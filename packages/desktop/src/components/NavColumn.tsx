import { useMemo, useState } from 'react';
import type { Channel } from '@kiroshi/shared';
import { selectors, useChannelsOfGuild, useStore, useVoiceMembersOf } from '../store/index.js';
import { gateway } from '../api/gateway.js';
import { voice } from '../voice/controller.js';
import { useIsSpeaking } from '../hooks/useVoice.js';
import { Avatar } from './Avatar.js';
import { DirectMessageList } from './DirectMessageList.js';
import { GuildMenu } from './GuildMenu.js';
import { CreateChannelModal } from './modals/CreateChannelModal.js';
import {
  Chevron,
  Hash,
  HeadphonesOff,
  Megaphone,
  MicOff,
  Plus,
  ScreenShare,
  Speaker,
  Video,
} from './Icons.js';

/**
 * Navegacao contextual: o que existe DENTRO do que esta selecionado.
 *
 * Canais quando ha um servidor aberto, conversas diretas quando nao ha. Os
 * icones de servidor saiam daqui para a barra global (`GlobalRail`).
 *
 * Por que a separacao. Antes esta coluna fazia as duas coisas: uma tira
 * horizontal de servidores no topo e os canais embaixo. Economizava 72px de
 * largura, e cobrava isso em clareza — com alguns servidores a tira rolava
 * lateralmente, e o destaque do servidor ativo disputava espaco com o nome
 * dele logo abaixo. Saber onde se esta vale mais que a largura.
 */
export function NavColumn() {
  const selectedGuildId = useStore((s) => s.selectedGuildId);
  const guild = useStore((s) => (selectedGuildId ? s.guilds.get(selectedGuildId) : null));

  const [criandoCanal, setCriandoCanal] = useState<{ parentId: string | null } | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());

  function alternarCategoria(id: string): void {
    setFechadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });
  }

  return (
    <nav className="nav" aria-label="Canais e conversas">
      {guild ? (
        <>
          {/*
            Botao, e nao um `div` com `onClick`.

            Daqui saem convidar pessoas, ajustes do servidor e sair dele. Como
            `div` nenhuma dessas acoes existia para quem nao usa mouse: o menu
            era inalcancavel, e com ele todas as acoes de servidor.
          */}
          <button
            type="button"
            className="nav-header"
            onClick={() => setMenuAberto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            aria-label={`${guild.name}. Acoes do servidor`}
          >
            <span>{guild.name}</span>
            <Chevron size={13} />
          </button>
          {menuAberto && <GuildMenu guildId={guild.id} onClose={() => setMenuAberto(false)} />}

          <div className="nav-scroll">
            <ArvoreDeCanais
              guildId={guild.id}
              fechadas={fechadas}
              onAlternar={alternarCategoria}
              onCriarCanal={(parentId) => setCriandoCanal({ parentId })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="nav-header" style={{ cursor: 'default' }}>
            <span>Mensagens diretas</span>
          </div>
          <div className="nav-scroll">
            <DirectMessageList />
          </div>
        </>
      )}

      {criandoCanal && guild && (
        <CreateChannelModal
          guildId={guild.id}
          parentId={criandoCanal.parentId}
          onClose={() => setCriandoCanal(null)}
        />
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------

interface ArvoreProps {
  guildId: string;
  fechadas: Set<string>;
  onAlternar: (id: string) => void;
  onCriarCanal: (parentId: string | null) => void;
}

function ArvoreDeCanais({ guildId, fechadas, onAlternar, onCriarCanal }: ArvoreProps) {
  const estado = useStore();
  const canais = useChannelsOfGuild(guildId);

  const { soltos, categorias } = useMemo(() => {
    const cats = canais.filter((c) => c.type === 'GUILD_CATEGORY');
    const resto = canais.filter((c) => c.type !== 'GUILD_CATEGORY');

    return {
      soltos: resto.filter((c) => !c.parentId),
      categorias: cats.map((categoria) => ({
        categoria,
        filhos: resto.filter((c) => c.parentId === categoria.id),
      })),
    };
  }, [canais]);

  return (
    <>
      {soltos.map((canal) => (
        <LinhaDeCanal key={canal.id} channel={canal} guildId={guildId} />
      ))}

      {categorias.map(({ categoria, filhos }) => {
        const fechada = fechadas.has(categoria.id);

        // Canal com mensagem nova continua visivel mesmo com a categoria
        // fechada; esconder o que pede atencao anula o proposito de avisar.
        const visiveis = fechada
          ? filhos.filter(
              (c) =>
                selectors.unreadCount(estado, c.id) > 0 ||
                c.id === estado.selectedChannelId ||
                selectors.voiceMembersOf(estado, c.id).length > 0,
            )
          : filhos;

        return (
          <div key={categoria.id}>
            <div className={`category ${fechada ? 'collapsed' : ''}`}>
              {/*
                O alternador e um botao SEPARADO, e nao a linha inteira.

                A linha ja contem o botao de criar canal, e botao dentro de
                botao nao e HTML valido — o navegador desmonta a marcacao e o
                resultado varia. Entao a linha continua sendo o `div` que
                desenha, e cada acao dentro dela tem o proprio botao.

                Antes o `onClick` estava no `div`: recolher uma categoria era
                impossivel sem mouse, e com a categoria fechada os canais
                dentro dela sumiam da ordem de tabulacao junto.
              */}
              <button
                type="button"
                className="category-alternar"
                onClick={() => onAlternar(categoria.id)}
                aria-expanded={!fechada}
                aria-label={`${categoria.name}, ${fechada ? 'fechada' : 'aberta'}`}
              >
                <Chevron size={11} className="chevron" />
                <span>{categoria.name}</span>
              </button>
              <button
                className="channel-action"
                onClick={() => onCriarCanal(categoria.id)}
                title="Criar canal"
                aria-label="Criar canal"
              >
                <Plus size={13} />
              </button>
            </div>
            {visiveis.map((canal) => (
              <LinhaDeCanal key={canal.id} channel={canal} guildId={guildId} />
            ))}
          </div>
        );
      })}

      {/*
        Botao, e nao um `div` com `onClick`.

        Como `div` ele nao entrava na ordem de tabulacao: "Criar canal" era
        inalcancavel sem mouse, e o dialogo que ele abre nao tinha para onde
        devolver o foco ao fechar. Um elemento que nao recebe foco nao pode
        recuperar o foco.
      */}
      <button type="button" className="category category-acao" onClick={() => onCriarCanal(null)}>
        <Plus size={11} />
        <span>Criar canal</span>
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function LinhaDeCanal({ channel, guildId }: { channel: Channel; guildId: string }) {
  const estado = useStore();
  const selecionado = useStore((s) => s.selectedChannelId);
  const selectChannel = useStore((s) => s.selectChannel);

  const ehVoz = channel.type === 'GUILD_VOICE';
  const naoLido = selectors.unreadCount(estado, channel.id) > 0;
  const mencoes = selectors.mentionCount(estado, channel.id);
  const presentes = useVoiceMembersOf(channel.id);

  function abrir(): void {
    if (ehVoz) {
      /*
        Entrar na voz tambem ABRE o canal.

        Antes so conectava, e o canal de texto de antes continuava na tela: o
        palco de video dividia o espaco com uma conversa que nao tinha nada a
        ver com a chamada, e sobrava pouca altura para as duas coisas. Um canal
        de voz e um lugar onde se esta, nao um interruptor.

        A selecao vem primeiro, antes de esperar o SFU: a tela muda no clique,
        e a chamada conecta com a pessoa ja olhando para o canal certo.
      */
      selectChannel(channel.id);

      // A conexao com o SFU vem por conta propria; o aviso pelo gateway vem
      // depois, para os outros verem quem entrou.
      void voice
        .joinChannel(channel.id, guildId)
        .then(() => {
          gateway.updateVoiceState({
            guildId,
            channelId: channel.id,
            selfMute: voice.getState().selfMuted,
            selfDeaf: voice.getState().selfDeafened,
          });
        })
        .catch(() => undefined);
      return;
    }
    selectChannel(channel.id);
  }

  const Icone = channel.type === 'GUILD_ANNOUNCEMENT' ? Megaphone : ehVoz ? Speaker : Hash;

  return (
    <>
      <div
        className={[
          'channel',
          // O canal de voz agora tambem fica destacado quando esta aberto:
          // ele e um lugar, e a pessoa precisa ver onde esta.
          selecionado === channel.id ? 'active' : '',
          naoLido && !ehVoz ? 'unread' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={abrir}
        role="button"
        tabIndex={0}
        // O tipo so aparecia como um icone diferente, o que nao serve para
        // quem usa leitor de tela nem para os testes que dirigem o app.
        data-tipo={channel.type}
        aria-label={`${ehVoz ? 'Canal de voz' : 'Canal'} ${channel.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') abrir();
        }}
      >
        <Icone size={15} className="channel-icon" />
        <span className="channel-name">{channel.name}</span>
        {ehVoz && channel.userLimit ? (
          <span className="channel-count">
            {presentes.length}/{channel.userLimit}
          </span>
        ) : null}
        {mencoes > 0 && <span className="channel-badge">{mencoes > 99 ? '99' : mencoes}</span>}
      </div>

      {presentes.length > 0 && (
        <div className="voice-roster">
          {presentes.map((p) => (
            <PessoaNaVoz key={p.userId} userId={p.userId} guildId={guildId} estado={p} />
          ))}
        </div>
      )}
    </>
  );
}

function PessoaNaVoz({
  userId,
  guildId,
  estado,
}: {
  userId: string;
  guildId: string;
  estado: {
    selfMute: boolean;
    selfDeaf: boolean;
    serverMute: boolean;
    selfVideo: boolean;
    selfStream: boolean;
  };
}) {
  const store = useStore();
  const usuario = useStore((s) => s.users.get(userId));
  const nome = selectors.displayNameOf(store, userId, guildId);

  // O indicador de fala vem do SFU, nao do gateway: e local e instantaneo.
  const falando = useIsSpeaking(userId);
  const mudo = estado.selfMute || estado.serverMute;

  return (
    <div className={`voice-person ${falando ? 'speaking' : ''}`}>
      <Avatar url={usuario?.avatarUrl} name={nome} size={21} className="speaking-ring" />
      <span className="voice-person-name">{nome}</span>
      <span className="voice-person-icons">
        {estado.selfStream && <ScreenShare size={12} />}
        {estado.selfVideo && <Video size={12} />}
        {estado.selfDeaf && <HeadphonesOff size={12} className="muted" />}
        {mudo && !estado.selfDeaf && <MicOff size={12} className="muted" />}
      </span>
    </div>
  );
}

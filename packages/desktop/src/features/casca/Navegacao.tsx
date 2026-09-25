import { useMemo, useState } from 'react';
import { Permission, has, type Channel } from '@kiroshi/shared';
import { ChevronDown, ChevronRight, Hash, Headphones, HeadphoneOff, LogOut, Megaphone, MicOff, Settings, UserPlus, Video, Volume2 } from 'lucide-react';
import { selectors, useChannelsOfGuild, usePrivateChannels, useStore, useVoiceMembersOf } from '../../store/index.js';
import { navegar, useRota } from '../../app/rotas.js';
import {
  Avatar,
  Contador,
  Menu,
  MenuConteudo,
  MenuGatilho,
  MenuItem,
  MenuSeparador,
  SeloVivo,
  cx,
} from '../../design/primitivos/index.js';
import { entrarNaVoz } from './acoesDeVoz.js';
import { useVoz } from './useVoz.js';
import { agruparCanais } from './organizar.js';
import { usePermissoesNoServidor } from '../../app/permissoes.js';
import { CartaoNaChamada } from '../chamada/CartaoNaChamada.js';
import { moverPara } from '../chamada/moderacao.js';

const ic = 'size-4 shrink-0';

// ---------------------------------------------------------------------------
// Canais do servidor
// ---------------------------------------------------------------------------

/** Tipo do arraste de uma pessoa entre canais de voz (so quem pode mover arrasta). */
const ARRASTE_DE_PESSOA = 'application/x-kiroshi-pessoa';

function PessoaNaVoz({ userId, guildId, canalId }: { userId: string; guildId: string; canalId: string }) {
  const nome = useStore((s) => selectors.displayNameOf(s, userId, guildId));
  const avatar = useStore((s) => s.users.get(userId)?.avatarUrl ?? null);
  const estado = useStore((s) => s.voiceStates.get(userId));
  const eu = useStore((s) => s.user?.id === userId);
  const podeMover = has(usePermissoesNoServidor(guildId), Permission.MOVE_MEMBERS);
  const [cartao, setCartao] = useState(false);
  // Quem fala so e conhecido de dentro da chamada: o SFU conta ao cliente.
  const falando = useVoz((v) => v.participants.some((p) => p.userId === userId && p.speaking));

  const mudo = estado?.selfMute || estado?.serverMute;
  const surdo = estado?.selfDeaf || estado?.serverDeaf;

  const linha = (
    <li
      className="flex h-7 items-center gap-2 pl-8 pr-2 text-13 text-texto-2"
      draggable={podeMover}
      onDragStart={(e) => {
        e.dataTransfer.setData(ARRASTE_DE_PESSOA, userId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={(e) => {
        // Botao direito: o mesmo cartao do palco (volume e, com permissao, moderacao).
        if (eu) return;
        e.preventDefault();
        setCartao(true);
      }}
    >
      <Avatar nome={nome} id={userId} url={avatar} tamanho={20} falando={falando} />
      <span className="min-w-0 flex-1 truncate">{nome}</span>
      <span className="flex items-center gap-1 text-texto-3">
        {estado?.selfStream ? <SeloVivo /> : null}
        {estado?.selfVideo ? <Video aria-label="câmera ligada" className="size-3.5" strokeWidth={1.5} /> : null}
        {surdo ? (
          <HeadphoneOff aria-label="ensurdecido" className="size-3.5 text-perigo" strokeWidth={1.5} />
        ) : mudo ? (
          <MicOff aria-label="microfone desligado" className="size-3.5 text-perigo" strokeWidth={1.5} />
        ) : null}
      </span>
    </li>
  );

  if (eu) return linha;
  return (
    <CartaoNaChamada userId={userId} guildId={guildId} canalId={canalId} transmitindo={Boolean(estado?.selfStream)} aberto={cartao} aoMudar={setCartao}>
      {linha}
    </CartaoNaChamada>
  );
}

function LinhaDeCanal({ canal, guildId, ativo }: { canal: Channel; guildId: string; ativo: boolean }) {
  const naoLido = useStore((s) => selectors.unreadCount(s, canal.id) > 0);
  const mencoes = useStore((s) => selectors.mentionCount(s, canal.id));
  const presentes = useVoiceMembersOf(canal.id);
  const ehVoz = canal.type === 'GUILD_VOICE';
  const Icone = ehVoz ? Volume2 : canal.type === 'GUILD_ANNOUNCEMENT' ? Megaphone : Hash;
  // Alvo de arrastar uma pessoa de outro canal de voz (mover, com permissao).
  const [recebendo, setRecebendo] = useState(false);

  function abrir() {
    // Abrir um canal de voz tambem entra nele: e um lugar onde se esta, nao um
    // interruptor. A tela muda no clique; a conexao vem em seguida.
    navegar({ tela: 'servidor', guildId, canalId: canal.id });
    if (ehVoz) void entrarNaVoz(canal.id, guildId);
  }

  return (
    <li
      onDragOver={(e) => {
        if (!ehVoz || !e.dataTransfer.types.includes(ARRASTE_DE_PESSOA)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setRecebendo(true);
      }}
      onDragLeave={() => setRecebendo(false)}
      onDrop={(e) => {
        setRecebendo(false);
        const userId = e.dataTransfer.getData(ARRASTE_DE_PESSOA);
        if (!ehVoz || !userId) return;
        e.preventDefault();
        void moverPara(guildId, userId, canal.id);
      }}
    >
      <button
        type="button"
        onClick={abrir}
        aria-current={ativo ? 'page' : undefined}
        className={cx(
          'relative flex h-[30px] w-full items-center gap-2 px-2 text-left text-14',
          recebendo && 'outline outline-1 -outline-offset-1 outline-acento',
          ativo ? 'bg-elevado text-texto' : naoLido ? 'font-semibold text-texto hover:bg-terminal' : 'text-texto-3 hover:bg-terminal hover:text-texto-2',
        )}
      >
        {ativo ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento shadow-brilho" /> : null}
        {!ativo && naoLido ? <span aria-hidden className="absolute -left-2 top-[11px] h-2 w-[3px] bg-texto" /> : null}
        <Icone aria-hidden className={cx(ic, ativo ? 'text-acento' : 'text-mudo')} strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">{canal.name}</span>
        {ehVoz && presentes.length > 0 ? (
          <span className="font-mono text-10 text-mudo">{presentes.length}</span>
        ) : null}
        <Contador valor={mencoes} rotulo="menções" />
      </button>
      {ehVoz && presentes.length > 0 ? (
        <ul aria-label={`Na chamada ${canal.name}`}>
          {presentes.map((p) => (
            <PessoaNaVoz key={p.userId} userId={p.userId} guildId={guildId} canalId={canal.id} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CabecalhoDoServidor({ guildId }: { guildId: string }) {
  const nome = useStore((s) => s.guilds.get(guildId)?.name ?? '');
  const membros = useStore((s) => s.guilds.get(guildId)?.memberCount ?? 0);

  return (
    <Menu>
      <MenuGatilho asChild>
        <button
          type="button"
          className="flex h-12 w-full shrink-0 items-center justify-between gap-2 border-b border-borda px-3.5 text-left hover:bg-terminal"
        >
          <span className="min-w-0">
            <span className="block truncate font-display text-18 font-bold tracking-[0.1em] text-texto">
              {nome.toUpperCase()}
            </span>
            <span className="block font-mono text-9 uppercase tracking-rotulo-largo text-mudo">
              // servidor · {membros} membros
            </span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />
        </button>
      </MenuGatilho>
      <MenuConteudo>
        <MenuItem icone={<UserPlus className="size-4" strokeWidth={1.5} />} desativado>
          Convidar pessoas (em breve)
        </MenuItem>
        <MenuItem
          icone={<Settings className="size-4" strokeWidth={1.5} />}
          aoEscolher={() => navegar({ tela: 'ajustes-servidor', guildId, pagina: 'visao-geral' })}
        >
          Ajustes do servidor
        </MenuItem>
        <MenuSeparador />
        <MenuItem icone={<LogOut className="size-4" strokeWidth={1.5} />} perigo desativado>
          Sair do servidor (em breve)
        </MenuItem>
      </MenuConteudo>
    </Menu>
  );
}

function CanaisDoServidor({ guildId, canalAtivo }: { guildId: string; canalAtivo: string | null }) {
  const canais = useChannelsOfGuild(guildId);
  const grupos = useMemo(() => agruparCanais(canais), [canais]);
  const [fechadas, setFechadas] = useState<ReadonlySet<string>>(new Set());

  return (
    <>
      <CabecalhoDoServidor guildId={guildId} />
      <div className="k-rolagem flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {grupos.map(({ categoria, canais: doGrupo }) => {
          const fechada = categoria ? fechadas.has(categoria.id) : false;
          // Categoria fechada ainda mostra o canal aberto, para nao perder de vista onde se esta.
          const visiveis = fechada ? doGrupo.filter((c) => c.id === canalAtivo) : doGrupo;
          return (
            <section key={categoria?.id ?? 'soltos'} aria-label={categoria?.name ?? 'Canais'} className="mt-3 first:mt-0">
              {categoria ? (
                <button
                  type="button"
                  aria-expanded={!fechada}
                  onClick={() =>
                    setFechadas((atual) => {
                      const proximo = new Set(atual);
                      if (proximo.has(categoria.id)) proximo.delete(categoria.id);
                      else proximo.add(categoria.id);
                      return proximo;
                    })
                  }
                  className="flex w-full items-center gap-1 px-1 pb-1 font-mono text-10 uppercase tracking-rotulo-largo text-mudo hover:text-texto-3"
                >
                  {fechada ? <ChevronRight aria-hidden className="size-3" /> : <ChevronDown aria-hidden className="size-3" />}
                  <span>// {categoria.name}</span>
                </button>
              ) : null}
              <ul className="flex flex-col gap-px">
                {visiveis.map((canal) => (
                  <LinhaDeCanal key={canal.id} canal={canal} guildId={guildId} ativo={canal.id === canalAtivo} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Conversas diretas
// ---------------------------------------------------------------------------

function LinhaDeConversa({ canal, ativo }: { canal: Channel; ativo: boolean }) {
  const eu = useStore((s) => s.user?.id ?? null);
  const outros = (canal.recipientIds ?? []).filter((id) => id !== eu);
  const primeiro = outros[0] ?? '';
  const nome = useStore((s) =>
    canal.type === 'GROUP_DM' && canal.name
      ? canal.name
      : outros.map((id) => s.users.get(id)?.displayName ?? s.users.get(id)?.username ?? '?').join(', '),
  );
  const avatar = useStore((s) => s.users.get(primeiro)?.avatarUrl ?? null);
  const status = useStore((s) => s.presences.get(primeiro)?.status ?? 'OFFLINE');
  const mencoes = useStore((s) => selectors.mentionCount(s, canal.id));
  const naoLido = useStore((s) => selectors.unreadCount(s, canal.id) > 0);

  return (
    <li>
      <button
        type="button"
        onClick={() => navegar({ tela: 'dm', canalId: canal.id })}
        aria-current={ativo ? 'page' : undefined}
        className={cx(
          'relative flex h-11 w-full items-center gap-2.5 px-2 text-left',
          ativo ? 'bg-elevado text-texto' : naoLido ? 'text-texto hover:bg-terminal' : 'text-texto-3 hover:bg-terminal hover:text-texto-2',
        )}
      >
        {ativo ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" /> : null}
        <Avatar nome={nome} id={primeiro || canal.id} url={avatar} tamanho={32} status={canal.type === 'DM' ? status : undefined} />
        <span className={cx('min-w-0 flex-1 truncate text-14', naoLido && 'font-semibold')}>{nome}</span>
        <Contador valor={mencoes} rotulo="mensagens novas" />
      </button>
    </li>
  );
}

function ConversasDiretas({ canalAtivo }: { canalAtivo: string | null }) {
  const conversas = usePrivateChannels();
  const pedidos = useStore((s) => selectors.pendingRequests(s).filter((r) => r.type === 'PENDING_INCOMING').length);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-borda px-3.5">
        <span className="font-display text-18 font-bold uppercase tracking-[0.1em]">
          Início
        </span>
      </div>
      <div className="k-rolagem flex-1 overflow-y-auto px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={() => navegar({ tela: 'inicio', aba: 'online' })}
          className="flex h-9 w-full items-center gap-2.5 px-2 text-14 text-texto-2 hover:bg-terminal hover:text-texto"
        >
          <Headphones aria-hidden className={ic} strokeWidth={1.5} />
          <span className="flex-1 text-left">Amigos</span>
          <Contador valor={pedidos} rotulo="pedidos de amizade" />
        </button>
        <p className="k-rotulo mb-1 mt-4 px-1">Conversas diretas</p>
        {conversas.length === 0 ? (
          <p className="px-2 py-2 text-13 text-texto-3">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {conversas.map((c) => (
              <LinhaDeConversa key={c.id} canal={c} ativo={c.id === canalAtivo} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Coluna de navegacao: os canais do servidor aberto, ou as conversas diretas no inicio. */
export function Navegacao(): React.JSX.Element {
  const rota = useRota();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rota.tela === 'servidor' || rota.tela === 'ajustes-servidor' ? (
        <CanaisDoServidor guildId={rota.guildId} canalAtivo={rota.tela === 'servidor' ? rota.canalId : null} />
      ) : (
        <ConversasDiretas canalAtivo={rota.tela === 'dm' ? rota.canalId : null} />
      )}
    </div>
  );
}

import { useEffect, useState, type RefObject } from 'react';
import { api } from '../api/client.js';
import { selectors, useRelationships, useStore } from '../store/index.js';
import { voice } from '../voice/controller.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { Popover } from './ui/Popover.js';
import { ProfileCard } from './ui/ProfileCard.js';
import { Check, Monitor, Plus, Mic } from './Icons.js';

/**
 * O cartao que abre no botao direito sobre uma pessoa.
 *
 * Junta, num lugar so, tudo que se quer fazer com alguem durante uma chamada:
 * ver quem e, ajustar o volume dela, ajustar o volume da transmissao dela, e
 * adicionar como amigo. Antes nada disso existia — o volume por pessoa estava
 * no controlador desde sempre e nenhuma tela o expunha.
 *
 * Por que botao direito e nao um menu de tres pontos: o alvo e o proprio
 * quadro de video ou a linha da pessoa, que ja esta ali e e grande. Um botao
 * de acoes precisaria caber dentro do quadro, competindo com o rosto e com os
 * controles de destaque e tela cheia que ja disputam aquele canto.
 *
 * Os dois volumes sao separados porque resolvem coisas diferentes: quem
 * transmite um jogo manda o som do jogo alto pelo mesmo canal em que fala.
 * Com um controle so, abaixar a trilha sonora significava parar de ouvir o
 * amigo.
 */

export interface CartaoDePessoaProps {
  userId: string;
  guildId: string | null;
  ancora: RefObject<HTMLElement | null>;
  aberto: boolean;
  aoFechar: () => void;
}

export function CartaoDePessoa({ userId, guildId, ancora, aberto, aoFechar }: CartaoDePessoaProps) {
  const store = useStore();
  const usuario = useStore((s) => s.users.get(userId));
  const eu = useStore((s) => s.user);
  const presenca = useStore((s) => s.presences.get(userId));
  const relacoes = useRelationships();
  const voz = useVoiceState();

  const [volumeDeVoz, setVolumeDeVoz] = useState(() => voice.getUserVolume(userId));
  const [volumeDaTela, setVolumeDaTela] = useState(() => voice.getScreenVolume(userId));
  const [pedido, setPedido] = useState<'nada' | 'enviando' | 'enviado' | 'erro'>('nada');

  /*
    Recarrega os volumes ao abrir para OUTRA pessoa.

    Sem isto o cartao levaria consigo o valor de quem foi aberto antes: os
    estados nascem uma vez, e o componente e o mesmo para todo mundo.
  */
  useEffect(() => {
    setVolumeDeVoz(voice.getUserVolume(userId));
    setVolumeDaTela(voice.getScreenVolume(userId));
    setPedido('nada');
  }, [userId]);

  if (!usuario || !aberto) return null;

  const souEu = userId === eu?.id;
  const nome = selectors.displayNameOf(store, userId, guildId);
  const naChamada = voz.participants.some((p) => p.userId === userId);
  const relacao = relacoes.find((r) => r.user.id === userId);
  const jaEhAmigo = relacao?.type === 'FRIEND';
  /*
    Quem MANDOU o pedido muda o que o cartao oferece.

    A primeira versao tratava os dois pendentes como um so e dizia "pedido
    enviado" tambem para quem tinha me mandado um — escondendo justamente a
    acao que importa ali, que e aceitar.
  */
  const pedidoQueRecebi = relacao?.type === 'PENDING_INCOMING' ? relacao : null;
  const pedidoQueEnviei = relacao?.type === 'PENDING_OUTGOING';
  // So aparece se a pessoa esta mesmo mandando som — ver `temAudioDeTransmissao`.
  const temSomDeTela = voice.temAudioDeTransmissao(userId);

  async function adicionar(): Promise<void> {
    if (!usuario) return;
    setPedido('enviando');
    try {
      await api.post('/relationships', { username: usuario.username });
      setPedido('enviado');
    } catch {
      setPedido('erro');
    }
  }

  async function aceitar(id: string): Promise<void> {
    setPedido('enviando');
    try {
      await api.put(`/relationships/${id}`);
      // O resto vem pelo gateway: RELATIONSHIP_UPDATE troca a relacao por
      // FRIEND e o cartao passa a mostrar "voces ja sao amigos" sozinho.
      setPedido('nada');
    } catch {
      setPedido('erro');
    }
  }

  return (
    <Popover ancora={ancora} aberto={aberto} aoFechar={aoFechar} rotulo={`Sobre ${nome}`}>
      <div className="cartao-pessoa">
        <ProfileCard
          displayName={nome}
          username={usuario.username}
          avatarUrl={usuario.avatarUrl}
          bannerUrl={usuario.bannerUrl}
          bio={usuario.bio}
          pronouns={usuario.pronouns}
          accentColor={usuario.accentColor}
          status={presenca?.status ?? 'OFFLINE'}
        />

        {/*
          Volume so faz sentido para quem esta na chamada AGORA, e nunca para
          mim mesmo: nao me escuto, entao o controle nao teria efeito nenhum.
        */}
        {naChamada && !souEu && (
          <div className="cartao-volumes">
            <Controle
              icone={<Mic size={14} />}
              rotulo={`Voz de ${nome}`}
              valor={volumeDeVoz}
              aoMudar={(v) => {
                setVolumeDeVoz(v);
                voice.setUserVolume(userId, v);
              }}
            />

            {temSomDeTela && (
              <Controle
                icone={<Monitor size={14} />}
                rotulo={`Som da transmissao de ${nome}`}
                valor={volumeDaTela}
                aoMudar={(v) => {
                  setVolumeDaTela(v);
                  voice.setScreenVolume(userId, v);
                }}
              />
            )}
          </div>
        )}

        {!souEu && (
          <div className="cartao-pessoa-acoes">
            {jaEhAmigo ? (
              <span className="cartao-ja-amigo">
                <Check size={14} /> Voces ja sao amigos
              </span>
            ) : pedidoQueRecebi ? (
              <button
                className="btn btn-primary"
                onClick={() => void aceitar(pedidoQueRecebi.id)}
                disabled={pedido === 'enviando'}
              >
                <Check size={14} />
                {pedido === 'enviando' ? 'Aceitando...' : 'Aceitar pedido'}
              </button>
            ) : pedidoQueEnviei || pedido === 'enviado' ? (
              <span className="cartao-ja-amigo">
                <Check size={14} /> Pedido enviado
              </span>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void adicionar()}
                disabled={pedido === 'enviando'}
              >
                <Plus size={14} />
                {pedido === 'enviando' ? 'Enviando...' : 'Adicionar amigo'}
              </button>
            )}

            {pedido === 'erro' && (
              <span className="cartao-erro">Nao consegui enviar o pedido.</span>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------

/**
 * Um controle de volume com rotulo e porcentagem.
 *
 * `range` nativo de proposito: ele ja vem com teclado (setas, Home, End),
 * arrasto e leitura correta em leitor de tela. Um deslizante desenhado a mao
 * teria que reconstruir tudo isso, e normalmente reconstroi so o arrasto.
 */
function Controle({
  icone,
  rotulo,
  valor,
  aoMudar,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: number;
  aoMudar: (v: number) => void;
}) {
  const porcento = Math.round(valor * 100);

  return (
    <label className="cartao-volume">
      <span className="cartao-volume-icone" aria-hidden="true">
        {icone}
      </span>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={porcento}
        onChange={(e) => aoMudar(Number(e.target.value) / 100)}
        aria-label={rotulo}
        // O leitor de tela diria "120" sem isto, sem dizer 120 de que.
        aria-valuetext={`${porcento} por cento`}
      />
      <span className="cartao-volume-valor mono">{porcento}%</span>
    </label>
  );
}

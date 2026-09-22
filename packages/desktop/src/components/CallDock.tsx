import { selectors, useStore } from '../store/index.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { useChamadaDeFundo } from '../hooks/useChamadaDeFundo.js';
import { CallControls } from './CallControls.js';
import { Avatar } from './Avatar.js';
import { Speaker, Chevron } from './Icons.js';

/**
 * A chamada que continua rodando enquanto voce esta lendo outra coisa.
 *
 * O problema que isto resolve e de orientacao, nao de controle. Sair de um
 * canal de voz para ler um canal de texto mantinha a chamada de pe — o audio
 * continuava, o video continuava — e a unica pista disso era o nome do canal
 * em letra pequena na barra de baixo, do lado do avatar, no meio dos
 * controles de presenca. Ja aconteceu de ficar falando para um canal que nao
 * e o que se esta olhando.
 *
 * Entao a barra diz as tres coisas que faltavam: que ha uma chamada, ONDE ela
 * e, e como voltar para ela em um clique.
 *
 * So aparece quando o canal aberto NAO e o da chamada. Dentro do proprio
 * canal de voz ela seria redundante com o palco logo abaixo.
 *
 * Nesta situacao ela e a UNICA faixa: o palco menor esconde a barra dele
 * enquanto este dock existe, e por isso o botao de recolher mora aqui. A
 * primeira montagem deixou as duas, e o resultado eram duas linhas dizendo a
 * mesma coisa uma em cima da outra.
 */
interface Props {
  recolhido: boolean;
  aoAlternarRecolhido: () => void;
}

export function CallDock({ recolhido, aoAlternarRecolhido }: Props) {
  const voz = useVoiceState();
  const store = useStore();
  const selectChannel = useStore((s) => s.selectChannel);
  const canal = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));
  const emSegundoPlano = useChamadaDeFundo();

  if (!emSegundoPlano) return null;

  const outros = voz.participants.filter((p) => !p.isLocal);
  const falando = outros.filter((p) => p.speaking);

  return (
    <div className="dock-chamada">
      <button
        className="dock-voltar"
        onClick={() => selectChannel(voz.channelId!)}
        // O rotulo diz para onde se vai, e nao "voltar": fora de contexto,
        // "voltar" nao informa nada a quem usa leitor de tela.
        aria-label={`Voltar para a chamada em ${canal?.name ?? 'canal de voz'}`}
      >
        <span className={`dock-farol ${falando.length > 0 ? 'ativo' : ''}`} aria-hidden="true">
          <Speaker size={14} />
        </span>
        <span className="dock-texto">
          <span className="dock-titulo">{canal?.name ?? 'Canal de voz'}</span>
          <span className="dock-sub">
            {voz.connecting && !voz.connected
              ? 'Entrando...'
              : falando.length > 0
                ? `${selectors.displayNameOf(store, falando[0]!.userId, canal?.guildId ?? null)}${falando.length > 1 ? ` e mais ${falando.length - 1}` : ''} falando`
                : `${voz.participants.length} na chamada`}
          </span>
        </span>
      </button>

      {/*
        Os rostos de quem esta la. E o que responde "vale a pena voltar?" sem
        precisar voltar — e o anel de quem fala ja existe no avatar.
      */}
      <div className="dock-gente">
        {outros.slice(0, 5).map((p) => {
          const usuario = store.users.get(p.userId);
          const nome = selectors.displayNameOf(store, p.userId, canal?.guildId ?? null);
          return (
            <span
              key={p.userId}
              className={p.speaking ? 'dock-rosto falando' : 'dock-rosto'}
              title={nome}
            >
              <Avatar url={usuario?.avatarUrl} name={nome} size={22} />
            </span>
          );
        })}
        {outros.length > 5 && <span className="dock-resto">+{outros.length - 5}</span>}
      </div>

      <CallControls compacto />

      {/*
        Recolher o palco. O botao vive aqui porque a barra do palco esta
        escondida nesta situacao — sem isto, esconder a barra tiraria uma
        funcao que existia.
      */}
      <button
        className="act"
        onClick={aoAlternarRecolhido}
        title={recolhido ? 'Mostrar o video' : 'Recolher o video'}
        aria-label={recolhido ? 'Mostrar o video' : 'Recolher o video'}
        aria-pressed={recolhido}
      >
        <Chevron size={15} style={recolhido ? { transform: 'rotate(180deg)' } : undefined} />
      </button>
    </div>
  );
}

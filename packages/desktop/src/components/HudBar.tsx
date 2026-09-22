import { useState } from 'react';
import type { PresenceStatus } from '@kiroshi/shared';
import { useStore } from '../store/index.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { Avatar } from './Avatar.js';
import { StatusMenu } from './StatusMenu.js';
import { CallControls } from './CallControls.js';
import { Settings } from './Icons.js';

interface Props {
  onOpenSettings: () => void;
}

/**
 * Barra inferior: quem voce e, o que o microfone esta fazendo, e como esta a
 * conexao.
 *
 * Ocupa a largura toda de proposito. Os controles de voz sao o que a pessoa
 * mais procura, e ficavam espremidos em um canto da lateral; aqui tem lugar
 * fixo, sempre no mesmo pixel, com a telemetria do lado — que e a informacao
 * que se quer justamente quando algo esta ruim.
 *
 * Os botoes em si nao moram mais aqui. Eram uma copia dos mesmos cinco
 * controles que agora ficam abaixo do palco, e duas copias de cinco botoes com
 * estado e uma divergencia esperando acontecer: bastaria uma correcao entrar
 * de um lado so para o microfone dizer uma coisa no rodape e outra no palco.
 *
 * O aviso de erro tambem saiu. Ele era um texto solto que aparecia e ficava —
 * ate reiniciar o aplicativo — e agora e o `CallStatus`, que fica junto do
 * palco, diz o que continua funcionando e oferece o que fazer a respeito.
 */
export function HudBar({ onOpenSettings }: Props) {
  const usuario = useStore((s) => s.user);
  const presenca = useStore((s) => (s.user ? s.presences.get(s.user.id) : undefined));
  const voz = useVoiceState();
  const canalDeVoz = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));

  const [statusAberto, setStatusAberto] = useState(false);

  if (!usuario) return null;

  const status: PresenceStatus = presenca?.status ?? usuario.status;
  const naChamada = voz.connected || voz.connecting;

  // A qualidade e lida pela latencia porque e o que a pessoa sente: ate 60 ms
  // a conversa flui, acima de 150 ms comeca a atrapalhar o ritmo de quem fala.
  const ping = voz.ping;
  const grau = ping === null ? '' : ping < 60 ? 'good' : ping < 150 ? 'ok' : 'bad';

  return (
    <div className="hud">
      {/*
        Botao, e nao um `div` com `onClick`.

        Este e o unico caminho para trocar o proprio estado de presenca. Como
        `div` ele nao recebia foco, entao ficar invisivel ou "nao perturbe"
        era impossivel sem mouse — e "nao perturbe" e justamente o que se quer
        quando nao da para ficar mexendo na tela.
      */}
      <button
        type="button"
        className="hud-identity"
        onClick={() => setStatusAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={statusAberto}
        aria-label={`${usuario.displayName}, ${rotulo(status)}. Mudar presenca`}
      >
        <Avatar url={usuario.avatarUrl} name={usuario.displayName} size={30} status={status} />
        <div className="hud-identity-text">
          <div className="hud-name">{usuario.displayName}</div>
          {/*
            Reconectar precisa aparecer. Antes, perder a midia deixava so um
            "--" na latencia: a pessoa continuava vendo o nome do canal, sem
            audio e sem nenhuma pista de que algo estava errado.
          */}
          <div className={`hud-sub ${voz.connecting && voz.connected ? 'reconectando' : ''}`}>
            {voz.connecting && voz.connected
              ? 'Reconectando…'
              : naChamada && canalDeVoz
                ? canalDeVoz.name
                : (usuario.customStatus ?? rotulo(status))}
          </div>
        </div>
      </button>

      {statusAberto && <StatusMenu onClose={() => setStatusAberto(false)} />}

      <div className="hud-divider" />

      <CallControls compacto />

      <div className="hud-spacer" />

      {naChamada && (
        <>
          <div className="hud-telemetry">
            <div
              className="hud-metric"
              title={
                ping === null
                  ? 'Medindo a latencia ate o servidor'
                  : `${ping} ms ate o servidor` +
                    (ping < 60 ? ' — excelente' : ping < 150 ? ' — boa' : ' — alta')
              }
            >
              <span className={`signal ${grau}`}>
                <span />
                <span />
                <span />
                <span />
              </span>
              <span className="hud-metric-value">{ping === null ? '--' : `${ping}ms`}</span>
            </div>
          </div>
          <div className="hud-divider" />
        </>
      )}

      <button className="act" onClick={onOpenSettings} title="Ajustes" aria-label="Ajustes">
        <Settings size={17} />
      </button>
    </div>
  );
}

function rotulo(status: PresenceStatus): string {
  switch (status) {
    case 'ONLINE':
      return 'Disponivel';
    case 'IDLE':
      return 'Ausente';
    case 'DND':
      return 'Nao perturbe';
    default:
      return 'Invisivel';
  }
}

import { useEffect, useState } from 'react';
import type { ConnectionState } from '../api/gateway.js';
import { useStore } from '../store/index.js';
import { Close, Maximize, Minimize, Restore } from './Icons.js';
import { Mark } from './Mark.js';

interface Props {
  connection: ConnectionState;
}

const ESTADO: Partial<Record<ConnectionState, { texto: string; grave: boolean }>> = {
  connecting: { texto: 'conectando', grave: false },
  identifying: { texto: 'entrando', grave: false },
  reconnecting: { texto: 'reconectando', grave: false },
  failed: { texto: 'sem conexao', grave: true },
};

export function TitleBar({ connection }: Props) {
  const [maximized, setMaximized] = useState(false);

  // O servidor aberto aparece na barra de titulo, nao so na lateral: com a
  // coluna de navegacao estreita, e onde o contexto cabe sem competir.
  const guild = useStore((s) => (s.selectedGuildId ? s.guilds.get(s.selectedGuildId) : null));
  const channel = useStore((s) => (s.selectedChannelId ? s.channels.get(s.selectedChannelId) : null));

  useEffect(() => {
    void window.kiroshi.window.isMaximized().then(setMaximized);
    return window.kiroshi.window.onMaximizedChange(setMaximized);
  }, []);

  const estado = ESTADO[connection];

  const contexto = guild
    ? `${guild.name}${channel?.name ? ` / ${channel.name}` : ''}`
    : 'Mensagens diretas';

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <Mark size={14} className="titlebar-mark" />
        <span>Kiroshi</span>
      </div>

      <div className="titlebar-context">{contexto}</div>

      <div className="titlebar-spacer" />

      {estado && (
        <div style={{ paddingRight: 10 }}>
          <span className={`status-pill ${estado.grave ? 'bad' : 'warn'}`}>{estado.texto}</span>
        </div>
      )}

      <div className="titlebar-controls">
        <button
          className="titlebar-button"
          onClick={() => window.kiroshi.window.minimize()}
          aria-label="Minimizar"
        >
          <Minimize />
        </button>
        <button
          className="titlebar-button"
          onClick={() => window.kiroshi.window.maximize()}
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        >
          {maximized ? <Restore /> : <Maximize />}
        </button>
        <button
          className="titlebar-button close"
          onClick={() => window.kiroshi.window.close()}
          aria-label="Fechar"
        >
          <Close size={15} />
        </button>
      </div>
    </div>
  );
}

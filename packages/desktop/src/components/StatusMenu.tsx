import { useEffect, useRef, useState } from 'react';
import type { PresenceStatus } from '@kiroshi/shared';
import { useStore } from '../store/index.js';
import { gateway } from '../api/gateway.js';
import { api } from '../api/client.js';

interface Props {
  onClose: () => void;
}

const OPTIONS: { status: PresenceStatus; label: string; hint: string; color: string }[] = [
  { status: 'ONLINE', label: 'Disponivel', hint: '', color: 'var(--on)' },
  { status: 'IDLE', label: 'Ausente', hint: '', color: 'var(--away)' },
  {
    status: 'DND',
    label: 'Nao perturbe',
    hint: 'Sem notificacoes na tela',
    color: 'var(--busy)',
  },
  {
    status: 'OFFLINE',
    label: 'Invisivel',
    hint: 'Voce continua usando normalmente',
    color: 'var(--off)',
  },
];

export function StatusMenu({ onClose }: Props) {
  const user = useStore((s) => s.user);
  const [customStatus, setCustomStatus] = useState(user?.customStatus ?? '');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou com Escape, como qualquer menu.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    // O timeout evita que o mesmo clique que abriu o menu ja o feche.
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function choose(status: PresenceStatus): void {
    gateway.updatePresence(status, customStatus || null);
    onClose();
  }

  async function saveCustom(): Promise<void> {
    const trimmed = customStatus.trim();
    gateway.updatePresence(user?.status ?? 'ONLINE', trimmed || null);
    await api
      .patch('/users/@me/presence', {
        status: user?.status ?? 'ONLINE',
        customStatus: trimmed || null,
      })
      .catch(() => undefined);
    onClose();
  }

  return (
    <div
      ref={ref}
      className="menu"
      style={{ bottom: 64, left: 8, width: 236 }}
      role="menu"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.status}
          className="menu-item"
          onClick={() => choose(option.status)}
          role="menuitem"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                background: option.color,
                flexShrink: 0,
              }}
            />
            <span style={{ textAlign: 'left' }}>
              <div>{option.label}</div>
              {option.hint && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{option.hint}</div>
              )}
            </span>
          </span>
        </button>
      ))}

      <div className="menu-sep" />

      <div style={{ padding: '4px 8px 8px' }}>
        <input
          value={customStatus}
          onChange={(e) => setCustomStatus(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveCustom();
          }}
          placeholder="Status personalizado"
          maxLength={128}
          style={{ fontSize: 13, padding: '7px 9px' }}
        />
      </div>
    </div>
  );
}

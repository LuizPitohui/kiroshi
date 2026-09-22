import { useState } from 'react';
import type { Channel, ChannelType } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { Hash, Megaphone, Speaker } from '../Icons.js';
import { Dialog } from '../ui/Dialog.js';
import { InlineAlert } from '../ui/InlineAlert.js';

interface Props {
  guildId: string;
  parentId: string | null;
  onClose: () => void;
}

const TYPES: { type: ChannelType; label: string; hint: string; Icon: typeof Hash }[] = [
  { type: 'GUILD_TEXT', label: 'Texto', hint: 'Mensagens, imagens e arquivos', Icon: Hash },
  { type: 'GUILD_VOICE', label: 'Voz', hint: 'Conversa, video e tela', Icon: Speaker },
  {
    type: 'GUILD_ANNOUNCEMENT',
    label: 'Anuncios',
    hint: 'So quem tem permissao escreve',
    Icon: Megaphone,
  },
  { type: 'GUILD_CATEGORY', label: 'Categoria', hint: 'Agrupa outros canais', Icon: Hash },
];

export function CreateChannelModal({ guildId, parentId, onClose }: Props) {
  const [type, setType] = useState<ChannelType>('GUILD_TEXT');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upsertChannel = useStore((s) => s.upsertChannel);
  const selectChannel = useStore((s) => s.selectChannel);

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);

    try {
      const channel = await api.post<Channel>(`/guilds/${guildId}/channels`, {
        name: normalizeName(trimmed, type),
        type,
        ...(parentId && type !== 'GUILD_CATEGORY' ? { parentId } : {}),
      });
      upsertChannel(channel);
      if (type === 'GUILD_TEXT' || type === 'GUILD_ANNOUNCEMENT') selectChannel(channel.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui criar o canal.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Criar canal"
      acoes={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void create()}
            disabled={busy || !name.trim()}
          >
            {busy ? 'Criando...' : 'Criar canal'}
          </button>
        </>
      }
    >
      <>
        <div className="field">
          <span className="field-label">Tipo de canal</span>
          {TYPES.map((option) => (
            <button
              key={option.type}
              onClick={() => setType(option.type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: 12,
                marginBottom: 6,
                borderRadius: 'var(--r)',
                background: type === option.type ? 'var(--active)' : 'var(--raised)',
                border: `1px solid ${type === option.type ? 'var(--optic)' : 'transparent'}`,
                textAlign: 'left',
              }}
            >
              <option.Icon size={20} />
              <span style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{option.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{option.hint}</div>
              </span>
            </button>
          ))}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="channel-name">
            Nome do canal
          </label>
          <input
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            placeholder={type === 'GUILD_VOICE' ? 'Jogatina' : 'novo-canal'}
            maxLength={100}
            autoFocus
          />
          {type !== 'GUILD_VOICE' && type !== 'GUILD_CATEGORY' && (
            <div className="field-hint">
              Espacos viram tracos, como em canais de texto por toda parte.
            </div>
          )}
        </div>

        {error && <InlineAlert tipo="erro">{error}</InlineAlert>}
      </>
    </Dialog>
  );
}

/** Canais de texto usam minusculas com tracos; voz e categoria ficam livres. */
function normalizeName(name: string, type: ChannelType): string {
  if (type === 'GUILD_VOICE' || type === 'GUILD_CATEGORY') return name;
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_À-ɏ]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

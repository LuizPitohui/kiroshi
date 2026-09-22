import { useEffect, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore, selectors } from '../../store/index.js';
import { Avatar } from '../Avatar.js';
import { MessageContent } from '../MessageContent.js';
import { Dialog } from '../ui/Dialog.js';

interface Props {
  channelId: string;
  onClose: () => void;
}

export function PinsModal({ channelId, onClose }: Props) {
  const [pins, setPins] = useState<Message[] | null>(null);
  const store = useStore();
  const guildId = useStore((s) => s.channels.get(channelId)?.guildId ?? null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Message[]>(`/channels/${channelId}/pins`)
      .then((items) => !cancelled && setPins(items))
      .catch(() => !cancelled && setPins([]));
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  async function unpin(messageId: string): Promise<void> {
    await api.delete(`/channels/${channelId}/pins/${messageId}`).catch(() => undefined);
    setPins((current) => current?.filter((m) => m.id !== messageId) ?? null);
  }

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Mensagens fixadas"
      acoes={
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <>
        {pins === null ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
            <div className="spinner" />
          </div>
        ) : pins.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <div>
              <h3>Nada fixado ainda</h3>
              <p>Fixe uma mensagem para encontra-la depois sem rolar a conversa.</p>
            </div>
          </div>
        ) : (
          pins.map((message) => (
            <div
              key={message.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: 12,
                background: 'var(--raised)',
                borderRadius: 'var(--r-md)',
                marginBottom: 8,
              }}
            >
              <Avatar url={message.author.avatarUrl} name={message.author.displayName} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>
                    {selectors.displayNameOf(store, message.authorId, guildId)}
                  </strong>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {new Date(message.createdAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <MessageContent content={message.content} guildId={guildId} />
              </div>
              <button
                className="btn-quiet"
                style={{ fontSize: 12, alignSelf: 'flex-start' }}
                onClick={() => void unpin(message.id)}
              >
                desafixar
              </button>
            </div>
          ))
        )}
      </>
    </Dialog>
  );
}

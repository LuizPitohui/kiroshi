import { useEffect, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore, selectors } from '../../store/index.js';
import { Avatar } from '../Avatar.js';
import { MessageContent } from '../MessageContent.js';
import { Dialog } from '../ui/Dialog.js';

interface Props {
  channelId: string;
  guildId: string | null;
  onClose: () => void;
}

export function SearchModal({ channelId, guildId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'channel' | 'guild'>(guildId ? 'guild' : 'channel');
  const [results, setResults] = useState<Message[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);

  const store = useStore();
  const selectChannel = useStore((s) => s.selectChannel);
  const abortRef = useRef<AbortController | null>(null);

  // Busca com atraso: digitar rapido nao deve gerar um pedido por tecla.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearching(true);
      const path =
        scope === 'guild' && guildId
          ? `/guilds/${guildId}/messages/search?query=${encodeURIComponent(query.trim())}`
          : `/channels/${channelId}/messages/search?query=${encodeURIComponent(query.trim())}`;

      api
        .get<{ messages: Message[]; total: number }>(path, { signal: controller.signal })
        .then((data) => {
          setResults(data.messages);
          setTotal(data.total);
          setSearching(false);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          setResults([]);
          setSearching(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, scope, channelId, guildId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Buscar mensagens"
      largura={720}
      acoes={
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="O que voce procura?"
          autoFocus
        />

        {guildId && (
          <div className="tabs" style={{ marginTop: 12 }}>
            <button
              className={`tab ${scope === 'guild' ? 'active' : ''}`}
              onClick={() => setScope('guild')}
            >
              Servidor inteiro
            </button>
            <button
              className={`tab ${scope === 'channel' ? 'active' : ''}`}
              onClick={() => setScope('channel')}
            >
              So neste canal
            </button>
          </div>
        )}

        {searching && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        )}

        {results && !searching && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-faint)', margin: '14px 0 8px' }}>
              {total === 0 ? 'Nada encontrado.' : `${total} resultado${total === 1 ? '' : 's'}`}
            </div>

            {results.map((message) => {
              const channel = store.channels.get(message.channelId);
              return (
                <div
                  key={message.id}
                  onClick={() => {
                    selectChannel(message.channelId);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: 12,
                    background: 'var(--raised)',
                    borderRadius: 'var(--r-md)',
                    marginBottom: 8,
                    cursor: 'pointer',
                  }}
                >
                  <Avatar
                    url={message.author.avatarUrl}
                    name={message.author.displayName}
                    size={36}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>
                        {selectors.displayNameOf(store, message.authorId, message.guildId)}
                      </strong>
                      {channel?.name && (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                          #{channel.name}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {new Date(message.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <MessageContent content={message.content} guildId={message.guildId} />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </>
    </Dialog>
  );
}

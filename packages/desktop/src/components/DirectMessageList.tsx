import { useState } from 'react';
import type { Channel } from '@kiroshi/shared';
import { api } from '../api/client.js';
import { useStore, selectors, usePrivateChannels, useRelationships } from '../store/index.js';
import { Avatar } from './Avatar.js';
import { Close, Plus, Users } from './Icons.js';

/** Barra lateral quando nenhum servidor esta selecionado: amigos e conversas. */
export function DirectMessageList() {
  const store = useStore();
  const selfId = useStore((s) => s.user?.id);
  const channels = usePrivateChannels();
  const relationships = useRelationships();
  const selectedChannelId = useStore((s) => s.selectedChannelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const upsertChannel = useStore((s) => s.upsertChannel);

  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const pending = relationships.filter((r) => r.type === 'PENDING_INCOMING');
  const friends = relationships.filter((r) => r.type === 'FRIEND');

  async function openDm(userId: string): Promise<void> {
    // Se ja existe uma conversa com essa pessoa, abre a existente.
    const existing = channels.find(
      (c) => c.type === 'DM' && c.recipientIds.includes(userId),
    );
    if (existing) {
      selectChannel(existing.id);
      return;
    }

    const channel = await api
      .post<Channel>('/users/@me/channels', { recipientIds: [userId] })
      .catch(() => null);
    if (!channel) return;

    upsertChannel(channel);
    selectChannel(channel.id);
  }

  async function sendRequest(): Promise<void> {
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) return;

    try {
      await api.post('/relationships', { username: trimmed });
      setFeedback('Pedido enviado.');
      setUsername('');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Nao consegui enviar o pedido.');
    }
  }

  function labelFor(channel: Channel): string {
    if (channel.type === 'GROUP_DM') {
      if (channel.name) return channel.name;
      const names = channel.recipientIds
        .filter((id) => id !== selfId)
        .map((id) => store.users.get(id)?.displayName ?? '?')
        .slice(0, 3);
      return names.join(', ') || 'Grupo';
    }
    const other = channel.recipientIds.find((id) => id !== selfId);
    return other ? selectors.displayNameOf(store, other, null) : 'Conversa';
  }

  return (
    <>
      <div
        className="channel"
        onClick={() => setAdding((v) => !v)}
        style={{ marginBottom: 8 }}
      >
        <Plus size={18} className="channel-icon" />
        <span className="channel-name">Adicionar amigo</span>
      </div>

      {adding && (
        <div style={{ padding: '0 8px 12px' }}>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFeedback(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendRequest();
            }}
            placeholder="nome de usuario"
            style={{ fontSize: 13, padding: '7px 9px' }}
            autoFocus
          />
          {feedback && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
              {feedback}
            </div>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <>
          <div className="category">
            <span style={{ flex: 1 }}>Pedidos de amizade — {pending.length}</span>
          </div>
          {pending.map((relationship) => (
            <div key={relationship.id} className="channel" style={{ gap: 8 }}>
              <Avatar
                url={relationship.user.avatarUrl}
                name={relationship.user.displayName}
                size={24}
              />
              <span className="channel-name">{relationship.user.displayName}</span>
              <button
                className="channel-action"
                style={{ opacity: 1, color: 'var(--on)' }}
                title="Aceitar"
                aria-label="Aceitar"
                onClick={(e) => {
                  e.stopPropagation();
                  void api.put(`/relationships/${relationship.id}`).catch(() => undefined);
                }}
              >
                <Plus size={16} />
              </button>
              <button
                className="channel-action"
                style={{ opacity: 1, color: 'var(--red)' }}
                title="Recusar"
                aria-label="Recusar"
                onClick={(e) => {
                  e.stopPropagation();
                  void api.delete(`/relationships/${relationship.id}`).catch(() => undefined);
                }}
              >
                <Close size={16} />
              </button>
            </div>
          ))}
        </>
      )}

      {friends.length > 0 && (
        <>
          <div className="category">
            <span style={{ flex: 1 }}>Amigos — {friends.length}</span>
          </div>
          {friends.map((relationship) => {
            const status = store.presences.get(relationship.user.id)?.status ?? 'OFFLINE';
            return (
              <div
                key={relationship.id}
                className="channel"
                onClick={() => void openDm(relationship.user.id)}
                style={{ gap: 8 }}
              >
                <Avatar
                  url={relationship.user.avatarUrl}
                  name={relationship.user.displayName}
                  size={24}
                  status={status}
                />
                <span className="channel-name">{relationship.user.displayName}</span>
              </div>
            );
          })}
        </>
      )}

      <div className="category">
        <span style={{ flex: 1 }}>Conversas</span>
      </div>

      {channels.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-faint)' }}>
          Nenhuma conversa ainda.
        </div>
      ) : (
        channels.map((channel) => {
          const other =
            channel.type === 'DM' ? channel.recipientIds.find((id) => id !== selfId) : null;
          const status = other
            ? (store.presences.get(other)?.status ?? 'OFFLINE')
            : undefined;
          const unread = selectors.unreadCount(store, channel.id) > 0;
          const mentions = selectors.mentionCount(store, channel.id);

          return (
            <div
              key={channel.id}
              className={[
                'channel',
                selectedChannelId === channel.id ? 'active' : '',
                unread ? 'unread' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => selectChannel(channel.id)}
              style={{ gap: 8 }}
            >
              {channel.type === 'GROUP_DM' ? (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: 'var(--active)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Users size={14} />
                </div>
              ) : (
                <Avatar
                  url={other ? store.users.get(other)?.avatarUrl : null}
                  name={labelFor(channel)}
                  size={24}
                  status={status}
                />
              )}
              <span className="channel-name">{labelFor(channel)}</span>
              {mentions > 0 && <span className="channel-badge">{mentions}</span>}
            </div>
          );
        })
      )}
    </>
  );
}

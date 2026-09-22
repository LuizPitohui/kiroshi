import { useEffect, useRef, useState } from 'react';
import { Permission, has } from '@kiroshi/shared';
import { api } from '../api/client.js';
import { useStore } from '../store/index.js';
import { useGuildPermissions, useHighestRolePosition } from '../hooks/usePermissions.js';
import { voice } from '../voice/controller.js';
import { Avatar } from './Avatar.js';

interface Props {
  guildId: string;
  userId: string;
  onClose: () => void;
}

/** Cartao de perfil com as acoes de moderacao disponiveis para quem olha. */
export function MemberCard({ guildId, userId, onClose }: Props) {
  const state = useStore();
  const selfId = useStore((s) => s.user?.id);
  const member = useStore((s) => s.members.get(`${guildId}:${userId}`));
  const guild = useStore((s) => s.guilds.get(guildId));
  const presence = useStore((s) => s.presences.get(userId));
  const voiceState = useStore((s) => s.voiceStates.get(userId));

  const selfPermissions = useGuildPermissions(guildId);
  const selfPosition = useHighestRolePosition(guildId, selfId ?? null);
  const targetPosition = useHighestRolePosition(guildId, userId);

  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  const isSelf = userId === selfId;

  // Moderar exige a permissao e tambem estar acima do alvo na hierarquia.
  const outranksTarget = selfPosition > targetPosition;
  const canKick = !isSelf && outranksTarget && has(selfPermissions, Permission.KICK_MEMBERS);
  const canBan = !isSelf && outranksTarget && has(selfPermissions, Permission.BAN_MEMBERS);
  const canMute = !isSelf && outranksTarget && has(selfPermissions, Permission.MUTE_MEMBERS);
  const canMove = !isSelf && outranksTarget && has(selfPermissions, Permission.MOVE_MEMBERS);

  if (!member || !guild) return null;

  const roles = member.roleIds
    .map((id) => state.roles.get(id))
    .filter((role) => role && role.id !== guildId)
    .sort((a, b) => (b?.position ?? 0) - (a?.position ?? 0));

  async function act(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      onClose();
    } catch {
      setBusy(false);
    }
  }

  const localVolume = voice.getSettings().userVolumes[userId] ?? 1;

  return (
    <div
      ref={ref}
      className="menu"
      style={{ right: 244, width: 300, padding: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          height: 64,
          background: member.user.accentColor ?? 'var(--optic)',
        }}
      />

      <div style={{ padding: '0 16px 16px', marginTop: -32 }}>
        <Avatar
          url={member.user.avatarUrl}
          name={member.nickname ?? member.user.displayName}
          size={72}
          status={presence?.status ?? 'OFFLINE'}
        />

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>
            {member.nickname ?? member.user.displayName}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>@{member.user.username}</div>
        </div>

        {presence?.customStatus && (
          <div style={{ fontSize: 13, marginTop: 8, color: 'var(--text-dim)' }}>
            {presence.customStatus}
          </div>
        )}

        {member.user.bio && (
          <>
            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="settings-group" style={{ padding: 0, marginBottom: 4 }}>
              Sobre
            </div>
            <div className="selectable" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {member.user.bio}
            </div>
          </>
        )}

        {member.user.pronouns && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
            {member.user.pronouns}
          </div>
        )}

        {roles.length > 0 && (
          <>
            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="settings-group" style={{ padding: 0, marginBottom: 6 }}>
              Cargos
            </div>
            <div className="chips">
              {roles.map((role) => (
                <span className="chip" key={role!.id}>
                  <span
                    className="chip-dot"
                    style={role!.color ? { background: role!.color } : undefined}
                  />
                  {role!.name}
                </span>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>
          Entrou em {new Date(member.joinedAt).toLocaleDateString('pt-BR')}
        </div>

        {/* Volume individual: ajuste local, nao afeta ninguem alem de quem ouve. */}
        {!isSelf && voiceState && (
          <>
            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="settings-group" style={{ padding: 0, marginBottom: 6 }}>
              Volume para voce
            </div>
            <input
              type="range"
              min={0}
              max={200}
              defaultValue={localVolume * 100}
              onChange={(e) => voice.setUserVolume(userId, Number(e.target.value) / 100)}
              style={{ width: '100%' }}
            />
          </>
        )}

        {(canKick || canBan || canMute || canMove) && (
          <>
            <div className="divider" style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {canMute && voiceState && (
                <button
                  className="menu-item"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api.patch(`/guilds/${guildId}/members/${userId}`, {
                        serverMuted: !member.serverMuted,
                      }),
                    )
                  }
                >
                  {member.serverMuted ? 'Reativar microfone' : 'Silenciar no servidor'}
                </button>
              )}
              {canMove && voiceState && (
                <button
                  className="menu-item"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api.patch(`/guilds/${guildId}/members/${userId}`, {
                        voiceChannelId: null,
                      }),
                    )
                  }
                >
                  Desconectar da voz
                </button>
              )}
              {canKick && (
                <button
                  className="menu-item danger"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api.delete(`/guilds/${guildId}/members/${userId}`))
                  }
                >
                  Expulsar do servidor
                </button>
              )}
              {canBan && (
                <button
                  className="menu-item danger"
                  disabled={busy}
                  onClick={() => void act(() => api.put(`/guilds/${guildId}/bans/${userId}`, {}))}
                >
                  Banir do servidor
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


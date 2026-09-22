import {
  SESSION_RESUME_WINDOW_MS,
  type GatewayEventMap,
  type GatewayEventName,
  type Presence,
  type PresenceStatus,
} from '@kiroshi/shared';
import { logger } from '../logger.js';
import { GatewaySession } from './session.js';

/**
 * Indice em memoria das sessoes deste processo.
 *
 * Com varios processos, cada um mantem o seu indice e o barramento distribui
 * os eventos; quem tem o destinatario local entrega, os outros ignoram.
 */
class SessionRegistry {
  private readonly bySessionId = new Map<string, GatewaySession>();
  private readonly byUserId = new Map<string, Set<GatewaySession>>();
  private readonly byGuildId = new Map<string, Set<GatewaySession>>();
  private readonly byChannelId = new Map<string, Set<GatewaySession>>();

  add(session: GatewaySession): void {
    this.bySessionId.set(session.id, session);
    let sessions = this.byUserId.get(session.userId);
    if (!sessions) {
      sessions = new Set();
      this.byUserId.set(session.userId, sessions);
    }
    sessions.add(session);
  }

  remove(session: GatewaySession): void {
    this.bySessionId.delete(session.id);

    const userSessions = this.byUserId.get(session.userId);
    userSessions?.delete(session);
    if (userSessions && userSessions.size === 0) this.byUserId.delete(session.userId);

    for (const guildId of session.guildIds) {
      const set = this.byGuildId.get(guildId);
      set?.delete(session);
      if (set && set.size === 0) this.byGuildId.delete(guildId);
    }
    for (const channelId of session.privateChannelIds) {
      const set = this.byChannelId.get(channelId);
      set?.delete(session);
      if (set && set.size === 0) this.byChannelId.delete(channelId);
    }
  }

  get(sessionId: string): GatewaySession | undefined {
    return this.bySessionId.get(sessionId);
  }

  subscribeGuild(session: GatewaySession, guildId: string): void {
    session.guildIds.add(guildId);
    let set = this.byGuildId.get(guildId);
    if (!set) {
      set = new Set();
      this.byGuildId.set(guildId, set);
    }
    set.add(session);
  }

  unsubscribeGuild(session: GatewaySession, guildId: string): void {
    session.guildIds.delete(guildId);
    const set = this.byGuildId.get(guildId);
    set?.delete(session);
    if (set && set.size === 0) this.byGuildId.delete(guildId);
  }

  subscribeChannel(session: GatewaySession, channelId: string): void {
    session.privateChannelIds.add(channelId);
    let set = this.byChannelId.get(channelId);
    if (!set) {
      set = new Set();
      this.byChannelId.set(channelId, set);
    }
    set.add(session);
  }

  unsubscribeChannel(session: GatewaySession, channelId: string): void {
    session.privateChannelIds.delete(channelId);
    const set = this.byChannelId.get(channelId);
    set?.delete(session);
    if (set && set.size === 0) this.byChannelId.delete(channelId);
  }

  sessionsOfUser(userId: string): GatewaySession[] {
    return [...(this.byUserId.get(userId) ?? [])];
  }

  sessionsOfGuild(guildId: string): GatewaySession[] {
    return [...(this.byGuildId.get(guildId) ?? [])];
  }

  sessionsOfChannel(channelId: string): GatewaySession[] {
    return [...(this.byChannelId.get(channelId) ?? [])];
  }

  /** Usuarios com pelo menos uma sessao viva neste processo. */
  onlineUserIds(): string[] {
    const ids: string[] = [];
    for (const [userId, sessions] of this.byUserId) {
      for (const session of sessions) {
        if (session.isOpen) {
          ids.push(userId);
          break;
        }
      }
    }
    return ids;
  }

  get size(): number {
    return this.bySessionId.size;
  }

  /**
   * Remove sessoes desconectadas cuja janela de retomada expirou. Roda a cada
   * 30 s; a janela e de 2 min.
   */
  pruneExpired(onExpire: (session: GatewaySession) => void): void {
    const cutoff = Date.now() - SESSION_RESUME_WINDOW_MS;
    for (const session of [...this.bySessionId.values()]) {
      if (session.disconnectedAt !== null && session.disconnectedAt < cutoff) {
        this.remove(session);
        onExpire(session);
      }
    }
  }

  all(): GatewaySession[] {
    return [...this.bySessionId.values()];
  }
}

export const sessions = new SessionRegistry();

// ---------------------------------------------------------------------------
// Presenca
// ---------------------------------------------------------------------------

/**
 * Presenca efetiva por usuario. Quem escolhe "invisivel" fica como OFFLINE
 * para os outros, mas continua recebendo eventos normalmente.
 */
const presenceByUser = new Map<string, Presence>();

export function setPresence(
  userId: string,
  status: PresenceStatus,
  customStatus: string | null,
): Presence {
  const presence: Presence = {
    userId,
    status,
    customStatus,
    activity: presenceByUser.get(userId)?.activity ?? null,
    since: status === 'OFFLINE' ? null : new Date().toISOString(),
  };
  presenceByUser.set(userId, presence);
  return presence;
}

export function getPresence(userId: string): Presence {
  return (
    presenceByUser.get(userId) ?? {
      userId,
      status: 'OFFLINE',
      customStatus: null,
      activity: null,
      since: null,
    }
  );
}

export function clearPresence(userId: string): Presence {
  const presence: Presence = {
    userId,
    status: 'OFFLINE',
    customStatus: null,
    activity: null,
    since: null,
  };
  presenceByUser.set(userId, presence);
  return presence;
}

export function allPresences(): Presence[] {
  return [...presenceByUser.values()];
}

/**
 * Entrega um evento a todas as sessoes de um usuario neste processo.
 * Devolve quantas receberam, para o chamador saber se precisa do barramento.
 */
export function dispatchToUser<E extends GatewayEventName>(
  userId: string,
  name: E,
  payload: GatewayEventMap[E],
): number {
  let delivered = 0;
  for (const session of sessions.sessionsOfUser(userId)) {
    if (!session.isOpen) continue;
    try {
      session.dispatch(name, payload);
      delivered += 1;
    } catch (error) {
      logger.error({ error, sessionId: session.id, event: name }, 'falha ao despachar');
    }
  }
  return delivered;
}

export function dispatchToGuild<E extends GatewayEventName>(
  guildId: string,
  name: E,
  payload: GatewayEventMap[E],
  options: { exceptUserId?: string; onlyUserIds?: Set<string> } = {},
): number {
  let delivered = 0;
  for (const session of sessions.sessionsOfGuild(guildId)) {
    if (!session.isOpen) continue;
    if (options.exceptUserId && session.userId === options.exceptUserId) continue;
    if (options.onlyUserIds && !options.onlyUserIds.has(session.userId)) continue;
    try {
      session.dispatch(name, payload);
      delivered += 1;
    } catch (error) {
      logger.error({ error, sessionId: session.id, event: name }, 'falha ao despachar');
    }
  }
  return delivered;
}

export function dispatchToChannel<E extends GatewayEventName>(
  channelId: string,
  name: E,
  payload: GatewayEventMap[E],
  options: { exceptUserId?: string } = {},
): number {
  let delivered = 0;
  for (const session of sessions.sessionsOfChannel(channelId)) {
    if (!session.isOpen) continue;
    if (options.exceptUserId && session.userId === options.exceptUserId) continue;
    try {
      session.dispatch(name, payload);
      delivered += 1;
    } catch (error) {
      logger.error({ error, sessionId: session.id, event: name }, 'falha ao despachar');
    }
  }
  return delivered;
}

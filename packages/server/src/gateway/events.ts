import type { GatewayEventMap, GatewayEventName } from '@kiroshi/shared';
import { BusChannel, getBus } from '../bus.js';
import { jsonSafe } from '../lib/serialize.js';
import {
  dispatchToChannel,
  dispatchToGuild,
  dispatchToUser,
  sessions,
} from './registry.js';

/**
 * Ponto unico de emissao de eventos. As rotas chamam estas funcoes; elas
 * entregam localmente e publicam no barramento para os outros processos.
 *
 * Um evento publicado volta para este mesmo processo pelo barramento, entao
 * cada envelope carrega a origem e ignoramos o que veio de nos mesmos, para
 * nao entregar duas vezes.
 */

export const PROCESS_ID = `${process.pid}-${Date.now().toString(36)}`;

interface BusEnvelope {
  origin: string;
  event: GatewayEventName;
  payload: unknown;
  exceptUserId?: string;
  onlyUserIds?: string[];
}

function publish(channel: string, envelope: BusEnvelope): void {
  // Enviar ao barramento e best effort: a entrega local ja aconteceu.
  void getBus()
    .publish(channel, jsonSafe(envelope))
    .catch(() => undefined);
}

/** Entrega a todas as sessoes de um usuario, em qualquer dispositivo. */
export function emitToUser<E extends GatewayEventName>(
  userId: string,
  event: E,
  payload: GatewayEventMap[E],
): void {
  dispatchToUser(userId, event, payload);
  publish(BusChannel.user(userId), { origin: PROCESS_ID, event, payload });
}

export function emitToUsers<E extends GatewayEventName>(
  userIds: Iterable<string>,
  event: E,
  payload: GatewayEventMap[E],
): void {
  for (const userId of userIds) emitToUser(userId, event, payload);
}

/** Entrega a todos os membros conectados de um servidor. */
export function emitToGuild<E extends GatewayEventName>(
  guildId: string,
  event: E,
  payload: GatewayEventMap[E],
  options: { exceptUserId?: string; onlyUserIds?: Set<string> } = {},
): void {
  dispatchToGuild(guildId, event, payload, options);
  publish(BusChannel.guild(guildId), {
    origin: PROCESS_ID,
    event,
    payload,
    exceptUserId: options.exceptUserId,
    onlyUserIds: options.onlyUserIds ? [...options.onlyUserIds] : undefined,
  });
}

/** Entrega a quem acompanha um canal de DM ou grupo. */
export function emitToChannel<E extends GatewayEventName>(
  channelId: string,
  event: E,
  payload: GatewayEventMap[E],
  options: { exceptUserId?: string } = {},
): void {
  dispatchToChannel(channelId, event, payload, options);
  publish(BusChannel.channel(channelId), {
    origin: PROCESS_ID,
    event,
    payload,
    exceptUserId: options.exceptUserId,
  });
}

/** Assina o barramento para receber o que os outros processos publicarem. */
export async function subscribeToBus(): Promise<void> {
  const bus = getBus();

  const handle = (
    deliver: (envelope: BusEnvelope, id: string) => void,
    extractId: (channel: string) => string | null,
  ) => {
    return (channel: string, raw: unknown) => {
      const envelope = raw as BusEnvelope;
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.origin === PROCESS_ID) return; // ja entregue localmente
      const id = extractId(channel);
      if (!id) return;
      deliver(envelope, id);
    };
  };

  await bus.subscribe(
    BusChannel.allUsers,
    handle(
      (envelope, userId) => {
        dispatchToUser(userId, envelope.event, envelope.payload as never);
      },
      (channel) => channel.split(':')[2] ?? null,
    ),
  );

  await bus.subscribe(
    BusChannel.allGuilds,
    handle(
      (envelope, guildId) => {
        dispatchToGuild(guildId, envelope.event, envelope.payload as never, {
          exceptUserId: envelope.exceptUserId,
          onlyUserIds: envelope.onlyUserIds ? new Set(envelope.onlyUserIds) : undefined,
        });
      },
      (channel) => channel.split(':')[2] ?? null,
    ),
  );

  await bus.subscribe(
    BusChannel.allChannels,
    handle(
      (envelope, channelId) => {
        dispatchToChannel(channelId, envelope.event, envelope.payload as never, {
          exceptUserId: envelope.exceptUserId,
        });
      },
      (channel) => channel.split(':')[2] ?? null,
    ),
  );
}

/**
 * Assina um servidor em todas as sessoes de um usuario neste processo. Precisa
 * passar pelo registry, e nao mexer em session.guildIds direto, senao o indice
 * por servidor nao enxerga a sessao e ela deixa de receber os eventos.
 */
export function subscribeUserToGuild(userId: string, guildId: string): void {
  for (const session of sessions.sessionsOfUser(userId)) {
    sessions.subscribeGuild(session, guildId);
  }
}

export function unsubscribeUserFromGuild(userId: string, guildId: string): void {
  for (const session of sessions.sessionsOfUser(userId)) {
    sessions.unsubscribeGuild(session, guildId);
  }
}

export function subscribeUserToChannel(userId: string, channelId: string): void {
  for (const session of sessions.sessionsOfUser(userId)) {
    sessions.subscribeChannel(session, channelId);
  }
}

export function unsubscribeUserFromChannel(userId: string, channelId: string): void {
  for (const session of sessions.sessionsOfUser(userId)) {
    sessions.unsubscribeChannel(session, channelId);
  }
}

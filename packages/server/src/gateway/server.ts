import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GATEWAY_VERSION,
  GatewayCloseCode,
  GatewayOpcode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  Permission,
  RATE_LIMITS,
  TYPING_TIMEOUT_MS,
  generateId,
  has,
  type GatewayEnvelope,
  type IdentifyPayload,
  type PresenceUpdatePayload,
  type RequestGuildMembersPayload,
  type ResumePayload,
  type TypingPayload,
  type VoiceStateUpdatePayload,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { MEMBER_INCLUDE, toMember } from '../lib/serialize.js';
import { emitirParaQuemVe } from '../services/entrega.js';
import { resolveChannelPermissions } from '../services/permissions.js';
import { buildReadyPayload } from '../services/ready.js';
import { handleVoiceStateUpdate, disconnectFromVoice } from '../services/voice.js';
import { emitToGuild, emitToUser } from './events.js';
import {
  clearPresence,
  getPresence,
  sessions,
  setPresence,
} from './registry.js';
import { GatewaySession } from './session.js';

/**
 * Servidor do gateway.
 *
 * Cada conexao passa por: HELLO -> IDENTIFY/RESUME -> READY/RESUMED -> eventos.
 * Um cliente que nao mandar HEARTBEAT dentro da tolerancia e desconectado;
 * a sessao fica retomavel por dois minutos antes de ser descartada de vez.
 */

interface PendingConnection {
  socket: WebSocket;
  session: GatewaySession | null;
  /** Contador simples de mensagens por janela, para limitar abuso. */
  messageCount: number;
  windowStartedAt: number;
}

const pending = new WeakMap<WebSocket, PendingConnection>();

/** Ultima vez que cada usuario sinalizou digitacao em cada canal. */
const typingThrottle = new Map<string, number>();

export function attachGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/gateway',
    maxPayload: 256 * 1024,
    // O cliente desktop nao precisa de compressao; ela custa CPU e memoria
    // por conexao e o ganho e pequeno em mensagens curtas.
    perMessageDeflate: false,
  });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const state: PendingConnection = {
      socket,
      session: null,
      messageCount: 0,
      windowStartedAt: Date.now(),
    };
    pending.set(socket, state);

    send(socket, {
      op: GatewayOpcode.HELLO,
      d: { heartbeatInterval: HEARTBEAT_INTERVAL_MS, gatewayVersion: GATEWAY_VERSION },
    });

    // Quem nao se identificar em 30 s vai embora, para nao segurar socket a toa.
    const identifyTimer = setTimeout(() => {
      if (!state.session) {
        closeSocket(socket, GatewayCloseCode.NOT_AUTHENTICATED, 'sem identify');
      }
    }, 30_000);

    socket.on('message', (raw) => {
      void handleMessage(state, raw.toString(), request).catch((error: unknown) => {
        logger.error({ error }, 'erro ao tratar mensagem do gateway');
        closeSocket(socket, GatewayCloseCode.UNKNOWN_ERROR, 'erro interno');
      });
    });

    socket.on('close', () => {
      clearTimeout(identifyTimer);
      handleClose(state);
    });

    socket.on('error', (error) => {
      logger.debug({ error }, 'socket do gateway com erro');
    });
  });

  // Varre conexoes mortas e sessoes cuja janela de retomada expirou.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.all()) {
      if (!session.isOpen) continue;
      if (now - session.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        logger.debug({ sessionId: session.id }, 'sem heartbeat, encerrando');
        session.close(GatewayCloseCode.SESSION_TIMED_OUT, 'sem heartbeat');
      }
    }

    sessions.pruneExpired((session) => {
      void finalizeSession(session);
    });

    for (const [key, at] of typingThrottle) {
      if (now - at > TYPING_TIMEOUT_MS * 2) typingThrottle.delete(key);
    }
  }, 30_000);
  sweeper.unref?.();

  wss.on('close', () => clearInterval(sweeper));

  logger.info('gateway em /gateway');
  return wss;
}

// ---------------------------------------------------------------------------

function send(socket: WebSocket, envelope: GatewayEnvelope): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(envelope));
}

function closeSocket(socket: WebSocket, code: GatewayCloseCode, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // ja fechado
  }
}

async function handleMessage(
  state: PendingConnection,
  raw: string,
  request: IncomingMessage,
): Promise<void> {
  const { socket } = state;

  // Limite de mensagens por janela, por conexao.
  const now = Date.now();
  if (now - state.windowStartedAt > RATE_LIMITS.gateway.windowMs) {
    state.windowStartedAt = now;
    state.messageCount = 0;
  }
  state.messageCount += 1;
  if (state.messageCount > RATE_LIMITS.gateway.points) {
    closeSocket(socket, GatewayCloseCode.RATE_LIMITED, 'mensagens demais');
    return;
  }

  let envelope: GatewayEnvelope;
  try {
    envelope = JSON.parse(raw) as GatewayEnvelope;
  } catch {
    closeSocket(socket, GatewayCloseCode.DECODE_ERROR, 'json invalido');
    return;
  }

  switch (envelope.op) {
    case GatewayOpcode.HEARTBEAT: {
      if (state.session) state.session.lastHeartbeat = Date.now();
      send(socket, { op: GatewayOpcode.HEARTBEAT_ACK });
      return;
    }

    case GatewayOpcode.IDENTIFY:
      await handleIdentify(state, envelope.d as IdentifyPayload, request);
      return;

    case GatewayOpcode.RESUME:
      await handleResume(state, envelope.d as ResumePayload);
      return;

    case GatewayOpcode.PRESENCE_UPDATE:
      await handlePresenceUpdate(state, envelope.d as PresenceUpdatePayload);
      return;

    case GatewayOpcode.VOICE_STATE_UPDATE:
      await handleVoiceOpcode(state, envelope.d as VoiceStateUpdatePayload);
      return;

    case GatewayOpcode.REQUEST_GUILD_MEMBERS:
      await handleRequestMembers(state, envelope.d as RequestGuildMembersPayload);
      return;

    case GatewayOpcode.TYPING:
      await handleTyping(state, envelope.d as TypingPayload);
      return;

    default:
      closeSocket(socket, GatewayCloseCode.UNKNOWN_OPCODE, 'opcode desconhecido');
  }
}

async function handleIdentify(
  state: PendingConnection,
  payload: IdentifyPayload | undefined,
  request: IncomingMessage,
): Promise<void> {
  const { socket } = state;

  if (state.session) {
    closeSocket(socket, GatewayCloseCode.ALREADY_AUTHENTICATED, 'ja identificado');
    return;
  }
  if (!payload?.token) {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token ausente');
    return;
  }

  let userId: string;
  try {
    const claims = await verifyAccessToken(payload.token);
    userId = claims.sub;
  } catch {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token invalido');
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, disabledAt: true, status: true, customStatus: true },
  });
  if (!user || user.disabledAt) {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'conta indisponivel');
    return;
  }

  const sessionId = generateId();
  const session = new GatewaySession(sessionId, userId, socket);
  state.session = session;

  // O status pedido no IDENTIFY manda; sem ele, vale o ultimo salvo.
  const requestedStatus = payload.presence?.status ?? user.status;
  session.status = requestedStatus;
  session.customStatus = payload.presence?.customStatus ?? user.customStatus;

  sessions.add(session);

  const ready = await buildReadyPayload(userId, sessionId, GATEWAY_VERSION);
  for (const guild of ready.guilds) sessions.subscribeGuild(session, guild.id);
  for (const channel of ready.privateChannels) sessions.subscribeChannel(session, channel.id);

  session.dispatch('READY', ready);

  logger.info(
    { userId, sessionId, client: payload.properties?.client, ip: clientIp(request) },
    'sessao identificada',
  );

  await announcePresence(session, requestedStatus, session.customStatus);
}

async function handleResume(
  state: PendingConnection,
  payload: ResumePayload | undefined,
): Promise<void> {
  const { socket } = state;

  if (!payload?.token || !payload.sessionId) {
    send(socket, { op: GatewayOpcode.INVALID_SESSION, d: { resumable: false } });
    return;
  }

  let userId: string;
  try {
    const claims = await verifyAccessToken(payload.token);
    userId = claims.sub;
  } catch {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token invalido');
    return;
  }

  const existing = sessions.get(payload.sessionId);
  if (!existing || existing.userId !== userId) {
    send(socket, { op: GatewayOpcode.INVALID_SESSION, d: { resumable: false } });
    return;
  }

  // Se o socket antigo ainda estiver de pe, ele perde o lugar.
  if (existing.isOpen && existing.socket !== socket) {
    existing.close(GatewayCloseCode.SESSION_REPLACED, 'retomada em outro socket');
  }

  existing.attachSocket(socket);
  state.session = existing;

  const replayed = existing.replayFrom(payload.seq);
  if (replayed === null) {
    sessions.remove(existing);
    state.session = null;
    send(socket, { op: GatewayOpcode.INVALID_SESSION, d: { resumable: false } });
    return;
  }

  existing.dispatch('RESUMED', { replayed });
  logger.debug({ sessionId: existing.id, replayed }, 'sessao retomada');
}

async function handlePresenceUpdate(
  state: PendingConnection,
  payload: PresenceUpdatePayload | undefined,
): Promise<void> {
  const session = state.session;
  if (!session || !payload) return;

  session.status = payload.status;
  session.customStatus = payload.customStatus ?? null;

  // updateMany em vez de update: a conta pode ter sido apagada enquanto a
  // sessao ainda estava aberta, e presenca e anotacao, nao algo que justifique
  // derrubar a operacao. O update lanca quando nao acha a linha, e o Prisma
  // registra isso como erro antes de qualquer catch — enchendo de ruido o nivel
  // onde a gente procura problema de verdade.
  await prisma.user.updateMany({
    where: { id: session.userId },
    data: { status: payload.status, customStatus: payload.customStatus ?? null },
  });

  await announcePresence(session, payload.status, payload.customStatus ?? null);
}

async function handleVoiceOpcode(
  state: PendingConnection,
  payload: VoiceStateUpdatePayload | undefined,
): Promise<void> {
  const session = state.session;
  if (!session || !payload) return;
  await handleVoiceStateUpdate(session.userId, session.id, payload);
}

async function handleRequestMembers(
  state: PendingConnection,
  payload: RequestGuildMembersPayload | undefined,
): Promise<void> {
  const session = state.session;
  if (!session || !payload?.guildId) return;

  // So responde para quem e membro do servidor pedido.
  const membership = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId: payload.guildId, userId: session.userId } },
    select: { userId: true },
  });
  if (!membership) return;

  const query = payload.query?.trim().toLowerCase();
  const members = await prisma.guildMember.findMany({
    where: {
      guildId: payload.guildId,
      ...(query
        ? {
            OR: [
              { nickname: { startsWith: query, mode: 'insensitive' } },
              { user: { username: { startsWith: query } } },
              { user: { displayName: { startsWith: query, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: MEMBER_INCLUDE,
    take: Math.min(payload.limit ?? 100, 1000),
    orderBy: { joinedAt: 'asc' },
  });

  const CHUNK = 100;
  const chunkCount = Math.max(1, Math.ceil(members.length / CHUNK));
  for (let i = 0; i < chunkCount; i++) {
    session.dispatch('GUILD_MEMBERS_CHUNK', {
      guildId: payload.guildId,
      members: members.slice(i * CHUNK, (i + 1) * CHUNK).map(toMember),
      chunkIndex: i,
      chunkCount,
    });
  }
}

async function handleTyping(
  state: PendingConnection,
  payload: TypingPayload | undefined,
): Promise<void> {
  const session = state.session;
  if (!session || !payload?.channelId) return;

  const key = `${session.userId}:${payload.channelId}`;
  const last = typingThrottle.get(key) ?? 0;
  const now = Date.now();
  // O cliente reenvia enquanto a pessoa digita; so propagamos de tempos em tempos.
  if (now - last < 4_000) return;
  typingThrottle.set(key, now);

  const channel = await prisma.channel.findUnique({
    where: { id: payload.channelId },
    select: { id: true, guildId: true, type: true },
  });
  if (!channel) return;

  const event = {
    channelId: channel.id,
    guildId: channel.guildId,
    userId: session.userId,
    timestamp: now,
  };

  if (channel.guildId) {
    /*
      Digitar e anunciar atividade num canal. So vale para quem ve o canal e
      pode escrever nele, e o aviso so chega a quem o enxerga.

      Antes nao havia conferencia nenhuma: qualquer conta mandava "fulano esta
      digitando" para o id que quisesse, e o aviso ia para o servidor inteiro.
    */
    if (channel.type === 'GUILD_CATEGORY') return;
    // Canal apagado entre a consulta acima e esta: um aviso de digitacao nao
    // justifica derrubar a conexao, que e o que uma excecao aqui faria.
    const resolvido = await resolveChannelPermissions(channel.id, session.userId).catch(() => null);
    if (!resolvido || !has(resolvido.permissions, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)) {
      return;
    }

    await emitirParaQuemVe(channel.guildId, channel.id, 'TYPING_START', event, {
      exceptUserId: session.userId,
    });
  } else {
    const recipients = await prisma.channelRecipient.findMany({
      where: { channelId: channel.id },
      select: { userId: true },
    });
    // So quem participa da conversa avisa que esta digitando nela.
    if (!recipients.some((r) => r.userId === session.userId)) return;

    for (const recipient of recipients) {
      if (recipient.userId === session.userId) continue;
      emitToUser(recipient.userId, 'TYPING_START', event);
    }
  }
}

// ---------------------------------------------------------------------------

function handleClose(state: PendingConnection): void {
  const session = state.session;
  if (!session) return;

  session.markDisconnected();
  logger.debug({ sessionId: session.id, userId: session.userId }, 'socket caiu');

  // Nao anunciamos offline na hora: a sessao pode voltar em segundos. Quem
  // decide e o sweeper, quando a janela de retomada expira.
}

/**
 * Chamado quando a sessao expira de vez. Tira o usuario da voz e avisa offline
 * se aquela era a ultima sessao dele.
 */
async function finalizeSession(session: GatewaySession): Promise<void> {
  try {
    await disconnectFromVoice(session.userId, session.id);
  } catch (error) {
    logger.warn({ error, userId: session.userId }, 'falha ao sair da voz na expiracao');
  }

  const stillOnline = sessions
    .sessionsOfUser(session.userId)
    .some((s) => s.isOpen || s.disconnectedAt !== null);

  if (stillOnline) return;

  const presence = clearPresence(session.userId);
  await broadcastPresence(session.userId, presence);

  // Mesmo motivo do updateMany la em cima: o catch engolia a excecao, mas o
  // log de erro do Prisma acontecia antes dele.
  await prisma.user.updateMany({
    where: { id: session.userId },
    data: { lastSeenAt: new Date() },
  });

  logger.info({ userId: session.userId, sessionId: session.id }, 'sessao encerrada');
}

async function announcePresence(
  session: GatewaySession,
  status: PresenceUpdatePayload['status'],
  customStatus: string | null,
): Promise<void> {
  // Invisivel: o proprio usuario ve ONLINE, os outros veem OFFLINE.
  const visibleStatus = status === 'OFFLINE' ? 'OFFLINE' : status;
  const presence = setPresence(session.userId, visibleStatus, customStatus);
  await broadcastPresence(session.userId, presence);
}

/** Espalha a presenca para quem compartilha servidor ou amizade. */
async function broadcastPresence(
  userId: string,
  presence: ReturnType<typeof getPresence>,
): Promise<void> {
  const [memberships, friendships] = await Promise.all([
    prisma.guildMember.findMany({ where: { userId }, select: { guildId: true } }),
    prisma.relationship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    }),
  ]);

  for (const membership of memberships) {
    emitToGuild(membership.guildId, 'PRESENCE_UPDATE', presence);
  }

  for (const friendship of friendships) {
    const friendId =
      friendship.requesterId === userId ? friendship.addresseeId : friendship.requesterId;
    emitToUser(friendId, 'PRESENCE_UPDATE', presence);
  }

  // O proprio usuario tambem recebe, para sincronizar entre dispositivos.
  emitToUser(userId, 'PRESENCE_UPDATE', presence);
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? '';
  return request.socket.remoteAddress ?? '';
}

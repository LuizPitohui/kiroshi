import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ZodType, z } from 'zod';
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
} from '@kiroshi/shared';
import { BusChannel, getBus } from '../bus.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { ipDoCliente } from '../lib/ip-do-cliente.js';
import { MEMBER_INCLUDE, toMember } from '../lib/serialize.js';
import { emitirParaQuemVe } from '../services/entrega.js';
import { resolveChannelPermissions } from '../services/permissions.js';
import { buildReadyPayload } from '../services/ready.js';
import { bloqueioNaDm } from '../services/relacoes.js';
import { handleVoiceStateUpdate, disconnectFromVoice } from '../services/voice.js';
import { PROCESS_ID, emitToGuild, emitToUser } from './events.js';
import {
  identifySchema,
  presenceUpdateSchema,
  requestGuildMembersSchema,
  resumeSchema,
  typingSchema,
  voiceStateUpdateSchema,
} from './payloads.js';
import {
  clearPresence,
  getPresence,
  sessions,
  setPresence,
} from './registry.js';
import { GatewaySession } from './session.js';

type IdentifyLido = z.infer<typeof identifySchema>;
type ResumeLido = z.infer<typeof resumeSchema>;
type PresencaLida = z.infer<typeof presenceUpdateSchema>;
type VozLida = z.infer<typeof voiceStateUpdateSchema>;
type PedidoDeMembrosLido = z.infer<typeof requestGuildMembersSchema>;
type DigitacaoLida = z.infer<typeof typingSchema>;

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

  // Sessao encerrada a pedido de outro processo (so existe com REDIS_URL).
  void getBus()
    .subscribe(BusChannel.todosOsControles, (canal, bruto) => {
      const envelope = bruto as { origin?: string; encerrar?: FiltroDeSessoes } | null;
      if (!envelope || envelope.origin === PROCESS_ID || !envelope.encerrar) return;
      const userId = canal.split(':')[2];
      if (userId) encerrarAqui(userId, envelope.encerrar);
    })
    .catch((error: unknown) => logger.error({ error }, 'nao consegui assinar o canal de controle'));

  logger.info('gateway em /gateway');
  return wss;
}

// ---------------------------------------------------------------------------
// Sessao de login encerrada
// ---------------------------------------------------------------------------

export interface FiltroDeSessoes {
  /** So as conexoes abertas por estas sessoes de login. */
  sessoesDeLogin?: string[];
  /** Todas menos as desta sessao de login: trocar a senha mantem quem trocou. */
  excetoSessaoDeLogin?: string;
}

function casaComFiltro(session: GatewaySession, filtro: FiltroDeSessoes): boolean {
  if (filtro.sessoesDeLogin && !filtro.sessoesDeLogin.includes(session.authSessionId)) return false;
  if (filtro.excetoSessaoDeLogin !== undefined && session.authSessionId === filtro.excetoSessaoDeLogin) {
    return false;
  }
  return true;
}

function encerrarAqui(userId: string, filtro: FiltroDeSessoes): void {
  for (const session of sessions.sessionsOfUser(userId)) {
    if (!casaComFiltro(session, filtro)) continue;
    // Sai do registro na hora, sem esperar a janela de retomada: a sessao de
    // login acabou, entao nao ha o que retomar.
    sessions.remove(session);
    session.close(GatewayCloseCode.AUTHENTICATION_FAILED, 'sessao encerrada');
    void finalizeSession(session);
  }
}

/**
 * Derruba as conexoes de gateway de sessoes de login que acabaram de ser
 * encerradas: logout, revogar um aparelho, trocar a senha, redefinir pelo
 * Google, excluir a conta.
 *
 * Antes nenhuma dessas acoes chegava ao gateway. A linha de Session sumia, mas
 * a conexao ja aberta continuava recebendo tudo, sem prazo — o aparelho
 * "desconectado" seguia lendo as conversas.
 *
 * O codigo e o 4004, que o app 1.15 ja trata assim: renova o token e, se a
 * renovacao tambem for recusada (e vai ser, a sessao nao existe mais), volta
 * para a tela de login. A voz daquela conexao sai junto, em `finalizeSession`.
 */
export function encerrarSessoesDeGateway(userId: string, filtro: FiltroDeSessoes = {}): void {
  encerrarAqui(userId, filtro);
  void getBus()
    .publish(BusChannel.controle(userId), { origin: PROCESS_ID, encerrar: filtro })
    .catch(() => undefined);
}

/**
 * A conta dona de uma sessao de login ainda valida, ou null.
 *
 * Valida quer dizer: a linha existe, e desta conta, nao venceu, e a conta nao
 * foi desativada. O JWT sozinho nao sabe de nada disso — ele e assinado e vale
 * quinze minutos mesmo depois de a sessao ser encerrada.
 */
async function contaDaSessao(sessaoDeLogin: string, userId: string) {
  const sessao = await prisma.session.findUnique({
    where: { id: sessaoDeLogin },
    select: {
      userId: true,
      expiresAt: true,
      user: { select: { disabledAt: true, status: true, customStatus: true } },
    },
  });
  if (!sessao || sessao.userId !== userId) return null;
  if (sessao.expiresAt < new Date() || sessao.user.disabledAt) return null;
  return sessao.user;
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
  // `null`, numero solto e lista tambem sao JSON valido, e nao sao envelope.
  if (typeof envelope !== 'object' || envelope === null || typeof envelope.op !== 'number') {
    closeSocket(socket, GatewayCloseCode.DECODE_ERROR, 'envelope invalido');
    return;
  }

  // Sessao de login encerrada: a conexao ja esta fechando e nao fala mais,
  // nem pelo que chegar antes de o socket terminar de fechar.
  if (state.session && sessions.get(state.session.id) !== state.session) return;

  switch (envelope.op) {
    case GatewayOpcode.HEARTBEAT: {
      if (state.session) state.session.lastHeartbeat = Date.now();
      send(socket, { op: GatewayOpcode.HEARTBEAT_ACK });
      return;
    }

    case GatewayOpcode.IDENTIFY: {
      const payload = lerPayload(socket, identifySchema, envelope.d);
      if (payload) await handleIdentify(state, payload, request);
      return;
    }

    case GatewayOpcode.RESUME: {
      const payload = lerPayload(socket, resumeSchema, envelope.d);
      if (payload) await handleResume(state, payload);
      return;
    }

    case GatewayOpcode.PRESENCE_UPDATE: {
      const payload = lerPayload(socket, presenceUpdateSchema, envelope.d);
      if (payload) await handlePresenceUpdate(state, payload);
      return;
    }

    case GatewayOpcode.VOICE_STATE_UPDATE: {
      const payload = lerPayload(socket, voiceStateUpdateSchema, envelope.d);
      if (payload) await handleVoiceOpcode(state, payload);
      return;
    }

    case GatewayOpcode.REQUEST_GUILD_MEMBERS: {
      const payload = lerPayload(socket, requestGuildMembersSchema, envelope.d);
      if (payload) await handleRequestMembers(state, payload);
      return;
    }

    case GatewayOpcode.TYPING: {
      const payload = lerPayload(socket, typingSchema, envelope.d);
      if (payload) await handleTyping(state, payload);
      return;
    }

    default:
      closeSocket(socket, GatewayCloseCode.UNKNOWN_OPCODE, 'opcode desconhecido');
  }
}

/**
 * O payload no formato do opcode, ou null — e nesse caso a conexao ja foi
 * fechada com o codigo de decodificacao, o mesmo do JSON invalido.
 */
function lerPayload<T>(socket: WebSocket, esquema: ZodType<T>, bruto: unknown): T | null {
  const lido = esquema.safeParse(bruto);
  if (lido.success) return lido.data;
  closeSocket(socket, GatewayCloseCode.DECODE_ERROR, 'payload invalido');
  return null;
}

async function handleIdentify(
  state: PendingConnection,
  payload: IdentifyLido,
  request: IncomingMessage,
): Promise<void> {
  const { socket } = state;

  if (state.session) {
    closeSocket(socket, GatewayCloseCode.ALREADY_AUTHENTICATED, 'ja identificado');
    return;
  }
  if (!payload.token) {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token ausente');
    return;
  }

  let userId: string;
  let sessaoDeLogin: string;
  try {
    const claims = await verifyAccessToken(payload.token);
    userId = claims.sub;
    sessaoDeLogin = claims.sid;
  } catch {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token invalido');
    return;
  }

  // O token pode ser valido e a sessao dele ja ter acabado: logout, aparelho
  // revogado, senha trocada. Entra so quem ainda tem a sessao de login.
  const user = await contaDaSessao(sessaoDeLogin, userId);
  if (!user) {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'sessao encerrada');
    return;
  }

  const sessionId = generateId();
  const session = new GatewaySession(sessionId, userId, socket, sessaoDeLogin);
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
    {
      userId,
      sessionId,
      client: payload.properties?.client,
      ip: ipDoCliente(request.headers, request.socket.remoteAddress),
    },
    'sessao identificada',
  );

  await announcePresence(session, requestedStatus, session.customStatus);
}

async function handleResume(state: PendingConnection, payload: ResumeLido): Promise<void> {
  const { socket } = state;

  if (!payload.token || !payload.sessionId) {
    send(socket, { op: GatewayOpcode.INVALID_SESSION, d: { resumable: false } });
    return;
  }

  let userId: string;
  let sessaoDeLogin: string;
  try {
    const claims = await verifyAccessToken(payload.token);
    userId = claims.sub;
    sessaoDeLogin = claims.sid;
  } catch {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'token invalido');
    return;
  }

  // Mesma conferencia do IDENTIFY: retomar nao pode ser o caminho de volta de
  // uma sessao de login que ja acabou.
  if (!(await contaDaSessao(sessaoDeLogin, userId))) {
    closeSocket(socket, GatewayCloseCode.AUTHENTICATION_FAILED, 'sessao encerrada');
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
  // A conexao passa a responder pela sessao de login do token que a retomou.
  existing.authSessionId = sessaoDeLogin;
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
  payload: PresencaLida,
): Promise<void> {
  const session = state.session;
  if (!session) return;

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

async function handleVoiceOpcode(state: PendingConnection, payload: VozLida): Promise<void> {
  const session = state.session;
  if (!session) return;
  await handleVoiceStateUpdate(session.userId, session.id, {
    ...payload,
    guildId: payload.guildId ?? null,
  });
}

async function handleRequestMembers(
  state: PendingConnection,
  payload: PedidoDeMembrosLido,
): Promise<void> {
  const session = state.session;
  if (!session) return;

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

async function handleTyping(state: PendingConnection, payload: DigitacaoLida): Promise<void> {
  const session = state.session;
  if (!session) return;

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
    // So quem participa da conversa avisa que esta digitando nela, e numa DM
    // 1:1 com bloqueio ninguem digita para ninguem: enviar ja e recusado.
    if (!recipients.some((r) => r.userId === session.userId)) return;
    if (channel.type === 'DM' && (await bloqueioNaDm(channel.id, session.userId))) return;

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
  status: PresencaLida['status'],
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

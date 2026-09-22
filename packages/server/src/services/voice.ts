import { AccessToken, RoomServiceClient, TrackSource, type VideoGrant } from 'livekit-server-sdk';
import {
  has,
  Permission,
  TOKEN_TTL,
  type IceServer,
  type VoiceStateUpdatePayload,
} from '@kiroshi/shared';
import { config } from '../config.js';
import { montarIceServers } from './turn.js';
import { prisma } from '../db.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { emitToGuild, emitToUser } from '../gateway/events.js';
import { toVoiceState } from '../lib/serialize.js';
import { resolveChannelPermissions, resolveMember } from './permissions.js';

/**
 * Voz, video e compartilhamento de tela via LiveKit (SFU).
 *
 * Por que um SFU e nao P2P: com 10 pessoas em uma call, malha P2P exige que
 * cada cliente envie 9 copias do proprio video. O SFU recebe uma copia e
 * redistribui, entao o upload de quem transmite nao cresce com a sala.
 *
 * Cada canal de voz vira uma sala no LiveKit chamada `channel_<id>`. As
 * permissoes do cargo viram permissoes no token: quem nao tem SPEAK entra
 * como ouvinte, quem nao tem STREAM nao consegue publicar tela nem camera.
 */

const ROOM_PREFIX = 'channel_';

function roomNameFor(channelId: string): string {
  return `${ROOM_PREFIX}${channelId}`;
}

/** Canais de voz e conversas diretas aceitam chamada; texto e categoria, nao. */
function isVoiceCapable(channelType: string): boolean {
  return channelType === 'GUILD_VOICE' || channelType === 'DM' || channelType === 'GROUP_DM';
}

let roomService: RoomServiceClient | null = null;

function getRoomService(): RoomServiceClient {
  if (!config.voice.enabled) {
    throw new ApiError('VOICE_UNAVAILABLE', 'A voz nao esta configurada neste servidor.');
  }
  roomService ??= new RoomServiceClient(
    // O SDK fala HTTP com o LiveKit; a URL do cliente e wss://.
    config.voice.url.replace(/^ws/, 'http'),
    config.voice.apiKey,
    config.voice.apiSecret,
  );
  return roomService;
}

export function isVoiceEnabled(): boolean {
  return config.voice.enabled;
}

/**
 * Monta o token de acesso do LiveKit com o que o membro pode fazer naquele
 * canal. O token vale 6 horas e e reemitido a cada entrada.
 */
export async function createVoiceToken(
  userId: string,
  channelId: string,
): Promise<{ token: string; roomName: string; url: string }> {
  if (!config.voice.enabled) {
    throw new ApiError('VOICE_UNAVAILABLE', 'A voz nao esta configurada neste servidor.');
  }

  const [user, { permissions, guildId, channelType }] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
    resolveChannelPermissions(channelId, userId),
  ]);

  if (!user) throw notFound('Usuario');

  // A checagem de tipo fica aqui, e nao so no caminho do gateway, porque esta
  // funcao tambem atende a rota REST. Sem ela, daria para abrir uma sala em um
  // canal de texto: uma chamada que nao aparece na interface de ninguem e que
  // ninguem consegue moderar.
  if (!isVoiceCapable(channelType)) {
    throw new ApiError('BAD_REQUEST', 'Este canal nao aceita voz.');
  }

  if (!has(permissions, Permission.CONNECT)) {
    throw forbidden('Voce nao pode entrar neste canal de voz.');
  }

  const canSpeak = has(permissions, Permission.SPEAK);
  const canStream = has(permissions, Permission.STREAM);
  const isModerator =
    has(permissions, Permission.MUTE_MEMBERS) || has(permissions, Permission.MOVE_MEMBERS);

  const sources: TrackSource[] = [];
  if (canSpeak) sources.push(TrackSource.MICROPHONE);
  if (canStream) {
    sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }

  const grant: VideoGrant = {
    room: roomNameFor(channelId),
    roomJoin: true,
    // Sem SPEAK a pessoa entra so para ouvir.
    canPublish: canSpeak || canStream,
    canPublishSources: sources.length ? sources : undefined,
    canSubscribe: true,
    // Usado pelo soundboard e pelos indicadores de fala.
    canPublishData: true,
    // Moderador pode silenciar e remover participantes pela propria sala.
    roomAdmin: isModerator,
  };

  const accessToken = new AccessToken(config.voice.apiKey, config.voice.apiSecret, {
    identity: userId,
    name: user.displayName,
    ttl: TOKEN_TTL.voiceSecs,
    metadata: JSON.stringify({ username: user.username, avatarUrl: user.avatarUrl, guildId }),
  });
  accessToken.addGrant(grant);

  return { token: await accessToken.toJwt(), roomName: grant.room!, url: config.voice.url };
}

/**
 * Trata o opcode VOICE_STATE_UPDATE: entrar, sair ou mudar mute/video.
 * Um usuario fica em no maximo um canal de voz por vez, entao entrar em outro
 * canal sai do anterior automaticamente.
 */
export async function handleVoiceStateUpdate(
  userId: string,
  sessionId: string,
  payload: VoiceStateUpdatePayload,
): Promise<void> {
  if (!payload.channelId) {
    logger.info({ userId, sessionId }, 'voz: saindo');
    await disconnectFromVoice(userId, sessionId);
    return;
  }

  /*
    Cada passo daqui ate o token e registrado, e isso nao e andaime de
    depuracao.

    Quando alguem diz "cliquei no canal e nao entrou", as perguntas sao sempre
    as mesmas: o pedido chegou? foi negado? o token saiu? E ate agora o
    servidor nao respondia nenhuma delas — o caminho inteiro da voz era mudo,
    e so dava para olhar o log do SFU, que nem chega a ser tocado quando a
    falha e antes dele. Com uma pessoa nos Estados Unidos do outro lado, cada
    rodada de adivinhacao custa uma conversa inteira.
  */
  const registro = { userId, sessionId, channelId: payload.channelId };

  const channel = await prisma.channel.findUnique({
    where: { id: payload.channelId },
    select: { id: true, type: true, guildId: true, userLimit: true },
  });
  if (!channel) {
    logger.warn(registro, 'voz: negada, canal nao existe');
    throw notFound('Canal');
  }

  if (!isVoiceCapable(channel.type)) {
    logger.warn({ ...registro, tipo: channel.type }, 'voz: negada, canal nao e de voz');
    throw new ApiError('BAD_REQUEST', 'Este canal nao aceita voz.');
  }

  const { permissions } = await resolveChannelPermissions(channel.id, userId);
  if (!has(permissions, Permission.CONNECT)) {
    logger.warn(registro, 'voz: negada, sem permissao de conectar');
    throw forbidden('Voce nao pode entrar neste canal de voz.');
  }

  // Limite de pessoas, exceto para quem pode mover membros.
  if (channel.userLimit && channel.userLimit > 0) {
    const occupants = await prisma.voiceState.count({ where: { channelId: channel.id } });
    const alreadyHere = await prisma.voiceState.findUnique({
      where: { userId },
      select: { channelId: true },
    });
    const joiningNew = alreadyHere?.channelId !== channel.id;
    if (
      joiningNew &&
      occupants >= channel.userLimit &&
      !has(permissions, Permission.MOVE_MEMBERS)
    ) {
      logger.warn({ ...registro, ocupantes: occupants }, 'voz: negada, canal cheio');
      throw new ApiError('FORBIDDEN', 'Este canal de voz esta cheio.');
    }
  }

  const previous = await prisma.voiceState.findUnique({ where: { userId } });
  const changedChannel = previous?.channelId !== channel.id;

  /**
   * O token tambem precisa ser reemitido quando a sessao muda, mesmo no mesmo
   * canal. Acontece sempre que o app reabre, reconecta ou perde a conexao com
   * o SFU: o servidor continua achando que a pessoa esta no canal, e sem esta
   * condicao ela clicaria no canal para sempre sem nunca receber o token que
   * permite entrar de fato.
   *
   * Mudancas de mute e camera chegam pela mesma sessao, entao nao disparam
   * token novo.
   */
  const newSession = previous?.sessionId !== sessionId;
  const needsToken = changedChannel || newSession;

  // Mute e deafen de servidor sao decisao da moderacao: o cliente nao pode
  // limpar sozinho ao reentrar.
  const member = channel.guildId
    ? await prisma.guildMember.findUnique({
        where: { guildId_userId: { guildId: channel.guildId, userId } },
        select: { serverMuted: true, serverDeafened: true },
      })
    : null;

  const state = await prisma.voiceState.upsert({
    where: { userId },
    create: {
      userId,
      guildId: channel.guildId,
      channelId: channel.id,
      sessionId,
      selfMute: payload.selfMute,
      selfDeaf: payload.selfDeaf,
      selfVideo: payload.selfVideo ?? false,
      selfStream: payload.selfStream ?? false,
      serverMute: member?.serverMuted ?? false,
      serverDeaf: member?.serverDeafened ?? false,
    },
    update: {
      guildId: channel.guildId,
      channelId: channel.id,
      sessionId,
      selfMute: payload.selfMute,
      selfDeaf: payload.selfDeaf,
      selfVideo: payload.selfVideo ?? false,
      selfStream: payload.selfStream ?? false,
      serverMute: member?.serverMuted ?? false,
      serverDeaf: member?.serverDeafened ?? false,
      ...(changedChannel ? { joinedAt: new Date() } : {}),
    },
  });

  // Se mudou de canal, quem ficou no antigo precisa ver a saida.
  if (previous && changedChannel) {
    await announceLeave(previous.channelId, previous.guildId, userId);
    await removeFromRoom(previous.channelId, userId);
  }

  const serialized = toVoiceState(state);
  if (channel.guildId) {
    emitToGuild(channel.guildId, 'VOICE_STATE_UPDATE', serialized);
  } else {
    await emitToDmRecipients(channel.id, 'VOICE_STATE_UPDATE', serialized);
  }

  // O token e emitido ao entrar e ao reconectar, nao a cada mute.
  if (needsToken && config.voice.enabled) {
    const { token, roomName, url } = await createVoiceToken(userId, channel.id);
    const iceServers = await montarIceServers();
    emitToUser(userId, 'VOICE_SERVER_UPDATE', {
      channelId: channel.id,
      guildId: channel.guildId,
      url,
      token,
      roomName,
      iceServers,
      forceRelay: config.voice.forceRelay,
    });
    // Sem o token o cliente nao tem o que fazer, entao esta linha separa
    // "o servidor nao deixou" de "o servidor deixou e a rede falhou".
    logger.info(
      { ...registro, roomName, url, relays: iceServers.length, trocouDeCanal: changedChannel },
      'voz: token emitido',
    );
  } else {
    // Este caso ja escondeu um defeito: sem token novo o cliente fica
    // clicando no canal sem nunca receber o que precisa para entrar.
    logger.info(
      { ...registro, vozAtiva: config.voice.enabled },
      'voz: sem token novo (mesma sessao e mesmo canal)',
    );
  }
}

/**
 * Tira alguem da voz.
 *
 * `notifyUser` decide se a propria pessoa recebe o aviso de saida. Por padrao
 * ela nao recebe, porque quem saiu foi ela e ja sabe: mandar o aviso de volta
 * criava uma corrida em que um "voce saiu" atrasado chegava depois de ela ter
 * entrado de novo e derrubava a chamada nova.
 *
 * Quando a saida e decisao de um moderador, ai sim o aviso precisa chegar: e a
 * unica forma de o cliente saber que foi desconectado.
 */
export async function disconnectFromVoice(
  userId: string,
  sessionId?: string,
  options: { notifyUser?: boolean } = {},
): Promise<void> {
  const state = await prisma.voiceState.findUnique({ where: { userId } });
  if (!state) return;

  // Uma sessao so derruba a voz se for a dona dela. Assim, fechar uma janela
  // secundaria nao tira a pessoa da call aberta na principal.
  if (sessionId && state.sessionId !== sessionId) return;

  await prisma.voiceState.delete({ where: { userId } }).catch(() => undefined);
  await announceLeave(state.channelId, state.guildId, userId, {
    exceptUserId: options.notifyUser ? undefined : userId,
  });
  await removeFromRoom(state.channelId, userId);
}

async function announceLeave(
  channelId: string,
  guildId: string | null,
  userId: string,
  options: { exceptUserId?: string } = {},
): Promise<void> {
  const payload = {
    userId,
    guildId,
    channelId: null as unknown as string,
    sessionId: '',
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    selfVideo: false,
    selfStream: false,
    joinedAt: new Date().toISOString(),
  };

  if (guildId) {
    emitToGuild(guildId, 'VOICE_STATE_UPDATE', payload, { exceptUserId: options.exceptUserId });
  } else {
    await emitToDmRecipients(channelId, 'VOICE_STATE_UPDATE', payload, options.exceptUserId);
  }
}

async function emitToDmRecipients(
  channelId: string,
  event: 'VOICE_STATE_UPDATE',
  payload: Parameters<typeof emitToUser<'VOICE_STATE_UPDATE'>>[2],
  exceptUserId?: string,
): Promise<void> {
  const recipients = await prisma.channelRecipient.findMany({
    where: { channelId },
    select: { userId: true },
  });
  for (const recipient of recipients) {
    if (recipient.userId === exceptUserId) continue;
    emitToUser(recipient.userId, event, payload);
  }
}

/** Tira o participante da sala no SFU. Falha aqui nao pode quebrar o fluxo. */
async function removeFromRoom(channelId: string, userId: string): Promise<void> {
  if (!config.voice.enabled) return;
  try {
    await getRoomService().removeParticipant(roomNameFor(channelId), userId);
  } catch (error) {
    // Participante ja tinha saido, ou a sala nem chegou a existir.
    logger.debug({ error, channelId, userId }, 'remocao do SFU ignorada');
  }
}

// ---------------------------------------------------------------------------
// Moderacao de voz
// ---------------------------------------------------------------------------

export async function setServerMute(
  guildId: string,
  actorId: string,
  targetId: string,
  muted: boolean,
): Promise<void> {
  const actor = await resolveMember(guildId, actorId);
  if (!actor) throw forbidden('Voce nao e membro deste servidor.');
  if (!has(actor.permissions, Permission.MUTE_MEMBERS)) {
    throw forbidden('Voce nao pode silenciar membros.');
  }

  await prisma.guildMember.update({
    where: { guildId_userId: { guildId, userId: targetId } },
    data: { serverMuted: muted },
  });

  const state = await prisma.voiceState.findUnique({ where: { userId: targetId } });
  if (!state || state.guildId !== guildId) return;

  const updated = await prisma.voiceState.update({
    where: { userId: targetId },
    data: { serverMute: muted },
  });
  emitToGuild(guildId, 'VOICE_STATE_UPDATE', toVoiceState(updated));

  // Silenciar de verdade acontece no SFU: sem isso o cliente poderia ignorar.
  if (config.voice.enabled) {
    try {
      const room = roomNameFor(state.channelId);
      const participants = await getRoomService().listParticipants(room);
      const participant = participants.find((p) => p.identity === targetId);
      for (const track of participant?.tracks ?? []) {
        if (track.source === TrackSource.MICROPHONE) {
          await getRoomService().mutePublishedTrack(room, targetId, track.sid, muted);
        }
      }
    } catch (error) {
      logger.warn({ error, targetId }, 'nao consegui aplicar mute no SFU');
    }
  }
}

export async function setServerDeafen(
  guildId: string,
  actorId: string,
  targetId: string,
  deafened: boolean,
): Promise<void> {
  const actor = await resolveMember(guildId, actorId);
  if (!actor) throw forbidden('Voce nao e membro deste servidor.');
  if (!has(actor.permissions, Permission.DEAFEN_MEMBERS)) {
    throw forbidden('Voce nao pode ensurdecer membros.');
  }

  await prisma.guildMember.update({
    where: { guildId_userId: { guildId, userId: targetId } },
    data: { serverDeafened: deafened },
  });

  const state = await prisma.voiceState.findUnique({ where: { userId: targetId } });
  if (!state || state.guildId !== guildId) return;

  const updated = await prisma.voiceState.update({
    where: { userId: targetId },
    data: { serverDeaf: deafened },
  });
  emitToGuild(guildId, 'VOICE_STATE_UPDATE', toVoiceState(updated));
}

/** Move alguem para outro canal de voz, ou desconecta quando destino e null. */
export async function moveMember(
  guildId: string,
  actorId: string,
  targetId: string,
  destinationChannelId: string | null,
): Promise<void> {
  const actor = await resolveMember(guildId, actorId);
  if (!actor) throw forbidden('Voce nao e membro deste servidor.');
  if (!has(actor.permissions, Permission.MOVE_MEMBERS)) {
    throw forbidden('Voce nao pode mover membros.');
  }

  const state = await prisma.voiceState.findUnique({ where: { userId: targetId } });
  if (!state || state.guildId !== guildId) {
    throw new ApiError('BAD_REQUEST', 'Esta pessoa nao esta em um canal de voz aqui.');
  }

  if (!destinationChannelId) {
    // Decisao do moderador, nao da pessoa: ela precisa ser avisada, senao o
    // app dela continuaria achando que esta na chamada.
    await disconnectFromVoice(targetId, undefined, { notifyUser: true });
    return;
  }

  const destination = await prisma.channel.findUnique({
    where: { id: destinationChannelId },
    select: { id: true, type: true, guildId: true },
  });
  if (!destination || destination.guildId !== guildId || destination.type !== 'GUILD_VOICE') {
    throw new ApiError('BAD_REQUEST', 'Canal de destino invalido.');
  }

  const previousChannelId = state.channelId;

  const updated = await prisma.voiceState.update({
    where: { userId: targetId },
    data: { channelId: destinationChannelId, joinedAt: new Date() },
  });

  await removeFromRoom(previousChannelId, targetId);
  emitToGuild(guildId, 'VOICE_STATE_UPDATE', toVoiceState(updated));

  // A pessoa movida precisa de um token novo para a sala de destino.
  if (config.voice.enabled) {
    try {
      const { token, roomName, url } = await createVoiceToken(targetId, destinationChannelId);
      emitToUser(targetId, 'VOICE_SERVER_UPDATE', {
        channelId: destinationChannelId,
        guildId,
        url,
        token,
        roomName,
        iceServers: await montarIceServers(),
        forceRelay: config.voice.forceRelay,
      });
    } catch (error) {
      logger.warn({ error, targetId }, 'nao consegui emitir token apos mover');
    }
  }
}

/** Limpa estados de voz orfaos na subida, depois de uma queda do processo. */
export async function clearStaleVoiceStates(): Promise<number> {
  const { count } = await prisma.voiceState.deleteMany({});
  if (count > 0) logger.info({ count }, 'estados de voz orfaos removidos');
  return count;
}

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
import { emitToSession, emitToUser } from '../gateway/events.js';
import { toVoiceState } from '../lib/serialize.js';
import { emitirParaQuemVe } from './entrega.js';
import { resolveChannelPermissions, resolveMember } from './permissions.js';
import { bloqueioNaDm } from './relacoes.js';
import { fontesPermitidas, type Moderacao } from '../lib/direitos-de-voz.js';

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

/** Silenciado ou ensurdecido pela moderacao: so existe em servidor (DM nao tem moderador). */
async function moderacaoDe(userId: string, guildId: string | null): Promise<Moderacao> {
  if (!guildId) return { silenciado: false, ensurdecido: false };
  const membro = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { serverMuted: true, serverDeafened: true },
  });
  return { silenciado: membro?.serverMuted ?? false, ensurdecido: membro?.serverDeafened ?? false };
}

/**
 * Leva a moderacao ao SFU na hora, sem esperar a pessoa reentrar: as
 * permissoes do participante sao trocadas (o LiveKit troca o conjunto inteiro,
 * entao vai tudo). Se a pessoa nao esta na sala, nao ha o que fazer.
 */
async function atualizarDireitosNoSfu(userId: string, channelId: string, guildId: string | null): Promise<void> {
  if (!config.voice.enabled) return;
  try {
    const [{ permissions }, moderacao] = await Promise.all([resolveChannelPermissions(channelId, userId), moderacaoDe(userId, guildId)]);
    const fontes = fontesPermitidas(permissions, moderacao);
    await getRoomService().updateParticipant(roomNameFor(channelId), userId, {
      permission: {
        canSubscribe: true,
        canPublish: fontes.length > 0,
        canPublishData: true,
        canPublishSources: fontes,
        canUpdateMetadata: true,
        hidden: false,
        recorder: false,
      },
    });
  } catch (error) {
    if (!naoEncontradoNoSfu(error)) logger.warn({ error, userId }, 'nao consegui atualizar as permissoes no SFU');
  }
}

/**
 * Monta o token de acesso do LiveKit com o que o membro pode fazer naquele
 * canal. O token vale 6 horas e e reemitido a cada entrada.
 */
export async function createVoiceToken(
  userId: string,
  channelId: string,
): Promise<{ token: string; roomName: string; url: string; serverMute: boolean; serverDeaf: boolean }> {
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

  // Aqui tambem, e nao so no gateway: a rota REST entrega o token direto.
  if (channelType === 'DM' && (await bloqueioNaDm(channelId, userId))) {
    throw forbidden('Nao foi possivel entrar nesta chamada.');
  }

  // Sem SPEAK a pessoa entra so para ouvir; silenciada pela moderacao, tambem.
  const moderacao = await moderacaoDe(userId, guildId);
  const sources = fontesPermitidas(permissions, moderacao);

  const grant: VideoGrant = {
    room: roomNameFor(channelId),
    roomJoin: true,
    canPublish: sources.length > 0,
    canPublishSources: sources.length ? sources : undefined,
    canSubscribe: true,
    // Usado pelo soundboard e pelos indicadores de fala.
    canPublishData: true,
    /*
      Os atributos do proprio participante: por eles cada cliente conta de
      quem assiste a transmissao, e o quadro de quem transmite mostra quantos
      espectadores tem. Nome e metadados que o cliente mudar nao valem nada: a
      interface usa os do servidor.
    */
    canUpdateOwnMetadata: true,
    /*
      Sem `roomAdmin`, para ninguem.

      Ele ia no token de quem tinha MUTE_MEMBERS ou MOVE_MEMBERS, e dava a esse
      cliente a API de administracao da sala direto no SFU: remover ou calar
      qualquer participante, sem passar pela hierarquia de cargos nem pelo
      registro de auditoria. O app nunca usou; a moderacao de voz passa pelo
      servidor (setServerMute, moveMember), que fala com o SFU pela chave da
      API.
    */
  };

  const accessToken = new AccessToken(config.voice.apiKey, config.voice.apiSecret, {
    identity: userId,
    name: user.displayName,
    ttl: TOKEN_TTL.voiceSecs,
    metadata: JSON.stringify({ username: user.username, avatarUrl: user.avatarUrl, guildId }),
  });
  accessToken.addGrant(grant);

  return {
    token: await accessToken.toJwt(),
    roomName: grant.room!,
    url: config.voice.url,
    serverMute: moderacao.silenciado,
    serverDeaf: moderacao.ensurdecido,
  };
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

  // Bloqueio numa DM 1:1 fecha a chamada nos dois sentidos. Conferido antes de
  // gravar o estado, para nao sobrar alguem "na chamada" sem poder entrar.
  if (channel.type === 'DM' && (await bloqueioNaDm(channel.id, userId))) {
    logger.warn(registro, 'voz: negada, bloqueio na DM');
    throw forbidden('Nao foi possivel entrar nesta chamada.');
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

  /*
    Se mudou de canal, quem ficou no antigo precisa ver a saida — mas a propria
    pessoa NAO recebe esse aviso.

    Ela ja esta na sala nova quando este pedido chega (o cliente conecta
    primeiro e avisa depois). O aviso "voce saiu da voz" sobre ela mesma e o
    que o app trata como desconexao feita por moderador: ele largava a chamada
    que tinha acabado de abrir. E a mesma corrida que `disconnectFromVoice`
    evita ao nao ecoar a saida para quem saiu.
  */
  if (previous && changedChannel) {
    await announceLeave(previous.channelId, previous.guildId, userId);
    await removeFromRoom(previous.channelId, userId);
  }

  const serialized = toVoiceState(state);
  if (channel.guildId) {
    await emitirParaQuemVe(channel.guildId, channel.id, 'VOICE_STATE_UPDATE', serialized, {
      incluir: [userId],
    });
  } else {
    await emitToDmRecipients(channel.id, 'VOICE_STATE_UPDATE', serialized);
  }

  // O token e emitido ao entrar e ao reconectar, nao a cada mute.
  if (needsToken && config.voice.enabled) {
    const { token, roomName, url, serverMute, serverDeaf } = await createVoiceToken(userId, channel.id);
    const iceServers = await montarIceServers();
    // So para a sessao que pediu: ver `emitToSession`.
    emitToSession(userId, sessionId, 'VOICE_SERVER_UPDATE', {
      channelId: channel.id,
      guildId: channel.guildId,
      url,
      token,
      roomName,
      iceServers,
      forceRelay: config.voice.forceRelay,
      serverMute,
      serverDeaf,
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

  await encerrarVoz(state, options);
}

/**
 * Tira alguem da voz porque perdeu o direito de estar la: expulso, banido,
 * saiu do servidor, o servidor foi apagado, o canal foi apagado, saiu ou foi
 * tirado do grupo, ou ha bloqueio na DM.
 *
 * Antes so o banco mudava: a linha de VoiceState sumia sem aviso nenhum, e a
 * pessoa continuava na sala do SFU, ouvindo e falando pela conexao que ja
 * tinha, com um token que vale seis horas.
 *
 * A propria pessoa recebe o aviso, porque para o app ele e a ordem de largar a
 * chamada. `onde` restringe: so tira se o estado for daquele servidor ou
 * canal — quem foi expulso de um servidor nao sai da chamada que esta em
 * outro.
 */
export async function tirarDaVoz(
  userId: string,
  onde: { guildId?: string; channelId?: string },
): Promise<void> {
  const state = await prisma.voiceState.findUnique({ where: { userId } });
  if (!state) return;
  if (onde.guildId !== undefined && state.guildId !== onde.guildId) return;
  if (onde.channelId !== undefined && state.channelId !== onde.channelId) return;

  await encerrarVoz(state, { notifyUser: true });
}

/** Apaga o estado, avisa quem enxerga o canal e tira da sala no SFU. */
async function encerrarVoz(
  state: { userId: string; channelId: string; guildId: string | null; sessionId: string },
  options: { notifyUser?: boolean },
): Promise<void> {
  // Apaga so o estado que foi lido. Se a pessoa trocou de canal ou de sessao
  // entre a leitura e aqui, o estado novo e dela e fica.
  const { count } = await prisma.voiceState.deleteMany({
    where: { userId: state.userId, channelId: state.channelId, sessionId: state.sessionId },
  });
  if (count === 0) return;

  await announceLeave(state.channelId, state.guildId, state.userId, {
    notifyUser: options.notifyUser,
  });
  await removeFromRoom(state.channelId, state.userId);
}

/**
 * Avisa que alguem saiu de um canal de voz, para quem enxerga o canal.
 *
 * A propria pessoa so recebe com `notifyUser` — ver `disconnectFromVoice`.
 */
async function announceLeave(
  channelId: string,
  guildId: string | null,
  userId: string,
  options: { notifyUser?: boolean } = {},
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
    await emitirParaQuemVe(
      guildId,
      channelId,
      'VOICE_STATE_UPDATE',
      payload,
      options.notifyUser ? { incluir: [userId] } : { exceptUserId: userId },
    );
  } else {
    await emitToDmRecipients(
      channelId,
      'VOICE_STATE_UPDATE',
      payload,
      options.notifyUser ? undefined : userId,
    );
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
    // Participante ja tinha saido, ou a sala nem chegou a existir: o resultado
    // que se queria ja vale.
    if (naoEncontradoNoSfu(error)) {
      logger.debug({ channelId, userId }, 'remocao do SFU ignorada: ja nao estava la');
      return;
    }
    // Qualquer outra falha nao vira erro para quem pediu — a saida ja foi
    // gravada — mas precisa aparecer: e ela que deixaria alguem na chamada.
    logger.warn({ error, channelId, userId }, 'nao consegui tirar da sala no SFU');
  }
}

/** O SFU respondeu "nao existe" (sala ou participante), e nao uma falha. */
function naoEncontradoNoSfu(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  return e?.status === 404 || e?.code === 'not_found';
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
  await emitirParaQuemVe(guildId, updated.channelId, 'VOICE_STATE_UPDATE', toVoiceState(updated), {
    incluir: [targetId],
  });

  // Silenciar de verdade acontece no SFU: sem isso o cliente poderia ignorar.
  // As permissoes impedem publicar de novo; o mute cala a faixa que ja esta no ar.
  await atualizarDireitosNoSfu(targetId, state.channelId, guildId);
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
  await emitirParaQuemVe(guildId, updated.channelId, 'VOICE_STATE_UPDATE', toVoiceState(updated), {
    incluir: [targetId],
  });

  /*
    O som deixa de chegar pelo proprio app (ele obedece ao estado de voz), e o
    microfone sai das permissoes no SFU: ensurdecido tambem nao fala. Antes
    ensurdecer so gravava no banco — nada acontecia em lugar nenhum.
  */
  await atualizarDireitosNoSfu(targetId, state.channelId, guildId);
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

  /*
    O token vem ANTES de mexer no banco, porque e ele que confere se a pessoa
    pode entrar no destino (CONNECT). Com o banco primeiro, quem nao podia
    entrar aparecia no canal novo para todos, sem conexao nenhuma.
  */
  let acesso: Awaited<ReturnType<typeof createVoiceToken>> | null = null;
  if (config.voice.enabled) {
    try {
      acesso = await createVoiceToken(targetId, destinationChannelId);
    } catch (error) {
      // A recusa do token fala com quem entra ("voce nao pode"); aqui quem le
      // e o moderador.
      if (error instanceof ApiError && error.code === 'FORBIDDEN') {
        throw forbidden('Essa pessoa nao pode entrar nesse canal.');
      }
      throw error;
    }
  }

  const updated = await prisma.voiceState.update({
    where: { userId: targetId },
    data: { channelId: destinationChannelId, joinedAt: new Date() },
  });

  /*
    Dois avisos, porque os dois canais podem ter plateias diferentes: quem via
    o canal de antes precisa ver a pessoa sair dele, e quem ve o destino, ela
    chegar. Um aviso so, para o destino, deixaria um fantasma na tela de quem
    enxerga o canal antigo e nao o novo.

    A saida nao vai para a propria pessoa: para o app, "voce saiu da voz" e
    ordem de largar a chamada, e aqui ela esta sendo movida, nao desconectada.
  */
  await announceLeave(previousChannelId, guildId, targetId);
  await emitirParaQuemVe(guildId, destinationChannelId, 'VOICE_STATE_UPDATE', toVoiceState(updated), {
    incluir: [targetId],
  });

  /*
    A pessoa movida precisa de um token novo para a sala de destino — no
    aparelho que esta na chamada, e so nele: a sessao dona do estado de voz.

    O token sai ANTES de a pessoa ser tirada da sala antiga. Na ordem inversa
    o app via a sala cair sem ter pedido nada e largava a chamada; o token que
    chegava em seguida era recusado pela guarda de entrada, que so atende quem
    esta numa sala ou entrando numa. Para todos a pessoa aparecia no canal
    novo, e de fato estava desconectada.
  */
  if (acesso) {
    try {
      emitToSession(targetId, state.sessionId, 'VOICE_SERVER_UPDATE', {
        channelId: destinationChannelId,
        guildId,
        url: acesso.url,
        token: acesso.token,
        roomName: acesso.roomName,
        iceServers: await montarIceServers(),
        forceRelay: config.voice.forceRelay,
        serverMute: acesso.serverMute,
        serverDeaf: acesso.serverDeaf,
      });
    } catch (error) {
      logger.warn({ error, targetId }, 'nao consegui emitir token apos mover');
    }
  }

  agendarSaidaDaSalaAntiga(previousChannelId, targetId);
}

/** Quanto o app tem para trocar de sala sozinho antes de o servidor agir. */
const PRAZO_PARA_TROCAR_DE_SALA_MS = 5_000;

/**
 * Rede de seguranca do mover: tira a pessoa da sala antiga, alguns segundos
 * depois.
 *
 * O app sai da sala antiga sozinho ao receber o token da nova. Isto e para
 * quem nao recebeu o aviso (sessao caida, versao antiga do app): moderador que
 * tira alguem de um canal precisa que a voz dessa pessoa pare de chegar la.
 * Se nesse meio tempo ela voltou para o mesmo canal, fica.
 */
function agendarSaidaDaSalaAntiga(channelId: string, userId: string): void {
  if (!config.voice.enabled) return;
  setTimeout(() => {
    void (async () => {
      const agora = await prisma.voiceState
        .findUnique({ where: { userId }, select: { channelId: true } })
        .catch(() => undefined);
      if (agora === undefined || agora?.channelId === channelId) return;
      await removeFromRoom(channelId, userId);
    })();
  }, PRAZO_PARA_TROCAR_DE_SALA_MS).unref();
}

/** Limpa estados de voz orfaos na subida, depois de uma queda do processo. */
export async function clearStaleVoiceStates(): Promise<number> {
  const { count } = await prisma.voiceState.deleteMany({});
  if (count > 0) logger.info({ count }, 'estados de voz orfaos removidos');
  return count;
}

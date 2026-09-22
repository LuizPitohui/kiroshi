import type { FastifyInstance } from 'fastify';
import { Permission, has, joinVoiceSchema, playSoundSchema } from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { toVoiceState } from '../lib/serialize.js';
import { emitToGuild } from '../gateway/events.js';
import { resolveChannelPermissions } from '../services/permissions.js';
import { createVoiceToken, disconnectFromVoice, isVoiceEnabled } from '../services/voice.js';
import { montarIceServers } from '../services/turn.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Como o aplicativo entra na voz.
   *
   * Aqui se pede o token do SFU; o estado de voz (quem esta em qual canal)
   * vem pelo gateway, em VOICE_STATE_UPDATE. Sao dois caminhos separados, e
   * vale lembrar disso ao investigar: nao ter linha em `VoiceState` nao quer
   * dizer que a pessoa nao tentou entrar — quer dizer que o outro caminho nao
   * chegou a rodar.
   *
   * O gateway tambem emite token sozinho quando o servidor move alguem de
   * canal; por isso a emissao existe nos dois lugares.
   */
  app.post('/voice/join', async (request) => {
    const userId = request.auth!.userId;
    const body = joinVoiceSchema.parse(request.body);

    /*
      Esta rota e por onde o aplicativo realmente entra na voz, e ate agora ela
      nao deixava rastro nenhum.

      O efeito pratico: quando alguem dizia "cliquei e nao entrou", o unico log
      disponivel era o do SFU — que nem e tocado quando a falha acontece antes
      dele. Nao dava para distinguir "o pedido nunca chegou" de "o token saiu e
      a rede falhou depois", que exigem consertos opostos. Com uma pessoa em
      outro pais do outro lado, cada rodada de adivinhacao custa uma conversa.

      O IP entra no registro porque ele diz de onde a pessoa vem, e o caminho
      da midia depende exatamente disso.
    */
    const registro = { userId, channelId: body.channelId, ip: request.ip };

    if (!isVoiceEnabled()) {
      logger.warn(registro, 'voz: negada, voz desligada no servidor');
      throw new ApiError('VOICE_UNAVAILABLE', 'A voz nao esta configurada neste servidor.');
    }

    let token: string;
    let roomName: string;
    let url: string;
    try {
      ({ token, roomName, url } = await createVoiceToken(userId, body.channelId));
    } catch (erro) {
      // Sem isto a recusa volta ao cliente e some: quem investiga nunca fica
      // sabendo que houve pedido, muito menos por que foi negado.
      logger.warn(
        { ...registro, motivo: erro instanceof Error ? erro.message : String(erro) },
        'voz: negada ao emitir token',
      );
      throw erro;
    }

    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: body.channelId },
      select: { guildId: true },
    });

    const iceServers = await montarIceServers();

    // A linha que separa "o servidor nao deixou" de "o servidor deixou e a
    // rede falhou". Sem ela as duas falhas parecem iguais de fora.
    logger.info(
      {
        ...registro,
        roomName,
        url,
        relays: iceServers.length,
        relayForcado: config.voice.forceRelay,
      },
      'voz: token emitido',
    );

    return {
      url,
      token,
      roomName,
      channelId: body.channelId,
      guildId: channel.guildId,
      iceServers,
      forceRelay: config.voice.forceRelay,
    };
  });

  app.post('/voice/leave', async (request) => {
    await disconnectFromVoice(request.auth!.userId);
    return { ok: true };
  });

  /** Renova o token sem sair da sala, para calls que passam do TTL. */
  app.post('/voice/refresh', async (request) => {
    const userId = request.auth!.userId;

    const state = await prisma.voiceState.findUnique({ where: { userId } });
    if (!state) throw new ApiError('BAD_REQUEST', 'Voce nao esta em um canal de voz.');

    const { token, roomName, url } = await createVoiceToken(userId, state.channelId);
    return {
      url,
      token,
      roomName,
      channelId: state.channelId,
      guildId: state.guildId,
      iceServers: await montarIceServers(),
      forceRelay: config.voice.forceRelay,
    };
  });

  app.get('/channels/:channelId/voice-states', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };

    const { permissions } = await resolveChannelPermissions(channelId, userId);
    if (permissions === 0n) throw forbidden('Voce nao tem acesso a este canal.');

    const states = await prisma.voiceState.findMany({ where: { channelId } });
    return states.map(toVoiceState);
  });

  // -------------------------------------------------------------------------
  /**
   * Toca um som do soundboard para quem esta no canal. O audio nao passa pelo
   * servidor: mandamos o evento e cada cliente reproduz o arquivo, que ja esta
   * em cache. Assim o som sai junto para todos sem custo de banda no SFU.
   */
  app.post('/channels/:channelId/soundboard', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = playSoundSchema.parse(request.body);

    const { permissions, guildId } = await resolveChannelPermissions(channelId, userId);
    if (!has(permissions, Permission.USE_SOUNDBOARD)) {
      throw forbidden('Voce nao pode usar o soundboard aqui.');
    }
    if (!guildId) throw new ApiError('BAD_REQUEST', 'O soundboard so funciona em servidores.');

    const state = await prisma.voiceState.findUnique({ where: { userId } });
    if (!state || state.channelId !== channelId) {
      throw new ApiError('BAD_REQUEST', 'Entre no canal de voz antes de tocar um som.');
    }

    const sound = await prisma.soundboardSound.findUnique({ where: { id: body.soundId } });
    if (!sound) throw notFound('Som');
    if (sound.guildId !== guildId) {
      throw forbidden('Este som e de outro servidor.');
    }

    emitToGuild(guildId, 'VOICE_CHANNEL_EFFECT', { channelId, guildId, userId, soundId: sound.id });

    return { ok: true };
  });
}

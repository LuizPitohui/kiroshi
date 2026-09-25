import type { FastifyInstance } from 'fastify';
import {
  LIMITS,
  USERNAME_PATTERN,
  updateChannelSettingsSchema,
  updateGuildSettingsSchema,
  updatePresenceSchema,
  updateProfileSchema,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { requireAuth, requireFreshAuth } from '../auth/middleware.js';
import {
  SELF_USER_SELECT,
  USER_SELECT,
  toChannelSettings,
  toGuildSettings,
  toPublicUser,
  toSelfUser,
} from '../lib/serialize.js';
import { emitToGuild, emitToUser } from '../gateway/events.js';
import { encerrarSessoesDeGateway } from '../gateway/server.js';
import { resolveImageInput } from '../services/storage.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  app.get('/users/@me', async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.userId },
      select: SELF_USER_SELECT,
    });
    if (!user) throw notFound('Usuario');
    return toSelfUser(user);
  });

  // -------------------------------------------------------------------------
  app.patch('/users/@me', async (request) => {
    const userId = request.auth!.userId;
    const body = updateProfileSchema.parse(request.body);

    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.pronouns !== undefined) data.pronouns = body.pronouns;
    if (body.accentColor !== undefined) data.accentColor = body.accentColor;

    for (const field of ['avatarUrl', 'bannerUrl'] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (value === null) {
        data[field] = null;
      } else {
        const stored = await resolveImageInput(value, {
          maxSize: field === 'avatarUrl' ? 256 : 960,
          maxBytes: LIMITS.imageBytes,
        });
        data[field] = stored.url;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: SELF_USER_SELECT,
    });

    const self = toSelfUser(updated);
    emitToUser(userId, 'USER_UPDATE', self);

    // Quem compartilha servidor precisa ver o avatar e o nome novos.
    const memberships = await prisma.guildMember.findMany({
      where: { userId },
      include: {
        user: { select: USER_SELECT },
        roles: { select: { roleId: true } },
      },
    });
    for (const membership of memberships) {
      emitToGuild(membership.guildId, 'GUILD_MEMBER_UPDATE', {
        guildId: membership.guildId,
        userId,
        user: toPublicUser(membership.user),
        nickname: membership.nickname,
        roleIds: membership.roles.map((r) => r.roleId),
        joinedAt: membership.joinedAt.toISOString(),
        serverMuted: membership.serverMuted,
        serverDeafened: membership.serverDeafened,
      });
    }

    return self;
  });

  // -------------------------------------------------------------------------
  /** Trocar o nome de usuario e sensivel: outra pessoa pode passar a se
   *  chamar como voce se o antigo for liberado sem cuidado. */
  app.patch('/users/@me/username', { preHandler: requireFreshAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { username } = request.body as { username?: string };

    const normalized = username?.trim().toLowerCase() ?? '';
    if (!USERNAME_PATTERN.test(normalized)) {
      throw badRequest('Use 2 a 32 caracteres: letras minusculas, numeros, ponto ou _.');
    }

    const taken = await prisma.user.findUnique({
      where: { username: normalized },
      select: { id: true },
    });
    if (taken && taken.id !== userId) {
      throw new ApiError('USERNAME_TAKEN', 'Este nome de usuario ja existe.');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { username: normalized },
      select: SELF_USER_SELECT,
    });

    const self = toSelfUser(updated);
    emitToUser(userId, 'USER_UPDATE', self);
    return self;
  });

  // -------------------------------------------------------------------------
  app.patch('/users/@me/presence', async (request) => {
    const userId = request.auth!.userId;
    const body = updatePresenceSchema.parse(request.body);

    await prisma.user.update({
      where: { id: userId },
      data: { status: body.status, customStatus: body.customStatus ?? null },
    });

    // O broadcast de presenca acontece no gateway, que conhece as sessoes.
    const { setPresence } = await import('../gateway/registry.js');
    const presence = setPresence(userId, body.status, body.customStatus ?? null);

    const memberships = await prisma.guildMember.findMany({
      where: { userId },
      select: { guildId: true },
    });
    for (const membership of memberships) {
      emitToGuild(membership.guildId, 'PRESENCE_UPDATE', presence);
    }
    emitToUser(userId, 'PRESENCE_UPDATE', presence);

    return presence;
  });

  // -------------------------------------------------------------------------
  app.get('/users/:userId', async (request) => {
    const { userId } = request.params as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw notFound('Usuario');
    return toPublicUser(user);
  });

  app.get('/users/by-username/:username', async (request) => {
    const { username } = request.params as { username: string };
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: USER_SELECT,
    });
    if (!user) throw notFound('Usuario');
    return toPublicUser(user);
  });

  // -------------------------------------------------------------------------
  // Preferencias de notificacao
  // -------------------------------------------------------------------------

  app.get('/users/@me/settings', async (request) => {
    const userId = request.auth!.userId;

    const [guildSettings, channelSettings] = await Promise.all([
      prisma.userGuildSettings.findMany({ where: { userId } }),
      prisma.userChannelSettings.findMany({ where: { userId } }),
    ]);

    /*
      Duas listas, e nao os canais dentro de cada servidor. Antes cada
      servidor voltava com os ajustes de TODOS os canais da pessoa (o filtro
      era `() => true`), e os de DM so apareciam se houvesse algum servidor.
    */
    return {
      guilds: guildSettings.map(toGuildSettings),
      channels: channelSettings.map(toChannelSettings),
    };
  });

  app.patch('/users/@me/guilds/:guildId/settings', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = updateGuildSettingsSchema.parse(request.body);

    const settings = await prisma.userGuildSettings.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: {
        userId,
        guildId,
        muted: body.muted ?? false,
        mutedUntil: body.muted && body.mutedUntil ? new Date(body.mutedUntil) : null,
        notificationLevel: body.notificationLevel ?? 'ALL',
      },
      update: {
        ...(body.muted !== undefined ? { muted: body.muted, mutedUntil: body.muted && body.mutedUntil ? new Date(body.mutedUntil) : null } : {}),
        ...(body.notificationLevel !== undefined
          ? { notificationLevel: body.notificationLevel }
          : {}),
      },
    });

    // Os outros aparelhos da pessoa passam a obedecer na hora.
    const serialized = toGuildSettings(settings);
    emitToUser(userId, 'USER_GUILD_SETTINGS_UPDATE', serialized);
    return serialized;
  });

  app.patch('/users/@me/channels/:channelId/settings', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = updateChannelSettingsSchema.parse(request.body);

    const settings = await prisma.userChannelSettings.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: {
        userId,
        channelId,
        muted: body.muted ?? false,
        mutedUntil: body.muted && body.mutedUntil ? new Date(body.mutedUntil) : null,
        notificationLevel: body.notificationLevel ?? null,
      },
      update: {
        ...(body.muted !== undefined ? { muted: body.muted, mutedUntil: body.muted && body.mutedUntil ? new Date(body.mutedUntil) : null } : {}),
        ...(body.notificationLevel !== undefined
          ? { notificationLevel: body.notificationLevel }
          : {}),
      },
    });

    const serialized = toChannelSettings(settings);
    emitToUser(userId, 'USER_CHANNEL_SETTINGS_UPDATE', serialized);
    return serialized;
  });

  /**
   * O que a tela de seguranca precisa saber e o perfil nao conta: se a conta
   * tem senha (quem entrou pelo Google pode nao ter). So um sim ou nao — o
   * hash nunca sai daqui.
   */
  app.get('/users/@me/security', async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId },
      select: { passwordHash: true, totpEnabled: true },
    });
    return { hasPassword: Boolean(user.passwordHash), totpEnabled: user.totpEnabled };
  });

  // -------------------------------------------------------------------------
  app.delete('/users/@me', { preHandler: requireFreshAuth }, async (request) => {
    const userId = request.auth!.userId;

    const owned = await prisma.guild.count({ where: { ownerId: userId } });
    if (owned > 0) {
      throw badRequest(
        'Transfira ou apague os servidores que voce criou antes de excluir a conta.',
      );
    }

    // Desativa em vez de apagar: as mensagens continuam fazendo sentido no
    // historico das conversas de quem ficou.
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId } });
      await tx.voiceState.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          disabledAt: new Date(),
          email: `apagado+${userId}@invalido.local`,
          displayName: 'Conta apagada',
          avatarUrl: null,
          bannerUrl: null,
          bio: null,
          pronouns: null,
          customStatus: null,
          totpEnabled: false,
          totpSecret: null,
          backupCodes: [],
        },
      });
    });

    // A conta desativada sai de todas as conexoes abertas, em todo aparelho.
    encerrarSessoesDeGateway(userId);

    return { ok: true };
  });
}

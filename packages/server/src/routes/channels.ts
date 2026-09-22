import type { FastifyInstance } from 'fastify';
import {
  BITRATE,
  LIMITS,
  Permission,
  createChannelSchema,
  deserialize,
  generateId,
  overwriteSchema,
  reorderChannelsSchema,
  updateChannelSchema,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { CHANNEL_INCLUDE, toChannel } from '../lib/serialize.js';
import { emitToGuild } from '../gateway/events.js';
import {
  assertGuildPermissions,
  resolveChannelPermissions,
  resolveMember,
  visibleChannelIds,
} from '../services/permissions.js';
import { recordAudit } from '../services/audit.js';
import { disconnectFromVoice } from '../services/voice.js';

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  app.get('/guilds/:guildId/channels', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };

    const member = await resolveMember(guildId, userId);
    if (!member) throw forbidden('Voce nao e membro deste servidor.');

    const [channels, visible] = await Promise.all([
      prisma.channel.findMany({
        where: { guildId },
        include: CHANNEL_INCLUDE,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      visibleChannelIds(guildId, userId),
    ]);

    return channels.filter((c) => visible.has(c.id)).map(toChannel);
  });

  // -------------------------------------------------------------------------
  app.post('/guilds/:guildId/channels', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createChannelSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_CHANNELS);

    const count = await prisma.channel.count({ where: { guildId } });
    if (count >= LIMITS.channelsPerGuild) {
      throw badRequest(`Um servidor pode ter no maximo ${LIMITS.channelsPerGuild} canais.`);
    }

    if (body.parentId) {
      const parent = await prisma.channel.findUnique({
        where: { id: body.parentId },
        select: { guildId: true, type: true },
      });
      if (!parent || parent.guildId !== guildId || parent.type !== 'GUILD_CATEGORY') {
        throw badRequest('A categoria informada nao existe neste servidor.');
      }
      if (body.type === 'GUILD_CATEGORY') {
        throw badRequest('Uma categoria nao pode ficar dentro de outra.');
      }
    }

    // Sem posicao explicita, entra no fim da categoria (ou da raiz).
    const position =
      body.position ??
      ((
        await prisma.channel.aggregate({
          where: { guildId, parentId: body.parentId ?? null },
          _max: { position: true },
        })
      )._max.position ?? -1) + 1;

    const isVoice = body.type === 'GUILD_VOICE';

    const channel = await prisma.channel.create({
      data: {
        id: generateId(),
        guildId,
        type: body.type,
        name: body.name,
        topic: body.topic ?? null,
        parentId: body.parentId ?? null,
        position,
        nsfw: body.nsfw ?? false,
        rateLimitPerUser: body.rateLimitPerUser ?? 0,
        bitrate: isVoice ? (body.bitrate ?? BITRATE.default) : null,
        userLimit: isVoice ? (body.userLimit ?? 0) : null,
      },
      include: CHANNEL_INCLUDE,
    });

    const serialized = toChannel(channel);
    // Um canal restrito nao deve aparecer para quem nao pode ve-lo.
    await emitChannelEvent(guildId, 'CHANNEL_CREATE', serialized, channel.id);
    await recordAudit(guildId, userId, 'CHANNEL_CREATE', channel.id, { name: body.name });

    return reply.status(201).send(serialized);
  });

  // -------------------------------------------------------------------------
  app.get('/channels/:channelId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };

    const { permissions } = await resolveChannelPermissions(channelId, userId);
    if (permissions === 0n) throw forbidden('Voce nao tem acesso a este canal.');

    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    return toChannel(channel);
  });

  // -------------------------------------------------------------------------
  app.patch('/channels/:channelId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = updateChannelSchema.parse(request.body);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, guildId: true, type: true },
    });
    if (!channel) throw notFound('Canal');
    if (!channel.guildId) throw badRequest('Use a rota de DM para mudar este canal.');

    await assertGuildPermissions(channel.guildId, userId, Permission.MANAGE_CHANNELS);

    if (body.parentId) {
      const parent = await prisma.channel.findUnique({
        where: { id: body.parentId },
        select: { guildId: true, type: true },
      });
      if (!parent || parent.guildId !== channel.guildId || parent.type !== 'GUILD_CATEGORY') {
        throw badRequest('A categoria informada nao existe neste servidor.');
      }
    }

    const isVoice = channel.type === 'GUILD_VOICE';

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.topic !== undefined ? { topic: body.topic } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.nsfw !== undefined ? { nsfw: body.nsfw } : {}),
        ...(body.rateLimitPerUser !== undefined
          ? { rateLimitPerUser: body.rateLimitPerUser }
          : {}),
        ...(isVoice && body.bitrate !== undefined ? { bitrate: body.bitrate } : {}),
        ...(isVoice && body.userLimit !== undefined ? { userLimit: body.userLimit } : {}),
      },
      include: CHANNEL_INCLUDE,
    });

    const serialized = toChannel(updated);
    await emitChannelEvent(channel.guildId, 'CHANNEL_UPDATE', serialized, channelId);
    await recordAudit(channel.guildId, userId, 'CHANNEL_UPDATE', channelId, { ...body });

    return serialized;
  });

  // -------------------------------------------------------------------------
  app.patch('/guilds/:guildId/channels', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = reorderChannelsSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_CHANNELS);

    const ids = body.positions.map((p) => p.id);
    const owned = await prisma.channel.count({ where: { guildId, id: { in: ids } } });
    if (owned !== ids.length) throw badRequest('Algum canal nao pertence a este servidor.');

    await prisma.$transaction(
      body.positions.map((p) =>
        prisma.channel.update({
          where: { id: p.id },
          data: {
            position: p.position,
            ...(p.parentId !== undefined ? { parentId: p.parentId } : {}),
          },
        }),
      ),
    );

    const channels = await prisma.channel.findMany({
      where: { guildId },
      include: CHANNEL_INCLUDE,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    for (const channel of channels) {
      await emitChannelEvent(guildId, 'CHANNEL_UPDATE', toChannel(channel), channel.id);
    }

    return channels.map(toChannel);
  });

  // -------------------------------------------------------------------------
  app.delete('/channels/:channelId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    if (!channel) throw notFound('Canal');
    if (!channel.guildId) throw badRequest('Uma DM nao pode ser apagada; feche-a.');

    await assertGuildPermissions(channel.guildId, userId, Permission.MANAGE_CHANNELS);

    // Tira todo mundo da voz antes de sumir com o canal.
    if (channel.type === 'GUILD_VOICE') {
      const occupants = await prisma.voiceState.findMany({
        where: { channelId },
        select: { userId: true },
      });
      for (const occupant of occupants) await disconnectFromVoice(occupant.userId);
    }

    const serialized = toChannel(channel);
    await prisma.channel.delete({ where: { id: channelId } });

    emitToGuild(channel.guildId, 'CHANNEL_DELETE', serialized);
    await recordAudit(channel.guildId, userId, 'CHANNEL_DELETE', channelId, {
      name: channel.name,
    });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Permissoes por canal
  // -------------------------------------------------------------------------

  app.put('/channels/:channelId/permissions/:targetId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId, targetId } = request.params as { channelId: string; targetId: string };
    const body = overwriteSchema.parse({ ...(request.body as object), targetId });

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { guildId: true },
    });
    if (!channel?.guildId) throw notFound('Canal');

    const actor = await assertGuildPermissions(channel.guildId, userId, [
      Permission.MANAGE_ROLES,
      Permission.MANAGE_CHANNELS,
    ]);

    const allow = deserialize(body.allow);
    const deny = deserialize(body.deny);

    // Nao pode conceder por overwrite o que nao tem no servidor.
    const granting = allow & ~actor.permissions;
    if (granting !== 0n && actor.ctx.userId !== actor.ctx.guildOwnerId) {
      throw forbidden('Voce nao pode liberar permissoes que voce mesmo nao tem.');
    }

    if (body.targetType === 'ROLE') {
      const role = await prisma.role.findUnique({
        where: { id: targetId },
        select: { guildId: true },
      });
      if (!role || role.guildId !== channel.guildId) throw badRequest('Cargo invalido.');
    } else {
      const member = await prisma.guildMember.findUnique({
        where: { guildId_userId: { guildId: channel.guildId, userId: targetId } },
        select: { userId: true },
      });
      if (!member) throw badRequest('Esta pessoa nao e membro do servidor.');
    }

    await prisma.permissionOverwrite.upsert({
      where: { channelId_targetId: { channelId, targetId } },
      create: { channelId, targetId, targetType: body.targetType, allow, deny },
      update: { targetType: body.targetType, allow, deny },
    });

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });

    await emitChannelEvent(channel.guildId, 'CHANNEL_UPDATE', toChannel(updated), channelId);
    await recordAudit(channel.guildId, userId, 'CHANNEL_OVERWRITE_UPDATE', channelId, {
      targetId,
      allow: body.allow,
      deny: body.deny,
    });

    return toChannel(updated);
  });

  app.delete('/channels/:channelId/permissions/:targetId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId, targetId } = request.params as { channelId: string; targetId: string };

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { guildId: true },
    });
    if (!channel?.guildId) throw notFound('Canal');

    await assertGuildPermissions(channel.guildId, userId, [
      Permission.MANAGE_ROLES,
      Permission.MANAGE_CHANNELS,
    ]);

    await prisma.permissionOverwrite.deleteMany({ where: { channelId, targetId } });

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    await emitChannelEvent(channel.guildId, 'CHANNEL_UPDATE', toChannel(updated), channelId);

    return toChannel(updated);
  });
}

/**
 * Manda o evento so para quem enxerga o canal. Sem isso, criar um canal
 * privado avisaria o servidor inteiro que ele existe.
 */
async function emitChannelEvent(
  guildId: string,
  event: 'CHANNEL_CREATE' | 'CHANNEL_UPDATE',
  payload: ReturnType<typeof toChannel>,
  channelId: string,
): Promise<void> {
  const members = await prisma.guildMember.findMany({
    where: { guildId },
    select: { userId: true },
  });

  const allowed = new Set<string>();
  for (const member of members) {
    const visible = await visibleChannelIds(guildId, member.userId);
    if (visible.has(channelId)) allowed.add(member.userId);
  }

  emitToGuild(guildId, event, payload, { onlyUserIds: allowed });
}

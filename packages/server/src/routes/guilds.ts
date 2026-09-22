import type { FastifyInstance } from 'fastify';
import {
  LIMITS,
  Permission,
  RATE_LIMITS,
  createGuildSchema,
  createInviteSchema,
  createRoleSchema,
  deserialize,
  generateId,
  reorderRolesSchema,
  updateGuildSchema,
  updateMemberSchema,
  updateRoleSchema,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { requireAuth, requireFreshAuth } from '../auth/middleware.js';
import { consume } from '../lib/ratelimit.js';
import {
  MEMBER_INCLUDE,
  USER_SELECT,
  toGuild,
  toMember,
  toPublicUser,
  toRole,
} from '../lib/serialize.js';
import {
  emitToGuild,
  emitToUser,
  subscribeUserToGuild,
  unsubscribeUserFromGuild,
} from '../gateway/events.js';
import {
  assertCanActOn,
  assertCanManageRole,
  assertGuildPermissions,
  resolveMember,
} from '../services/permissions.js';
import { createGuild, memberIds, removeMember, transferOwnership } from '../services/guilds.js';
import { createInvite, listInvites } from '../services/invites.js';
import { buildGuildState } from '../services/ready.js';
import { moveMember, setServerDeafen, setServerMute } from '../services/voice.js';
import { resolveImageInput } from '../services/storage.js';
import { recordAudit } from '../services/audit.js';

export async function guildRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  app.post('/guilds', async (request, reply) => {
    const userId = request.auth!.userId;
    consume(`createGuild:${userId}`, RATE_LIMITS.createGuild);

    const body = createGuildSchema.parse(request.body);

    let iconUrl: string | null = null;
    if (body.iconUrl) {
      const stored = await resolveImageInput(body.iconUrl, {
        maxSize: 256,
        maxBytes: LIMITS.imageBytes,
      });
      iconUrl = stored.url;
    }

    const guild = await createGuild(userId, { ...body, iconUrl });

    // A sessao precisa acompanhar o servidor novo antes de qualquer evento dele.
    subscribeUserToGuild(userId, guild.id);
    emitToUser(userId, 'GUILD_CREATE', guild);

    return reply.status(201).send(guild);
  });

  // -------------------------------------------------------------------------
  app.get('/guilds/:guildId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };

    const member = await resolveMember(guildId, userId);
    if (!member) throw forbidden('Voce nao e membro deste servidor.');

    return buildGuildState(guildId, userId);
  });

  // -------------------------------------------------------------------------
  app.patch('/guilds/:guildId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = updateGuildSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_GUILD);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.systemChannelId !== undefined) data.systemChannelId = body.systemChannelId;

    for (const field of ['iconUrl', 'bannerUrl'] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (value === null) {
        data[field] = null;
      } else {
        const stored = await resolveImageInput(value, {
          maxSize: field === 'iconUrl' ? 256 : 960,
          maxBytes: LIMITS.imageBytes,
        });
        data[field] = stored.url;
      }
    }

    const updated = await prisma.guild.update({ where: { id: guildId }, data });
    const serialized = toGuild(updated);

    emitToGuild(guildId, 'GUILD_UPDATE', serialized);
    await recordAudit(guildId, userId, 'GUILD_UPDATE', guildId, data);

    return serialized;
  });

  // -------------------------------------------------------------------------
  app.delete('/guilds/:guildId', { preHandler: requireFreshAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { ownerId: true },
    });
    if (!guild) throw notFound('Servidor');
    if (guild.ownerId !== userId) throw forbidden('So o dono pode apagar o servidor.');

    const members = await memberIds(guildId);

    // Avisa antes de apagar: depois do delete nao ha mais a quem perguntar
    // quem eram os membros.
    for (const memberId of members) {
      emitToUser(memberId, 'GUILD_DELETE', { id: guildId, unavailable: false });
      unsubscribeUserFromGuild(memberId, guildId);
    }

    await prisma.guild.delete({ where: { id: guildId } });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  app.post('/guilds/:guildId/leave', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { ownerId: true },
    });
    if (!guild) throw notFound('Servidor');
    if (guild.ownerId === userId) {
      throw badRequest('Transfira a posse antes de sair, ou apague o servidor.');
    }

    await removeMember(guildId, userId);

    emitToGuild(guildId, 'GUILD_MEMBER_REMOVE', { guildId, userId });
    emitToUser(userId, 'GUILD_DELETE', { id: guildId, unavailable: false });
    unsubscribeUserFromGuild(userId, guildId);

    return { ok: true };
  });

  app.post('/guilds/:guildId/owner', { preHandler: requireFreshAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const { userId: newOwnerId } = request.body as { userId?: string };
    if (!newOwnerId) throw badRequest('Informe o userId do novo dono.');

    await transferOwnership(guildId, userId, newOwnerId);

    const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
    emitToGuild(guildId, 'GUILD_UPDATE', toGuild(guild));
    await recordAudit(guildId, userId, 'OWNERSHIP_TRANSFER', newOwnerId, {});

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Membros
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/members', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const query = request.query as { limit?: string; after?: string };

    const member = await resolveMember(guildId, userId);
    if (!member) throw forbidden('Voce nao e membro deste servidor.');

    const members = await prisma.guildMember.findMany({
      where: { guildId, ...(query.after ? { userId: { gt: query.after } } : {}) },
      include: MEMBER_INCLUDE,
      orderBy: { userId: 'asc' },
      take: Math.min(Number(query.limit ?? 100), 1000),
    });

    return members.map(toMember);
  });

  app.patch('/guilds/:guildId/members/:memberId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, memberId } = request.params as { guildId: string; memberId: string };
    const body = updateMemberSchema.parse(request.body);

    const actor = await resolveMember(guildId, userId);
    if (!actor) throw forbidden('Voce nao e membro deste servidor.');

    const isSelf = memberId === userId;

    // Apelido: proprio exige CHANGE_NICKNAME, de terceiro exige MANAGE_NICKNAMES.
    if (body.nickname !== undefined) {
      const needed = isSelf ? Permission.CHANGE_NICKNAME : Permission.MANAGE_NICKNAMES;
      await assertGuildPermissions(guildId, userId, needed);
      if (!isSelf) await assertCanActOn(guildId, userId, memberId);
    }

    if (body.roleIds !== undefined) {
      await assertGuildPermissions(guildId, userId, Permission.MANAGE_ROLES);
      await assertCanActOn(guildId, userId, memberId);

      const roles = await prisma.role.findMany({
        where: { id: { in: body.roleIds }, guildId },
        select: { id: true, position: true, permissions: true, managed: true },
      });
      if (roles.length !== body.roleIds.length) {
        throw badRequest('Algum cargo informado nao existe neste servidor.');
      }
      // Nao pode dar cargo igual ou acima do proprio, nem permissoes que nao tem.
      for (const role of roles) {
        if (role.managed) continue;
        await assertCanManageRole(guildId, userId, role.position, role.permissions);
      }
    }

    if (body.serverMuted !== undefined) {
      await setServerMute(guildId, userId, memberId, body.serverMuted);
    }
    if (body.serverDeafened !== undefined) {
      await setServerDeafen(guildId, userId, memberId, body.serverDeafened);
    }
    if (body.voiceChannelId !== undefined) {
      await moveMember(guildId, userId, memberId, body.voiceChannelId);
    }

    if (body.nickname !== undefined || body.roleIds !== undefined) {
      await prisma.$transaction(async (tx) => {
        if (body.nickname !== undefined) {
          await tx.guildMember.update({
            where: { guildId_userId: { guildId, userId: memberId } },
            data: { nickname: body.nickname },
          });
        }
        if (body.roleIds !== undefined) {
          // O cargo everyone e implicito e nunca aparece na tabela.
          const explicit = body.roleIds.filter((id) => id !== guildId);
          await tx.memberRole.deleteMany({ where: { guildId, userId: memberId } });
          if (explicit.length > 0) {
            await tx.memberRole.createMany({
              data: explicit.map((roleId) => ({ guildId, userId: memberId, roleId })),
            });
          }
        }
      });
    }

    const updated = await prisma.guildMember.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId: memberId } },
      include: MEMBER_INCLUDE,
    });
    const serialized = toMember(updated);

    emitToGuild(guildId, 'GUILD_MEMBER_UPDATE', serialized);
    await recordAudit(guildId, userId, 'MEMBER_UPDATE', memberId, {
      nickname: body.nickname,
      roleIds: body.roleIds,
    });

    return serialized;
  });

  app.delete('/guilds/:guildId/members/:memberId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, memberId } = request.params as { guildId: string; memberId: string };

    await assertGuildPermissions(guildId, userId, Permission.KICK_MEMBERS);
    await assertCanActOn(guildId, userId, memberId);

    const guild = await prisma.guild.findUniqueOrThrow({
      where: { id: guildId },
      select: { ownerId: true },
    });
    if (guild.ownerId === memberId) throw forbidden('O dono nao pode ser expulso.');

    await removeMember(guildId, memberId);

    emitToGuild(guildId, 'GUILD_MEMBER_REMOVE', { guildId, userId: memberId });
    emitToUser(memberId, 'GUILD_DELETE', { id: guildId, unavailable: false });
    unsubscribeUserFromGuild(memberId, guildId);
    await recordAudit(guildId, userId, 'MEMBER_KICK', memberId, {});

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Banimentos
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/bans', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    await assertGuildPermissions(guildId, userId, Permission.BAN_MEMBERS);

    const bans = await prisma.guildBan.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
    });

    const users = await prisma.user.findMany({
      where: { id: { in: bans.map((b) => b.userId) } },
      select: USER_SELECT,
    });
    const byId = new Map(users.map((u) => [u.id, toPublicUser(u)]));

    return bans.map((ban) => ({
      user: byId.get(ban.userId) ?? null,
      userId: ban.userId,
      reason: ban.reason,
      bannedBy: ban.bannedBy,
      createdAt: ban.createdAt.toISOString(),
    }));
  });

  app.put('/guilds/:guildId/bans/:memberId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, memberId } = request.params as { guildId: string; memberId: string };
    const { reason } = (request.body ?? {}) as { reason?: string };

    await assertGuildPermissions(guildId, userId, Permission.BAN_MEMBERS);

    const guild = await prisma.guild.findUniqueOrThrow({
      where: { id: guildId },
      select: { ownerId: true },
    });
    if (guild.ownerId === memberId) throw forbidden('O dono nao pode ser banido.');

    // A hierarquia so vale se a pessoa ainda for membro; banir alguem de fora
    // (para impedir que entre) e permitido.
    const isMember = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId: memberId } },
      select: { userId: true },
    });
    if (isMember) await assertCanActOn(guildId, userId, memberId);

    await prisma.guildBan.upsert({
      where: { guildId_userId: { guildId, userId: memberId } },
      create: { guildId, userId: memberId, reason: reason?.slice(0, 512), bannedBy: userId },
      update: { reason: reason?.slice(0, 512), bannedBy: userId },
    });

    if (isMember) {
      await removeMember(guildId, memberId);
      emitToGuild(guildId, 'GUILD_MEMBER_REMOVE', { guildId, userId: memberId });
      emitToUser(memberId, 'GUILD_DELETE', { id: guildId, unavailable: false });
      unsubscribeUserFromGuild(memberId, guildId);
    }

    await recordAudit(guildId, userId, 'MEMBER_BAN', memberId, { reason });
    return { ok: true };
  });

  app.delete('/guilds/:guildId/bans/:memberId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, memberId } = request.params as { guildId: string; memberId: string };
    await assertGuildPermissions(guildId, userId, Permission.BAN_MEMBERS);

    await prisma.guildBan.deleteMany({ where: { guildId, userId: memberId } });
    await recordAudit(guildId, userId, 'MEMBER_UNBAN', memberId, {});
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Cargos
  // -------------------------------------------------------------------------

  app.post('/guilds/:guildId/roles', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createRoleSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_ROLES);

    const count = await prisma.role.count({ where: { guildId } });
    if (count >= LIMITS.rolesPerGuild) {
      throw badRequest(`Um servidor pode ter no maximo ${LIMITS.rolesPerGuild} cargos.`);
    }

    const permissions = deserialize(body.permissions ?? '0');

    // O cargo novo entra logo abaixo do cargo mais alto de quem cria.
    const highest = await prisma.role.aggregate({
      where: { guildId },
      _max: { position: true },
    });
    const position = (highest._max.position ?? 0) + 1;

    await assertCanManageRole(guildId, userId, position, permissions);

    const role = await prisma.role.create({
      data: {
        id: generateId(),
        guildId,
        name: body.name,
        color: body.color ?? null,
        permissions,
        hoist: body.hoist ?? false,
        mentionable: body.mentionable ?? false,
        position,
      },
    });

    const serialized = toRole(role);
    emitToGuild(guildId, 'GUILD_ROLE_CREATE', serialized);
    await recordAudit(guildId, userId, 'ROLE_CREATE', role.id, { name: body.name });

    return reply.status(201).send(serialized);
  });

  app.patch('/guilds/:guildId/roles/:roleId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, roleId } = request.params as { guildId: string; roleId: string };
    const body = updateRoleSchema.parse(request.body);

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.guildId !== guildId) throw notFound('Cargo');

    const nextPermissions =
      body.permissions !== undefined ? deserialize(body.permissions) : role.permissions;

    await assertCanManageRole(guildId, userId, role.position, nextPermissions);

    // O cargo everyone existe sempre e nao pode ser renomeado nem exibido a parte.
    const isEveryone = role.id === guildId;
    if (isEveryone && (body.name !== undefined || body.hoist !== undefined)) {
      throw badRequest('O cargo padrao nao pode ser renomeado nem destacado.');
    }

    const updated = await prisma.role.update({
      where: { id: roleId },
      data: {
        ...(body.name !== undefined && !isEveryone ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.permissions !== undefined ? { permissions: nextPermissions } : {}),
        ...(body.hoist !== undefined && !isEveryone ? { hoist: body.hoist } : {}),
        ...(body.mentionable !== undefined ? { mentionable: body.mentionable } : {}),
      },
    });

    const serialized = toRole(updated);
    emitToGuild(guildId, 'GUILD_ROLE_UPDATE', serialized);
    await recordAudit(guildId, userId, 'ROLE_UPDATE', roleId, { ...body });

    return serialized;
  });

  app.patch('/guilds/:guildId/roles', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = reorderRolesSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_ROLES);

    const actor = await resolveMember(guildId, userId);
    const actorHighest =
      actor && actor.ctx.userId === actor.ctx.guildOwnerId
        ? Number.POSITIVE_INFINITY
        : (actor?.ctx.roles.reduce((max, r) => (r.position > max ? r.position : max), -1) ?? -1);

    const roles = await prisma.role.findMany({
      where: { guildId, id: { in: body.positions.map((p) => p.id) } },
      select: { id: true, position: true },
    });

    // Nao deixa empurrar um cargo para cima do proprio nivel.
    for (const target of body.positions) {
      const current = roles.find((r) => r.id === target.id);
      if (!current) throw badRequest('Algum cargo informado nao existe neste servidor.');
      if (target.position >= actorHighest || current.position >= actorHighest) {
        throw forbidden('Voce nao pode reordenar cargos no seu nivel ou acima dele.');
      }
    }

    await prisma.$transaction(
      body.positions.map((p) =>
        prisma.role.update({ where: { id: p.id }, data: { position: p.position } }),
      ),
    );

    const updated = await prisma.role.findMany({ where: { guildId }, orderBy: { position: 'asc' } });
    for (const role of updated) emitToGuild(guildId, 'GUILD_ROLE_UPDATE', toRole(role));

    return updated.map(toRole);
  });

  app.delete('/guilds/:guildId/roles/:roleId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, roleId } = request.params as { guildId: string; roleId: string };

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.guildId !== guildId) throw notFound('Cargo');
    if (role.managed) throw badRequest('Este cargo e gerido pelo sistema e nao pode ser apagado.');

    await assertCanManageRole(guildId, userId, role.position, role.permissions);

    await prisma.role.delete({ where: { id: roleId } });

    emitToGuild(guildId, 'GUILD_ROLE_DELETE', { guildId, roleId });
    await recordAudit(guildId, userId, 'ROLE_DELETE', roleId, { name: role.name });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Convites
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/invites', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    await assertGuildPermissions(guildId, userId, Permission.MANAGE_GUILD);
    return listInvites(guildId);
  });

  app.post('/guilds/:guildId/invites', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createInviteSchema.parse(request.body ?? {});

    await assertGuildPermissions(guildId, userId, Permission.CREATE_INVITE);

    if (body.channelId) {
      const channel = await prisma.channel.findUnique({
        where: { id: body.channelId },
        select: { guildId: true },
      });
      if (!channel || channel.guildId !== guildId) {
        throw badRequest('Canal informado nao pertence a este servidor.');
      }
    }

    const invite = await createInvite(guildId, userId, {
      channelId: body.channelId ?? null,
      maxAgeSecs: body.maxAgeSecs,
      maxUses: body.maxUses,
    });

    return reply.status(201).send(invite);
  });

  // -------------------------------------------------------------------------
  app.get('/guilds/:guildId/audit-log', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const query = request.query as { limit?: string; before?: string };

    await assertGuildPermissions(guildId, userId, Permission.VIEW_AUDIT_LOG);

    const entries = await prisma.auditLogEntry.findMany({
      where: { guildId, ...(query.before ? { id: { lt: query.before } } : {}) },
      include: { actor: { select: USER_SELECT } },
      orderBy: { id: 'desc' },
      take: Math.min(Number(query.limit ?? 50), 100),
    });

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor: toPublicUser(entry.actor),
      targetId: entry.targetId,
      changes: entry.changes,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    }));
  });
}

/** Erro claro quando alguem tenta agir em um servidor que nao existe. */
export function assertGuildExists(guild: unknown): asserts guild {
  if (!guild) throw new ApiError('NOT_FOUND', 'Servidor nao encontrado.');
}

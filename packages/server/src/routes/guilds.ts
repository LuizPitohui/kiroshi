import type { FastifyInstance, FastifyRequest } from 'fastify';
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
  type AuditLogEntry,
  type GuildBan,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { requireAuth, requireFreshAuth } from '../auth/middleware.js';
import { consume } from '../lib/ratelimit.js';
import {
  CHANNEL_INCLUDE,
  MEMBER_INCLUDE,
  USER_SELECT,
  toChannel,
  toGuild,
  toMember,
  toPublicUser,
  toRole,
} from '../lib/serialize.js';
import { cargoMaisAlto, reordenarCargos } from '../lib/cargos.js';
import { membrosComPermissao } from '../lib/visibilidade.js';
import { avisarMudancaDeAcesso } from '../services/acesso.js';
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
  carregarRetratoDaGuild,
  resolveMember,
} from '../services/permissions.js';
import { createGuild, memberIds, removeMember, transferOwnership } from '../services/guilds.js';
import { createInvite, listInvites } from '../services/invites.js';
import { buildGuildState } from '../services/ready.js';
import { moveMember, setServerDeafen, setServerMute, tirarDaVoz } from '../services/voice.js';
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

    // Quem esta numa chamada deste servidor sai dela antes: o banco apagaria o
    // estado por cascata, mas a sala no SFU continuaria aberta para essa gente.
    const naVoz = await prisma.voiceState.findMany({
      where: { guildId },
      select: { userId: true },
    });
    for (const { userId: ocupante } of naVoz) await tirarDaVoz(ocupante, { guildId });

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

    const antes = await carregarRetratoDaGuild(guildId);
    await transferOwnership(guildId, userId, newOwnerId);

    const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
    emitToGuild(guildId, 'GUILD_UPDATE', toGuild(guild));
    // O dono ve tudo: quem entrega a posse pode deixar de ver canal privado.
    await avisarMudancaDeAcesso(guildId, antes, [userId, newOwnerId]);
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
      await recordAudit(guildId, userId, body.serverMuted ? 'MEMBER_MUTE' : 'MEMBER_UNMUTE', memberId, {});
    }
    if (body.serverDeafened !== undefined) {
      await setServerDeafen(guildId, userId, memberId, body.serverDeafened);
      await recordAudit(guildId, userId, body.serverDeafened ? 'MEMBER_DEAFEN' : 'MEMBER_UNDEAFEN', memberId, {});
    }
    if (body.voiceChannelId !== undefined) {
      await moveMember(guildId, userId, memberId, body.voiceChannelId);
      await recordAudit(
        guildId,
        userId,
        body.voiceChannelId ? 'MEMBER_MOVE' : 'MEMBER_DISCONNECT',
        memberId,
        body.voiceChannelId ? { channelId: body.voiceChannelId } : {},
      );
    }

    const antes = body.roleIds !== undefined ? await carregarRetratoDaGuild(guildId) : null;

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
    await avisarMudancaDeAcesso(guildId, antes, [memberId]);
    if (body.nickname !== undefined || body.roleIds !== undefined) {
      await recordAudit(guildId, userId, 'MEMBER_UPDATE', memberId, {
        nickname: body.nickname,
        roleIds: body.roleIds,
      });
    }

    return serialized;
  });

  /*
    Dar ou tirar UM cargo.

    A unica forma de mexer em cargo de alguem era o PATCH acima com a lista
    COMPLETA, que apaga e recria: dois moderadores mexendo ao mesmo tempo
    desfaziam o que o outro fez, e o cliente precisava saber todos os cargos
    da pessoa para mudar um. Aqui cada pedido muda so o que diz.
  */
  const mudarCargoDoMembro = (dar: boolean) => async (request: FastifyRequest) => {
    const userId = request.auth!.userId;
    const { guildId, memberId, roleId } = request.params as {
      guildId: string;
      memberId: string;
      roleId: string;
    };

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_ROLES);
    if (roleId === guildId) throw badRequest('O cargo everyone vale para todos e nao se da nem se tira.');

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.guildId !== guildId) throw notFound('Cargo');
    // Nao se da cargo no proprio nivel ou acima, nem um com permissao que nao se tem.
    await assertCanManageRole(guildId, userId, role.position, dar ? role.permissions : 0n);
    await assertCanActOn(guildId, userId, memberId);

    const membro = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId: memberId } },
      select: { userId: true },
    });
    if (!membro) throw notFound('Membro');

    const antes = await carregarRetratoDaGuild(guildId);
    const linha = { guildId, userId: memberId, roleId };
    const mudou = dar
      ? (await prisma.memberRole.createMany({ data: [linha], skipDuplicates: true })).count > 0
      : (await prisma.memberRole.deleteMany({ where: linha })).count > 0;

    const atualizado = await prisma.guildMember.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId: memberId } },
      include: MEMBER_INCLUDE,
    });
    const serializado = toMember(atualizado);
    if (mudou) {
      emitToGuild(guildId, 'GUILD_MEMBER_UPDATE', serializado);
      await avisarMudancaDeAcesso(guildId, antes, [memberId]);
      await recordAudit(guildId, userId, 'MEMBER_ROLE_UPDATE', memberId, dar ? { added: [roleId] } : { removed: [roleId] });
    }
    return serializado;
  };

  app.put('/guilds/:guildId/members/:memberId/roles/:roleId', mudarCargoDoMembro(true));
  app.delete('/guilds/:guildId/members/:memberId/roles/:roleId', mudarCargoDoMembro(false));

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

    return bans.map(
      (ban): GuildBan => ({
        user: byId.get(ban.userId) ?? null,
        userId: ban.userId,
        reason: ban.reason,
        bannedBy: ban.bannedBy,
        createdAt: ban.createdAt.toISOString(),
      }),
    );
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

    /*
      O cargo novo nasce logo acima do everyone, como no Discord.

      Antes nascia no topo (maximo + 1) e em seguida a hierarquia exigia que
      ficasse abaixo de quem criou: impossivel para qualquer um que nao fosse
      o dono, administrador inclusive. Posicao 0 na checagem quer dizer "no
      nivel do everyone": passa quem tem qualquer cargo acima dele.
    */
    await assertCanManageRole(guildId, userId, 0, permissions);

    const role = await prisma.$transaction(async (tx) => {
      await tx.role.updateMany({
        where: { guildId, position: { gte: 1 } },
        data: { position: { increment: 1 } },
      });
      return tx.role.create({
        data: {
          id: generateId(),
          guildId,
          name: body.name,
          color: body.color ?? null,
          permissions,
          hoist: body.hoist ?? false,
          mentionable: body.mentionable ?? false,
          position: 1,
        },
      });
    });

    const serialized = toRole(role);
    emitToGuild(guildId, 'GUILD_ROLE_CREATE', serialized);
    // Os outros subiram um degrau; sem isto a ordem na tela de cada um ficaria errada.
    const subiram = await prisma.role.findMany({
      where: { guildId, position: { gt: 1 } },
    });
    for (const outro of subiram) emitToGuild(guildId, 'GUILD_ROLE_UPDATE', toRole(outro));
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

    // So os bits que mudam precisam caber no que o autor tem: antes o conjunto
    // final inteiro precisava, e nao dava nem para trocar a cor de um cargo
    // que tivesse uma permissao que o autor nao tem.
    await assertCanManageRole(guildId, userId, role.position, nextPermissions ^ role.permissions);

    // O cargo everyone existe sempre e nao pode ser renomeado nem exibido a parte.
    const isEveryone = role.id === guildId;
    if (isEveryone && (body.name !== undefined || body.hoist !== undefined)) {
      throw badRequest('O cargo padrao nao pode ser renomeado nem destacado.');
    }

    const mudaAcesso = nextPermissions !== role.permissions;
    const antes = mudaAcesso ? await carregarRetratoDaGuild(guildId) : null;

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
    await avisarMudancaDeAcesso(guildId, antes);
    await recordAudit(guildId, userId, 'ROLE_UPDATE', roleId, { ...body });

    return serialized;
  });

  app.patch('/guilds/:guildId/roles', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = reorderRolesSchema.parse(request.body);

    const actor = await assertGuildPermissions(guildId, userId, Permission.MANAGE_ROLES);
    const atuais = await prisma.role.findMany({
      where: { guildId },
      select: { id: true, position: true },
    });

    const dono = actor.ctx.userId === actor.ctx.guildOwnerId;
    const resultado = reordenarCargos(
      atuais,
      body.positions,
      guildId,
      dono ? { dono: true } : { dono: false, topoDoAutor: cargoMaisAlto(actor.ctx.roles, guildId) },
    );
    if (!resultado.ok) {
      switch (resultado.motivo) {
        case 'EVERYONE':
          throw badRequest('O cargo everyone fica sempre embaixo de todos.');
        case 'REPETIDO':
          throw badRequest('Um cargo apareceu duas vezes no pedido.');
        case 'DESCONHECIDO':
          throw badRequest('Algum cargo informado nao existe neste servidor.');
        case 'HIERARQUIA':
          throw forbidden('Voce so pode reordenar cargos abaixo do seu cargo mais alto.');
      }
    }

    const mudaram = atuais.filter((r) => {
      const nova = resultado.posicoes.get(r.id);
      return nova !== undefined && nova !== r.position;
    });
    if (mudaram.length > 0) {
      await prisma.$transaction(
        mudaram.map((r) =>
          prisma.role.update({ where: { id: r.id }, data: { position: resultado.posicoes.get(r.id)! } }),
        ),
      );
    }

    const updated = await prisma.role.findMany({ where: { guildId }, orderBy: { position: 'asc' } });
    const idsQueMudaram = new Set(mudaram.map((r) => r.id));
    for (const role of updated) {
      if (idsQueMudaram.has(role.id)) emitToGuild(guildId, 'GUILD_ROLE_UPDATE', toRole(role));
    }
    if (mudaram.length > 0) {
      await recordAudit(guildId, userId, 'ROLE_REORDER', null, {
        order: updated.filter((r) => r.id !== guildId).map((r) => r.id).reverse(),
      });
    }

    return updated.map(toRole);
  });

  app.delete('/guilds/:guildId/roles/:roleId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, roleId } = request.params as { guildId: string; roleId: string };

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.guildId !== guildId) throw notFound('Cargo');
    if (role.managed) throw badRequest('Este cargo e gerido pelo sistema e nao pode ser apagado.');

    // Apagar tira permissoes de quem tinha o cargo, nao concede nenhuma: basta
    // a hierarquia, como no Discord.
    await assertCanManageRole(guildId, userId, role.position, 0n);

    const antes = await carregarRetratoDaGuild(guildId);
    // As sobrescritas que citavam o cargo nao tem chave estrangeira; sem esta
    // limpeza ficariam nos canais apontando para um cargo que nao existe.
    const citado = await prisma.permissionOverwrite.findMany({
      where: { targetId: roleId, channel: { guildId } },
      select: { channelId: true },
    });
    await prisma.$transaction([
      prisma.permissionOverwrite.deleteMany({ where: { targetId: roleId, channel: { guildId } } }),
      prisma.role.delete({ where: { id: roleId } }),
    ]);

    emitToGuild(guildId, 'GUILD_ROLE_DELETE', { guildId, roleId });
    if (citado.length > 0) {
      const canais = await prisma.channel.findMany({
        where: { id: { in: citado.map((c) => c.channelId) } },
        include: CHANNEL_INCLUDE,
      });
      const depois = await carregarRetratoDaGuild(guildId);
      for (const canal of canais) {
        emitToGuild(guildId, 'CHANNEL_UPDATE', toChannel(canal), {
          onlyUserIds: depois ? membrosComPermissao(depois, canal.id) : new Set(),
        });
      }
    }
    await avisarMudancaDeAcesso(guildId, antes);
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
    await recordAudit(guildId, userId, 'INVITE_CREATE', null, {
      code: invite.code,
      maxAgeSecs: body.maxAgeSecs,
      maxUses: body.maxUses,
    });

    return reply.status(201).send(invite);
  });

  // -------------------------------------------------------------------------
  app.get('/guilds/:guildId/audit-log', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const query = request.query as { limit?: string; before?: string; actorId?: string; action?: string };

    await assertGuildPermissions(guildId, userId, Permission.VIEW_AUDIT_LOG);

    // Filtros da tela: por quem fez e pelo tipo de acao.
    const id = /^\d{1,20}$/;
    if (query.before && !id.test(query.before)) throw badRequest('Paginacao invalida.');
    if (query.actorId && !id.test(query.actorId)) throw badRequest('Pessoa invalida.');
    if (query.action && !/^[A-Z_]{2,64}$/.test(query.action)) throw badRequest('Acao invalida.');

    const entries = await prisma.auditLogEntry.findMany({
      where: {
        guildId,
        ...(query.before ? { id: { lt: query.before } } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      include: { actor: { select: USER_SELECT } },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100),
    });

    // O alvo, quando e uma pessoa: quem foi banido ja nao esta na lista de membros do app.
    const alvos = await prisma.user.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.targetId).filter((t): t is string => Boolean(t)))] } },
      select: USER_SELECT,
    });
    const pessoa = new Map(alvos.map((u) => [u.id, toPublicUser(u)]));

    return entries.map(
      (entry): AuditLogEntry => ({
        id: entry.id,
        action: entry.action,
        actor: toPublicUser(entry.actor),
        targetId: entry.targetId,
        targetUser: entry.targetId ? (pessoa.get(entry.targetId) ?? null) : null,
        changes: (entry.changes ?? {}) as Record<string, unknown>,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      }),
    );
  });
}

/** Erro claro quando alguem tenta agir em um servidor que nao existe. */
export function assertGuildExists(guild: unknown): asserts guild {
  if (!guild) throw new ApiError('NOT_FOUND', 'Servidor nao encontrado.');
}

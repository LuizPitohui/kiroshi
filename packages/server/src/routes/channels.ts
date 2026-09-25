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
import { logger } from '../logger.js';
import { requireAuth } from '../auth/middleware.js';
import { CHANNEL_INCLUDE, toChannel } from '../lib/serialize.js';
import { membrosComPermissao, type RetratoDaGuild } from '../lib/visibilidade.js';
import { emitToGuild } from '../gateway/events.js';
import {
  assertGuildPermissions,
  carregarRetratoDaGuild,
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
    await avisarCanalCriado(guildId, serialized);
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

    // Trocar de categoria troca as sobrescritas herdadas, e com elas quem ve o
    // canal. Guarda o antes para avisar quem deixou de ver.
    const antes = body.parentId !== undefined ? await carregarRetratoDaGuild(channel.guildId) : null;

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
    await avisarCanaisAlterados(channel.guildId, [channelId], antes);
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

    const trocaDePai = body.positions.some((p) => p.parentId !== undefined);
    const antes = trocaDePai ? await carregarRetratoDaGuild(guildId) : null;

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
    await avisarCanaisAlterados(
      guildId,
      channels.map((c) => c.id),
      antes,
    );

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

    // Quem via o canal, calculado enquanto ele ainda existe: depois de apagado
    // nao ha mais sobrescrita para consultar.
    const antes = await carregarRetratoDaGuild(channel.guildId);
    const viam = antes ? membrosComPermissao(antes, channelId) : new Set<string>();
    const filhos =
      channel.type === 'GUILD_CATEGORY' && antes
        ? antes.channels.filter((c) => c.parentId === channelId).map((c) => c.id)
        : [];

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

    // So quem via o canal fica sabendo que ele sumiu: o aviso para o servidor
    // inteiro revelava a existencia de canal privado.
    emitToGuild(channel.guildId, 'CHANNEL_DELETE', serialized, { onlyUserIds: viam });

    // Apagar uma categoria solta os canais dela (o pai vira nulo), e eles
    // perdem as sobrescritas que herdavam: quem ve cada um pode ter mudado.
    if (filhos.length > 0) await avisarCanaisAlterados(channel.guildId, filhos, antes);

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
      select: { guildId: true, type: true },
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

    const antes = await carregarRetratoDaGuild(channel.guildId);

    await prisma.permissionOverwrite.upsert({
      where: { channelId_targetId: { channelId, targetId } },
      create: { channelId, targetId, targetType: body.targetType, allow, deny },
      update: { targetType: body.targetType, allow, deny },
    });

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });

    await avisarCanaisAlterados(
      channel.guildId,
      canaisAfetadosPorSobrescrita(antes, channelId, channel.type),
      antes,
    );
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
      select: { guildId: true, type: true },
    });
    if (!channel?.guildId) throw notFound('Canal');

    await assertGuildPermissions(channel.guildId, userId, [
      Permission.MANAGE_ROLES,
      Permission.MANAGE_CHANNELS,
    ]);

    const antes = await carregarRetratoDaGuild(channel.guildId);

    await prisma.permissionOverwrite.deleteMany({ where: { channelId, targetId } });

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    await avisarCanaisAlterados(
      channel.guildId,
      canaisAfetadosPorSobrescrita(antes, channelId, channel.type),
      antes,
    );

    return toChannel(updated);
  });
}

/**
 * Canais cuja visibilidade muda com a sobrescrita de `channelId`: ele mesmo e,
 * se for categoria, os canais dentro dela, que herdam as sobrescritas do pai.
 */
function canaisAfetadosPorSobrescrita(
  antes: RetratoDaGuild | null,
  channelId: string,
  tipo: string,
): string[] {
  if (tipo !== 'GUILD_CATEGORY' || !antes) return [channelId];
  return [channelId, ...antes.channels.filter((c) => c.parentId === channelId).map((c) => c.id)];
}

/** Avisa a criacao de um canal so a quem pode ve-lo. */
async function avisarCanalCriado(
  guildId: string,
  canal: ReturnType<typeof toChannel>,
): Promise<void> {
  try {
    const retrato = await carregarRetratoDaGuild(guildId);
    if (!retrato) return;
    emitToGuild(guildId, 'CHANNEL_CREATE', canal, {
      onlyUserIds: membrosComPermissao(retrato, canal.id),
    });
  } catch (error) {
    logger.error({ error, guildId, channelId: canal.id }, 'nao consegui avisar o canal novo');
  }
}

/**
 * Poe em dia a lista de canais de cada membro depois de uma mudanca.
 *
 * Quem ve o canal agora recebe CHANNEL_UPDATE, que o app trata como "crie se
 * nao tiver" — entao serve tambem para quem acabou de ganhar acesso. Quem via
 * antes e deixou de ver recebe CHANNEL_DELETE: sem isso o canal ficaria na
 * tela dessa pessoa, mudo, porque os eventos dele ja nao chegam para ela.
 *
 * `antes` e nulo quando a mudanca nao mexe em quem ve o canal (nome, posicao):
 * nesse caso so ha o que atualizar.
 *
 * Nao lanca: a mudanca ja foi gravada, e um aviso que falhou vira log.
 */
async function avisarCanaisAlterados(
  guildId: string,
  channelIds: string[],
  antes: RetratoDaGuild | null,
): Promise<void> {
  try {
    const [depois, canais] = await Promise.all([
      carregarRetratoDaGuild(guildId),
      prisma.channel.findMany({
        where: { id: { in: channelIds }, guildId },
        include: CHANNEL_INCLUDE,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    ]);
    if (!depois) return;

    for (const canal of canais) {
      const serializado = toChannel(canal);
      const veemAgora = membrosComPermissao(depois, canal.id);
      emitToGuild(guildId, 'CHANNEL_UPDATE', serializado, { onlyUserIds: veemAgora });

      if (!antes) continue;
      const perderam = new Set(
        [...membrosComPermissao(antes, canal.id)].filter((id) => !veemAgora.has(id)),
      );
      if (perderam.size > 0) {
        emitToGuild(guildId, 'CHANNEL_DELETE', serializado, { onlyUserIds: perderam });
      }
    }
  } catch (error) {
    logger.error({ error, guildId }, 'nao consegui avisar a mudanca de canais');
  }
}

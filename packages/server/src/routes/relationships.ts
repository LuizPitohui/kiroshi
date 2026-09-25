import type { FastifyInstance } from 'fastify';
import {
  LIMITS,
  createDmSchema,
  friendRequestSchema,
  generateId,
  updateGroupDmSchema,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import {
  CHANNEL_INCLUDE,
  USER_SELECT,
  toChannel,
  toPublicUser,
} from '../lib/serialize.js';
import {
  emitToUser,
  subscribeUserToChannel,
  unsubscribeUserFromChannel,
} from '../gateway/events.js';
import { bloqueioEntre, dmEntre } from '../services/relacoes.js';
import { resolveImageInput } from '../services/storage.js';
import { tirarDaVoz } from '../services/voice.js';

/**
 * Amizades e mensagens diretas.
 *
 * A tabela Relationship guarda um par ordenado (requester, addressee). Uma
 * amizade aceita e uma linha so; um bloqueio tambem, mas direcional: quem
 * bloqueou fica sempre como requester.
 */

async function findRelationship(a: string, b: string) {
  return prisma.relationship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  });
}

export async function relationshipRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  app.get('/relationships', async (request) => {
    const userId = request.auth!.userId;

    const rows = await prisma.relationship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: {
        requester: { select: USER_SELECT },
        addressee: { select: USER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows
      .filter((row) => {
        // Um bloqueio so aparece para quem bloqueou.
        if (row.status === 'BLOCKED') return row.requesterId === userId;
        return true;
      })
      .map((row) => {
        const outgoing = row.requesterId === userId;
        const other = outgoing ? row.addressee : row.requester;
        const type =
          row.status === 'ACCEPTED'
            ? 'FRIEND'
            : row.status === 'BLOCKED'
              ? 'BLOCKED'
              : outgoing
                ? 'PENDING_OUTGOING'
                : 'PENDING_INCOMING';
        return {
          id: row.id,
          type,
          user: toPublicUser(other),
          createdAt: row.createdAt.toISOString(),
        };
      });
  });

  // -------------------------------------------------------------------------
  app.post('/relationships', async (request, reply) => {
    const userId = request.auth!.userId;
    const body = friendRequestSchema.parse(request.body);

    const target = await prisma.user.findUnique({
      where: { username: body.username },
      select: { ...USER_SELECT, disabledAt: true },
    });
    if (!target || target.disabledAt) throw notFound('Usuario');
    if (target.id === userId) throw badRequest('Voce nao pode adicionar a si mesmo.');

    const existing = await findRelationship(userId, target.id);

    if (existing) {
      if (existing.status === 'ACCEPTED') throw conflict('Voces ja sao amigos.');
      if (existing.status === 'BLOCKED') {
        // Nao revela quem bloqueou quem.
        throw new ApiError('FORBIDDEN', 'Nao foi possivel enviar o pedido.');
      }
      // Pedido cruzado: a outra pessoa ja tinha convidado, entao aceita direto.
      if (existing.addresseeId === userId) {
        const accepted = await prisma.relationship.update({
          where: { id: existing.id },
          data: { status: 'ACCEPTED' },
          include: { requester: { select: USER_SELECT }, addressee: { select: USER_SELECT } },
        });

        emitToUser(userId, 'RELATIONSHIP_UPDATE', {
          id: accepted.id,
          type: 'FRIEND',
          user: toPublicUser(accepted.requester),
          createdAt: accepted.createdAt.toISOString(),
        });
        emitToUser(accepted.requesterId, 'RELATIONSHIP_UPDATE', {
          id: accepted.id,
          type: 'FRIEND',
          user: toPublicUser(accepted.addressee),
          createdAt: accepted.createdAt.toISOString(),
        });

        return reply.status(200).send({ status: 'FRIEND' });
      }
      throw conflict('Voce ja enviou um pedido para esta pessoa.');
    }

    const relationship = await prisma.relationship.create({
      data: {
        id: generateId(),
        requesterId: userId,
        addresseeId: target.id,
        status: 'PENDING',
      },
      include: { requester: { select: USER_SELECT }, addressee: { select: USER_SELECT } },
    });

    emitToUser(userId, 'RELATIONSHIP_ADD', {
      id: relationship.id,
      type: 'PENDING_OUTGOING',
      user: toPublicUser(relationship.addressee),
      createdAt: relationship.createdAt.toISOString(),
    });
    emitToUser(target.id, 'RELATIONSHIP_ADD', {
      id: relationship.id,
      type: 'PENDING_INCOMING',
      user: toPublicUser(relationship.requester),
      createdAt: relationship.createdAt.toISOString(),
    });

    return reply.status(201).send({ status: 'PENDING_OUTGOING' });
  });

  // -------------------------------------------------------------------------
  app.put('/relationships/:relationshipId', async (request) => {
    const userId = request.auth!.userId;
    const { relationshipId } = request.params as { relationshipId: string };

    const relationship = await prisma.relationship.findUnique({
      where: { id: relationshipId },
      include: { requester: { select: USER_SELECT }, addressee: { select: USER_SELECT } },
    });
    if (!relationship) throw notFound('Pedido');
    // So quem recebeu o pedido pode aceitar.
    if (relationship.addresseeId !== userId) throw forbidden('Este pedido nao e seu.');
    if (relationship.status !== 'PENDING') throw badRequest('Este pedido nao esta pendente.');

    await prisma.relationship.update({
      where: { id: relationshipId },
      data: { status: 'ACCEPTED' },
    });

    emitToUser(userId, 'RELATIONSHIP_UPDATE', {
      id: relationship.id,
      type: 'FRIEND',
      user: toPublicUser(relationship.requester),
      createdAt: relationship.createdAt.toISOString(),
    });
    emitToUser(relationship.requesterId, 'RELATIONSHIP_UPDATE', {
      id: relationship.id,
      type: 'FRIEND',
      user: toPublicUser(relationship.addressee),
      createdAt: relationship.createdAt.toISOString(),
    });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  /** Recusa, cancela ou desfaz a amizade: a mesma rota nos tres casos. */
  app.delete('/relationships/:relationshipId', async (request) => {
    const userId = request.auth!.userId;
    const { relationshipId } = request.params as { relationshipId: string };

    const relationship = await prisma.relationship.findUnique({
      where: { id: relationshipId },
    });
    if (!relationship) throw notFound('Relacao');
    if (relationship.requesterId !== userId && relationship.addresseeId !== userId) {
      throw forbidden('Esta relacao nao e sua.');
    }

    await prisma.relationship.delete({ where: { id: relationshipId } });

    const otherId =
      relationship.requesterId === userId ? relationship.addresseeId : relationship.requesterId;

    emitToUser(userId, 'RELATIONSHIP_REMOVE', { id: relationshipId, userId: otherId });
    // Quem bloqueou nao avisa o bloqueado.
    if (relationship.status !== 'BLOCKED') {
      emitToUser(otherId, 'RELATIONSHIP_REMOVE', { id: relationshipId, userId });
    }

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  app.put('/relationships/block/:targetId', async (request) => {
    const userId = request.auth!.userId;
    const { targetId } = request.params as { targetId: string };

    if (targetId === userId) throw badRequest('Voce nao pode bloquear a si mesmo.');

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: USER_SELECT,
    });
    if (!target) throw notFound('Usuario');

    /*
      Cada bloqueio e de quem bloqueou, gravado com ele como requester, e os
      dois sentidos podem existir juntos.

      Antes a relacao encontrada era apagada fosse qual fosse: bloquear quem ja
      tinha te bloqueado apagava o bloqueio DELA, em silencio. Agora so some a
      amizade ou o pedido pendente; um bloqueio alheio fica onde esta.
    */
    const [minha, dela] = await Promise.all([
      prisma.relationship.findUnique({
        where: { requesterId_addresseeId: { requesterId: userId, addresseeId: targetId } },
      }),
      prisma.relationship.findUnique({
        where: { requesterId_addresseeId: { requesterId: targetId, addresseeId: userId } },
      }),
    ]);

    const desfeitas = [minha, dela].filter(
      (r): r is NonNullable<typeof r> => r !== null && r.status !== 'BLOCKED',
    );
    for (const relacao of desfeitas) {
      await prisma.relationship.delete({ where: { id: relacao.id } });
      // Os dois lados perdem a amizade ou o pedido. Quem bloqueou tambem
      // precisa do aviso: o app guarda a relacao pelo id, e sem ele a amizade
      // antiga ficava na tela ao lado do bloqueio novo.
      emitToUser(userId, 'RELATIONSHIP_REMOVE', { id: relacao.id, userId: targetId });
      emitToUser(targetId, 'RELATIONSHIP_REMOVE', { id: relacao.id, userId });
    }

    // Bloquear de novo quem ja esta bloqueado nao cria nada.
    if (minha?.status !== 'BLOCKED') {
      const blocked = await prisma.relationship.create({
        data: {
          id: generateId(),
          requesterId: userId,
          addresseeId: targetId,
          status: 'BLOCKED',
        },
      });

      emitToUser(userId, 'RELATIONSHIP_ADD', {
        id: blocked.id,
        type: 'BLOCKED',
        user: toPublicUser(target),
        createdAt: blocked.createdAt.toISOString(),
      });
    }

    // Bloqueio fecha a chamada da DM entre os dois, para os dois.
    const dm = await dmEntre(userId, targetId);
    if (dm) {
      await tirarDaVoz(userId, { channelId: dm.id });
      await tirarDaVoz(targetId, { channelId: dm.id });
    }

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Mensagens diretas
  // -------------------------------------------------------------------------

  app.get('/users/@me/channels', async (request) => {
    const userId = request.auth!.userId;
    const channels = await prisma.channel.findMany({
      where: {
        type: { in: ['DM', 'GROUP_DM'] },
        recipients: { some: { userId, closed: false } },
      },
      include: CHANNEL_INCLUDE,
      orderBy: { lastMessageId: 'desc' },
    });
    return channels.map(toChannel);
  });

  app.post('/users/@me/channels', async (request, reply) => {
    const userId = request.auth!.userId;
    const body = createDmSchema.parse(request.body);

    const recipientIds = [...new Set(body.recipientIds.filter((id) => id !== userId))];
    if (recipientIds.length === 0) throw badRequest('Informe pelo menos um destinatario.');
    if (recipientIds.length + 1 > LIMITS.groupDmRecipients) {
      throw badRequest(`Um grupo aceita no maximo ${LIMITS.groupDmRecipients} pessoas.`);
    }

    const recipients = await prisma.user.findMany({
      where: { id: { in: recipientIds }, disabledAt: null },
      select: { id: true },
    });
    if (recipients.length !== recipientIds.length) throw badRequest('Algum usuario nao existe.');

    for (const recipient of recipients) {
      if (await bloqueioEntre(userId, recipient.id)) {
        throw new ApiError('FORBIDDEN', 'Nao foi possivel abrir a conversa.');
      }
    }

    const isGroup = recipientIds.length > 1;

    // DM 1 a 1 e unica: se ja existe, reabre em vez de criar outra.
    if (!isGroup) {
      const otherId = recipientIds[0]!;
      const existing = await prisma.channel.findFirst({
        where: {
          type: 'DM',
          AND: [
            { recipients: { some: { userId } } },
            { recipients: { some: { userId: otherId } } },
          ],
        },
        include: CHANNEL_INCLUDE,
      });

      if (existing) {
        await prisma.channelRecipient.updateMany({
          where: { channelId: existing.id, userId },
          data: { closed: false },
        });
        const serialized = toChannel(existing);
        subscribeUserToChannel(userId, existing.id);
        emitToUser(userId, 'CHANNEL_CREATE', serialized);
        return reply.status(200).send(serialized);
      }
    }

    const channelId = generateId();
    const participants = [userId, ...recipientIds];

    const channel = await prisma.channel.create({
      data: {
        id: channelId,
        type: isGroup ? 'GROUP_DM' : 'DM',
        ownerId: isGroup ? userId : null,
        recipients: { create: participants.map((id) => ({ userId: id })) },
      },
      include: CHANNEL_INCLUDE,
    });

    const serialized = toChannel(channel);
    for (const participant of participants) {
      subscribeUserToChannel(participant, channelId);
      emitToUser(participant, 'CHANNEL_CREATE', serialized);
    }

    return reply.status(201).send(serialized);
  });

  // -------------------------------------------------------------------------
  app.patch('/channels/:channelId/dm', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = updateGroupDmSchema.parse(request.body);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    if (!channel || channel.type !== 'GROUP_DM') throw notFound('Grupo');
    if (!channel.recipients.some((r) => r.userId === userId)) {
      throw forbidden('Voce nao participa deste grupo.');
    }

    let iconUrl: string | null | undefined;
    if (body.iconUrl !== undefined) {
      iconUrl = body.iconUrl
        ? (await resolveImageInput(body.iconUrl, { maxSize: 256, maxBytes: LIMITS.imageBytes })).url
        : null;
    }

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
      },
      include: CHANNEL_INCLUDE,
    });

    const serialized = toChannel(updated);
    for (const recipient of updated.recipients) {
      emitToUser(recipient.userId, 'CHANNEL_UPDATE', serialized);
    }

    return serialized;
  });

  app.put('/channels/:channelId/recipients/:targetId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId, targetId } = request.params as { channelId: string; targetId: string };

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    if (!channel || channel.type !== 'GROUP_DM') throw notFound('Grupo');
    if (!channel.recipients.some((r) => r.userId === userId)) {
      throw forbidden('Voce nao participa deste grupo.');
    }
    if (channel.recipients.length >= LIMITS.groupDmRecipients) {
      throw badRequest(`Um grupo aceita no maximo ${LIMITS.groupDmRecipients} pessoas.`);
    }
    if (channel.recipients.some((r) => r.userId === targetId)) {
      throw conflict('Esta pessoa ja esta no grupo.');
    }
    if (await bloqueioEntre(userId, targetId)) {
      throw new ApiError('FORBIDDEN', 'Nao foi possivel adicionar esta pessoa.');
    }

    await prisma.channelRecipient.create({ data: { channelId, userId: targetId } });

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    const serialized = toChannel(updated);

    subscribeUserToChannel(targetId, channelId);
    for (const recipient of updated.recipients) {
      emitToUser(recipient.userId, 'CHANNEL_UPDATE', serialized);
    }
    emitToUser(targetId, 'CHANNEL_CREATE', serialized);

    return serialized;
  });

  app.delete('/channels/:channelId/recipients/:targetId', async (request) => {
    const userId = request.auth!.userId;
    const { channelId, targetId } = request.params as { channelId: string; targetId: string };

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    if (!channel || channel.type !== 'GROUP_DM') throw notFound('Grupo');

    // Sair sozinho e sempre permitido; tirar outra pessoa e so para o dono.
    const isSelf = targetId === userId;
    if (!isSelf && channel.ownerId !== userId) {
      throw forbidden('So quem criou o grupo pode remover pessoas.');
    }

    // Quem deixa o grupo deixa tambem a chamada dele. Antes de sair da lista
    // de participantes, para o aviso ainda alcancar a propria pessoa.
    await tirarDaVoz(targetId, { channelId });

    await prisma.channelRecipient.deleteMany({ where: { channelId, userId: targetId } });
    unsubscribeUserFromChannel(targetId, channelId);

    const remaining = await prisma.channelRecipient.findMany({
      where: { channelId },
      select: { userId: true },
    });

    // Grupo sem ninguem some junto com o historico.
    if (remaining.length === 0) {
      await prisma.channel.delete({ where: { id: channelId } });
      return { ok: true };
    }

    // O dono saiu: passa a posse para quem entrou primeiro entre os que ficaram.
    if (channel.ownerId === targetId) {
      await prisma.channel.update({
        where: { id: channelId },
        data: { ownerId: remaining[0]!.userId },
      });
    }

    const updated = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    const serialized = toChannel(updated);

    for (const recipient of remaining) {
      emitToUser(recipient.userId, 'CHANNEL_UPDATE', serialized);
    }
    emitToUser(targetId, 'CHANNEL_DELETE', serialized);

    return { ok: true };
  });

  /** Fecha a DM na barra lateral sem apagar nada. */
  app.delete('/channels/:channelId/close', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: CHANNEL_INCLUDE,
    });
    if (!channel || channel.type !== 'DM') throw notFound('Conversa');

    await prisma.channelRecipient.updateMany({
      where: { channelId, userId },
      data: { closed: true },
    });

    unsubscribeUserFromChannel(userId, channelId);
    emitToUser(userId, 'CHANNEL_DELETE', toChannel(channel));

    return { ok: true };
  });
}

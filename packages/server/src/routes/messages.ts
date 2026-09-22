import type { FastifyInstance } from 'fastify';
import {
  RATE_LIMITS,
  ackSchema,
  createMessageSchema,
  editMessageSchema,
  fetchMessagesSchema,
  reactionSchema,
  searchMessagesSchema,
} from '@kiroshi/shared';
import { requireAuth } from '../auth/middleware.js';
import { badRequest } from '../errors.js';
import { consume } from '../lib/ratelimit.js';
import {
  acknowledge,
  addReaction,
  bulkDeleteMessages,
  createMessage,
  deleteMessage,
  editMessage,
  fetchMessages,
  listPins,
  removeReaction,
  searchMessages,
  setPinned,
} from '../services/messages.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  app.get('/channels/:channelId/messages', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const query = fetchMessagesSchema.parse(request.query);

    return fetchMessages({ channelId, userId, ...query });
  });

  // -------------------------------------------------------------------------
  app.post('/channels/:channelId/messages', async (request, reply) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = createMessageSchema.parse(request.body);

    consume(`msg:${userId}:${channelId}`, RATE_LIMITS.sendMessage);

    const message = await createMessage({
      channelId,
      authorId: userId,
      content: body.content,
      attachmentIds: body.attachmentIds,
      replyToId: body.replyToId,
      stickerId: body.stickerId,
      nonce: body.nonce,
    });

    return reply.status(201).send(message);
  });

  // -------------------------------------------------------------------------
  app.patch('/channels/:channelId/messages/:messageId', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    const body = editMessageSchema.parse(request.body);

    consume(`edit:${userId}`, RATE_LIMITS.editMessage);
    return editMessage(messageId, userId, body.content);
  });

  // -------------------------------------------------------------------------
  app.delete('/channels/:channelId/messages/:messageId', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    await deleteMessage(messageId, userId);
    return { ok: true };
  });

  app.post('/channels/:channelId/messages/bulk-delete', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const { messageIds } = request.body as { messageIds?: string[] };
    if (!Array.isArray(messageIds)) throw badRequest('Informe messageIds.');

    const deleted = await bulkDeleteMessages(channelId, userId, messageIds);
    return { deleted };
  });

  // -------------------------------------------------------------------------
  // Reacoes
  // -------------------------------------------------------------------------

  app.put('/channels/:channelId/messages/:messageId/reactions', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    const body = reactionSchema.parse(request.body);

    consume(`react:${userId}`, RATE_LIMITS.addReaction);
    await addReaction(messageId, userId, body.emoji ?? null, body.emojiId ?? null);
    return { ok: true };
  });

  app.delete('/channels/:channelId/messages/:messageId/reactions', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    const query = request.query as { emoji?: string; emojiId?: string };

    const body = reactionSchema.parse({
      emoji: query.emoji,
      emojiId: query.emojiId,
    });

    await removeReaction(messageId, userId, body.emoji ?? null, body.emojiId ?? null);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Fixadas
  // -------------------------------------------------------------------------

  app.get('/channels/:channelId/pins', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    return listPins(channelId, userId);
  });

  app.put('/channels/:channelId/pins/:messageId', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    await setPinned(messageId, userId, true);
    return { ok: true };
  });

  app.delete('/channels/:channelId/pins/:messageId', async (request) => {
    const userId = request.auth!.userId;
    const { messageId } = request.params as { messageId: string };
    await setPinned(messageId, userId, false);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  app.post('/channels/:channelId/ack', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const body = ackSchema.parse(request.body);

    await acknowledge(channelId, userId, body.messageId);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  app.get('/guilds/:guildId/messages/search', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const query = searchMessagesSchema.parse(request.query);

    return searchMessages({ userId, guildId, ...query });
  });

  app.get('/channels/:channelId/messages/search', async (request) => {
    const userId = request.auth!.userId;
    const { channelId } = request.params as { channelId: string };
    const query = searchMessagesSchema.parse(request.query);

    return searchMessages({ userId, channelId, ...query });
  });
}

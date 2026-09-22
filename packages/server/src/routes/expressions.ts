import type { FastifyInstance } from 'fastify';
import {
  AUDIO_MIME_TYPES,
  LIMITS,
  Permission,
  createEmojiSchema,
  createSoundSchema,
  createStickerSchema,
  generateId,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { toEmoji, toSound, toSticker } from '../lib/serialize.js';
import { emitToGuild } from '../gateway/events.js';
import { assertGuildPermissions } from '../services/permissions.js';
import { resolveImageInput, storeFile } from '../services/storage.js';
import { recordAudit } from '../services/audit.js';

/** Emojis, figurinhas e sons do soundboard. */
export async function expressionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------------------------------------------------------------
  // Emojis
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/emojis', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    await assertGuildPermissions(guildId, userId, Permission.VIEW_CHANNEL);

    const emojis = await prisma.emoji.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
    return emojis.map(toEmoji);
  });

  app.post('/guilds/:guildId/emojis', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createEmojiSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_EMOJIS);

    const count = await prisma.emoji.count({ where: { guildId } });
    if (count >= LIMITS.emojisPerGuild) {
      throw badRequest(`Um servidor aceita no maximo ${LIMITS.emojisPerGuild} emojis.`);
    }

    const taken = await prisma.emoji.findUnique({
      where: { guildId_name: { guildId, name: body.name } },
      select: { id: true },
    });
    if (taken) throw conflict('Ja existe um emoji com este nome neste servidor.');

    // 128px e o suficiente para o maior tamanho em que o emoji aparece.
    const stored = await resolveImageInput(body.image, {
      maxSize: 128,
      maxBytes: LIMITS.emojiBytes,
    });

    const emoji = await prisma.emoji.create({
      data: {
        id: generateId(),
        guildId,
        name: body.name,
        url: stored.url,
        animated: stored.animated,
        creatorId: userId,
      },
    });

    await broadcastEmojis(guildId);
    await recordAudit(guildId, userId, 'EMOJI_CREATE', emoji.id, { name: body.name });

    return reply.status(201).send(toEmoji(emoji));
  });

  app.patch('/guilds/:guildId/emojis/:emojiId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, emojiId } = request.params as { guildId: string; emojiId: string };
    const { name } = request.body as { name?: string };

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_EMOJIS);

    if (!name || !/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
      throw badRequest('Use 2 a 32 caracteres: letras, numeros ou _.');
    }

    const emoji = await prisma.emoji.findUnique({ where: { id: emojiId } });
    if (!emoji || emoji.guildId !== guildId) throw notFound('Emoji');

    const updated = await prisma.emoji.update({ where: { id: emojiId }, data: { name } });
    await broadcastEmojis(guildId);

    return toEmoji(updated);
  });

  app.delete('/guilds/:guildId/emojis/:emojiId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, emojiId } = request.params as { guildId: string; emojiId: string };

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_EMOJIS);

    const emoji = await prisma.emoji.findUnique({ where: { id: emojiId } });
    if (!emoji || emoji.guildId !== guildId) throw notFound('Emoji');

    await prisma.emoji.delete({ where: { id: emojiId } });
    await broadcastEmojis(guildId);
    await recordAudit(guildId, userId, 'EMOJI_DELETE', emojiId, { name: emoji.name });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Figurinhas
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/stickers', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    await assertGuildPermissions(guildId, userId, Permission.VIEW_CHANNEL);

    const stickers = await prisma.sticker.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
    return stickers.map(toSticker);
  });

  app.post('/guilds/:guildId/stickers', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createStickerSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_EMOJIS);

    const count = await prisma.sticker.count({ where: { guildId } });
    if (count >= LIMITS.stickersPerGuild) {
      throw badRequest(`Um servidor aceita no maximo ${LIMITS.stickersPerGuild} figurinhas.`);
    }

    const taken = await prisma.sticker.findUnique({
      where: { guildId_name: { guildId, name: body.name } },
      select: { id: true },
    });
    if (taken) throw conflict('Ja existe uma figurinha com este nome.');

    const stored = await resolveImageInput(body.image, {
      maxSize: 320,
      maxBytes: LIMITS.imageBytes,
    });

    const sticker = await prisma.sticker.create({
      data: {
        id: generateId(),
        guildId,
        name: body.name,
        description: body.description ?? null,
        tags: body.tags,
        url: stored.url,
        creatorId: userId,
      },
    });

    const all = await prisma.sticker.findMany({ where: { guildId } });
    emitToGuild(guildId, 'GUILD_STICKERS_UPDATE', { guildId, stickers: all.map(toSticker) });

    return reply.status(201).send(toSticker(sticker));
  });

  app.delete('/guilds/:guildId/stickers/:stickerId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, stickerId } = request.params as { guildId: string; stickerId: string };

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_EMOJIS);

    const sticker = await prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker || sticker.guildId !== guildId) throw notFound('Figurinha');

    await prisma.sticker.delete({ where: { id: stickerId } });

    const all = await prisma.sticker.findMany({ where: { guildId } });
    emitToGuild(guildId, 'GUILD_STICKERS_UPDATE', { guildId, stickers: all.map(toSticker) });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Soundboard
  // -------------------------------------------------------------------------

  app.get('/guilds/:guildId/sounds', async (request) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    await assertGuildPermissions(guildId, userId, Permission.VIEW_CHANNEL);

    const sounds = await prisma.soundboardSound.findMany({
      where: { guildId },
      orderBy: { name: 'asc' },
    });
    return sounds.map(toSound);
  });

  app.post('/guilds/:guildId/sounds', async (request, reply) => {
    const userId = request.auth!.userId;
    const { guildId } = request.params as { guildId: string };
    const body = createSoundSchema.parse(request.body);

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_SOUNDBOARD);

    const count = await prisma.soundboardSound.count({ where: { guildId } });
    if (count >= LIMITS.soundsPerGuild) {
      throw badRequest(`Um servidor aceita no maximo ${LIMITS.soundsPerGuild} sons.`);
    }

    const taken = await prisma.soundboardSound.findUnique({
      where: { guildId_name: { guildId, name: body.name } },
      select: { id: true },
    });
    if (taken) throw conflict('Ja existe um som com este nome.');

    const match = body.audio.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match?.[1] || !match[2]) throw badRequest('Envie o audio como data URL em base64.');
    if (!(AUDIO_MIME_TYPES as readonly string[]).includes(match[1].toLowerCase())) {
      throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Use MP3, OGG, WAV ou WebM.');
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > LIMITS.soundBytes) {
      throw new ApiError(
        'PAYLOAD_TOO_LARGE',
        `O limite e ${Math.floor(LIMITS.soundBytes / 1024)} KB por som.`,
      );
    }

    const extension = match[1].split('/')[1] ?? 'mp3';
    const stored = await storeFile({
      buffer,
      filename: `${body.name}.${extension}`,
      contentType: match[1],
      uploaderId: userId,
      maxBytes: LIMITS.soundBytes,
    });

    const sound = await prisma.soundboardSound.create({
      data: {
        id: generateId(),
        guildId,
        name: body.name,
        url: stored.url,
        emoji: body.emoji ?? null,
        volume: body.volume,
        creatorId: userId,
      },
    });

    // O arquivo do som e permanente: desvincula do ciclo de vida de anexo
    // para que a limpeza de orfaos nao o apague.
    await prisma.attachment.delete({ where: { id: stored.id } }).catch(() => undefined);

    const all = await prisma.soundboardSound.findMany({ where: { guildId } });
    emitToGuild(guildId, 'GUILD_SOUNDS_UPDATE', { guildId, sounds: all.map(toSound) });
    await recordAudit(guildId, userId, 'SOUND_CREATE', sound.id, { name: body.name });

    return reply.status(201).send(toSound(sound));
  });

  app.delete('/guilds/:guildId/sounds/:soundId', async (request) => {
    const userId = request.auth!.userId;
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };

    await assertGuildPermissions(guildId, userId, Permission.MANAGE_SOUNDBOARD);

    const sound = await prisma.soundboardSound.findUnique({ where: { id: soundId } });
    if (!sound || sound.guildId !== guildId) throw notFound('Som');

    await prisma.soundboardSound.delete({ where: { id: soundId } });

    const all = await prisma.soundboardSound.findMany({ where: { guildId } });
    emitToGuild(guildId, 'GUILD_SOUNDS_UPDATE', { guildId, sounds: all.map(toSound) });

    return { ok: true };
  });
}

async function broadcastEmojis(guildId: string): Promise<void> {
  const emojis = await prisma.emoji.findMany({ where: { guildId } });
  emitToGuild(guildId, 'GUILD_EMOJIS_UPDATE', { guildId, emojis: emojis.map(toEmoji) });
}

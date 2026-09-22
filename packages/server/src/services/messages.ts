import {
  LIMITS,
  Permission,
  compareIds,
  generateId,
  has,
  parseMentions,
  type Message as ApiMessage,
} from '@kiroshi/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { emitToChannel, emitToGuild, emitToUser } from '../gateway/events.js';
import { MESSAGE_INCLUDE, toMessage, type MessageRow } from '../lib/serialize.js';
import { resolveChannelPermissions } from './permissions.js';
import { buildEmbeds } from './embeds.js';

/**
 * Criacao, edicao e leitura de mensagens.
 *
 * Duas decisoes que valem explicar:
 *
 *  - Exclusao e logica. Uma resposta que cita a mensagem apagada continuaria
 *    apontando para uma linha inexistente, e o cliente mostraria um buraco.
 *    Guardamos a linha com deletedAt e o serializador limpa o conteudo.
 *
 *  - A contagem de mencoes e feita no momento do envio e gravada por usuario,
 *    em vez de calculada na leitura. Ler "quantas mensagens novas me citam"
 *    varrendo o historico ficaria caro rapido.
 */

export interface CreateMessageArgs {
  channelId: string;
  authorId: string;
  content: string;
  attachmentIds?: string[];
  replyToId?: string | null;
  stickerId?: string | null;
  nonce?: string;
}

export async function createMessage(args: CreateMessageArgs): Promise<ApiMessage> {
  const { permissions, guildId } = await resolveChannelPermissions(args.channelId, args.authorId);

  if (permissions === 0n) throw forbidden('Voce nao tem acesso a este canal.');
  if (!has(permissions, Permission.SEND_MESSAGES)) {
    throw forbidden('Voce nao pode enviar mensagens neste canal.');
  }

  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: args.channelId },
    select: { id: true, type: true, guildId: true, rateLimitPerUser: true },
  });

  /*
    Canal de voz TEM conversa propria.

    Antes ele era recusado junto com categoria, e o efeito na interface era
    quem estava numa chamada ter que sair para o canal de texto para mandar um
    link — e ai o palco de video dividia a tela com uma conversa que nao tinha
    nada a ver com o que estava acontecendo na chamada.

    Categoria continua fora: ela e so um agrupamento na lista lateral, nao um
    lugar onde alguem esta.
  */
  if (channel.type === 'GUILD_CATEGORY') {
    throw badRequest('Uma categoria nao aceita mensagens.');
  }

  // Modo lento: nao vale para quem pode gerenciar mensagens no canal.
  if (channel.rateLimitPerUser > 0 && !has(permissions, Permission.MANAGE_MESSAGES)) {
    const last = await prisma.message.findFirst({
      where: { channelId: channel.id, authorId: args.authorId, deletedAt: null },
      orderBy: { id: 'desc' },
      select: { createdAt: true },
    });
    if (last) {
      const elapsed = Date.now() - last.createdAt.getTime();
      const waitMs = channel.rateLimitPerUser * 1000 - elapsed;
      if (waitMs > 0) {
        throw new ApiError('RATE_LIMITED', 'O modo lento esta ativo neste canal.', {
          retryAfterMs: waitMs,
        });
      }
    }
  }

  const attachmentIds = args.attachmentIds ?? [];
  if (attachmentIds.length > 0 && !has(permissions, Permission.ATTACH_FILES)) {
    throw forbidden('Voce nao pode anexar arquivos neste canal.');
  }
  if (attachmentIds.length > LIMITS.attachmentsPerMessage) {
    throw badRequest(`No maximo ${LIMITS.attachmentsPerMessage} anexos por mensagem.`);
  }

  // Um anexo so pode ser usado pelo proprio autor e apenas uma vez.
  if (attachmentIds.length > 0) {
    const owned = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, uploaderId: args.authorId, messageId: null },
      select: { id: true },
    });
    if (owned.length !== attachmentIds.length) {
      throw badRequest('Algum anexo nao existe, ja foi usado ou nao e seu.');
    }
  }

  const parsed = parseMentions(args.content);

  // Uma mencao pode apontar para alguem que nunca existiu (id digitado a mao)
  // ou que saiu do servidor. Guardar esses ids quebraria a chave estrangeira
  // de ReadState mais adiante, entao ficam so os que valem de verdade.
  const mentions = await resolveMentions(parsed, channel);

  // Sem MENTION_EVERYONE a mencao vira texto: nao notifica ninguem.
  const mentionsEveryone =
    (mentions.everyone || mentions.here) && has(permissions, Permission.MENTION_EVERYONE);

  // Responder a uma mensagem de outro canal nao faz sentido.
  if (args.replyToId) {
    const target = await prisma.message.findUnique({
      where: { id: args.replyToId },
      select: { channelId: true, deletedAt: true },
    });
    if (!target || target.channelId !== channel.id) {
      throw badRequest('A mensagem citada nao esta neste canal.');
    }
  }

  const messageId = generateId();
  const embeds = has(permissions, Permission.EMBED_LINKS) ? await buildEmbeds(args.content) : [];

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        id: messageId,
        channelId: channel.id,
        guildId: channel.guildId,
        authorId: args.authorId,
        content: args.content,
        type: args.replyToId ? 'REPLY' : 'DEFAULT',
        replyToId: args.replyToId ?? null,
        stickerId: args.stickerId ?? null,
        mentionedUserIds: mentions.userIds,
        mentionedRoleIds: mentions.roleIds,
        mentionsEveryone,
        // Prisma tipa Json como objeto; uma lista precisa do cast explicito.
        embeds: embeds as unknown as object,
      },
      include: MESSAGE_INCLUDE,
    });

    if (attachmentIds.length > 0) {
      await tx.attachment.updateMany({ where: { id: { in: attachmentIds } }, data: { messageId } });
    }

    await tx.channel.update({ where: { id: channel.id }, data: { lastMessageId: messageId } });

    return created;
  });

  // Recarrega para trazer os anexos ja vinculados.
  const full = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });

  const serialized = toMessage(
    full as unknown as MessageRow,
    args.authorId,
    config.publicBaseUrl,
    args.nonce ?? null,
  );

  // A partir daqui a mensagem ja existe e ja e visivel. Uma falha na
  // distribuicao ou na contagem de mencoes nao pode virar erro na resposta:
  // o cliente mostraria "falha ao enviar" para algo que foi enviado, e ainda
  // reenviaria, duplicando. Registra e segue.
  try {
    await fanOutMessage(channel, serialized, mentions, mentionsEveryone);
  } catch (error) {
    logger.error(
      { error, messageId, channelId: channel.id },
      'mensagem gravada mas a distribuicao falhou',
    );
  }

  return serialized;
}

/**
 * Descarta mencoes que nao correspondem a ninguem alcancavel neste canal.
 *
 * Em um servidor, valem os membros; em uma DM, os participantes. Cargos
 * precisam existir no mesmo servidor. Sem esse filtro, um `<@123>` digitado a
 * mao viraria uma linha de ReadState apontando para um usuario inexistente e
 * o envio falharia com erro de chave estrangeira depois da mensagem ja ter
 * sido criada e distribuida.
 */
async function resolveMentions(
  parsed: ReturnType<typeof parseMentions>,
  channel: { id: string; guildId: string | null },
): Promise<ReturnType<typeof parseMentions>> {
  if (parsed.userIds.length === 0 && parsed.roleIds.length === 0) return parsed;

  let userIds: string[] = [];
  if (parsed.userIds.length > 0) {
    if (channel.guildId) {
      const members = await prisma.guildMember.findMany({
        where: { guildId: channel.guildId, userId: { in: parsed.userIds } },
        select: { userId: true },
      });
      userIds = members.map((m) => m.userId);
    } else {
      const recipients = await prisma.channelRecipient.findMany({
        where: { channelId: channel.id, userId: { in: parsed.userIds } },
        select: { userId: true },
      });
      userIds = recipients.map((r) => r.userId);
    }
  }

  let roleIds: string[] = [];
  if (parsed.roleIds.length > 0 && channel.guildId) {
    const roles = await prisma.role.findMany({
      where: { guildId: channel.guildId, id: { in: parsed.roleIds } },
      select: { id: true },
    });
    roleIds = roles.map((r) => r.id);
  }

  return { ...parsed, userIds, roleIds };
}

/**
 * Entrega a mensagem e atualiza a contagem de mencoes de quem foi citado.
 * O autor recebe a mensagem com o nonce; os demais, sem.
 */
async function fanOutMessage(
  channel: { id: string; guildId: string | null; type: string },
  message: ApiMessage,
  mentions: ReturnType<typeof parseMentions>,
  mentionsEveryone: boolean,
): Promise<void> {
  const withoutNonce = { ...message, nonce: null };

  if (channel.guildId) {
    emitToGuild(channel.guildId, 'MESSAGE_CREATE', withoutNonce, {
      exceptUserId: message.authorId,
    });
    emitToUser(message.authorId, 'MESSAGE_CREATE', message);
  } else {
    const recipients = await prisma.channelRecipient.findMany({
      where: { channelId: channel.id },
      select: { userId: true, closed: true },
    });

    for (const recipient of recipients) {
      // Uma DM fechada volta a aparecer quando chega mensagem nova.
      if (recipient.closed) {
        await prisma.channelRecipient.update({
          where: { channelId_userId: { channelId: channel.id, userId: recipient.userId } },
          data: { closed: false },
        });
      }
      emitToUser(
        recipient.userId,
        'MESSAGE_CREATE',
        recipient.userId === message.authorId ? message : withoutNonce,
      );
    }
    emitToChannel(channel.id, 'MESSAGE_CREATE', withoutNonce, { exceptUserId: message.authorId });
  }

  await incrementMentionCounts(channel, message, mentions, mentionsEveryone);
}

async function incrementMentionCounts(
  channel: { id: string; guildId: string | null },
  message: ApiMessage,
  mentions: ReturnType<typeof parseMentions>,
  mentionsEveryone: boolean,
): Promise<void> {
  const mentioned = new Set<string>(mentions.userIds);

  if (channel.guildId) {
    if (mentions.roleIds.length > 0) {
      const holders = await prisma.memberRole.findMany({
        where: { guildId: channel.guildId, roleId: { in: mentions.roleIds } },
        select: { userId: true },
      });
      for (const holder of holders) mentioned.add(holder.userId);
    }
    if (mentionsEveryone) {
      const members = await prisma.guildMember.findMany({
        where: { guildId: channel.guildId },
        select: { userId: true },
      });
      for (const member of members) mentioned.add(member.userId);
    }
  } else {
    // Em DM toda mensagem conta como mencao para o outro lado.
    const recipients = await prisma.channelRecipient.findMany({
      where: { channelId: channel.id },
      select: { userId: true },
    });
    for (const recipient of recipients) mentioned.add(recipient.userId);
  }

  mentioned.delete(message.authorId);
  if (mentioned.size === 0) return;

  await Promise.all(
    [...mentioned].map((userId) =>
      prisma.readState.upsert({
        where: { userId_channelId: { userId, channelId: channel.id } },
        create: { userId, channelId: channel.id, mentionCount: 1 },
        update: { mentionCount: { increment: 1 } },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------

export async function editMessage(
  messageId: string,
  userId: string,
  content: string,
): Promise<ApiMessage> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, guildId: true, authorId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw notFound('Mensagem');

  // So o autor edita o proprio texto. Nem administrador reescreve fala alheia.
  if (existing.authorId !== userId) {
    throw forbidden('Voce so pode editar as suas proprias mensagens.');
  }

  const { permissions } = await resolveChannelPermissions(existing.channelId, userId);
  if (!has(permissions, Permission.SEND_MESSAGES)) {
    throw forbidden('Voce nao pode mais escrever neste canal.');
  }

  const mentions = await resolveMentions(parseMentions(content), {
    id: existing.channelId,
    guildId: existing.guildId,
  });
  const mentionsEveryone =
    (mentions.everyone || mentions.here) && has(permissions, Permission.MENTION_EVERYONE);

  await prisma.message.update({
    where: { id: messageId },
    data: {
      content,
      editedAt: new Date(),
      mentionedUserIds: mentions.userIds,
      mentionedRoleIds: mentions.roleIds,
      mentionsEveryone,
      embeds: (has(permissions, Permission.EMBED_LINKS)
        ? await buildEmbeds(content)
        : []) as unknown as object,
    },
  });

  const full = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });
  const serialized = toMessage(full as unknown as MessageRow, userId, config.publicBaseUrl);

  if (existing.guildId) {
    emitToGuild(existing.guildId, 'MESSAGE_UPDATE', serialized);
  } else {
    await emitToDm(existing.channelId, 'MESSAGE_UPDATE', serialized);
  }

  return serialized;
}

export async function deleteMessage(messageId: string, userId: string): Promise<void> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, guildId: true, authorId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw notFound('Mensagem');

  const { permissions } = await resolveChannelPermissions(existing.channelId, userId);
  const isAuthor = existing.authorId === userId;
  if (!isAuthor && !has(permissions, Permission.MANAGE_MESSAGES)) {
    throw forbidden('Voce nao pode apagar mensagens de outras pessoas aqui.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '', embeds: [], pinned: false },
    });
    // Reacoes e anexos vao junto: nao ha mais mensagem a que pertencer.
    await tx.reaction.deleteMany({ where: { messageId } });
    await tx.attachment.deleteMany({ where: { messageId } });
  });

  const payload = { id: messageId, channelId: existing.channelId, guildId: existing.guildId };

  if (existing.guildId) {
    emitToGuild(existing.guildId, 'MESSAGE_DELETE', payload);
  } else {
    await emitToDm(existing.channelId, 'MESSAGE_DELETE', payload);
  }

  logger.debug({ messageId, userId }, 'mensagem apagada');
}

export async function bulkDeleteMessages(
  channelId: string,
  userId: string,
  messageIds: string[],
): Promise<number> {
  const { permissions, guildId } = await resolveChannelPermissions(channelId, userId);
  if (!has(permissions, Permission.MANAGE_MESSAGES)) {
    throw forbidden('Voce nao pode apagar mensagens em massa aqui.');
  }
  if (messageIds.length === 0 || messageIds.length > 100) {
    throw badRequest('Informe de 1 a 100 mensagens.');
  }

  const { count } = await prisma.message.updateMany({
    where: { id: { in: messageIds }, channelId, deletedAt: null },
    data: { deletedAt: new Date(), content: '', embeds: [], pinned: false },
  });

  await prisma.reaction.deleteMany({ where: { messageId: { in: messageIds } } });

  const payload = { ids: messageIds, channelId, guildId };
  if (guildId) {
    emitToGuild(guildId, 'MESSAGE_DELETE_BULK', payload);
  } else {
    await emitToDm(channelId, 'MESSAGE_DELETE_BULK', payload);
  }

  return count;
}

// ---------------------------------------------------------------------------

export interface FetchArgs {
  channelId: string;
  userId: string;
  limit: number;
  before?: string;
  after?: string;
  around?: string;
}

export async function fetchMessages(args: FetchArgs): Promise<ApiMessage[]> {
  const { permissions } = await resolveChannelPermissions(args.channelId, args.userId);
  if (!has(permissions, Permission.READ_MESSAGE_HISTORY)) {
    throw forbidden('Voce nao pode ler o historico deste canal.');
  }

  // "around" busca metade antes e metade depois, para abrir o canal em uma
  // mensagem especifica com contexto dos dois lados.
  if (args.around) {
    const half = Math.floor(args.limit / 2);
    const [before, target, after] = await Promise.all([
      prisma.message.findMany({
        where: { channelId: args.channelId, deletedAt: null, id: { lt: args.around } },
        include: MESSAGE_INCLUDE,
        orderBy: { id: 'desc' },
        take: half,
      }),
      prisma.message.findUnique({ where: { id: args.around }, include: MESSAGE_INCLUDE }),
      prisma.message.findMany({
        where: { channelId: args.channelId, deletedAt: null, id: { gt: args.around } },
        include: MESSAGE_INCLUDE,
        orderBy: { id: 'asc' },
        take: half,
      }),
    ]);

    const combined = [
      ...before.reverse(),
      ...(target && !target.deletedAt ? [target] : []),
      ...after,
    ];
    return combined.map((m) =>
      toMessage(m as unknown as MessageRow, args.userId, config.publicBaseUrl),
    );
  }

  const where = {
    channelId: args.channelId,
    deletedAt: null,
    ...(args.before ? { id: { lt: args.before } } : {}),
    ...(args.after ? { id: { gt: args.after } } : {}),
  };

  const rows = await prisma.message.findMany({
    where,
    include: MESSAGE_INCLUDE,
    // Com "after" queremos as mais antigas logo depois do marcador; nos demais
    // casos, as mais recentes.
    orderBy: { id: args.after ? 'asc' : 'desc' },
    take: args.limit,
  });

  const ordered = args.after ? rows : rows.reverse();
  return ordered.map((m) =>
    toMessage(m as unknown as MessageRow, args.userId, config.publicBaseUrl),
  );
}

export async function searchMessages(args: {
  userId: string;
  guildId?: string;
  channelId?: string;
  authorId?: string;
  query: string;
  limit: number;
  offset: number;
}): Promise<{ messages: ApiMessage[]; total: number }> {
  // Restringe a busca aos canais que a pessoa realmente enxerga.
  let channelIds: string[];
  if (args.channelId) {
    const { permissions } = await resolveChannelPermissions(args.channelId, args.userId);
    if (!has(permissions, Permission.READ_MESSAGE_HISTORY)) {
      throw forbidden('Voce nao pode ler o historico deste canal.');
    }
    channelIds = [args.channelId];
  } else if (args.guildId) {
    const { visibleChannelIds } = await import('./permissions.js');
    channelIds = [...(await visibleChannelIds(args.guildId, args.userId))];
  } else {
    const rows = await prisma.channelRecipient.findMany({
      where: { userId: args.userId },
      select: { channelId: true },
    });
    channelIds = rows.map((r) => r.channelId);
  }

  if (channelIds.length === 0) return { messages: [], total: 0 };

  const where = {
    channelId: { in: channelIds },
    deletedAt: null,
    content: { contains: args.query, mode: 'insensitive' as const },
    ...(args.authorId ? { authorId: args.authorId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: MESSAGE_INCLUDE,
      orderBy: { id: 'desc' },
      take: args.limit,
      skip: args.offset,
    }),
    prisma.message.count({ where }),
  ]);

  return {
    messages: rows.map((m) =>
      toMessage(m as unknown as MessageRow, args.userId, config.publicBaseUrl),
    ),
    total,
  };
}

// ---------------------------------------------------------------------------
// Reacoes
// ---------------------------------------------------------------------------

/**
 * Chave estavel para a reacao: emoji unicode, ou `custom:<id>`. Sem isso nao
 * daria para ter a chave primaria composta garantindo uma reacao por pessoa.
 */
function emojiKeyFor(emoji: string | null, emojiId: string | null): string {
  return emojiId ? `custom:${emojiId}` : (emoji ?? '');
}

export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string | null,
  emojiId: string | null,
): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, guildId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw notFound('Mensagem');

  const { permissions } = await resolveChannelPermissions(message.channelId, userId);
  if (!has(permissions, Permission.ADD_REACTIONS)) {
    throw forbidden('Voce nao pode reagir neste canal.');
  }

  if (emojiId) {
    const custom = await prisma.emoji.findUnique({
      where: { id: emojiId },
      select: { guildId: true },
    });
    if (!custom) throw notFound('Emoji');
    // Usar emoji de outro servidor exige a permissao correspondente.
    if (custom.guildId !== message.guildId && !has(permissions, Permission.USE_EXTERNAL_EMOJIS)) {
      throw forbidden('Voce nao pode usar emojis de outros servidores aqui.');
    }
  }

  const distinct = await prisma.reaction.findMany({
    where: { messageId },
    select: { emojiKey: true },
    distinct: ['emojiKey'],
  });
  const key = emojiKeyFor(emoji, emojiId);
  if (distinct.length >= LIMITS.reactionsPerMessage && !distinct.some((d) => d.emojiKey === key)) {
    throw badRequest('Esta mensagem ja tem reacoes demais.');
  }

  await prisma.reaction.upsert({
    where: { messageId_userId_emojiKey: { messageId, userId, emojiKey: key } },
    create: { messageId, userId, emoji, emojiId, emojiKey: key },
    update: {},
  });

  await emitReactionChange('MESSAGE_REACTION_ADD', message, userId, emoji, emojiId, key);
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string | null,
  emojiId: string | null,
): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, guildId: true },
  });
  if (!message) throw notFound('Mensagem');

  const key = emojiKeyFor(emoji, emojiId);
  await prisma.reaction
    .delete({ where: { messageId_userId_emojiKey: { messageId, userId, emojiKey: key } } })
    .catch(() => undefined);

  await emitReactionChange('MESSAGE_REACTION_REMOVE', message, userId, emoji, emojiId, key);
}

async function emitReactionChange(
  event: 'MESSAGE_REACTION_ADD' | 'MESSAGE_REACTION_REMOVE',
  message: { id: string; channelId: string; guildId: string | null },
  userId: string,
  emoji: string | null,
  emojiId: string | null,
  emojiKey: string,
): Promise<void> {
  const rows = await prisma.reaction.findMany({
    where: { messageId: message.id, emojiKey },
    select: {
      userId: true,
      emoji: true,
      emojiId: true,
      emojiKey: true,
      emojiRef: { select: { name: true, animated: true } },
    },
  });

  const reaction =
    rows.length > 0
      ? {
          emoji,
          emojiId,
          emojiName: rows[0]?.emojiRef?.name ?? null,
          animated: rows[0]?.emojiRef?.animated ?? false,
          count: rows.length,
          me: false,
          userIds: rows.map((r) => r.userId),
        }
      : null;

  const payload = {
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    userId,
    emoji,
    emojiId,
    emojiName: reaction?.emojiName ?? null,
    animated: reaction?.animated ?? false,
    reaction,
  };

  if (message.guildId) {
    emitToGuild(message.guildId, event, payload);
  } else {
    await emitToDm(message.channelId, event, payload);
  }
}

// ---------------------------------------------------------------------------
// Fixar e marcar como lido
// ---------------------------------------------------------------------------

export async function setPinned(messageId: string, userId: string, pinned: boolean): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, guildId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw notFound('Mensagem');

  const { permissions } = await resolveChannelPermissions(message.channelId, userId);
  if (!has(permissions, Permission.MANAGE_MESSAGES)) {
    throw forbidden('Voce nao pode fixar mensagens neste canal.');
  }

  if (pinned) {
    const count = await prisma.message.count({
      where: { channelId: message.channelId, pinned: true, deletedAt: null },
    });
    if (count >= LIMITS.pinsPerChannel) {
      throw badRequest(`Um canal pode ter no maximo ${LIMITS.pinsPerChannel} mensagens fixadas.`);
    }
  }

  await prisma.message.update({ where: { id: messageId }, data: { pinned } });
  await prisma.channel.update({
    where: { id: message.channelId },
    data: { lastPinAt: pinned ? new Date() : null },
  });

  const payload = {
    channelId: message.channelId,
    guildId: message.guildId,
    lastPinAt: pinned ? new Date().toISOString() : null,
  };

  if (message.guildId) {
    emitToGuild(message.guildId, 'CHANNEL_PINS_UPDATE', payload);
  } else {
    await emitToDm(message.channelId, 'CHANNEL_PINS_UPDATE', payload);
  }
}

export async function listPins(channelId: string, userId: string): Promise<ApiMessage[]> {
  const { permissions } = await resolveChannelPermissions(channelId, userId);
  if (!has(permissions, Permission.READ_MESSAGE_HISTORY)) {
    throw forbidden('Voce nao pode ler este canal.');
  }

  const rows = await prisma.message.findMany({
    where: { channelId, pinned: true, deletedAt: null },
    include: MESSAGE_INCLUDE,
    orderBy: { id: 'desc' },
    take: LIMITS.pinsPerChannel,
  });

  return rows.map((m) => toMessage(m as unknown as MessageRow, userId, config.publicBaseUrl));
}

/** Marca o canal como lido ate a mensagem informada e zera as mencoes. */
export async function acknowledge(
  channelId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  const existing = await prisma.readState.findUnique({
    where: { userId_channelId: { userId, channelId } },
    select: { lastReadMessageId: true },
  });

  // Nao deixa o marcador andar para tras se chegarem acks fora de ordem.
  if (existing?.lastReadMessageId && compareIds(messageId, existing.lastReadMessageId) < 0) {
    return;
  }

  await prisma.readState.upsert({
    where: { userId_channelId: { userId, channelId } },
    create: { userId, channelId, lastReadMessageId: messageId, mentionCount: 0 },
    update: { lastReadMessageId: messageId, mentionCount: 0 },
  });

  emitToUser(userId, 'MESSAGE_ACK', { channelId, lastReadMessageId: messageId, mentionCount: 0 });
}

async function emitToDm(
  channelId: string,
  event:
    | 'MESSAGE_UPDATE'
    | 'MESSAGE_DELETE'
    | 'MESSAGE_DELETE_BULK'
    | 'MESSAGE_REACTION_ADD'
    | 'MESSAGE_REACTION_REMOVE'
    | 'CHANNEL_PINS_UPDATE',
  payload: unknown,
): Promise<void> {
  const recipients = await prisma.channelRecipient.findMany({
    where: { channelId },
    select: { userId: true },
  });
  for (const recipient of recipients) {
    emitToUser(recipient.userId, event, payload as never);
  }
}

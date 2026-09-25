import type {
  GuildWithState,
  Presence,
  PublicUser,
  ReadyEvent,
  Relationship,
  RelationshipType,
} from '@kiroshi/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { getPresence } from '../gateway/registry.js';
import {
  CHANNEL_INCLUDE,
  MEMBER_INCLUDE,
  SELF_USER_SELECT,
  USER_SELECT,
  toChannel,
  toChannelSettings,
  toEmoji,
  toGuildSettings,
  toGuild,
  toMember,
  toPublicUser,
  toRole,
  toSelfUser,
  toSound,
  toSticker,
  toVoiceState,
} from '../lib/serialize.js';
import { visibleChannelIds } from './permissions.js';
import { chamadasEm } from './chamadas.js';

/**
 * Monta o payload do READY: tudo que o cliente precisa para desenhar a
 * interface sem uma unica requisicao extra.
 *
 * Para 10 pessoas isso cabe folgado em um pacote. Se um dia a instalacao
 * crescer, o caminho e parar de mandar `members` inteiro aqui e passar a
 * responder REQUEST_GUILD_MEMBERS sob demanda, que o protocolo ja preve.
 */
export async function buildReadyPayload(
  userId: string,
  sessionId: string,
  gatewayVersion: number,
): Promise<ReadyEvent> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: SELF_USER_SELECT,
  });
  if (!user) throw notFound('Usuario');

  const memberships = await prisma.guildMember.findMany({
    where: { userId },
    select: { guildId: true },
  });
  const guildIds = memberships.map((m) => m.guildId);

  const guilds = await Promise.all(guildIds.map((id) => buildGuildState(id, userId)));

  const [privateChannelRows, relationshipRows, readStateRows, privateVoiceRows, guildSettingsRows, channelSettingsRows] = await Promise.all([
    prisma.channel.findMany({
      where: {
        type: { in: ['DM', 'GROUP_DM'] },
        recipients: { some: { userId, closed: false } },
      },
      include: CHANNEL_INCLUDE,
      orderBy: { lastMessageId: 'desc' },
    }),
    prisma.relationship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId, status: { not: 'BLOCKED' } }],
      },
      include: {
        requester: { select: USER_SELECT },
        addressee: { select: USER_SELECT },
      },
    }),
    prisma.readState.findMany({ where: { userId } }),
    // Voz das DMs e grupos de que a pessoa participa (os de servidor vem em cada servidor).
    prisma.voiceState.findMany({
      where: { guildId: null, channel: { recipients: { some: { userId } } } },
    }),
    prisma.userGuildSettings.findMany({ where: { userId } }),
    prisma.userChannelSettings.findMany({ where: { userId } }),
  ]);

  const relationships: Relationship[] = relationshipRows.map((row) => {
    const outgoing = row.requesterId === userId;
    const other = outgoing ? row.addressee : row.requester;

    let type: RelationshipType;
    if (row.status === 'ACCEPTED') type = 'FRIEND';
    else if (row.status === 'BLOCKED') type = 'BLOCKED';
    else type = outgoing ? 'PENDING_OUTGOING' : 'PENDING_INCOMING';

    return {
      id: row.id,
      type,
      user: toPublicUser(other),
      createdAt: row.createdAt.toISOString(),
    };
  });

  // Usuarios citados por DMs e amizades, para o cliente nao precisar buscar
  // cada um depois.
  const referencedUserIds = new Set<string>();
  for (const channel of privateChannelRows) {
    for (const recipient of channel.recipients) referencedUserIds.add(recipient.userId);
  }
  for (const relationship of relationships) referencedUserIds.add(relationship.user.id);
  referencedUserIds.delete(userId);

  const users: PublicUser[] = referencedUserIds.size
    ? (
        await prisma.user.findMany({
          where: { id: { in: [...referencedUserIds] } },
          select: USER_SELECT,
        })
      ).map(toPublicUser)
    : [];

  // Presenca de quem compartilha algum servidor com o usuario, mais os amigos.
  const presenceUserIds = new Set<string>(referencedUserIds);
  for (const guild of guilds) {
    for (const member of guild.members) presenceUserIds.add(member.userId);
  }
  const presences: Presence[] = [...presenceUserIds].map((id) => getPresence(id));

  return {
    gatewayVersion,
    sessionId,
    user: toSelfUser(user),
    guilds,
    privateChannels: privateChannelRows.map(toChannel),
    relationships,
    readStates: readStateRows.map((r) => ({
      channelId: r.channelId,
      lastReadMessageId: r.lastReadMessageId,
      mentionCount: r.mentionCount,
    })),
    presences,
    users,
    privateVoiceStates: privateVoiceRows.map(toVoiceState),
    calls: chamadasEm(new Set(privateChannelRows.map((c) => c.id))),
    notificationSettings: {
      guilds: guildSettingsRows.map(toGuildSettings),
      channels: channelSettingsRows.map(toChannelSettings),
    },
  };
}

/**
 * Estado completo de um servidor do ponto de vista de um membro. Canais que a
 * pessoa nao pode ver nao aparecem, nem os estados de voz deles.
 */
export async function buildGuildState(
  guildId: string,
  userId: string,
): Promise<GuildWithState> {
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    include: {
      roles: true,
      emojis: true,
      stickers: true,
      sounds: true,
    },
  });
  if (!guild) throw notFound('Servidor');

  const [channels, members, memberCount, voiceStates, visible] = await Promise.all([
    prisma.channel.findMany({
      where: { guildId },
      include: CHANNEL_INCLUDE,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    }),
    prisma.guildMember.findMany({
      where: { guildId },
      include: MEMBER_INCLUDE,
      orderBy: { joinedAt: 'asc' },
      take: 1000,
    }),
    prisma.guildMember.count({ where: { guildId } }),
    prisma.voiceState.findMany({ where: { guildId } }),
    visibleChannelIds(guildId, userId),
  ]);

  const allowedChannels = channels.filter((c) => visible.has(c.id));
  const allowedChannelIds = new Set(allowedChannels.map((c) => c.id));

  return {
    ...toGuild(guild),
    channels: allowedChannels.map(toChannel),
    roles: guild.roles.map(toRole),
    members: members.map(toMember),
    emojis: guild.emojis.map(toEmoji),
    stickers: guild.stickers.map(toSticker),
    sounds: guild.sounds.map(toSound),
    voiceStates: voiceStates
      .filter((v) => allowedChannelIds.has(v.channelId))
      .map(toVoiceState),
    memberCount,
  };
}


import type {
  Attachment as ApiAttachment,
  Channel as ApiChannel,
  Emoji as ApiEmoji,
  Embed,
  Guild as ApiGuild,
  GuildMember as ApiMember,
  Message as ApiMessage,
  MessageCall,
  PublicUser,
  Reaction as ApiReaction,
  Role as ApiRole,
  SelfUser,
  SoundboardSound as ApiSound,
  Sticker as ApiSticker,
  VoiceState as ApiVoiceState,
} from '@kiroshi/shared';

/**
 * Converte linhas do banco para as formas que o cliente conhece.
 *
 * Duas coisas nunca podem escapar daqui: BigInt, que quebra JSON.stringify, e
 * campo sensivel (hash de senha, segredo do TOTP). Por isso toda saida passa
 * por uma destas funcoes em vez de devolver a linha crua.
 */

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

const isoRequired = (date: Date): string => date.toISOString();

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  pronouns: string | null;
  accentColor: string | null;
  bot: boolean;
  createdAt: Date;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    bio: row.bio,
    pronouns: row.pronouns,
    accentColor: row.accentColor,
    bot: row.bot,
    createdAt: isoRequired(row.createdAt),
  };
}

export interface SelfUserRow extends UserRow {
  email: string;
  totpEnabled: boolean;
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  customStatus: string | null;
}

export function toSelfUser(row: SelfUserRow): SelfUser {
  return {
    ...toPublicUser(row),
    email: row.email,
    totpEnabled: row.totpEnabled,
    status: row.status,
    customStatus: row.customStatus,
  };
}

/** Campos minimos que toda consulta de usuario deve pedir. */
export const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bannerUrl: true,
  bio: true,
  pronouns: true,
  accentColor: true,
  bot: true,
  createdAt: true,
} as const;

export const SELF_USER_SELECT = {
  ...USER_SELECT,
  email: true,
  totpEnabled: true,
  status: true,
  customStatus: true,
} as const;

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

export function toGuild(row: {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  ownerId: string;
  systemChannelId: string | null;
  createdAt: Date;
}): ApiGuild {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconUrl: row.iconUrl,
    bannerUrl: row.bannerUrl,
    ownerId: row.ownerId,
    systemChannelId: row.systemChannelId,
    createdAt: isoRequired(row.createdAt),
  };
}

export function toRole(row: {
  id: string;
  guildId: string;
  name: string;
  color: string | null;
  position: number;
  permissions: bigint;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
}): ApiRole {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    color: row.color,
    position: row.position,
    permissions: row.permissions.toString(),
    hoist: row.hoist,
    mentionable: row.mentionable,
    managed: row.managed,
  };
}

export function toMember(row: {
  guildId: string;
  userId: string;
  nickname: string | null;
  joinedAt: Date;
  serverMuted: boolean;
  serverDeafened: boolean;
  user: UserRow;
  roles: { roleId: string }[];
}): ApiMember {
  return {
    guildId: row.guildId,
    userId: row.userId,
    user: toPublicUser(row.user),
    nickname: row.nickname,
    roleIds: row.roles.map((r) => r.roleId),
    joinedAt: isoRequired(row.joinedAt),
    serverMuted: row.serverMuted,
    serverDeafened: row.serverDeafened,
  };
}

export const MEMBER_INCLUDE = {
  user: { select: USER_SELECT },
  roles: { select: { roleId: true } },
} as const;

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export function toChannel(row: {
  id: string;
  type: string;
  guildId: string | null;
  name: string | null;
  topic: string | null;
  position: number;
  parentId: string | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number | null;
  userLimit: number | null;
  ownerId: string | null;
  iconUrl: string | null;
  lastMessageId: string | null;
  createdAt: Date;
  overwrites?: { targetId: string; targetType: string; allow: bigint; deny: bigint }[];
  recipients?: { userId: string }[];
}): ApiChannel {
  return {
    id: row.id,
    type: row.type as ApiChannel['type'],
    guildId: row.guildId,
    name: row.name,
    topic: row.topic,
    position: row.position,
    parentId: row.parentId,
    nsfw: row.nsfw,
    rateLimitPerUser: row.rateLimitPerUser,
    bitrate: row.bitrate,
    userLimit: row.userLimit,
    ownerId: row.ownerId,
    iconUrl: row.iconUrl,
    lastMessageId: row.lastMessageId,
    createdAt: isoRequired(row.createdAt),
    overwrites: (row.overwrites ?? []).map((o) => ({
      targetId: o.targetId,
      targetType: o.targetType as 'ROLE' | 'MEMBER',
      allow: o.allow.toString(),
      deny: o.deny.toString(),
    })),
    recipientIds: (row.recipients ?? []).map((r) => r.userId),
  };
}

export const CHANNEL_INCLUDE = {
  overwrites: { select: { targetId: true, targetType: true, allow: true, deny: true } },
  recipients: { select: { userId: true } },
} as const;

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export function toAttachment(row: {
  id: string;
  filename: string;
  size: number;
  contentType: string | null;
  storageKey: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  durationSecs: number | null;
  waveform: string | null;
}, baseUrl: string): ApiAttachment {
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    contentType: row.contentType,
    url: `${baseUrl}/attachments/${row.storageKey}`,
    width: row.width,
    height: row.height,
    placeholder: row.placeholder,
    durationSecs: row.durationSecs,
    waveform: row.waveform,
  };
}

interface ReactionRow {
  userId: string;
  emoji: string | null;
  emojiId: string | null;
  emojiKey: string;
  emojiRef?: { name: string; animated: boolean } | null;
}

/** Agrupa as linhas de reacao por emoji e marca quais o leitor deu. */
export function toReactions(rows: ReactionRow[], viewerId: string): ApiReaction[] {
  const grouped = new Map<string, ApiReaction>();

  for (const row of rows) {
    let entry = grouped.get(row.emojiKey);
    if (!entry) {
      entry = {
        emoji: row.emoji,
        emojiId: row.emojiId,
        emojiName: row.emojiRef?.name ?? null,
        animated: row.emojiRef?.animated ?? false,
        count: 0,
        me: false,
        userIds: [],
      };
      grouped.set(row.emojiKey, entry);
    }
    entry.count += 1;
    entry.userIds.push(row.userId);
    if (row.userId === viewerId) entry.me = true;
  }

  return [...grouped.values()];
}

export interface MessageRow {
  id: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  content: string;
  type: string;
  mentionedUserIds: unknown;
  mentionedRoleIds: unknown;
  mentionsEveryone: boolean;
  embeds: unknown;
  pinned: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  replyToId: string | null;
  /** Registro da chamada, so nas mensagens do tipo CALL. */
  call?: unknown;
  author: UserRow;
  attachments: Parameters<typeof toAttachment>[0][];
  reactions: ReactionRow[];
  replyTo?: (Omit<MessageRow, 'replyTo'> & { replyTo?: never }) | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asEmbeds(value: unknown): Embed[] {
  return Array.isArray(value) ? (value as Embed[]) : [];
}

/** O registro da chamada gravado na mensagem, conferido campo a campo. */
function asCall(value: unknown): MessageCall | null {
  if (!value || typeof value !== 'object') return null;
  const registro = value as { participantIds?: unknown; endedAt?: unknown };
  return {
    participantIds: asStringArray(registro.participantIds),
    endedAt: typeof registro.endedAt === 'string' ? registro.endedAt : null,
  };
}

export function toMessage(
  row: MessageRow,
  viewerId: string,
  baseUrl: string,
  nonce: string | null = null,
): ApiMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    guildId: row.guildId,
    authorId: row.authorId,
    author: toPublicUser(row.author),
    // Mensagem apagada continua existindo para nao quebrar quem respondeu a ela.
    content: row.deletedAt ? '' : row.content,
    type: row.type as ApiMessage['type'],
    call: row.type === 'CALL' ? asCall(row.call) : null,
    attachments: row.deletedAt ? [] : row.attachments.map((a) => toAttachment(a, baseUrl)),
    embeds: row.deletedAt ? [] : asEmbeds(row.embeds),
    reactions: row.deletedAt ? [] : toReactions(row.reactions, viewerId),
    mentionedUserIds: asStringArray(row.mentionedUserIds),
    mentionedRoleIds: asStringArray(row.mentionedRoleIds),
    mentionsEveryone: row.mentionsEveryone,
    reference: row.replyToId
      ? { messageId: row.replyToId, channelId: row.channelId, guildId: row.guildId }
      : null,
    referencedMessage: row.replyTo
      ? toMessage({ ...row.replyTo, replyTo: null } as MessageRow, viewerId, baseUrl)
      : null,
    pinned: row.pinned,
    editedAt: iso(row.editedAt),
    createdAt: isoRequired(row.createdAt),
    nonce,
  };
}

export const MESSAGE_INCLUDE = {
  author: { select: USER_SELECT },
  attachments: true,
  reactions: {
    select: {
      userId: true,
      emoji: true,
      emojiId: true,
      emojiKey: true,
      emojiRef: { select: { name: true, animated: true } },
    },
  },
  replyTo: {
    include: {
      author: { select: USER_SELECT },
      attachments: true,
      reactions: {
        select: {
          userId: true,
          emoji: true,
          emojiId: true,
          emojiKey: true,
          emojiRef: { select: { name: true, animated: true } },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Expressoes e voz
// ---------------------------------------------------------------------------

export function toEmoji(row: {
  id: string;
  guildId: string;
  name: string;
  url: string;
  animated: boolean;
  creatorId: string | null;
}): ApiEmoji {
  return { ...row };
}

export function toSticker(row: {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  tags: string;
  url: string;
  creatorId: string | null;
}): ApiSticker {
  return { ...row };
}

export function toSound(row: {
  id: string;
  guildId: string;
  name: string;
  url: string;
  emoji: string | null;
  volume: number;
  durationSecs: number;
  creatorId: string | null;
}): ApiSound {
  return { ...row };
}

export function toVoiceState(row: {
  userId: string;
  guildId: string | null;
  channelId: string;
  sessionId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  selfVideo: boolean;
  selfStream: boolean;
  joinedAt: Date;
}): ApiVoiceState {
  return {
    userId: row.userId,
    guildId: row.guildId,
    channelId: row.channelId,
    sessionId: row.sessionId,
    selfMute: row.selfMute,
    selfDeaf: row.selfDeaf,
    serverMute: row.serverMute,
    serverDeaf: row.serverDeaf,
    selfVideo: row.selfVideo,
    selfStream: row.selfStream,
    joinedAt: isoRequired(row.joinedAt),
  };
}

/**
 * JSON.stringify nao sabe serializar BigInt e lanca. Em vez de deixar isso
 * derrubar um pedido, convertemos para string, que e o formato do protocolo.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}

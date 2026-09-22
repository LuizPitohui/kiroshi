/** Entidades de dominio partilhadas entre servidor e cliente. */

export type Snowflake = string;

// ---------------------------------------------------------------------------
// Usuarios e presenca
// ---------------------------------------------------------------------------

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';

export interface PublicUser {
  id: Snowflake;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  pronouns: string | null;
  accentColor: string | null;
  bot: boolean;
  createdAt: string;
}

/** Dados que so o proprio usuario recebe. */
export interface SelfUser extends PublicUser {
  email: string;
  totpEnabled: boolean;
  status: PresenceStatus;
  customStatus: string | null;
}

export interface Presence {
  userId: Snowflake;
  status: PresenceStatus;
  customStatus: string | null;
  /** Rich presence: o que a pessoa esta jogando ou ouvindo. */
  activity: Activity | null;
  since: string | null;
}

export interface Activity {
  type: 'PLAYING' | 'LISTENING' | 'WATCHING' | 'STREAMING' | 'COMPETING';
  name: string;
  details: string | null;
  state: string | null;
  largeImageUrl: string | null;
  startedAt: string | null;
}

// ---------------------------------------------------------------------------
// Amizades
// ---------------------------------------------------------------------------

export type RelationshipType = 'PENDING_INCOMING' | 'PENDING_OUTGOING' | 'FRIEND' | 'BLOCKED';

export interface Relationship {
  id: Snowflake;
  type: RelationshipType;
  user: PublicUser;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

export interface Guild {
  id: Snowflake;
  name: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  ownerId: Snowflake;
  systemChannelId: Snowflake | null;
  createdAt: string;
}

/** Servidor com todo o estado inicial embutido, enviado no READY. */
export interface GuildWithState extends Guild {
  channels: Channel[];
  roles: Role[];
  members: GuildMember[];
  emojis: Emoji[];
  stickers: Sticker[];
  sounds: SoundboardSound[];
  voiceStates: VoiceState[];
  memberCount: number;
}

export interface GuildMember {
  userId: Snowflake;
  guildId: Snowflake;
  user: PublicUser;
  nickname: string | null;
  roleIds: Snowflake[];
  joinedAt: string;
  /** Silenciado pela moderacao no servidor inteiro. */
  serverMuted: boolean;
  serverDeafened: boolean;
}

export interface Role {
  id: Snowflake;
  guildId: Snowflake;
  name: string;
  color: string | null;
  /** Maior numero = mais alto na hierarquia. */
  position: number;
  /** Bitfield serializado como string decimal. */
  permissions: string;
  /** Exibe os membros separadamente na lista lateral. */
  hoist: boolean;
  mentionable: boolean;
  /** Cargo gerido pelo sistema; nao pode ser apagado. */
  managed: boolean;
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export type ChannelType =
  | 'GUILD_CATEGORY'
  | 'GUILD_TEXT'
  | 'GUILD_VOICE'
  | 'GUILD_ANNOUNCEMENT'
  | 'DM'
  | 'GROUP_DM';

export interface PermissionOverwrite {
  targetId: Snowflake;
  targetType: 'ROLE' | 'MEMBER';
  allow: string;
  deny: string;
}

export interface Channel {
  id: Snowflake;
  type: ChannelType;
  guildId: Snowflake | null;
  name: string | null;
  topic: string | null;
  position: number;
  parentId: Snowflake | null;
  nsfw: boolean;
  /** Modo lento em segundos; 0 desliga. */
  rateLimitPerUser: number;
  /** Canais de voz: bitrate em bits por segundo. */
  bitrate: number | null;
  /** Canais de voz: 0 significa sem limite. */
  userLimit: number | null;
  overwrites: PermissionOverwrite[];
  /** DM e GROUP_DM: participantes. */
  recipientIds: Snowflake[];
  ownerId: Snowflake | null;
  iconUrl: string | null;
  lastMessageId: Snowflake | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export type MessageType = 'DEFAULT' | 'REPLY' | 'USER_JOIN' | 'PINNED_MESSAGE' | 'CALL';

export interface Attachment {
  id: Snowflake;
  filename: string;
  size: number;
  contentType: string | null;
  url: string;
  width: number | null;
  height: number | null;
  /** Placeholder borrado para carregar sem pulo de layout. */
  placeholder: string | null;
  durationSecs: number | null;
  waveform: string | null;
}

export interface Embed {
  type: 'link' | 'image' | 'video' | 'article';
  url: string | null;
  title: string | null;
  description: string | null;
  color: string | null;
  siteName: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
}

export interface Reaction {
  /** Emoji unicode, ou null quando for emoji customizado. */
  emoji: string | null;
  emojiId: Snowflake | null;
  emojiName: string | null;
  animated: boolean;
  count: number;
  /** Se o usuario da sessao reagiu. */
  me: boolean;
  userIds: Snowflake[];
}

export interface MessageReference {
  messageId: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
}

export interface Message {
  id: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
  authorId: Snowflake;
  author: PublicUser;
  content: string;
  type: MessageType;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  mentionedUserIds: Snowflake[];
  mentionedRoleIds: Snowflake[];
  mentionsEveryone: boolean;
  reference: MessageReference | null;
  /** Mensagem citada, resolvida pelo servidor quando existe. */
  referencedMessage: Message | null;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  /** Eco do id temporario do cliente, para reconciliar o envio otimista. */
  nonce: string | null;
}

// ---------------------------------------------------------------------------
// Expressoes
// ---------------------------------------------------------------------------

export interface Emoji {
  id: Snowflake;
  guildId: Snowflake;
  name: string;
  url: string;
  animated: boolean;
  creatorId: Snowflake | null;
}

export interface Sticker {
  id: Snowflake;
  guildId: Snowflake;
  name: string;
  description: string | null;
  tags: string;
  url: string;
  creatorId: Snowflake | null;
}

export interface SoundboardSound {
  id: Snowflake;
  guildId: Snowflake;
  name: string;
  url: string;
  emoji: string | null;
  volume: number;
  durationSecs: number;
  creatorId: Snowflake | null;
}

// ---------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------

export interface VoiceState {
  userId: Snowflake;
  guildId: Snowflake | null;
  channelId: Snowflake | null;
  sessionId: string;
  /** Silenciou o proprio microfone. */
  selfMute: boolean;
  /** Silenciou o audio de todos. */
  selfDeaf: boolean;
  /** Silenciado por um moderador. */
  serverMute: boolean;
  serverDeaf: boolean;
  /** Transmitindo tela ou camera. */
  selfStream: boolean;
  selfVideo: boolean;
  joinedAt: string;
}

export interface VoiceConnectionInfo {
  /** URL do SFU (LiveKit) para o cliente conectar. */
  url: string;
  /** Token de acesso com escopo na sala e nas permissoes do membro. */
  token: string;
  roomName: string;
  channelId: Snowflake;
  guildId: Snowflake | null;
  /** Servidores ICE extras, quando o caminho direto nao funciona. */
  iceServers: IceServer[];
  /** Forca todo o trafego pelo relay, util atras de NAT restritivo. */
  forceRelay: boolean;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

export interface Invite {
  code: string;
  guildId: Snowflake;
  channelId: Snowflake | null;
  inviterId: Snowflake;
  uses: number;
  /** 0 significa ilimitado. */
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
}

/** Pre-visualizacao publica, mostrada antes de aceitar o convite. */
export interface InvitePreview {
  code: string;
  guild: Pick<Guild, 'id' | 'name' | 'iconUrl' | 'description'>;
  inviter: PublicUser;
  memberCount: number;
  onlineCount: number;
  /** Se o usuario da sessao ja e membro. */
  alreadyMember: boolean;
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Estado de leitura e notificacoes
// ---------------------------------------------------------------------------

export interface ReadState {
  channelId: Snowflake;
  lastReadMessageId: Snowflake | null;
  mentionCount: number;
}

export type NotificationLevel = 'ALL' | 'MENTIONS' | 'NOTHING';

export interface ChannelSettings {
  channelId: Snowflake;
  muted: boolean;
  notificationLevel: NotificationLevel | null;
}

export interface GuildSettings {
  guildId: Snowflake;
  muted: boolean;
  notificationLevel: NotificationLevel;
  channelOverrides: ChannelSettings[];
}

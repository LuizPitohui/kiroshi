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
  /** A foto parada: a que aparece em todo lugar (o primeiro quadro, quando veio um GIF). */
  avatarUrl: string | null;
  /**
   * A mesma foto animada, quando a pessoa subiu um GIF. O app mostra esta
   * enquanto ela fala (e no cartao de perfil); no resto, a parada. Ausente em
   * servidor antigo — o app trata como `null`.
   */
  avatarAnimatedUrl?: string | null;
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

/**
 * O registro de uma chamada em conversa direta, na propria mensagem de
 * sistema que a anuncia (tipo CALL).
 */
export interface MessageCall {
  /** Quem passou pela chamada, na ordem em que entrou. */
  participantIds: Snowflake[];
  /** Quando a ultima pessoa saiu; null enquanto a chamada esta no ar. */
  endedAt: string | null;
}

export interface Message {
  id: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
  authorId: Snowflake;
  author: PublicUser;
  content: string;
  type: MessageType;
  /** So nas mensagens de chamada (tipo CALL). Servidores antigos nao mandam. */
  call?: MessageCall | null;
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
  /**
   * Por que a pessoa saiu, quando foi o servidor que a tirou por uma regra.
   * So vem no aviso de saida:
   *
   *   ALONE_TIMEOUT  a regra dos 3 minutos sozinho numa chamada de DM
   *   VOICE_LOST     constava na chamada sem estar na sala do SFU pelo prazo
   *                  inteiro (a voz caiu e ninguem avisou)
   *
   * Versoes do app que nao conhecem um motivo mostram o aviso generico.
   */
  leaveReason?: 'ALONE_TIMEOUT' | 'VOICE_LOST';
}

/**
 * Uma chamada no ar numa DM ou grupo. Existe enquanto houver alguem na voz da
 * conversa; o toque e so para quem ainda nao entrou.
 */
export interface Call {
  channelId: Snowflake;
  /** A mensagem de sistema que registra a chamada. */
  messageId: Snowflake;
  /** Quem esta sendo chamado agora: sai ao atender, recusar ou no fim do toque. */
  ringing: Snowflake[];
  startedAt: string;
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
  /** Quem criou, para a lista de convites. Servidores antigos nao mandam. */
  inviter?: PublicUser | null;
  uses: number;
  /** 0 significa ilimitado. */
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
}

/** Um banimento, como a lista dos ajustes do servidor mostra. */
export interface GuildBan {
  userId: Snowflake;
  /** null quando a conta ja nao existe. */
  user: PublicUser | null;
  reason: string | null;
  bannedBy: Snowflake;
  createdAt: string;
}

/** Uma linha do registro de auditoria. */
export interface AuditLogEntry {
  id: Snowflake;
  /** ROLE_CREATE, MEMBER_BAN, INVITE_DELETE... (ver `AUDIT_ACTIONS` no cliente). */
  action: string;
  actor: PublicUser;
  targetId: Snowflake | null;
  /** Quando o alvo e uma pessoa, ela, mesmo que ja tenha saido do servidor. */
  targetUser?: PublicUser | null;
  changes: Record<string, unknown>;
  reason: string | null;
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

/** Silenciar: com `mutedUntil`, ate aquela hora; sem, ate a pessoa reativar. */
export interface ChannelSettings {
  channelId: Snowflake;
  muted: boolean;
  mutedUntil: string | null;
  /** null herda do servidor (numa DM, vale "todas"). */
  notificationLevel: NotificationLevel | null;
}

export interface GuildSettings {
  guildId: Snowflake;
  muted: boolean;
  mutedUntil: string | null;
  notificationLevel: NotificationLevel;
}

/** Os ajustes de notificacao da pessoa: por servidor e por canal, DMs inclusive. */
export interface NotificationSettings {
  guilds: GuildSettings[];
  channels: ChannelSettings[];
}

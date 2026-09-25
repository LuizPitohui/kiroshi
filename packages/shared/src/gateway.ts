/**
 * Protocolo do gateway em tempo real (WebSocket).
 *
 * Fluxo de uma conexao saudavel:
 *
 *   servidor -> HELLO            (intervalo de heartbeat)
 *   cliente  -> IDENTIFY         (token) ou RESUME (sessionId + ultimo seq)
 *   servidor -> DISPATCH READY   (estado inicial completo)
 *   cliente  -> HEARTBEAT        a cada heartbeatInterval ms
 *   servidor -> HEARTBEAT_ACK
 *   servidor -> DISPATCH ...     eventos, cada um com um seq crescente
 *
 * Se o socket cair, o cliente reconecta e manda RESUME com o ultimo seq que
 * recebeu. O servidor guarda um buffer dos eventos recentes por sessao e
 * reenvia o que faltou. Se o buffer ja passou, responde INVALID_SESSION e o
 * cliente refaz o IDENTIFY do zero.
 */

import type {
  Activity,
  Channel,
  Emoji,
  Guild,
  GuildMember,
  GuildWithState,
  Message,
  Presence,
  PresenceStatus,
  PublicUser,
  Reaction,
  ReadState,
  Relationship,
  Role,
  SelfUser,
  Snowflake,
  SoundboardSound,
  Sticker,
  VoiceState,
} from './types.js';

export const GATEWAY_VERSION = 1;

export enum GatewayOpcode {
  /** servidor -> cliente: evento com nome e sequencia. */
  DISPATCH = 0,
  /** cliente -> servidor: mantem a conexao viva. */
  HEARTBEAT = 1,
  /** cliente -> servidor: autentica uma sessao nova. */
  IDENTIFY = 2,
  /** cliente -> servidor: muda status e atividade. */
  PRESENCE_UPDATE = 3,
  /** cliente -> servidor: entra, sai ou muda de estado em canal de voz. */
  VOICE_STATE_UPDATE = 4,
  /** cliente -> servidor: retoma uma sessao interrompida. */
  RESUME = 6,
  /** servidor -> cliente: reconecte agora, a sessao pode ser retomada. */
  RECONNECT = 7,
  /** cliente -> servidor: pede a lista completa de membros de um servidor. */
  REQUEST_GUILD_MEMBERS = 8,
  /** servidor -> cliente: sessao invalida; refaca o IDENTIFY. */
  INVALID_SESSION = 9,
  /** servidor -> cliente: primeiro pacote, traz o intervalo de heartbeat. */
  HELLO = 10,
  /** servidor -> cliente: confirmacao de heartbeat. */
  HEARTBEAT_ACK = 11,
  /** cliente -> servidor: sinaliza digitacao. */
  TYPING = 12,
}

/** Codigos de fechamento. >= 4000 sao especificos da aplicacao. */
export enum GatewayCloseCode {
  UNKNOWN_ERROR = 4000,
  UNKNOWN_OPCODE = 4001,
  DECODE_ERROR = 4002,
  NOT_AUTHENTICATED = 4003,
  AUTHENTICATION_FAILED = 4004,
  ALREADY_AUTHENTICATED = 4005,
  INVALID_SEQUENCE = 4007,
  RATE_LIMITED = 4008,
  SESSION_TIMED_OUT = 4009,
  /** Outra sessao assumiu; nao tente reconectar. */
  SESSION_REPLACED = 4010,
}

/** Codigos de fechamento em que reconectar nao adianta. */
export const NON_RESUMABLE_CLOSE_CODES: readonly number[] = [
  GatewayCloseCode.AUTHENTICATION_FAILED,
  GatewayCloseCode.SESSION_REPLACED,
  GatewayCloseCode.RATE_LIMITED,
];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface GatewayEnvelope<T = unknown> {
  op: GatewayOpcode;
  d?: T;
  /** Sequencia, presente apenas em DISPATCH. */
  s?: number;
  /** Nome do evento, presente apenas em DISPATCH. */
  t?: GatewayEventName;
}

export interface HelloPayload {
  heartbeatInterval: number;
  gatewayVersion: number;
}

export interface IdentifyPayload {
  token: string;
  properties: {
    os: string;
    client: string;
    version: string;
  };
  presence?: {
    status: PresenceStatus;
    customStatus?: string | null;
    activity?: Activity | null;
  };
}

export interface ResumePayload {
  token: string;
  sessionId: string;
  seq: number;
}

export interface PresenceUpdatePayload {
  status: PresenceStatus;
  customStatus?: string | null;
  activity?: Activity | null;
}

export interface VoiceStateUpdatePayload {
  guildId: Snowflake | null;
  /** null desconecta do canal atual. */
  channelId: Snowflake | null;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo?: boolean;
  selfStream?: boolean;
}

export interface RequestGuildMembersPayload {
  guildId: Snowflake;
  /** Filtro por prefixo do nome; vazio traz todos. */
  query?: string;
  limit?: number;
}

export interface TypingPayload {
  channelId: Snowflake;
}

export interface InvalidSessionPayload {
  /** Se true, vale a pena tentar RESUME de novo. */
  resumable: boolean;
}

// ---------------------------------------------------------------------------
// Eventos (DISPATCH)
// ---------------------------------------------------------------------------

export type GatewayEventName =
  | 'READY'
  | 'RESUMED'
  | 'USER_UPDATE'
  | 'PRESENCE_UPDATE'
  | 'RELATIONSHIP_ADD'
  | 'RELATIONSHIP_UPDATE'
  | 'RELATIONSHIP_REMOVE'
  | 'GUILD_CREATE'
  | 'GUILD_UPDATE'
  | 'GUILD_DELETE'
  | 'GUILD_MEMBER_ADD'
  | 'GUILD_MEMBER_UPDATE'
  | 'GUILD_MEMBER_REMOVE'
  | 'GUILD_MEMBERS_CHUNK'
  | 'GUILD_ROLE_CREATE'
  | 'GUILD_ROLE_UPDATE'
  | 'GUILD_ROLE_DELETE'
  | 'GUILD_EMOJIS_UPDATE'
  | 'GUILD_STICKERS_UPDATE'
  | 'GUILD_SOUNDS_UPDATE'
  | 'CHANNEL_CREATE'
  | 'CHANNEL_UPDATE'
  | 'CHANNEL_DELETE'
  | 'CHANNEL_PINS_UPDATE'
  | 'MESSAGE_CREATE'
  | 'MESSAGE_UPDATE'
  | 'MESSAGE_DELETE'
  | 'MESSAGE_DELETE_BULK'
  | 'MESSAGE_REACTION_ADD'
  | 'MESSAGE_REACTION_REMOVE'
  | 'MESSAGE_REACTION_REMOVE_ALL'
  | 'MESSAGE_ACK'
  | 'TYPING_START'
  | 'VOICE_STATE_UPDATE'
  | 'VOICE_SERVER_UPDATE'
  | 'VOICE_CHANNEL_EFFECT'
  | 'SPEAKING_UPDATE';

export interface ReadyEvent {
  gatewayVersion: number;
  sessionId: string;
  user: SelfUser;
  guilds: GuildWithState[];
  /** Canais de DM e grupos de que o usuario participa. */
  privateChannels: Channel[];
  relationships: Relationship[];
  readStates: ReadState[];
  /** Presenca de amigos e de membros dos servidores. */
  presences: Presence[];
  /** Usuarios referenciados por DMs e amizades, para evitar buscas extras. */
  users: PublicUser[];
}

export interface ResumedEvent {
  /** Quantos eventos foram reenviados do buffer. */
  replayed: number;
}

export interface GuildMembersChunkEvent {
  guildId: Snowflake;
  members: GuildMember[];
  chunkIndex: number;
  chunkCount: number;
}

export interface MessageDeleteEvent {
  id: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
}

export interface MessageDeleteBulkEvent {
  ids: Snowflake[];
  channelId: Snowflake;
  guildId: Snowflake | null;
}

export interface MessageReactionEvent {
  messageId: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
  userId: Snowflake;
  emoji: string | null;
  emojiId: Snowflake | null;
  emojiName: string | null;
  animated: boolean;
  /** Estado consolidado da reacao apos a mudanca. */
  reaction: Reaction | null;
}

export interface TypingStartEvent {
  channelId: Snowflake;
  guildId: Snowflake | null;
  userId: Snowflake;
  timestamp: number;
}

export interface ChannelPinsUpdateEvent {
  channelId: Snowflake;
  guildId: Snowflake | null;
  lastPinAt: string | null;
}

/**
 * Enviado depois de VOICE_STATE_UPDATE quando o usuario entra em um canal de
 * voz: traz a URL e o token do SFU. Nunca e reenviado no replay de RESUME,
 * porque o token tem validade curta.
 */
export interface VoiceServerUpdateEvent {
  channelId: Snowflake;
  guildId: Snowflake | null;
  url: string;
  token: string;
  roomName: string;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  forceRelay: boolean;
  /**
   * A moderacao que valia quando o token saiu, e que o proprio token ja
   * respeita: silenciado, ele nao deixa publicar microfone. Vem junto para o
   * app saber antes de abrir o microfone e para o estado nao se perder na
   * troca de sala. Servidores antigos nao mandam.
   */
  serverMute?: boolean;
  serverDeaf?: boolean;
}

export interface SpeakingUpdateEvent {
  channelId: Snowflake;
  userId: Snowflake;
  speaking: boolean;
  /** 0 a 1, para desenhar o anel de audio. */
  level: number;
}

export interface VoiceChannelEffectEvent {
  channelId: Snowflake;
  guildId: Snowflake;
  userId: Snowflake;
  soundId: Snowflake;
}

export interface GuildDeleteEvent {
  id: Snowflake;
  /** true quando foi so uma queda temporaria, nao uma saida real. */
  unavailable: boolean;
}

export interface GuildMemberRemoveEvent {
  guildId: Snowflake;
  userId: Snowflake;
}

export interface GuildRoleDeleteEvent {
  guildId: Snowflake;
  roleId: Snowflake;
}

export interface GuildEmojisUpdateEvent {
  guildId: Snowflake;
  emojis: Emoji[];
}

export interface GuildStickersUpdateEvent {
  guildId: Snowflake;
  stickers: Sticker[];
}

export interface GuildSoundsUpdateEvent {
  guildId: Snowflake;
  sounds: SoundboardSound[];
}

export interface MessageAckEvent {
  channelId: Snowflake;
  lastReadMessageId: Snowflake;
  mentionCount: number;
}

export interface RelationshipRemoveEvent {
  id: Snowflake;
  userId: Snowflake;
}

/** Mapa de evento para payload, para tipar o dispatcher nas duas pontas. */
export interface GatewayEventMap {
  READY: ReadyEvent;
  RESUMED: ResumedEvent;
  USER_UPDATE: SelfUser;
  PRESENCE_UPDATE: Presence;
  RELATIONSHIP_ADD: Relationship;
  RELATIONSHIP_UPDATE: Relationship;
  RELATIONSHIP_REMOVE: RelationshipRemoveEvent;
  GUILD_CREATE: GuildWithState;
  GUILD_UPDATE: Guild;
  GUILD_DELETE: GuildDeleteEvent;
  GUILD_MEMBER_ADD: GuildMember;
  GUILD_MEMBER_UPDATE: GuildMember;
  GUILD_MEMBER_REMOVE: GuildMemberRemoveEvent;
  GUILD_MEMBERS_CHUNK: GuildMembersChunkEvent;
  GUILD_ROLE_CREATE: Role;
  GUILD_ROLE_UPDATE: Role;
  GUILD_ROLE_DELETE: GuildRoleDeleteEvent;
  GUILD_EMOJIS_UPDATE: GuildEmojisUpdateEvent;
  GUILD_STICKERS_UPDATE: GuildStickersUpdateEvent;
  GUILD_SOUNDS_UPDATE: GuildSoundsUpdateEvent;
  CHANNEL_CREATE: Channel;
  CHANNEL_UPDATE: Channel;
  CHANNEL_DELETE: Channel;
  CHANNEL_PINS_UPDATE: ChannelPinsUpdateEvent;
  MESSAGE_CREATE: Message;
  MESSAGE_UPDATE: Message;
  MESSAGE_DELETE: MessageDeleteEvent;
  MESSAGE_DELETE_BULK: MessageDeleteBulkEvent;
  MESSAGE_REACTION_ADD: MessageReactionEvent;
  MESSAGE_REACTION_REMOVE: MessageReactionEvent;
  MESSAGE_REACTION_REMOVE_ALL: { messageId: Snowflake; channelId: Snowflake };
  MESSAGE_ACK: MessageAckEvent;
  TYPING_START: TypingStartEvent;
  VOICE_STATE_UPDATE: VoiceState;
  VOICE_SERVER_UPDATE: VoiceServerUpdateEvent;
  VOICE_CHANNEL_EFFECT: VoiceChannelEffectEvent;
  SPEAKING_UPDATE: SpeakingUpdateEvent;
}

// ---------------------------------------------------------------------------
// Constantes de tempo
// ---------------------------------------------------------------------------

/** Intervalo pedido ao cliente no HELLO. */
export const HEARTBEAT_INTERVAL_MS = 41_250;

/** Tolerancia antes de considerar o cliente morto. */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2;

/** Janela para retomar a sessao apos a queda do socket. */
export const SESSION_RESUME_WINDOW_MS = 120_000;

/** Quantos eventos ficam no buffer de replay por sessao. */
export const SESSION_REPLAY_BUFFER = 512;

/** O indicador de digitacao some sozinho depois disso. */
export const TYPING_TIMEOUT_MS = 9_000;

/** Intervalo minimo entre dois TYPING do mesmo cliente. */
export const TYPING_THROTTLE_MS = 8_000;

/** Eventos que nunca entram no buffer de replay, por conterem credencial
 *  de vida curta ou por so fazerem sentido no instante em que ocorrem. */
export const NON_REPLAYABLE_EVENTS: readonly GatewayEventName[] = [
  'VOICE_SERVER_UPDATE',
  'TYPING_START',
  'SPEAKING_UPDATE',
];

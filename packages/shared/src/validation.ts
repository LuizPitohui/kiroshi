/** Schemas zod compartilhados: o servidor valida a entrada, o cliente valida
 *  o formulario antes de enviar. Uma definicao so, duas pontas. */

import { z } from 'zod';
import { LIMITS, USERNAME_PATTERN, INVITE_CODE_PATTERN, BITRATE, usernameReservado } from './constants.js';
import { ALL_PERMISSION_NAMES } from './permissions.js';

const snowflake = z.string().regex(/^\d{1,20}$/, 'id invalido');

/** Bitfield de permissao chega como string decimal. */
const permissionBits = z.string().regex(/^\d{1,20}$/, 'permissoes invalidas');

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'cor deve estar no formato #rrggbb');

// ---------------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------------

/** Nome de usuario de conta nova: o formato de sempre e fora da lista de reservados. */
export const novoUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'use 2 a 32 caracteres: letras minusculas, numeros, ponto ou _')
  .refine((u) => !usernameReservado(u), 'este nome de usuario e reservado');

export const registerSchema = z.object({
  email: z.string().email('email invalido').max(254).toLowerCase().trim(),
  username: novoUsernameSchema,
  displayName: z
    .string()
    .trim()
    .min(LIMITS.displayName.min)
    .max(LIMITS.displayName.max)
    .optional(),
  password: z
    .string()
    .min(LIMITS.password.min, `minimo de ${LIMITS.password.min} caracteres`)
    .max(LIMITS.password.max),
  /** Codigo de convite do servidor, quando o cadastro e fechado. */
  inviteCode: z.string().regex(INVITE_CODE_PATTERN).optional(),
});

export const loginSchema = z.object({
  /** Aceita email ou nome de usuario. */
  login: z.string().trim().min(2).max(254),
  password: z.string().min(1).max(LIMITS.password.max),
  /** Codigo TOTP, quando o 2FA esta ligado. */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  /** Codigo de recuperacao, alternativa ao TOTP. */
  backupCode: z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16),
});

/*
  A senha e opcional nestes tres.

  Quem criou a conta pelo Google pode nao ter senha nenhuma, e exigir uma aqui
  trancaria essa pessoa para fora do 2FA e de definir a primeira senha. Quem
  TEM senha continua obrigado a informa-la: isso e cobrado no servidor, que e
  onde se sabe se a conta tem senha. O schema so para de exigir o campo; nao
  para de exigir a confirmacao.
*/
export const enableTotpSchema = z.object({
  /** Confirma que o app autenticador foi configurado. */
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(1).optional(),
});

/*
  Desligar o 2FA aceita o codigo do app OU um codigo de recuperacao.

  Antes so o do app: quem perdeu o celular entrava com um codigo de
  recuperacao e ficava preso com o 2FA ligado, sem ter como desligar nem
  cadastrar o celular novo.
*/
export const disableTotpSchema = z
  .object({
    password: z.string().min(1).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
    backupCode: z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.backupCode), {
    message: 'informe o codigo do app ou um codigo de recuperacao',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(LIMITS.password.min).max(LIMITS.password.max),
});

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(LIMITS.displayName.min).max(LIMITS.displayName.max).optional(),
  bio: z.string().max(LIMITS.bio.max).nullable().optional(),
  pronouns: z.string().max(LIMITS.pronouns.max).nullable().optional(),
  accentColor: hexColor.nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
});

export const updatePresenceSchema = z.object({
  status: z.enum(['ONLINE', 'IDLE', 'DND', 'OFFLINE']),
  customStatus: z.string().max(LIMITS.customStatus.max).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

export const createGuildSchema = z.object({
  name: z.string().trim().min(LIMITS.guildName.min).max(LIMITS.guildName.max),
  iconUrl: z.string().url().nullable().optional(),
  /** Cria os canais padrao (geral + Geral de voz). */
  withDefaultChannels: z.boolean().default(true),
});

export const updateGuildSchema = z.object({
  name: z.string().trim().min(LIMITS.guildName.min).max(LIMITS.guildName.max).optional(),
  description: z.string().max(LIMITS.guildDescription.max).nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  systemChannelId: snowflake.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export const channelTypeSchema = z.enum([
  'GUILD_CATEGORY',
  'GUILD_TEXT',
  'GUILD_VOICE',
  'GUILD_ANNOUNCEMENT',
]);

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.channelName.min)
    .max(LIMITS.channelName.max),
  type: channelTypeSchema,
  parentId: snowflake.nullable().optional(),
  topic: z.string().max(LIMITS.channelTopic.max).nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().min(0).max(LIMITS.rateLimitPerUserMax).optional(),
  bitrate: z.number().int().min(BITRATE.min).max(BITRATE.max).optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
});

export const updateChannelSchema = createChannelSchema.partial().omit({ type: true });

export const reorderChannelsSchema = z.object({
  positions: z
    .array(
      z.object({
        id: snowflake,
        position: z.number().int().min(0).max(1000),
        parentId: snowflake.nullable().optional(),
      }),
    )
    .min(1)
    .max(LIMITS.channelsPerGuild),
});

export const overwriteSchema = z.object({
  targetId: snowflake,
  targetType: z.enum(['ROLE', 'MEMBER']),
  allow: permissionBits,
  deny: permissionBits,
});

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

export const permissionNameSchema = z.enum(
  ALL_PERMISSION_NAMES as [string, ...string[]],
);

export const createRoleSchema = z.object({
  name: z.string().trim().min(LIMITS.roleName.min).max(LIMITS.roleName.max),
  color: hexColor.nullable().optional(),
  permissions: permissionBits.optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});

export const updateRoleSchema = createRoleSchema.partial();

export const reorderRolesSchema = z.object({
  positions: z
    .array(z.object({ id: snowflake, position: z.number().int().min(0).max(1000) }))
    .min(1)
    .max(LIMITS.rolesPerGuild),
});

export const updateMemberSchema = z.object({
  nickname: z.string().trim().max(LIMITS.nickname.max).nullable().optional(),
  roleIds: z.array(snowflake).max(LIMITS.rolesPerGuild).optional(),
  serverMuted: z.boolean().optional(),
  serverDeafened: z.boolean().optional(),
  /** Move o membro para outro canal de voz, ou o desconecta com null. */
  voiceChannelId: snowflake.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export const createMessageSchema = z
  .object({
    content: z.string().max(LIMITS.messageContent.max).default(''),
    attachmentIds: z.array(snowflake).max(LIMITS.attachmentsPerMessage).optional(),
    replyToId: snowflake.nullable().optional(),
    stickerId: snowflake.nullable().optional(),
    /** Id temporario do cliente, ecoado no MESSAGE_CREATE. */
    nonce: z.string().max(64).optional(),
  })
  .refine(
    (v) => v.content.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0 || v.stickerId,
    { message: 'mensagem vazia' },
  );

export const editMessageSchema = z.object({
  content: z.string().max(LIMITS.messageContent.max),
});

export const fetchMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITS.messagesPerFetch.max).default(LIMITS.messagesPerFetch.default),
  /** Paginacao: mensagens anteriores a este id. */
  before: snowflake.optional(),
  /** Paginacao: mensagens posteriores a este id. */
  after: snowflake.optional(),
  /** Centraliza a busca em volta de um id, para pular para uma mensagem. */
  around: snowflake.optional(),
});

export const reactionSchema = z.object({
  /** Emoji unicode. */
  emoji: z.string().min(1).max(64).optional(),
  /** Ou o id de um emoji customizado. */
  emojiId: snowflake.optional(),
}).refine((v) => Boolean(v.emoji) !== Boolean(v.emojiId), {
  message: 'informe emoji unicode ou emojiId, nunca os dois',
});

export const ackSchema = z.object({
  messageId: snowflake,
});

export const searchMessagesSchema = z.object({
  query: z.string().trim().min(1).max(200),
  channelId: snowflake.optional(),
  authorId: snowflake.optional(),
  has: z.enum(['link', 'file', 'image']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

export const createInviteSchema = z.object({
  channelId: snowflake.nullable().optional(),
  /** Segundos ate expirar; 0 nunca expira. */
  maxAgeSecs: z.number().int().min(0).max(30 * 24 * 3600).default(7 * 24 * 3600),
  /** 0 significa ilimitado. */
  maxUses: z.number().int().min(0).max(100).default(0),
});

// ---------------------------------------------------------------------------
// Amizades e DMs
// ---------------------------------------------------------------------------

export const friendRequestSchema = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_PATTERN),
});

export const createDmSchema = z.object({
  recipientIds: z.array(snowflake).min(1).max(LIMITS.groupDmRecipients),
});

/**
 * Tocar, ou parar de tocar, numa chamada de DM. Sem lista: tocar vale para
 * todos que ainda nao entraram, e parar vale para quem pediu (recusar).
 */
export const callRingSchema = z.object({
  recipients: z.array(snowflake).min(1).max(LIMITS.groupDmRecipients).optional(),
});

export const updateGroupDmSchema = z.object({
  name: z.string().trim().max(LIMITS.channelName.max).nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Expressoes
// ---------------------------------------------------------------------------

export const createEmojiSchema = z.object({
  name: z.string().trim().regex(/^[a-zA-Z0-9_]{2,32}$/, 'use letras, numeros ou _'),
  /** Data URL ou URL ja enviada. */
  image: z.string().min(16),
});

export const createStickerSchema = z.object({
  name: z.string().trim().min(2).max(30),
  description: z.string().max(100).nullable().optional(),
  tags: z.string().max(200).default(''),
  image: z.string().min(16),
});

export const createSoundSchema = z.object({
  name: z.string().trim().min(2).max(32),
  emoji: z.string().max(64).nullable().optional(),
  volume: z.number().min(0).max(1).default(1),
  audio: z.string().min(16),
  /**
   * Duracao medida por quem envia (o app decodifica antes de subir). O
   * servidor nao decodifica audio; o limite vale de verdade na hora de tocar,
   * que para no mesmo teto. Clientes antigos nao mandam.
   */
  durationSecs: z
    .number()
    .positive()
    .max(LIMITS.soundDurationSecs + 0.25, `o som pode ter no maximo ${LIMITS.soundDurationSecs} segundos`)
    .optional(),
});

export const updateSoundSchema = z.object({
  name: z.string().trim().min(2).max(32).optional(),
  emoji: z.string().max(64).nullable().optional(),
  volume: z.number().min(0).max(1).optional(),
});

export const playSoundSchema = z.object({
  soundId: snowflake,
});

// ---------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------

export const joinVoiceSchema = z.object({
  channelId: snowflake,
  selfMute: z.boolean().default(false),
  selfDeaf: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Preferencias
// ---------------------------------------------------------------------------

export const notificationLevelSchema = z.enum(['ALL', 'MENTIONS', 'NOTHING']);

/** Ate quando o silencio vale (ISO 8601); null e sem prazo. */
const mutedUntilSchema = z.string().datetime({ offset: true }).nullable().optional();

export const updateGuildSettingsSchema = z.object({
  muted: z.boolean().optional(),
  mutedUntil: mutedUntilSchema,
  notificationLevel: notificationLevelSchema.optional(),
});

export const updateChannelSettingsSchema = z.object({
  muted: z.boolean().optional(),
  mutedUntil: mutedUntilSchema,
  notificationLevel: notificationLevelSchema.nullable().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateGuildInput = z.infer<typeof createGuildSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type FetchMessagesInput = z.infer<typeof fetchMessagesSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

import { z } from 'zod';
import { LIMITS } from '@kiroshi/shared';

/**
 * O formato de cada payload que o cliente manda pelo gateway.
 *
 * Antes cada opcode fazia `envelope.d as Tipo` e confiava. Um status que nao
 * existe, um id que nao e snowflake ou um recado de mil caracteres iam direto
 * para o banco, e o erro que voltava de la derrubava a conexao como "erro
 * interno". Agora o payload fora do formato fecha com o codigo de decodificacao
 * (4002), o mesmo do JSON invalido, antes de tocar em qualquer coisa.
 *
 * Os esquemas aceitam exatamente o que o app manda hoje (ver
 * packages/desktop/src/api/gateway.ts). Campo a mais e ignorado, nao recusado:
 * e o que deixa um cliente mais novo conversar com este servidor.
 *
 * Token vazio e sessao vazia continuam passando por aqui: o tratamento deles
 * ja existe no proprio opcode (4004 para token ausente, INVALID_SESSION para
 * retomada sem sessao), e o app decide o que fazer a partir desses codigos.
 */

const snowflake = z.string().regex(/^\d{1,20}$/);
const status = z.enum(['ONLINE', 'IDLE', 'DND', 'OFFLINE']);
const recado = z.string().max(LIMITS.customStatus.max).nullable().optional();
const token = z.string().max(4096);

/** Opcode 2. */
export const identifySchema = z.object({
  token,
  properties: z
    .object({
      os: z.string().max(200),
      client: z.string().max(200),
      version: z.string().max(200),
    })
    .partial()
    .optional(),
  presence: z
    .object({
      status,
      customStatus: recado,
      // Previsto no protocolo e ainda sem uso: aceito e ignorado.
      activity: z.unknown().optional(),
    })
    .optional(),
});

/** Opcode 3. */
export const presenceUpdateSchema = z.object({
  status,
  customStatus: recado,
  activity: z.unknown().optional(),
});

/** Opcode 4. `channelId` nulo e sair da voz. */
export const voiceStateUpdateSchema = z.object({
  guildId: snowflake.nullable().optional(),
  channelId: snowflake.nullable(),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
  selfVideo: z.boolean().optional(),
  selfStream: z.boolean().optional(),
});

/** Opcode 6. */
export const resumeSchema = z.object({
  token,
  sessionId: z.string().max(32),
  seq: z.number().int().min(0),
});

/** Opcode 8. O limite e cortado em 1000 por quem trata. */
export const requestGuildMembersSchema = z.object({
  guildId: snowflake,
  query: z.string().max(100).optional(),
  limit: z.number().int().min(0).optional(),
});

/** Opcode 12. */
export const typingSchema = z.object({
  channelId: snowflake,
});

/**
 * Os payloads do gateway: o que o app 1.15 manda tem que passar, e o resto
 * tem que parar aqui, antes de chegar ao banco.
 *
 * Os exemplos "do app" sao copiados de packages/desktop/src/api/gateway.ts e
 * dos componentes que chamam updateVoiceState e sendTyping. Se o app mudar o
 * formato, e aqui que o servidor precisa ser avisado.
 */

import { describe, it, expect } from 'vitest';
import {
  identifySchema,
  presenceUpdateSchema,
  requestGuildMembersSchema,
  resumeSchema,
  typingSchema,
  voiceStateUpdateSchema,
} from './payloads.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.assinatura';

describe('o que o app manda passa', () => {
  it('IDENTIFY, com e sem presenca guardada', () => {
    const base = {
      token: TOKEN,
      properties: { os: 'Win32', client: 'kiroshi-desktop', version: '1.15.0' },
    };
    expect(identifySchema.safeParse(base).success).toBe(true);
    expect(
      identifySchema.safeParse({ ...base, presence: { status: 'DND', customStatus: null } }).success,
    ).toBe(true);
    expect(
      identifySchema.safeParse({ ...base, presence: { status: 'IDLE', customStatus: 'jogando' } }).success,
    ).toBe(true);
  });

  it('IDENTIFY com token vazio passa aqui: o opcode responde 4004, como antes', () => {
    expect(identifySchema.safeParse({ token: '', properties: {} }).success).toBe(true);
  });

  it('RESUME', () => {
    expect(resumeSchema.safeParse({ token: TOKEN, sessionId: '359514397288243200', seq: 42 }).success).toBe(true);
  });

  it('PRESENCE_UPDATE, inclusive com o recado no limite de 128', () => {
    expect(presenceUpdateSchema.safeParse({ status: 'ONLINE', customStatus: null }).success).toBe(true);
    expect(presenceUpdateSchema.safeParse({ status: 'OFFLINE', customStatus: 'x'.repeat(128) }).success).toBe(true);
  });

  it('VOICE_STATE_UPDATE de entrar, sair do servidor e sair da DM', () => {
    expect(
      voiceStateUpdateSchema.safeParse({ guildId: '1', channelId: '2', selfMute: false, selfDeaf: false }).success,
    ).toBe(true);
    expect(
      voiceStateUpdateSchema.safeParse({ guildId: '1', channelId: null, selfMute: true, selfDeaf: true }).success,
    ).toBe(true);
    expect(
      voiceStateUpdateSchema.safeParse({ guildId: null, channelId: null, selfMute: false, selfDeaf: false }).success,
    ).toBe(true);
  });

  it('REQUEST_GUILD_MEMBERS e TYPING', () => {
    expect(requestGuildMembersSchema.safeParse({ guildId: '1', query: '', limit: 1000 }).success).toBe(true);
    expect(typingSchema.safeParse({ channelId: '2' }).success).toBe(true);
  });

  it('campo a mais e ignorado, nao recusado', () => {
    const lido = typingSchema.safeParse({ channelId: '2', futuro: true });
    expect(lido.success).toBe(true);
  });
});

describe('o que esta fora do formato para', () => {
  it('status que nao existe e recado longo demais', () => {
    expect(presenceUpdateSchema.safeParse({ status: 'INVISIVEL', customStatus: null }).success).toBe(false);
    expect(presenceUpdateSchema.safeParse({ status: 'ONLINE', customStatus: 'x'.repeat(129) }).success).toBe(false);
  });

  it('canal que nao e snowflake e booleano faltando na voz', () => {
    expect(
      voiceStateUpdateSchema.safeParse({ guildId: '1', channelId: 'abc', selfMute: false, selfDeaf: false }).success,
    ).toBe(false);
    expect(voiceStateUpdateSchema.safeParse({ guildId: '1', channelId: '2', selfDeaf: false }).success).toBe(false);
  });

  it('tipos trocados', () => {
    expect(typingSchema.safeParse({ channelId: 2 }).success).toBe(false);
    expect(resumeSchema.safeParse({ token: TOKEN, sessionId: '1', seq: '5' }).success).toBe(false);
    expect(identifySchema.safeParse({ token: 123 }).success).toBe(false);
    expect(typingSchema.safeParse(undefined).success).toBe(false);
  });
});

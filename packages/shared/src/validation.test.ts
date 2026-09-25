import { describe, expect, it } from 'vitest';
import { usernameReservado } from './constants.js';
import { disableTotpSchema, novoUsernameSchema, registerSchema } from './validation.js';

describe('nomes reservados (cadastro aberto)', () => {
  it('pega os nomes e as variacoes com ponto e sublinhado', () => {
    expect(usernameReservado('admin')).toBe(true);
    expect(usernameReservado('everyone')).toBe(true);
    expect(usernameReservado('_kiroshi_')).toBe(true);
    expect(usernameReservado('adm.in')).toBe(true);
    expect(usernameReservado('KIROSHI')).toBe(true);
  });

  it('deixa passar nome comum, mesmo parecido', () => {
    expect(usernameReservado('pitohui')).toBe(false);
    expect(usernameReservado('adminha')).toBe(false);
    expect(usernameReservado('kaya')).toBe(false);
  });

  it('o schema de conta nova recusa reservado e hifen, e normaliza', () => {
    expect(novoUsernameSchema.safeParse('admin').success).toBe(false);
    expect(novoUsernameSchema.safeParse('com-hifen').success).toBe(false);
    expect(novoUsernameSchema.parse('  Kaya.2 ')).toBe('kaya.2');
  });

  it('o cadastro usa o mesmo schema', () => {
    const r = registerSchema.safeParse({ email: 'a@b.com', username: 'here', password: '12345678' });
    expect(r.success).toBe(false);
  });
});

describe('desligar o 2FA', () => {
  it('aceita o codigo do app ou um de recuperacao, nunca os dois nem nenhum', () => {
    expect(disableTotpSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(disableTotpSchema.safeParse({ backupCode: 'ab12-cd34' }).success).toBe(true);
    expect(disableTotpSchema.safeParse({ code: '123456', backupCode: 'ab12-cd34' }).success).toBe(false);
    expect(disableTotpSchema.safeParse({}).success).toBe(false);
    expect(disableTotpSchema.safeParse({ backupCode: 'nao-e-codigo' }).success).toBe(false);
  });
});

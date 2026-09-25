import { describe, expect, it } from 'vitest';
import { codigoDe, descreverUsos, quandoExpira, valido } from './regrasDoConvite.js';

describe('codigo do convite', () => {
  it('aceita o codigo, o link e o kiroshi://', () => {
    expect(codigoDe('Ab3dEf7h')).toBe('Ab3dEf7h');
    expect(codigoDe('  https://order.arasaka.fun/convite/Ab3dEf7h/ ')).toBe('Ab3dEf7h');
    expect(codigoDe('kiroshi://convite/Ab3dEf7h')).toBe('Ab3dEf7h');
  });

  it('recusa o que nao e codigo', () => {
    expect(codigoDe('')).toBeNull();
    expect(codigoDe('https://order.arasaka.fun/convite/')).toBeNull();
    expect(codigoDe('abc')).toBeNull();
    expect(codigoDe('ola tudo bem?')).toBeNull();
  });
});

describe('validade e usos', () => {
  const agora = Date.parse('2026-09-25T12:00:00Z');

  it('vencido ou sem usos nao vale', () => {
    expect(valido({ expiresAt: '2026-09-25T11:00:00Z', maxUses: 0, uses: 0 }, agora)).toBe(false);
    expect(valido({ expiresAt: null, maxUses: 1, uses: 1 }, agora)).toBe(false);
    expect(valido({ expiresAt: null, maxUses: 0, uses: 40 }, agora)).toBe(true);
  });

  it('diz quando expira em unidades que se leem', () => {
    expect(quandoExpira(null, agora)).toBe('não expira');
    expect(quandoExpira('2026-09-25T12:20:00Z', agora)).toBe('expira em 20 min');
    expect(quandoExpira('2026-09-25T18:00:00Z', agora)).toBe('expira em 6 h');
    expect(quandoExpira('2026-09-26T12:00:00Z', agora)).toBe('expira em 1 dia');
    expect(quandoExpira('2026-10-02T12:00:00Z', agora)).toBe('expira em 7 dias');
    expect(quandoExpira('2026-09-25T11:59:00Z', agora)).toBe('expirado');
  });

  it('usos com e sem limite', () => {
    expect(descreverUsos({ maxUses: 5, uses: 3 })).toBe('3 de 5 usos');
    expect(descreverUsos({ maxUses: 1, uses: 0 })).toBe('0 de 1 uso');
    expect(descreverUsos({ maxUses: 0, uses: 1 })).toBe('1 uso');
  });
});

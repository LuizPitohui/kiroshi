/**
 * Conta sem senha nao aceita senha nenhuma.
 *
 * Quando a senha virou opcional no banco — para quem cria conta pelo Google —
 * apareceu um jeito novo de errar: tratar o nulo como "senha vazia", que
 * qualquer comparacao frouxa aceitaria. Seria uma porta aberta em toda conta
 * criada pelo Google.
 *
 * Nao e teste de hipotese: o compilador apontou CINCO lugares que conferiam
 * senha assumindo que ela existe, e bastava um deles tratar o nulo errado.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

describe('verifyPassword sem senha cadastrada', () => {
  it('nenhuma senha confere quando nao ha hash', async () => {
    for (const tentativa of ['', ' ', 'senha', 'null', 'undefined', '0']) {
      expect(await verifyPassword(null, tentativa), JSON.stringify(tentativa)).toBe(false);
    }
  });

  it('nem a string vazia, que e a armadilha obvia', async () => {
    expect(await verifyPassword(null, '')).toBe(false);
  });

  it('hash vazio conta como sem senha, nao como senha vazia', async () => {
    expect(await verifyPassword('', '')).toBe(false);
  });
});

describe('verifyPassword com senha cadastrada', () => {
  it('a senha certa confere', async () => {
    const hash = await hashPassword('umaSenhaQualquer123');
    expect(await verifyPassword(hash, 'umaSenhaQualquer123')).toBe(true);
  });

  it('a errada nao', async () => {
    const hash = await hashPassword('umaSenhaQualquer123');
    expect(await verifyPassword(hash, 'umaSenhaQualquer124')).toBe(false);
  });

  it('hash corrompido nao derruba, so reprova', async () => {
    expect(await verifyPassword('isto nao e um hash', 'seja la o que for')).toBe(false);
  });
});

describe('needsRehash', () => {
  it('conta sem senha nao tem o que refazer', () => {
    expect(needsRehash(null)).toBe(false);
  });

  it('hash recem-criado esta em dia', async () => {
    expect(needsRehash(await hashPassword('umaSenhaQualquer123'))).toBe(false);
  });

  it('formato desconhecido pede troca', () => {
    expect(needsRehash('isto nao e um hash')).toBe(true);
  });
});

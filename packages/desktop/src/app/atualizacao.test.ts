import { describe, expect, it } from 'vitest';
import { deveReiniciarAgora, prontaParaReiniciar } from './atualizacao.js';

describe('aviso de versao nova', () => {
  it('so a versao baixada conta como pronta (baixando, procurando e erro nao)', () => {
    const com = (fase: 'ocioso' | 'procurando' | 'baixando' | 'pronta' | 'erro') => ({ fase, versao: '2.0.9', progresso: 0, erro: null });
    expect(prontaParaReiniciar(com('pronta'))).toBe(true);
    for (const fase of ['ocioso', 'procurando', 'baixando', 'erro'] as const) expect(prontaParaReiniciar(com(fase))).toBe(false);
    expect(prontaParaReiniciar(null)).toBe(false);
  });

  it('"quando eu sair da chamada": reinicia so fora da chamada', () => {
    expect(deveReiniciarAgora(true, true, true)).toBe(false);
    expect(deveReiniciarAgora(true, true, false)).toBe(true);
  });

  it('sem o pedido, ou sem versao pronta, nunca reinicia sozinho', () => {
    expect(deveReiniciarAgora(true, false, false)).toBe(false);
    expect(deveReiniciarAgora(false, true, false)).toBe(false);
  });
});

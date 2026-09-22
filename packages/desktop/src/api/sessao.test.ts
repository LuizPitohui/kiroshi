/**
 * O que derruba um login e o que nao derruba.
 */
import { describe, it, expect } from 'vitest';
import { sessaoMorreu, servidorIndisponivel } from './sessao.js';

describe('sessaoMorreu', () => {
  it('401 e sessao morta: o token nao vale mais', () => {
    expect(sessaoMorreu(401)).toBe(true);
  });

  it('403 tambem: a conta perdeu o direito', () => {
    expect(sessaoMorreu(403)).toBe(true);
  });

  /*
    O teste que teria evitado o problema de hoje. Cada um destes ja derrubou,
    ou derrubaria, um login perfeitamente valido.
  */
  it('reinicio do servidor NAO derruba o login', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(sessaoMorreu(status)).toBe(false);
    }
  });

  it('excesso de pedidos NAO derruba o login', () => {
    expect(sessaoMorreu(429)).toBe(false);
  });

  it('nem respostas de sucesso, obviamente', () => {
    for (const status of [200, 201, 204]) {
      expect(sessaoMorreu(status)).toBe(false);
    }
  });

  it('um pedido malformado nao e sessao morta', () => {
    expect(sessaoMorreu(400)).toBe(false);
    expect(sessaoMorreu(404)).toBe(false);
  });
});

describe('servidorIndisponivel', () => {
  it('reconhece o tunel reconectando e o servidor subindo', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(servidorIndisponivel(status)).toBe(true);
    }
  });

  it('e o freio por excesso de pedidos', () => {
    expect(servidorIndisponivel(429)).toBe(true);
  });

  it('mas nao confunde com recusa de identidade', () => {
    expect(servidorIndisponivel(401)).toBe(false);
    expect(servidorIndisponivel(403)).toBe(false);
  });
});

describe('as duas condicoes nunca valem ao mesmo tempo', () => {
  it('nenhum status e "morta" e "indisponivel" de uma vez', () => {
    for (let s = 100; s < 600; s++) {
      expect(sessaoMorreu(s) && servidorIndisponivel(s)).toBe(false);
    }
  });
});

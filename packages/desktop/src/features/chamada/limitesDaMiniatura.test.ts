import { describe, expect, it } from 'vitest';
import { caracteristicasDaJanela, limitesIniciais, limitesValidos, TAMANHO_PADRAO } from './limitesDaMiniatura.js';

const APP = { x: 100, y: 50, largura: 1280, altura: 800 };

describe('onde a miniatura flutuante abre', () => {
  it('sem nada salvo: no canto de baixo a direita do app, 16:9', () => {
    expect(limitesIniciais(null, APP)).toEqual({ x: 100 + 1280 - 384 - 24, y: 50 + 800 - 216 - 96, largura: 384, altura: 216 });
    expect(TAMANHO_PADRAO.largura / TAMANHO_PADRAO.altura).toBeCloseTo(16 / 9, 5);
  });

  it('onde a pessoa deixou, inclusive em outro monitor (coordenada negativa)', () => {
    const salvos = { x: -1700, y: 300, largura: 640, altura: 360 };
    expect(limitesIniciais(salvos, APP)).toEqual(salvos);
  });

  it('salvo quebrado ou pequeno demais: volta ao canto', () => {
    for (const ruim of [{}, 'x', { x: 1, y: 2, largura: 100, altura: 50 }, { x: NaN, y: 0, largura: 400, altura: 225 }]) {
      expect(limitesValidos(ruim)).toBe(false);
      expect(limitesIniciais(ruim, APP).largura).toBe(384);
    }
  });

  it('arredonda (a escala do Windows da posicao fracionada)', () => {
    expect(limitesIniciais({ x: 10.6, y: 20.2, largura: 400.4, altura: 225.5 }, APP)).toEqual({ x: 11, y: 20, largura: 400, altura: 226 });
  });

  it('caracteristicas no formato do window.open', () => {
    expect(caracteristicasDaJanela({ x: 1, y: 2, largura: 384, altura: 216 })).toBe('left=1,top=2,width=384,height=216');
  });
});

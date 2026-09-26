import { describe, expect, it } from 'vitest';
import { limitesDentroDaArea, opcoesDoMiniPalco } from './miniPalco.js';

const TELA = { x: 0, y: 0, width: 1920, height: 1040 };

describe('janela do mini palco', () => {
  it('dentro da tela fica onde a pessoa deixou', () => {
    const j = { x: 1500, y: 800, width: 384, height: 216 };
    expect(limitesDentroDaArea(j, TELA)).toEqual(j);
  });

  it('arrastada para fora pela direita e por baixo volta inteira para dentro', () => {
    expect(limitesDentroDaArea({ x: 1800, y: 1000, width: 384, height: 216 }, TELA)).toEqual({ x: 1536, y: 824, width: 384, height: 216 });
  });

  it('num monitor que sumiu (coordenada negativa) volta para a tela que sobrou', () => {
    expect(limitesDentroDaArea({ x: -1500, y: -300, width: 384, height: 216 }, TELA)).toEqual({ x: 0, y: 0, width: 384, height: 216 });
  });

  it('segundo monitor a direita: respeita a origem dele', () => {
    const segundo = { x: 1920, y: 0, width: 1280, height: 984 };
    expect(limitesDentroDaArea({ x: 3100, y: 900, width: 320, height: 180 }, segundo)).toEqual({ x: 2880, y: 804, width: 320, height: 180 });
  });

  it('maior que a tela encolhe para caber', () => {
    expect(limitesDentroDaArea({ x: 100, y: 100, width: 4000, height: 3000 }, TELA)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('a janela: sem moldura, redimensionavel, sempre por cima, fora da barra, sem roubar foco', () => {
    const o = opcoesDoMiniPalco('icone.png');
    expect(o).toMatchObject({
      frame: false,
      resizable: true,
      thickFrame: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      minimizable: false,
      maximizable: false,
    });
    expect((o.minWidth ?? 0) / (o.minHeight ?? 1)).toBeCloseTo(16 / 9, 2);
  });
});

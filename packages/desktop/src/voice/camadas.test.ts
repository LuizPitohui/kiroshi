import { describe, expect, it } from 'vitest';
import { camadasDesalinhadas, qualidadeDoRid, type CodecPedido } from './camadas.js';

const ordem = (baixa: boolean, media: boolean, alta: boolean): CodecPedido[] => [
  {
    codec: 'vp8',
    qualities: [
      { quality: 0, enabled: baixa },
      { quality: 1, enabled: media },
      { quality: 2, enabled: alta },
    ],
  },
];
const saindo = (q: boolean, h: boolean, f: boolean) => [
  { rid: 'q', active: q },
  { rid: 'h', active: h },
  { rid: 'f', active: f },
];

describe('camadas de envio contra a ordem do servidor', () => {
  it('rid do LiveKit: q baixa, h media, f alta; sem rid e a baixa', () => {
    expect([qualidadeDoRid('q'), qualidadeDoRid('h'), qualidadeDoRid('f'), qualidadeDoRid(undefined)]).toEqual([0, 1, 2, 0]);
  });

  it('o caso medido: ninguem assiste, e a renegociacao religou as tres', () => {
    expect(camadasDesalinhadas('vp8', ordem(false, false, false), saindo(true, true, true))).toBe(true);
  });

  it('ninguem assiste e esta tudo pausado: nada a fazer', () => {
    expect(camadasDesalinhadas('vp8', ordem(false, false, false), saindo(false, false, false))).toBe(false);
  });

  it('alguem assiste na media: baixa e media ligadas, alta pausada, concorda', () => {
    expect(camadasDesalinhadas('vp8', ordem(true, true, false), saindo(true, true, false))).toBe(false);
  });

  it('a alta religada sozinha tambem discorda', () => {
    expect(camadasDesalinhadas('vp8', ordem(true, true, false), saindo(true, true, true))).toBe(true);
  });

  it('camada que o servidor quer e esta desligada tambem discorda (reaplicar liga)', () => {
    expect(camadasDesalinhadas('vp8', ordem(true, true, true), saindo(true, true, false))).toBe(true);
  });

  it('active ausente vale ligado', () => {
    expect(camadasDesalinhadas('vp8', ordem(false, false, false), [{ rid: 'q' }, { rid: 'h' }, { rid: 'f' }])).toBe(true);
  });

  it('sem ordem do servidor ainda: nao mexe', () => {
    expect(camadasDesalinhadas('vp8', undefined, saindo(true, true, true))).toBe(false);
    expect(camadasDesalinhadas(undefined, ordem(false, false, false), saindo(true, true, true))).toBe(false);
  });

  it('ordem de outro codec (reserva): nao mexe', () => {
    const av1: CodecPedido[] = [{ codec: 'av1', qualities: [{ quality: 0, enabled: false }] }];
    expect(camadasDesalinhadas('vp8', av1, saindo(true, true, true))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { registrarAmostra, resumoEnviado, resumoRecebido, rotuloDaBanda, rotuloDaImagem, somarJanela } from './medicao.js';
import type { CamadaEnviada, VideoRecebido } from '../../voice/metricas.js';

describe('rotulos', () => {
  it('imagem e banda como o quadro escreve', () => {
    expect(rotuloDaImagem(1080, 59.7)).toBe('1080p · 60 fps');
    expect(rotuloDaImagem(720, null)).toBe('720p');
    expect(rotuloDaImagem(null, 30)).toBeNull();
    expect(rotuloDaBanda(7_800_000)).toBe('7,8 Mbps');
    expect(rotuloDaBanda(640_000)).toBe('640 kbps');
    expect(rotuloDaBanda(0)).toBeNull();
  });
});

describe('janela de travadas', () => {
  it('soma so os ultimos 30 s', () => {
    let a = registrarAmostra([], { em: 0, travadas: 2, segundos: 0.4 });
    a = registrarAmostra(a, { em: 10_000, travadas: 1, segundos: 0.2 });
    expect(somarJanela(a)).toEqual({ travadas: 3, segundos: 0.6 });
    a = registrarAmostra(a, { em: 31_000, travadas: 0, segundos: 0 });
    expect(somarJanela(a)).toEqual({ travadas: 1, segundos: 0.2 });
  });
});

const recebido = (parte: Partial<VideoRecebido> = {}): VideoRecebido => ({
  largura: 1920,
  altura: 1080,
  fps: 60,
  bitrate: 7_800_000,
  travadas: 0,
  segundosTravado: 0,
  quadrosDescartados: 0,
  perda: 0,
  jitterMs: 5,
  atrasoDeBufferMs: 40,
  decodificador: null,
  ...parte,
});

describe('resumoRecebido', () => {
  it('estavel: imagem, banda e nenhuma travada', () => {
    expect(resumoRecebido(recebido(), { travadas: 0 })).toEqual({ imagem: '1080p · 60 fps', banda: '7,8 Mbps', travadas: 0, instavel: false });
  });

  it('instavel quando travou na janela ou perdeu mais de 2% no intervalo', () => {
    expect(resumoRecebido(recebido(), { travadas: 1 })?.instavel).toBe(true);
    expect(resumoRecebido(recebido({ perda: 0.05 }), { travadas: 0 })?.instavel).toBe(true);
  });

  it('sem video, nada', () => {
    expect(resumoRecebido(null, { travadas: 0 })).toBeNull();
  });
});

const camada = (altura: number, fps: number, bitrate: number, limitacao: CamadaEnviada['limitacao'] = 'nenhuma'): CamadaEnviada => ({
  rid: null,
  largura: null,
  altura,
  fps,
  bitrate,
  limitacao,
  msPorQuadro: null,
  pedidosDeQuadroChave: null,
  reenvios: null,
  codificador: null,
});

describe('resumoEnviado', () => {
  it('o topo que sai e a soma de todas as camadas', () => {
    expect(resumoEnviado([camada(360, 30, 500_000), camada(720, 30, 1_800_000), camada(1080, 60, 5_500_000)])).toEqual({
      imagem: '1080p · 60 fps',
      banda: '7,8 Mbps',
      limitacao: null,
    });
  });

  it('diz quando o codificador esta preso por CPU ou banda', () => {
    expect(resumoEnviado([camada(360, 15, 500_000), camada(1080, 24, 4_000_000, 'cpu')])?.limitacao).toBe('cpu');
  });

  it('sem camadas vivas, nada', () => {
    expect(resumoEnviado([])).toBeNull();
  });
});

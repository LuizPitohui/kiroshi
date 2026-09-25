import { describe, expect, it } from 'vitest';
import {
  diagnosticarEnvio,
  diagnosticarRecebimento,
  resumirEnvio,
  resumirRecebimento,
  type EntradaDeStats,
  type VideoRecebido,
} from './metricas.js';

// Relatorios no formato que o Chromium entrega (so os campos que usamos).
function camada(id: string, rid: string, altura: number, extra: Record<string, unknown>): EntradaDeStats {
  return {
    id,
    timestamp: 0,
    type: 'outbound-rtp',
    kind: 'video',
    rid,
    frameWidth: Math.round((altura * 16) / 9),
    frameHeight: altura,
    framesPerSecond: 30,
    encoderImplementation: 'libvpx',
    qualityLimitationReason: 'none',
    ...extra,
  } as EntradaDeStats;
}

describe('resumirEnvio', () => {
  const antes = [
    camada('o1', 'f', 1080, { timestamp: 1000, bytesSent: 0, framesEncoded: 0, totalEncodeTime: 0, pliCount: 2, nackCount: 10 }),
    camada('o2', 'q', 360, { timestamp: 1000, bytesSent: 0, framesEncoded: 0, totalEncodeTime: 0, pliCount: 0, nackCount: 0 }),
  ];
  const depois = [
    camada('o1', 'f', 1080, {
      timestamp: 3000,
      bytesSent: 1_000_000, // 1 MB em 2 s = 4 Mbps
      framesEncoded: 60,
      totalEncodeTime: 0.6, // 10 ms por quadro
      pliCount: 5,
      nackCount: 14,
      qualityLimitationReason: 'bandwidth',
    }),
    camada('o2', 'q', 360, { timestamp: 3000, bytesSent: 125_000, framesEncoded: 30, totalEncodeTime: 0.06, pliCount: 0, nackCount: 0 }),
    { id: 'a1', type: 'outbound-rtp', kind: 'audio', timestamp: 3000 } as EntradaDeStats,
    { id: 'c1', type: 'candidate-pair', timestamp: 3000 } as EntradaDeStats,
  ];

  it('ordena da menor para a maior e ignora audio e o resto do relatorio', () => {
    const camadas = resumirEnvio(depois, antes);
    expect(camadas.map((c) => c.rid)).toEqual(['q', 'f']);
  });

  it('calcula taxa, custo por quadro e pedidos pela diferenca entre amostras', () => {
    const topo = resumirEnvio(depois, antes).find((c) => c.rid === 'f');
    expect(topo).toMatchObject({
      altura: 1080,
      bitrate: 4_000_000,
      msPorQuadro: 10,
      pedidosDeQuadroChave: 3,
      reenvios: 4,
      limitacao: 'banda',
      codificador: 'libvpx',
    });
  });

  it('primeira amostra: estado sim, ritmo nao', () => {
    const [baixa] = resumirEnvio(antes, null);
    expect(baixa?.altura).toBe(360);
    expect(baixa?.bitrate).toBeNull();
    expect(baixa?.pedidosDeQuadroChave).toBeNull();
  });

  it('contador que voltou (faixa republicada) nao vira numero negativo', () => {
    const reiniciado = [camada('o1', 'f', 1080, { timestamp: 5000, bytesSent: 10, pliCount: 0 })];
    const [topo] = resumirEnvio(reiniciado, depois);
    expect(topo?.bitrate).toBeNull();
    expect(topo?.pedidosDeQuadroChave).toBeNull();
  });
});

describe('resumirRecebimento', () => {
  const base = {
    id: 'i1',
    type: 'inbound-rtp',
    kind: 'video',
    frameWidth: 640,
    frameHeight: 360,
    framesPerSecond: 15,
    decoderImplementation: 'libvpx',
  };
  const antes = { ...base, timestamp: 0, bytesReceived: 0, freezeCount: 1, totalFreezesDuration: 0.5, framesDropped: 2, packetsReceived: 1000, packetsLost: 10 } as EntradaDeStats;
  const depois = {
    ...base,
    timestamp: 1000,
    bytesReceived: 62_500, // 500 kbps
    freezeCount: 3,
    totalFreezesDuration: 1.7,
    framesDropped: 5,
    packetsReceived: 1950,
    packetsLost: 60, // 50 perdidos de 1000 no intervalo = 5%
    jitter: 0.012,
    jitterBufferDelay: 12,
    jitterBufferEmittedCount: 300,
  } as EntradaDeStats;

  it('mostra a camada que chegou e o que aconteceu no intervalo', () => {
    const video = resumirRecebimento([depois], [antes]);
    expect(video).toMatchObject({
      altura: 360,
      fps: 15,
      bitrate: 500_000,
      travadas: 2,
      quadrosDescartados: 3,
      jitterMs: 12,
      atrasoDeBufferMs: 40,
    });
    expect(video?.segundosTravado).toBeCloseTo(1.2);
    expect(video?.perda).toBeCloseTo(0.05);
  });

  it('sem inbound-rtp de video ainda: null, e nao um diagnostico inventado', () => {
    expect(resumirRecebimento([{ id: 'x', type: 'transport', timestamp: 0 } as EntradaDeStats], null)).toBeNull();
  });
});

describe('diagnosticos', () => {
  const liso: VideoRecebido = {
    largura: 1920, altura: 1080, fps: 60, bitrate: 7_800_000, travadas: 0, segundosTravado: 0,
    quadrosDescartados: 0, perda: 0, jitterMs: 4, atrasoDeBufferMs: 30, decodificador: 'libvpx',
  };

  it('transmissao lisa nao tem o que dizer', () => {
    expect(diagnosticarRecebimento(liso, 60)).toEqual({ veredito: 'boa', motivos: [] });
  });

  it('travada longa e perda alta sao ruins, com o motivo em portugues', () => {
    const d = diagnosticarRecebimento({ ...liso, travadas: 1, segundosTravado: 2, perda: 0.08 }, 60);
    expect(d.veredito).toBe('ruim');
    expect(d.motivos).toContain('a imagem travou no último intervalo');
    expect(d.motivos.some((m) => m.includes('8%'))).toBe(true);
  });

  it('fps bem abaixo do escolhido e instavel', () => {
    expect(diagnosticarRecebimento({ ...liso, fps: 15 }, 60).veredito).toBe('instavel');
  });

  it('do lado de quem envia: CPU e banda viram frase; quadro mais lento que o ritmo e ruim', () => {
    const base = { rid: 'f', largura: 1920, altura: 1080, fps: 60, bitrate: 8e6, pedidosDeQuadroChave: 0, reenvios: 0, codificador: 'libvpx' };
    expect(diagnosticarEnvio([{ ...base, limitacao: 'cpu', msPorQuadro: 9 }]).motivos[0]).toMatch(/processador/);
    expect(diagnosticarEnvio([{ ...base, limitacao: 'nenhuma', msPorQuadro: 22 }]).veredito).toBe('ruim');
    expect(diagnosticarEnvio([{ ...base, limitacao: 'nenhuma', msPorQuadro: 9 }]).veredito).toBe('boa');
  });
});

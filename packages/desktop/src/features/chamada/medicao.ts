/**
 * O que o quadro da transmissao escreve sobre a qualidade, a partir das
 * metricas (`voice/metricas.ts`). Puro e testado: e o numero que responde "ta
 * travando?" — errar aqui e voltar ao palpite.
 */
import type { CamadaEnviada, VideoRecebido } from '../../voice/metricas.js';

/** "1080p · 60 fps", ou null enquanto nao ha medida. */
export function rotuloDaImagem(altura: number | null, fps: number | null): string | null {
  if (!altura) return null;
  const p = `${Math.round(altura)}p`;
  return fps ? `${p} · ${Math.round(fps)} fps` : p;
}

/** "7,8 Mbps" / "640 kbps". */
export function rotuloDaBanda(bps: number | null): string | null {
  if (bps === null || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1).replace('.', ',')} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export interface AmostraDeTravada {
  /** Momento da amostra, em ms. */
  em: number;
  /** Travadas no intervalo desta amostra. */
  travadas: number;
  /** Segundos travado no intervalo desta amostra. */
  segundos: number;
}

/** Janela das travadas mostradas no quadro: "2 travadas nos últimos 30 s". */
export const JANELA_DE_TRAVADAS_MS = 30_000;

/** Guarda a amostra nova e descarta o que saiu da janela. */
export function registrarAmostra(amostras: readonly AmostraDeTravada[], nova: AmostraDeTravada, janelaMs = JANELA_DE_TRAVADAS_MS): AmostraDeTravada[] {
  return [...amostras, nova].filter((a) => nova.em - a.em < janelaMs);
}

export function somarJanela(amostras: readonly AmostraDeTravada[]): { travadas: number; segundos: number } {
  let travadas = 0;
  let segundos = 0;
  for (const a of amostras) {
    travadas += a.travadas;
    segundos += a.segundos;
  }
  return { travadas, segundos: Math.round(segundos * 10) / 10 };
}

export interface ResumoRecebido {
  imagem: string | null;
  banda: string | null;
  /** Travadas nos ultimos 30 s (0 = nenhuma). */
  travadas: number;
  /** Instavel: travou na janela, ou perdeu pacote no ultimo intervalo. */
  instavel: boolean;
}

export function resumoRecebido(video: VideoRecebido | null, janela: { travadas: number }): ResumoRecebido | null {
  if (!video) return null;
  return {
    imagem: rotuloDaImagem(video.altura, video.fps),
    banda: rotuloDaBanda(video.bitrate),
    travadas: janela.travadas,
    instavel: janela.travadas > 0 || (video.perda ?? 0) > 0.02,
  };
}

export interface ResumoEnviado {
  imagem: string | null;
  banda: string | null;
  /** Por que o codificador esta segurando: CPU ou banda. */
  limitacao: 'cpu' | 'banda' | null;
}

/** A camada de topo que esta saindo, e a soma da banda de todas. */
export function resumoEnviado(camadas: readonly CamadaEnviada[]): ResumoEnviado | null {
  const vivas = camadas.filter((c) => c.altura);
  const topo = vivas[vivas.length - 1];
  if (!topo) return null;
  const soma = camadas.reduce((t, c) => t + (c.bitrate ?? 0), 0);
  const limitada = camadas.find((c) => c.limitacao === 'cpu' || c.limitacao === 'banda');
  return {
    imagem: rotuloDaImagem(topo.altura, topo.fps),
    banda: rotuloDaBanda(soma || null),
    limitacao: limitada ? (limitada.limitacao as 'cpu' | 'banda') : null,
  };
}

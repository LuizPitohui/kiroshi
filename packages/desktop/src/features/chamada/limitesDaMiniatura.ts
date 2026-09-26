/**
 * Onde a miniatura flutuante da chamada abre: onde a pessoa a deixou da ultima
 * vez, ou no canto de baixo a direita da janela do app (onde ela ficava quando
 * era presa ao app). Se o monitor daquela posicao sumiu, o processo principal
 * a traz para dentro da tela (`electron/miniPalco.ts`).
 */

export interface Limites {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** No armazenamento da pessoa: so conveniencia, sem ele abre no canto. */
export const CHAVE_DOS_LIMITES = 'kiroshi.miniPalco';

/** 16:9, como a proporcao que o processo principal trava. */
export const TAMANHO_PADRAO = { largura: 384, altura: 216 } as const;

/** O menor tamanho que a janela aceita (o mesmo `minWidth`/`minHeight` do processo principal). */
const MENOR = { largura: 256, altura: 144 } as const;

function numero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function limitesValidos(v: unknown): v is Limites {
  if (!v || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  return numero(l.x) && numero(l.y) && numero(l.largura) && numero(l.altura) && l.largura >= MENOR.largura && l.altura >= MENOR.altura;
}

/** `app`: a janela principal agora (posicao e tamanho por fora). */
export function limitesIniciais(salvos: unknown, app: Limites): Limites {
  if (limitesValidos(salvos)) {
    return { x: Math.round(salvos.x), y: Math.round(salvos.y), largura: Math.round(salvos.largura), altura: Math.round(salvos.altura) };
  }
  // Acima da barra de mensagem e dos controles, como a miniatura presa ao app.
  return {
    x: Math.round(app.x + app.largura - TAMANHO_PADRAO.largura - 24),
    y: Math.round(app.y + app.altura - TAMANHO_PADRAO.altura - 96),
    largura: TAMANHO_PADRAO.largura,
    altura: TAMANHO_PADRAO.altura,
  };
}

/** O terceiro argumento do `window.open`: o Electron le posicao e tamanho daqui. */
export function caracteristicasDaJanela(l: Limites): string {
  return `left=${l.x},top=${l.y},width=${l.largura},height=${l.altura}`;
}

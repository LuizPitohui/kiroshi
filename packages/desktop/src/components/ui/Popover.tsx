import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useCamada } from './sobreposicao.js';

/**
 * Balao: um painel pequeno ancorado a um botao.
 *
 * Menu do servidor, seletor de status, lista de emoji. Fica em portal e se
 * posiciona por coordenada de tela, e nao por `position: absolute` dentro do
 * pai — assim nao e recortado por um `overflow: hidden` de uma coluna que
 * rola, que e o que fazia o menu do servidor sumir pela metade.
 *
 * A posicao e recalculada ao abrir e ao rolar: se nao couber embaixo da
 * ancora, vai para cima; se vazar pela direita, encosta na borda. Um balao que
 * abre fora da tela e a mesma coisa que um balao que nao abriu.
 */

export interface PopoverProps {
  /** O elemento que abriu. A posicao sai da caixa dele. */
  ancora: RefObject<HTMLElement | null>;
  aberto: boolean;
  aoFechar: () => void;
  /** Alinhamento em relacao a ancora. */
  alinhamento?: 'inicio' | 'fim';
  /** Rotulo para leitor de tela, quando o conteudo nao tem titulo proprio. */
  rotulo?: string;
  children: ReactNode;
}

const FOLGA = 6;
const MARGEM_DA_TELA = 8;

export function Popover({
  ancora,
  aberto,
  aoFechar,
  alinhamento = 'inicio',
  rotulo,
  children,
}: PopoverProps) {
  const caixa = useCamada<HTMLDivElement>(aberto, aoFechar);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  /*
    `useLayoutEffect` e nao `useEffect`: a medicao precisa acontecer antes do
    navegador pintar. Com o efeito normal o balao aparece um quadro no canto
    superior esquerdo e so entao pula para o lugar certo — um piscar visivel.
  */
  useLayoutEffect(() => {
    if (!aberto) return;

    const posicionar = (): void => {
      const base = ancora.current?.getBoundingClientRect();
      const propria = caixa.current?.getBoundingClientRect();
      if (!base || !propria) return;

      let top = base.bottom + FOLGA;
      // Nao cabe embaixo: vira para cima da ancora.
      if (top + propria.height > window.innerHeight - MARGEM_DA_TELA) {
        top = Math.max(MARGEM_DA_TELA, base.top - propria.height - FOLGA);
      }

      let left = alinhamento === 'fim' ? base.right - propria.width : base.left;
      // Encosta na borda em vez de vazar.
      left = Math.min(left, window.innerWidth - propria.width - MARGEM_DA_TELA);
      left = Math.max(MARGEM_DA_TELA, left);

      setPosicao({ top, left });
    };

    posicionar();
    window.addEventListener('resize', posicionar);
    // `true` para capturar rolagem de qualquer coluna, nao so da janela.
    window.addEventListener('scroll', posicionar, true);
    return () => {
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('scroll', posicionar, true);
    };
  }, [aberto, ancora, alinhamento, caixa]);

  if (!aberto) return null;

  return createPortal(
    <div
      ref={caixa}
      className="balao"
      role="dialog"
      aria-label={rotulo}
      tabIndex={-1}
      style={{
        top: posicao?.top ?? 0,
        left: posicao?.left ?? 0,
        // Invisivel ate ter medida: o primeiro render existe so para o
        // navegador poder medir a caixa.
        visibility: posicao ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

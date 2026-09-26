import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CHAVE_DOS_LIMITES, caracteristicasDaJanela, limitesIniciais, type Limites } from './limitesDaMiniatura.js';

/**
 * Uma janela propria do Windows desenhada pelo React daqui (portal).
 *
 * Existe para a miniatura da chamada andar pelo computador inteiro, por cima
 * de outros programas, com o app minimizado (pedido do dono em 2026-09-26).
 * O processo principal da o feitio da janela — sem moldura, sempre por cima,
 * 16:9 — pelo nome (`electron/miniPalco.ts`).
 *
 * Tudo roda no processo e no JavaScript do app: a janela nova e so um
 * documento em branco onde o portal desenha. Por isso os estilos do app sao
 * copiados para la, e medidas e eventos usam o `window` DELA (quem esta em
 * outra janela nao aparece para o ResizeObserver e o IntersectionObserver
 * daqui).
 */

/** Prefixo do nome no processo principal (`NOME_DA_JANELA_DO_MINI_PALCO`). */
const NOME_DA_JANELA = 'kiroshi-mini-palco';

function lerSalvos(): unknown {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_DOS_LIMITES) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Onde a janela esta agora, para abrir ali da proxima vez. `posicao` quando
 * quem chama sabe melhor (o fim de um arraste, antes de a janela informar).
 */
export function guardarLimites(janela: Window, posicao?: { x: number; y: number }): void {
  if (janela.closed) return;
  const l: Limites = {
    x: posicao?.x ?? janela.screenX,
    y: posicao?.y ?? janela.screenY,
    largura: janela.outerWidth,
    altura: janela.outerHeight,
  };
  try {
    localStorage.setItem(CHAVE_DOS_LIMITES, JSON.stringify(l));
  } catch {
    // Sem armazenamento: da proxima vez abre no canto.
  }
}

/** Os estilos e os atributos do app na janela nova: sem eles, nenhuma classe vale la. */
function vestir(janela: Window, titulo: string): void {
  const doc = janela.document;
  doc.title = titulo;
  for (const no of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    const copia = doc.importNode(no, true) as HTMLElement;
    // O documento novo e `about:blank`: endereco relativo vira absoluto.
    if (no.tagName === 'LINK') copia.setAttribute('href', (no as HTMLLinkElement).href);
    doc.head.appendChild(copia);
  }
  // Tema e preferencias (movimento, escala...) moram em atributos do <html>.
  for (const a of Array.from(document.documentElement.attributes)) doc.documentElement.setAttribute(a.name, a.value);
  doc.body.className = document.body.className;
  doc.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
}

interface Props {
  titulo: string;
  /** A pessoa fechou pela janela do sistema (Alt+F4, barra de tarefas). */
  aoSerFechada: () => void;
  children: (janela: Window) => ReactNode;
}

export function JanelaFlutuante({ titulo, aoSerFechada, children }: Props): ReactNode {
  const [janela, setJanela] = useState<Window | null>(null);
  const aoSerFechadaAgora = useRef(aoSerFechada);
  const tituloAgora = useRef(titulo);
  useEffect(() => {
    aoSerFechadaAgora.current = aoSerFechada;
    tituloAgora.current = titulo;
  });

  useEffect(() => {
    const limites = limitesIniciais(lerSalvos(), {
      x: window.screenX,
      y: window.screenY,
      largura: window.outerWidth,
      altura: window.outerHeight,
    });
    // Nome novo a cada vez: com o mesmo nome, o navegador devolveria a janela
    // anterior ainda fechando.
    const aberta = window.open('', `${NOME_DA_JANELA}-${Date.now()}`, caracteristicasDaJanela(limites));
    if (!aberta) return;
    vestir(aberta, tituloAgora.current);
    setJanela(aberta);

    let saindo = false;
    // Janela fechada por fora do app nao avisa ninguem: confere.
    const vigia = window.setInterval(() => {
      if (!aberta.closed || saindo) return;
      window.clearInterval(vigia);
      setJanela(null);
      aoSerFechadaAgora.current();
    }, 400);
    const guardar = () => guardarLimites(aberta);
    aberta.addEventListener('resize', guardar);

    return () => {
      saindo = true;
      window.clearInterval(vigia);
      if (!aberta.closed) {
        guardarLimites(aberta);
        aberta.close();
      }
      setJanela(null);
    };
  }, []);

  useEffect(() => {
    if (janela && !janela.closed) janela.document.title = titulo;
  }, [janela, titulo]);

  return janela && !janela.closed ? createPortal(children(janela), janela.document.body) : null;
}

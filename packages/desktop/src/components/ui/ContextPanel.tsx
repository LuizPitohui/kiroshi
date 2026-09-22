import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Close } from '../Icons.js';

/**
 * A coluna da direita: membros, conversa da chamada, detalhes.
 *
 * Duas regras da especificacao vivem aqui.
 *
 * A primeira: o painel NAO deve ficar aberto por obrigacao, e a area principal
 * nunca deve ser comprimida por ele. Por isso ele fecha, e por isso a largura
 * tem teto — nao da para arrastar ate engolir a conversa.
 *
 * A segunda: a largura escolhida e guardada. Quem alargou a conversa da
 * chamada para caber uma linha inteira nao quer refazer isso a cada vez que
 * entra num canal.
 *
 * O redimensionamento funciona por mouse e por TECLADO. As setas na alca
 * movem de 16 em 16px, porque um painel que so se ajusta arrastando esta
 * fechado para quem nao usa mouse.
 */

export interface ContextPanelProps {
  titulo: string;
  children: ReactNode;
  /** Chave de armazenamento da largura. Sem ela o painel nao lembra nada. */
  chave?: string;
  aoFechar?: () => void;
  larguraPadrao?: number;
  larguraMin?: number;
  larguraMax?: number;
  /** Acoes no cabecalho, antes do botao de fechar. */
  acoes?: ReactNode;
}

const PASSO_DO_TECLADO = 16;

export function ContextPanel({
  titulo,
  children,
  chave,
  aoFechar,
  larguraPadrao = 320,
  larguraMin = 260,
  larguraMax = 460,
  acoes,
}: ContextPanelProps) {
  const [largura, setLargura] = useState(() => {
    if (!chave) return larguraPadrao;
    const salva = Number(localStorage.getItem(`kiroshi.painel.${chave}`));
    return Number.isFinite(salva) && salva >= larguraMin
      ? Math.min(salva, larguraMax)
      : larguraPadrao;
  });

  const arrastando = useRef(false);
  const caixa = useRef<HTMLElement>(null);

  const guardar = useCallback(
    (valor: number) => {
      if (chave) localStorage.setItem(`kiroshi.painel.${chave}`, String(valor));
    },
    [chave],
  );

  const ajustar = useCallback(
    (valor: number) => Math.max(larguraMin, Math.min(larguraMax, valor)),
    [larguraMin, larguraMax],
  );

  useEffect(() => {
    function mover(e: MouseEvent): void {
      if (!arrastando.current) return;
      const direita = caixa.current?.getBoundingClientRect().right ?? 0;
      setLargura(ajustar(direita - e.clientX));
    }
    function soltar(): void {
      if (!arrastando.current) return;
      arrastando.current = false;
      document.body.style.cursor = '';
      // Grava so ao soltar: durante o arrasto seriam dezenas de escritas por
      // segundo em disco, sem nenhum ganho.
      setLargura((atual) => {
        guardar(atual);
        return atual;
      });
    }
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    return () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
  }, [ajustar, guardar]);

  return (
    <aside ref={caixa} className="painel" style={{ width: largura }} aria-label={titulo}>
      <div
        className="painel-alca"
        onMouseDown={() => {
          arrastando.current = true;
          document.body.style.cursor = 'ew-resize';
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          // Esquerda alarga: o painel cresce para dentro da tela.
          const novo = ajustar(
            largura + (e.key === 'ArrowLeft' ? PASSO_DO_TECLADO : -PASSO_DO_TECLADO),
          );
          setLargura(novo);
          guardar(novo);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Ajustar largura de ${titulo}`}
        aria-valuenow={largura}
        aria-valuemin={larguraMin}
        aria-valuemax={larguraMax}
        tabIndex={0}
      />

      <header className="painel-topo">
        <h2 className="painel-titulo">{titulo}</h2>
        {acoes}
        {aoFechar && (
          <button className="painel-fechar" onClick={aoFechar} aria-label={`Fechar ${titulo}`}>
            <Close size={15} />
          </button>
        )}
      </header>

      <div className="painel-corpo">{children}</div>
    </aside>
  );
}

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCamada } from './sobreposicao.js';
import { Close } from '../Icons.js';

/**
 * Gaveta: um painel que entra pela lateral, por cima do conteudo.
 *
 * E a forma que as colunas laterais assumem quando a janela fica estreita. Em
 * 1440px a lista de membros e uma coluna ao lado; abaixo de 1024px ela vira
 * gaveta, porque espremer tres colunas em uma tela pequena deixa a conversa —
 * que e o conteudo — com menos espaco do que os paineis auxiliares.
 *
 * Fecha ao clicar fora, ao contrario do dialogo: gaveta mostra informacao, nao
 * segura formulario preenchido.
 */

export interface DrawerProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  /** De qual borda entra. O padrao e a direita, onde ficam os paineis. */
  lado?: 'esquerda' | 'direita';
  largura?: number;
  children: ReactNode;
}

export function Drawer({
  aberto,
  aoFechar,
  titulo,
  lado = 'direita',
  largura = 320,
  children,
}: DrawerProps) {
  const caixa = useCamada<HTMLDivElement>(aberto, aoFechar);

  if (!aberto) return null;

  return createPortal(
    <div className="camada-fundo camada-fundo-lateral">
      <aside
        ref={caixa}
        className={`gaveta gaveta-${lado}`}
        style={{ width: largura }}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
      >
        <header className="gaveta-topo">
          <h2 className="gaveta-titulo">{titulo}</h2>
          <button className="dialogo-fechar" onClick={aoFechar} aria-label="Fechar">
            <Close size={16} />
          </button>
        </header>
        <div className="gaveta-corpo">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

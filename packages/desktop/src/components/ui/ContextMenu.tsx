import type { ReactNode, RefObject } from 'react';
import { Popover } from './Popover.js';

/**
 * Menu de acoes, ancorado a um botao.
 *
 * E um balao com uma lista de comandos, e nao um componente novo: a mecanica
 * de abrir, posicionar, prender foco e fechar e exatamente a mesma. O que este
 * acrescenta e a semantica de menu para leitor de tela e a regra de que
 * escolher um item fecha.
 *
 * Acao destrutiva fica separada por uma linha e marcada, porque ela e a unica
 * que nao tem volta — e a distancia visual e o que evita o clique errado.
 */

export interface ItemDeMenu {
  rotulo: string;
  icone?: ReactNode;
  aoAtivar: () => void;
  desabilitado?: boolean;
  /** Explica por que esta desabilitado. Um item cinza sem motivo e um enigma. */
  motivo?: string;
  /** Apagar, sair, remover: separado do resto e em vermelho. */
  perigoso?: boolean;
}

export interface ContextMenuProps {
  ancora: RefObject<HTMLElement | null>;
  aberto: boolean;
  aoFechar: () => void;
  itens: ItemDeMenu[];
  alinhamento?: 'inicio' | 'fim';
  rotulo?: string;
}

export function ContextMenu({
  ancora,
  aberto,
  aoFechar,
  itens,
  alinhamento = 'inicio',
  rotulo = 'Acoes',
}: ContextMenuProps) {
  const comuns = itens.filter((i) => !i.perigoso);
  const perigosos = itens.filter((i) => i.perigoso);

  const linha = (item: ItemDeMenu) => (
    <button
      key={item.rotulo}
      className={`menu-item ${item.perigoso ? 'perigoso' : ''}`}
      role="menuitem"
      disabled={item.desabilitado}
      title={item.desabilitado ? item.motivo : undefined}
      onClick={() => {
        // Fecha antes de agir: se a acao abrir outra camada, o menu nao pode
        // continuar aberto por baixo dela.
        aoFechar();
        item.aoAtivar();
      }}
    >
      {item.icone && <span className="menu-icone">{item.icone}</span>}
      <span>{item.rotulo}</span>
    </button>
  );

  return (
    <Popover ancora={ancora} aberto={aberto} aoFechar={aoFechar} alinhamento={alinhamento}>
      <div className="menu" role="menu" aria-label={rotulo}>
        {comuns.map(linha)}
        {perigosos.length > 0 && comuns.length > 0 && <div className="menu-divisor" />}
        {perigosos.map(linha)}
      </div>
    </Popover>
  );
}

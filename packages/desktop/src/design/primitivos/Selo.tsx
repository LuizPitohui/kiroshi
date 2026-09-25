import type { ReactNode } from 'react';
import { cx } from './cx.js';

/** `● AO VIVO` — sempre solido e vermelho; o ponto so pulsa se o movimento deixar. */
export function SeloVivo({ grande = false, children = 'Ao vivo' }: { grande?: boolean; children?: ReactNode }): React.JSX.Element {
  return (
    <span
      className={cx(
        'k-vivo',
        grande && 'px-2.5 py-1 text-11 tracking-[0.18em] shadow-[0_0_18px_rgba(220,38,38,0.55)]',
      )}
    >
      <span className="sr-only">Transmitindo: </span>
      {children}
    </span>
  );
}

/**
 * Contador de mencoes/nao lidas: numero em caixa vermelha. Acima de 99 vira
 * "99+" — o numero exato nao ajuda ninguem a decidir nada.
 */
export function Contador({ valor, rotulo }: { valor: number; rotulo: string }): React.JSX.Element | null {
  if (valor <= 0) return null;
  return (
    <span
      aria-label={`${valor} ${rotulo}`}
      className="inline-grid h-4 min-w-4 place-items-center bg-vivo px-1 font-mono text-10 font-medium tabular-nums text-branco"
    >
      {valor > 99 ? '99+' : valor}
    </span>
  );
}

/** Cargo: ponto na cor do cargo + nome. */
export function SeloCargo({ nome, cor }: { nome: string; cor?: number | null }): React.JSX.Element {
  const hex = cor ? `#${cor.toString(16).padStart(6, '0')}` : 'var(--k-texto-3)';
  return (
    <span className="inline-flex items-center gap-1.5 border border-borda px-1.5 py-0.5 text-12 text-texto-2">
      <span aria-hidden className="size-2 rounded-full" style={{ background: hex }} />
      {nome}
    </span>
  );
}

/** Tecla de atalho, ex.: <Tecla>Ctrl</Tecla> <Tecla>K</Tecla>. */
export function Tecla({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-grid min-w-5 place-items-center border border-borda-2 px-1 font-mono text-10 uppercase tracking-[0.08em] text-texto-3">
      {children}
    </kbd>
  );
}

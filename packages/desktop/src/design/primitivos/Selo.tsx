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

/**
 * Cargo: ponto na cor do cargo + nome. A cor vem como o servidor guarda
 * (`#rrggbb`) ou como numero. Com `aoTirar`, ganha o x para tirar o cargo.
 */
export function SeloCargo({
  nome,
  cor,
  aoTirar,
}: {
  nome: string;
  cor?: number | string | null;
  aoTirar?: () => void;
}): React.JSX.Element {
  const hex = typeof cor === 'number' ? `#${cor.toString(16).padStart(6, '0')}` : (cor ?? 'var(--k-texto-3)');
  return (
    <span className="group/cargo inline-flex items-center gap-1.5 border border-borda px-1.5 py-0.5 text-12 text-texto-2">
      {aoTirar ? (
        <button
          type="button"
          onClick={aoTirar}
          aria-label={`Tirar o cargo ${nome}`}
          title={`Tirar o cargo ${nome}`}
          className="relative grid size-2.5 place-items-center rounded-full"
          style={{ background: hex }}
        >
          <span aria-hidden className="hidden text-[9px] leading-none text-preto group-hover/cargo:block group-focus-within/cargo:block">
            ×
          </span>
        </button>
      ) : (
        <span aria-hidden className="size-2 rounded-full" style={{ background: hex }} />
      )}
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

import type { ReactNode } from 'react';
import { Tooltip } from 'radix-ui';

/** Uma vez na raiz: o atraso comum faz as dicas vizinhas abrirem sem espera. */
export function ProvedorDeDicas({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  );
}

interface Props {
  texto: ReactNode;
  children: ReactNode;
  lado?: 'top' | 'right' | 'bottom' | 'left';
  /** Atalho mostrado ao lado do texto, ex.: "Ctrl K". */
  atalho?: string;
}

/**
 * Dica curta ao passar o mouse ou focar pelo teclado. Nunca e o unico lugar de
 * uma informacao: o elemento tambem tem `aria-label` (o Radix liga os dois).
 */
export function Dica({ texto, children, lado = 'top', atalho }: Props): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={lado}
          sideOffset={6}
          className="z-[var(--k-z-menu)] flex items-center gap-2 border border-borda-2 bg-elevado px-2 py-1 font-mono text-10 uppercase tracking-rotulo text-texto shadow-camada"
        >
          {texto}
          {atalho ? <span className="text-texto-3">{atalho}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

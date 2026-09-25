import type { ReactNode } from 'react';
import { Tabs } from 'radix-ui';

export interface Aba {
  valor: string;
  rotulo: string;
  /** Numero ao lado (pedidos pendentes, por exemplo). */
  contagem?: number;
}

interface Props {
  abas: readonly Aba[];
  valor: string;
  aoMudar: (valor: string) => void;
  children: ReactNode;
  rotulo: string;
}

/** Abas em mono caixa alta; a ativa ganha a regua vermelha embaixo. Setas trocam. */
export function Abas({ abas, valor, aoMudar, children, rotulo }: Props): React.JSX.Element {
  return (
    <Tabs.Root value={valor} onValueChange={aoMudar}>
      <Tabs.List aria-label={rotulo} className="flex gap-1 border-b border-borda">
        {abas.map((aba) => (
          <Tabs.Trigger
            key={aba.valor}
            value={aba.valor}
            className="relative -mb-px flex items-center gap-2 border-b-2 border-transparente px-3 py-2 font-mono text-11 uppercase tracking-rotulo text-texto-3 hover:text-texto data-[state=active]:border-acento data-[state=active]:text-texto"
          >
            {aba.rotulo}
            {aba.contagem ? (
              <span className="min-w-4 bg-vivo px-1 text-center text-10 text-branco">{aba.contagem}</span>
            ) : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}

export const ConteudoDaAba = Tabs.Content;

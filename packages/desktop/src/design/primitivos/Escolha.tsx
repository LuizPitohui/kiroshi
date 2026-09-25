import { useId, type ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { cx } from './cx.js';

export interface OpcaoDeEscolha<T extends string> {
  valor: T;
  rotulo: string;
  descricao?: ReactNode;
}

interface Props<T extends string> {
  rotulo: string;
  valor: T;
  opcoes: readonly OpcaoDeEscolha<T>[];
  aoMudar: (valor: T) => void;
  /** Explicacao embaixo do grupo. */
  dica?: ReactNode;
}

/**
 * Uma escolha entre poucas opcoes, em cartoes lado a lado (tema, densidade,
 * movimento). Grupo de radio do Radix: setas trocam, Tab entra e sai do grupo
 * como uma parada so. A escolhida ganha a regua vermelha e a borda — forma,
 * alem da cor.
 */
export function Escolha<T extends string>({ rotulo, valor, opcoes, aoMudar, dica }: Props<T>): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <p id={id} className="mb-1.5 font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
        <span className="text-mudo">// </span>
        {rotulo}
      </p>
      <RadioGroup.Root
        aria-labelledby={id}
        value={valor}
        onValueChange={(v) => aoMudar(v as T)}
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${opcoes.length}, minmax(0, 1fr))` }}
      >
        {opcoes.map((o) => (
          <RadioGroup.Item
            key={o.valor}
            value={o.valor}
            className={cx(
              'relative border px-3 py-2.5 text-left outline-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
              'data-[state=checked]:border-acento data-[state=checked]:bg-acento-tenue data-[state=unchecked]:border-borda data-[state=unchecked]:bg-terminal data-[state=unchecked]:hover:border-borda-2',
            )}
          >
            <RadioGroup.Indicator className="absolute inset-y-0 left-0 w-0.5 bg-acento" />
            <span className="block text-14 font-medium text-texto">{o.rotulo}</span>
            {o.descricao ? <span className="mt-0.5 block text-12 text-texto-3">{o.descricao}</span> : null}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {dica ? <p className="mt-1.5 text-12 text-texto-3">{dica}</p> : null}
    </div>
  );
}

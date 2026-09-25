import { useId } from 'react';
import { Select } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';

export interface Opcao {
  valor: string;
  rotulo: string;
  /** Linha menor sob o rotulo (ex.: "padrao do Windows"). */
  detalhe?: string;
}

interface Props {
  rotulo: string;
  valor: string;
  opcoes: readonly Opcao[];
  aoMudar: (valor: string) => void;
  dica?: string;
  desativado?: boolean;
  className?: string;
}

/** Lista de escolha com o mesmo rotulo `// NOME` dos campos. */
export function Selecao({ rotulo, valor, opcoes, aoMudar, dica, desativado, className }: Props): React.JSX.Element {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
        <span className="text-mudo">// </span>
        {rotulo}
      </label>
      <Select.Root value={valor} onValueChange={aoMudar} disabled={desativado}>
        <Select.Trigger
          id={id}
          className="flex h-9 w-full items-center justify-between gap-2 border border-borda bg-terminal px-3 text-left text-14 text-texto hover:border-borda-2 focus-visible:border-acento data-[disabled]:opacity-50"
        >
          <Select.Value />
          <Select.Icon>
            <ChevronDown className="size-4 text-texto-3" strokeWidth={1.5} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-[var(--k-z-menu)] max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden border border-borda-2 bg-elevado shadow-camada"
          >
            <Select.Viewport className="p-1">
              {opcoes.map((opcao) => (
                <Select.Item
                  key={opcao.valor}
                  value={opcao.valor}
                  className="relative flex cursor-default select-none items-center gap-2 py-2 pl-8 pr-3 text-14 text-texto outline-none data-[highlighted]:bg-acento-tenue data-[highlighted]:shadow-[inset_2px_0_0_var(--k-acento)]"
                >
                  <Select.ItemIndicator className="absolute left-2.5">
                    <Check className="size-4 text-acento" strokeWidth={1.5} />
                  </Select.ItemIndicator>
                  <div>
                    <Select.ItemText>{opcao.rotulo}</Select.ItemText>
                    {opcao.detalhe ? <div className="text-12 text-texto-3">{opcao.detalhe}</div> : null}
                  </div>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {dica ? <p className="mt-1 text-12 text-texto-3">{dica}</p> : null}
    </div>
  );
}

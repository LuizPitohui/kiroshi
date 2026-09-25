import { useId, type ReactNode } from 'react';
import { Switch } from 'radix-ui';
import { cx } from './cx.js';

interface Props {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  /** Nome acessivel quando nao ha rotulo visivel ligado a ele. */
  rotulo?: string;
  id?: string;
  desativado?: boolean;
}

/**
 * Interruptor quadrado (cyberpunk nao arredonda). O estado tambem se le pela
 * posicao do quadrado, nao so pela cor.
 */
export function Interruptor({ ligado, aoMudar, rotulo, id, desativado }: Props): React.JSX.Element {
  return (
    <Switch.Root
      id={id}
      checked={ligado}
      onCheckedChange={aoMudar}
      disabled={desativado}
      aria-label={rotulo}
      className={cx(
        'relative inline-flex h-[18px] w-[34px] shrink-0 items-center border border-borda-2 bg-terminal',
        'data-[state=checked]:border-acento data-[state=checked]:bg-acento',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'animado:transition-colors animado:duration-[120ms]',
      )}
    >
      <Switch.Thumb
        className={cx(
          'block size-[12px] translate-x-[2px] bg-texto-3',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-branco',
          'animado:transition-transform animado:duration-[120ms] animado:ease-saida',
        )}
      />
    </Switch.Root>
  );
}

interface PropsDaLinha {
  titulo: string;
  descricao?: ReactNode;
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  desativado?: boolean;
}

/**
 * Uma linha de ajuste: titulo, explicacao e o interruptor, tudo clicavel pelo
 * rotulo. E o formato de quase todo ajuste liga/desliga.
 */
export function LinhaDeInterruptor({ titulo, descricao, ligado, aoMudar, desativado }: PropsDaLinha): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-14 font-medium text-texto">
          {titulo}
        </label>
        {descricao ? <p className="mt-0.5 text-13 text-texto-3">{descricao}</p> : null}
      </div>
      <Interruptor id={id} ligado={ligado} aoMudar={aoMudar} desativado={desativado} />
    </div>
  );
}

import { useId } from 'react';
import { Slider } from 'radix-ui';

interface Props {
  rotulo: string;
  valor: number;
  aoMudar: (valor: number) => void;
  min?: number;
  max?: number;
  passo?: number;
  /** Como mostrar o valor ao lado (ex.: v => `${v}%`). */
  formatar?: (valor: number) => string;
  /** Marca uma posicao na trilha — o limiar de sensibilidade, por exemplo. */
  marca?: number;
  desativado?: boolean;
  /** Quando a pessoa solta (mouse ou tecla): para gravar uma vez so, e nao a cada passo. */
  aoSoltar?: (valor: number) => void;
}

/**
 * Controle deslizante com o valor em mono ao lado. A trilha fina e o quadrado
 * seguem a forma da familia; setas e Page Up/Down vem do Radix.
 */
export function Deslizante({
  rotulo,
  valor,
  aoMudar,
  min = 0,
  max = 100,
  passo = 1,
  formatar = (v) => String(v),
  marca,
  desativado,
  aoSoltar,
}: Props): React.JSX.Element {
  const id = useId();
  const posicaoDaMarca = marca === undefined ? null : ((marca - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span id={id} className="font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
          <span className="text-mudo">// </span>
          {rotulo}
        </span>
        <span className="font-mono text-12 tabular-nums text-texto">{formatar(valor)}</span>
      </div>
      <Slider.Root
        aria-labelledby={id}
        value={[valor]}
        onValueChange={([v]) => {
          if (v !== undefined) aoMudar(v);
        }}
        onValueCommit={([v]) => {
          if (v !== undefined) aoSoltar?.(v);
        }}
        min={min}
        max={max}
        step={passo}
        disabled={desativado}
        className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-40"
      >
        <Slider.Track className="relative h-[2px] grow bg-borda-2">
          <Slider.Range className="absolute h-full bg-acento" />
          {posicaoDaMarca !== null ? (
            <span
              aria-hidden
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-aviso"
              style={{ left: `${posicaoDaMarca}%` }}
            />
          ) : null}
        </Slider.Track>
        <Slider.Thumb
          aria-labelledby={id}
          className="block size-3 border border-acento bg-texto hover:shadow-brilho focus-visible:shadow-brilho"
        />
      </Slider.Root>
    </div>
  );
}

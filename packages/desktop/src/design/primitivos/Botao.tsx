import type { ComponentPropsWithRef, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx.js';

export type VarianteDeBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

interface Props extends ComponentPropsWithRef<'button'> {
  variante?: VarianteDeBotao;
  tamanho?: 'md' | 'sm';
  /** Icone antes do rotulo (lucide, tamanho 16). */
  icone?: ReactNode;
  /** Mostra o giro e bloqueia o clique, mantendo a largura. */
  carregando?: boolean;
}

const BASE =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono uppercase ' +
  'tracking-rotulo disabled:pointer-events-none disabled:opacity-30 ' +
  'animado:transition-[background-color,border-color,color,box-shadow,transform] animado:duration-[120ms] ' +
  'animado:active:scale-[0.98]';

const TAMANHOS = {
  md: 'h-9 px-4 text-11',
  sm: 'h-7 px-3 text-10',
} as const;

/*
  Os chanfrados usam `clip-path`, que corta tudo o que fica fora da caixa —
  inclusive o contorno de foco padrao, desenhado por fora. Neles o foco vira um
  anel INTERNO, que o recorte nao alcanca.
*/
const FOCO_INTERNO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-branco';

const VARIANTES: Record<VarianteDeBotao, string> = {
  primario: `k-chanfro bg-acento text-sobre-acento hover:bg-acento-2 hover:shadow-brilho ${FOCO_INTERNO}`,
  secundario: 'border border-borda-2 bg-terminal text-texto hover:border-acento',
  fantasma: 'text-texto-2 hover:bg-realce hover:text-texto',
  perigo: `k-chanfro bg-vivo text-branco hover:bg-acento-2 ${FOCO_INTERNO}`,
};

/**
 * Botao com a voz mono da familia: rotulo em caixa alta, acao principal
 * chanfrada e vermelha. Todo botao diz o que faz no rotulo — o perigo e
 * vermelho como o principal (direcao A), entao "Sair" e "Apagar" precisam
 * dizer "sair" e "apagar".
 */
export function Botao({
  variante = 'secundario',
  tamanho = 'md',
  icone,
  carregando = false,
  className,
  children,
  disabled,
  type = 'button',
  ...resto
}: Props): React.JSX.Element {
  return (
    <button
      type={type}
      className={cx(BASE, TAMANHOS[tamanho], VARIANTES[variante], className)}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...resto}
    >
      {carregando ? (
        <LoaderCircle aria-hidden className="size-4 animado:animate-spin" strokeWidth={1.5} />
      ) : (
        icone
      )}
      {children}
    </button>
  );
}

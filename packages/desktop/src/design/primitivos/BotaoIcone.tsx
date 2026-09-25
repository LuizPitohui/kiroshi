import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';
import { Dica } from './Dica.js';

interface Props extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** O que o botao faz. Vira o `aria-label` e a dica — obrigatorio. */
  rotulo: string;
  icone: ReactNode;
  tamanho?: 'md' | 'sm' | 'lg';
  /**
   * Estado de um botao que liga e desliga (microfone, camera, painel).
   * Undefined = botao comum, sem `aria-pressed`.
   */
  ligado?: boolean;
  /** Estado de perigo (microfone cortado, por exemplo): icone em vermelho. */
  alerta?: boolean;
  atalho?: string;
  semDica?: boolean;
}

const TAMANHOS = {
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-10',
} as const;

/**
 * Botao so de icone. Sempre com nome acessivel e dica; o estado ligado usa
 * FORMA alem da cor (borda + fundo), porque o vermelho aqui tambem e o da
 * identidade.
 */
export function BotaoIcone({
  rotulo,
  icone,
  tamanho = 'md',
  ligado,
  alerta = false,
  atalho,
  semDica = false,
  className,
  type = 'button',
  ...resto
}: Props): React.JSX.Element {
  const botao = (
    <button
      type={type}
      aria-label={rotulo}
      aria-pressed={ligado === undefined ? undefined : ligado}
      className={cx(
        'inline-grid shrink-0 place-items-center border text-texto-3 disabled:pointer-events-none disabled:opacity-30',
        'animado:transition-colors animado:duration-[120ms]',
        TAMANHOS[tamanho],
        ligado
          ? 'border-acento bg-acento-tenue text-acento'
          : 'border-transparente hover:border-borda-2 hover:bg-realce hover:text-texto',
        alerta && 'text-perigo',
        className,
      )}
      {...resto}
    >
      {icone}
    </button>
  );
  if (semDica) return botao;
  return (
    <Dica texto={rotulo} atalho={atalho}>
      {botao}
    </Dica>
  );
}

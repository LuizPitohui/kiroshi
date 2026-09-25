import type { ReactNode } from 'react';
import { Toaster, toast } from 'sonner';
import { cx } from './cx.js';

/** Barra de carregamento: linha de sistema + esqueleto. Nunca um spinner sozinho. */
export function Carregando({ texto = 'Carregando…' }: { texto?: string }): React.JSX.Element {
  return (
    <div role="status" className="flex flex-col items-center gap-3 font-mono text-11 uppercase tracking-rotulo text-texto-3">
      <span>
        {texto}
        <span aria-hidden className="k-anima k-cursor ml-0.5 text-acento">
          ▌
        </span>
      </span>
      <span aria-hidden className="k-esqueleto k-anima block h-0.5 w-40" />
    </div>
  );
}

/** Bloco cinza animado no lugar de algo que ainda nao chegou. */
export function Esqueleto({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden className={cx('k-esqueleto k-anima block', className)} />;
}

type TipoDeAviso = 'info' | 'aviso' | 'erro' | 'ok';

const GLIFO: Record<TipoDeAviso, string> = { info: '[i]', aviso: '[!]', erro: '[!]', ok: '[OK]' };
const COR: Record<TipoDeAviso, string> = {
  info: 'border-l-info text-texto',
  aviso: 'border-l-aviso text-texto',
  erro: 'border-l-perigo text-texto',
  ok: 'border-l-ok text-texto',
};
const COR_DO_GLIFO: Record<TipoDeAviso, string> = {
  info: 'text-info',
  aviso: 'text-aviso',
  erro: 'text-perigo',
  ok: 'text-ok',
};

/** Aviso no lugar (dentro de um painel ou formulario), com glifo alem da cor. */
export function Aviso({ tipo = 'info', titulo, children, acao }: { tipo?: TipoDeAviso; titulo?: string; children?: ReactNode; acao?: ReactNode }): React.JSX.Element {
  return (
    <div
      role={tipo === 'erro' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 border border-l-2 border-borda bg-terminal px-3 py-2.5 text-13', COR[tipo])}
    >
      <span aria-hidden className={cx('font-mono text-11', COR_DO_GLIFO[tipo])}>
        {GLIFO[tipo]}
      </span>
      <div className="min-w-0 flex-1">
        {titulo ? <p className="font-medium">{titulo}</p> : null}
        {children ? <div className="text-texto-2">{children}</div> : null}
      </div>
      {acao}
    </div>
  );
}

/** Estado vazio: grade de fundo, titulo em Rajdhani, texto de operador e a acao. */
export function EstadoVazio({ rotulo, titulo, children, acao }: { rotulo?: string; titulo: string; children?: ReactNode; acao?: ReactNode }): React.JSX.Element {
  return (
    <div className="k-grade flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {rotulo ? <p className="k-rotulo">{rotulo}</p> : null}
      <h2 className="font-display text-28 font-bold uppercase tracking-display text-texto">{titulo}</h2>
      {children ? <p className="max-w-md text-14 text-texto-3">{children}</p> : null}
      {acao ? <div className="mt-2 flex gap-2">{acao}</div> : null}
    </div>
  );
}

/*
  Avisos flutuantes (toasts). A interface 1.x nao tinha — o provedor so existia
  na vitrine —, e por isso tanto erro era engolido. Aqui ha um so, na raiz.
*/
export function Avisos(): React.JSX.Element {
  return (
    <Toaster
      position="bottom-right"
      offset={{ bottom: 36, right: 16 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[360px] items-start gap-3 border border-l-2 border-borda-2 bg-elevado px-4 py-3 text-13 text-texto shadow-camada',
          title: 'font-medium',
          description: 'text-texto-2',
          error: 'border-l-perigo',
          success: 'border-l-ok',
          warning: 'border-l-aviso',
          info: 'border-l-info',
        },
      }}
    />
  );
}

/** A unica forma de avisar algo passageiro. Erro sempre diz o que aconteceu. */
export const avisar = {
  erro: (titulo: string, detalhe?: string) => toast.error(titulo, { description: detalhe }),
  ok: (titulo: string, detalhe?: string) => toast.success(titulo, { description: detalhe }),
  info: (titulo: string, detalhe?: string) => toast.info(titulo, { description: detalhe }),
  aviso: (titulo: string, detalhe?: string) => toast.warning(titulo, { description: detalhe }),
};

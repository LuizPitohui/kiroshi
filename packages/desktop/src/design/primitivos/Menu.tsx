import type { ReactNode } from 'react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { cx } from './cx.js';

/*
  Menus suspensos e de contexto com o mesmo visual. O Radix cuida de setas,
  Enter, Esc, digitar para pular e devolver o foco; aqui so a aparencia.
*/

const CONTEUDO =
  'z-[var(--k-z-menu)] min-w-[200px] border border-borda-2 bg-elevado p-1 shadow-camada';

const ITEM =
  'relative flex cursor-default select-none items-center gap-2.5 px-2.5 py-1.5 text-13 text-texto outline-none ' +
  'data-[highlighted]:bg-acento-tenue data-[highlighted]:shadow-[inset_2px_0_0_var(--k-acento)] ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

const SEPARADOR = 'my-1 h-px bg-borda';
const ROTULO = 'px-2.5 pb-1 pt-2 font-mono text-10 uppercase tracking-rotulo-largo text-mudo';

interface PropsDoItem {
  icone?: ReactNode;
  atalho?: string;
  perigo?: boolean;
  desativado?: boolean;
  aoEscolher?: () => void;
  children: ReactNode;
}

function conteudoDoItem(icone: ReactNode, children: ReactNode, atalho?: string) {
  return (
    <>
      {icone ? <span className="grid size-4 place-items-center text-texto-3">{icone}</span> : null}
      <span className="flex-1">{children}</span>
      {atalho ? <span className="font-mono text-10 text-texto-3">{atalho}</span> : null}
    </>
  );
}

// ---- menu suspenso ----

export const Menu = DropdownMenu.Root;
export const MenuGatilho = DropdownMenu.Trigger;

export function MenuConteudo({ children, alinhar = 'start' }: { children: ReactNode; alinhar?: 'start' | 'center' | 'end' }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={alinhar} sideOffset={6} className={CONTEUDO}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ icone, atalho, perigo, desativado, aoEscolher, children }: PropsDoItem) {
  return (
    <DropdownMenu.Item
      disabled={desativado}
      onSelect={aoEscolher}
      className={cx(ITEM, perigo && 'text-perigo')}
    >
      {conteudoDoItem(icone, children, atalho)}
    </DropdownMenu.Item>
  );
}

export function MenuSeparador() {
  return <DropdownMenu.Separator className={SEPARADOR} />;
}

export function MenuRotulo({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className={ROTULO}>{children}</DropdownMenu.Label>;
}

// ---- menu de contexto (botao direito, Shift+F10, tecla de menu) ----

export const MenuDeContexto = ContextMenu.Root;
export const MenuDeContextoGatilho = ContextMenu.Trigger;

export function MenuDeContextoConteudo({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={CONTEUDO}>{children}</ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

export function MenuDeContextoItem({ icone, atalho, perigo, desativado, aoEscolher, children }: PropsDoItem) {
  return (
    <ContextMenu.Item disabled={desativado} onSelect={aoEscolher} className={cx(ITEM, perigo && 'text-perigo')}>
      {conteudoDoItem(icone, children, atalho)}
    </ContextMenu.Item>
  );
}

export function MenuDeContextoSeparador() {
  return <ContextMenu.Separator className={SEPARADOR} />;
}

/**
 * Item de marcar (os cargos de alguem no clique direito). `aoMudar` roda sem
 * fechar o menu: da para marcar varios cargos seguidos.
 */
export function MenuDeContextoMarcavel({
  marcado,
  aoMudar,
  desativado,
  children,
  cor,
}: {
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
  desativado?: boolean;
  children: ReactNode;
  /** A bolinha do cargo, quando ele tem cor. */
  cor?: string | null;
}) {
  return (
    <ContextMenu.CheckboxItem
      checked={marcado}
      disabled={desativado}
      onCheckedChange={(v) => aoMudar(v === true)}
      onSelect={(e) => e.preventDefault()}
      className={ITEM}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-4 place-items-center border',
          marcado ? 'border-acento bg-acento text-sobre-acento' : 'border-borda-2',
        )}
      >
        {marcado ? (
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" />
          </svg>
        ) : null}
      </span>
      {cor !== undefined ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cor ?? 'var(--k-texto-3)' }} />
      ) : null}
      <span className="flex-1 truncate">{children}</span>
    </ContextMenu.CheckboxItem>
  );
}

export const MenuDeContextoSub = ContextMenu.Sub;

export function MenuDeContextoSubGatilho({ icone, children }: { icone?: ReactNode; children: ReactNode }) {
  return (
    <ContextMenu.SubTrigger className={cx(ITEM, 'data-[state=open]:bg-acento-tenue')}>
      {conteudoDoItem(icone, children)}
      <span aria-hidden className="font-mono text-10 text-texto-3">›</span>
    </ContextMenu.SubTrigger>
  );
}

export function MenuDeContextoSubConteudo({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.SubContent sideOffset={4} className={cx(CONTEUDO, 'k-rolagem max-h-[60vh] overflow-y-auto')}>
        {children}
      </ContextMenu.SubContent>
    </ContextMenu.Portal>
  );
}

export function MenuDeContextoRotulo({ children }: { children: ReactNode }) {
  return <ContextMenu.Label className={ROTULO}>{children}</ContextMenu.Label>;
}

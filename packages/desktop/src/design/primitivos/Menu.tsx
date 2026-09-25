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

export function MenuDeContextoRotulo({ children }: { children: ReactNode }) {
  return <ContextMenu.Label className={ROTULO}>{children}</ContextMenu.Label>;
}

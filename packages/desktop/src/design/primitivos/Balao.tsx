import type { ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { cx } from './cx.js';

/*
  Balao: o painel pequeno que abre ancorado num botao (fixadas, emojis,
  autocompletar). O Radix cuida de Esc, clique fora, foco e de nao sair da
  janela; aqui so a aparencia, a mesma dos menus.
*/

export const Balao = Popover.Root;
export const BalaoGatilho = Popover.Trigger;
export const BalaoAncora = Popover.Anchor;
export const BalaoFechar = Popover.Close;

interface Props {
  children: ReactNode;
  /** Nome acessivel do painel (ele nao tem titulo visivel sempre). */
  rotulo: string;
  lado?: 'top' | 'right' | 'bottom' | 'left';
  alinhar?: 'start' | 'center' | 'end';
  className?: string;
  /** Falso para o foco ficar onde estava (o autocompletar nao tira o foco do campo). */
  focarAoAbrir?: boolean;
  /**
   * Para onde o foco vai ao fechar. Sem isto o Radix devolve ao gatilho — e
   * errado quando a escolha ja mandou o foco para outro lugar (o emoji
   * escolhido volta para o campo de texto, o "ir ate ela" vai para a mensagem).
   */
  aoFecharFoco?: (evento: Event) => void;
}

export function BalaoConteudo({ children, rotulo, lado = 'bottom', alinhar = 'end', className, focarAoAbrir = true, aoFecharFoco }: Props): React.JSX.Element {
  return (
    <Popover.Portal>
      <Popover.Content
        side={lado}
        align={alinhar}
        sideOffset={6}
        collisionPadding={8}
        aria-label={rotulo}
        onOpenAutoFocus={focarAoAbrir ? undefined : (e) => e.preventDefault()}
        onCloseAutoFocus={aoFecharFoco}
        className={cx('z-[var(--k-z-menu)] border border-borda-2 bg-elevado shadow-camada outline-none', className)}
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}

import { useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Botao } from './Botao.js';
import { cx } from './cx.js';

interface Props {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** Titulo em Rajdhani; vira o nome acessivel do dialogo. */
  titulo: string;
  /** Linha mono acima do titulo, ex.: "servidor". */
  rotulo?: string;
  descricao?: ReactNode;
  children?: ReactNode;
  /** Botoes do rodape, da direita para a esquerda na leitura. */
  acoes?: ReactNode;
  largura?: 'sm' | 'md' | 'lg';
}

const LARGURAS = { sm: 'w-[420px]', md: 'w-[520px]', lg: 'w-[680px]' } as const;

/**
 * Janela modal. O Radix prende o foco, fecha com Esc e devolve o foco a quem
 * abriu; os colchetes nos cantos marcam a camada ativa.
 */
export function Dialogo({ aberto, aoMudar, titulo, rotulo, descricao, children, acoes, largura = 'md' }: Props): React.JSX.Element {
  return (
    <Dialog.Root open={aberto} onOpenChange={aoMudar}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--k-z-dialogo)] bg-preto/80 backdrop-blur-sm" />
        <Dialog.Content
          className={cx(
            'k-colchetes fixed left-1/2 top-1/2 z-[var(--k-z-dialogo)] max-h-[85vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2',
            'flex flex-col border border-borda-2 bg-deck shadow-camada outline-none',
            LARGURAS[largura],
          )}
        >
          <span className="k-colchetes-extra" aria-hidden />
          <header className="flex items-start justify-between gap-4 border-b border-borda px-5 pb-4 pt-5">
            <div>
              {rotulo ? <p className="k-rotulo mb-1">{rotulo}</p> : null}
              <Dialog.Title className="font-display text-20 font-bold uppercase tracking-display text-texto">
                {titulo}
              </Dialog.Title>
              {descricao ? (
                <Dialog.Description className="mt-1 text-13 text-texto-3">{descricao}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Fechar"
              className="grid size-8 shrink-0 place-items-center text-texto-3 hover:bg-realce hover:text-texto"
            >
              <X className="size-4" strokeWidth={1.5} />
            </Dialog.Close>
          </header>
          {children ? <div className="k-rolagem overflow-y-auto px-5 py-4">{children}</div> : null}
          {acoes ? (
            <footer className="flex justify-end gap-2 border-t border-borda px-5 py-3">{acoes}</footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PropsDaConfirmacao {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  descricao: ReactNode;
  /** Rotulo do botao que confirma — o verbo, nunca "OK". */
  confirmar: string;
  perigo?: boolean;
  /** Pode ser assincrono; o botao gira enquanto espera e o erro aparece aqui. */
  aoConfirmar: () => Promise<void> | void;
}

/**
 * Pergunta antes de algo que nao volta (expulsar, banir, apagar). O erro de
 * quem confirmou aparece na propria janela — nunca e engolido.
 */
export function Confirmacao({ aberto, aoMudar, titulo, descricao, confirmar, perigo = false, aoConfirmar }: PropsDaConfirmacao): React.JSX.Element {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmarAgora() {
    setOcupado(true);
    setErro(null);
    try {
      await aoConfirmar();
      aoMudar(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      aoMudar={(v) => {
        if (!ocupado) aoMudar(v);
        if (!v) setErro(null);
      }}
      titulo={titulo}
      descricao={descricao}
      largura="sm"
      acoes={
        <>
          <Botao variante="fantasma" onClick={() => aoMudar(false)} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variante={perigo ? 'perigo' : 'primario'} carregando={ocupado} onClick={() => void confirmarAgora()}>
            {confirmar}
          </Botao>
        </>
      }
    >
      {erro ? (
        <p role="alert" className="text-13 text-perigo">
          <span className="font-mono">[!] </span>
          {erro}
        </p>
      ) : null}
    </Dialogo>
  );
}

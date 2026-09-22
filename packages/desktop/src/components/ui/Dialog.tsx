import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCamada } from './sobreposicao.js';
import { Close } from '../Icons.js';

/**
 * Dialogo: uma decisao ou um formulario curto, por cima do resto.
 *
 * Nao fecha ao clicar fora, de proposito. Os sete modais do aplicativo tem
 * campos preenchidos dentro — criar servidor, criar canal, escolher tela — e
 * perder o que foi digitado por um clique ao lado e pior do que precisar de um
 * passo a mais para sair. Esc e o X continuam funcionando.
 *
 * Vai em portal no fim do `body` porque o pai pode ter `overflow: hidden` ou
 * `transform`, e qualquer um dos dois recorta ou reposiciona uma camada que
 * deveria cobrir a tela inteira.
 */

export interface DialogProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  /** Uma linha abaixo do titulo, quando o titulo sozinho nao basta. */
  descricao?: string;
  children?: ReactNode;
  /** Botoes do rodape. A acao principal vai por ultimo, a direita. */
  acoes?: ReactNode;
  /** Largura maxima. O padrao serve para formulario de poucos campos. */
  largura?: number;
  /**
   * Altura fixa, para dialogo com navegacao propria por dentro.
   *
   * Sem isto, um dialogo com abas muda de tamanho a cada aba, e o botao de
   * fechar anda na tela entre um clique e outro. Com altura fixa o quadro fica
   * parado e so o conteudo rola.
   */
  altura?: number | string;
  /** Tira o espacamento do corpo, para conteudo que desenha as proprias bordas. */
  corpoSemMargem?: boolean;
}

export function Dialog({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  acoes,
  largura = 440,
  altura,
  corpoSemMargem = false,
}: DialogProps) {
  const caixa = useCamada<HTMLDivElement>(aberto, aoFechar, { fecharAoClicarFora: false });

  if (!aberto) return null;

  return createPortal(
    <div className="camada-fundo">
      <div
        ref={caixa}
        className="dialogo"
        style={{ maxWidth: largura, height: altura }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        aria-describedby={descricao ? 'dialogo-descricao' : undefined}
        tabIndex={-1}
      >
        <header className="dialogo-topo">
          <div>
            <h2 className="dialogo-titulo" id="dialogo-titulo">
              {titulo}
            </h2>
            {descricao && (
              <p className="dialogo-descricao" id="dialogo-descricao">
                {descricao}
              </p>
            )}
          </div>
          <button className="dialogo-fechar" onClick={aoFechar} aria-label="Fechar">
            <Close size={16} />
          </button>
        </header>

        {children && (
          <div className={`dialogo-corpo ${corpoSemMargem ? 'sem-margem' : ''}`}>{children}</div>
        )}
        {acoes && <footer className="dialogo-acoes">{acoes}</footer>}
      </div>
    </div>,
    document.body,
  );
}

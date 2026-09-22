import { createPortal } from 'react-dom';
import { useCamada } from './sobreposicao.js';
import { Close, Download } from '../Icons.js';

/**
 * Visualizador de imagem em tela cheia.
 *
 * Era a ultima camada do aplicativo escrita a mao, e a unica que ainda nao
 * fechava no Esc: so dava para sair clicando no fundo. Uma imagem aberta em
 * cima de tudo, sem saida por teclado, e uma armadilha para quem nao usa
 * mouse.
 *
 * O zoom e a navegacao entre imagens que a especificacao pede ficam para a
 * fase de mensagens, quando houver a lista de anexos de uma mensagem para
 * navegar. Aqui esta o que uma imagem aberta precisa ter hoje: fechar por
 * teclado, fechar clicando fora, baixar, e um nome acessivel.
 */

export interface LightboxProps {
  url: string;
  /** Nome do arquivo. Vira o rotulo acessivel e o nome ao baixar. */
  nome: string;
  aoFechar: () => void;
}

export function Lightbox({ url, nome, aoFechar }: LightboxProps) {
  const caixa = useCamada<HTMLDivElement>(true, aoFechar);

  return createPortal(
    <div className="camada-fundo lightbox-fundo">
      <div
        ref={caixa}
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={nome}
        tabIndex={-1}
      >
        <div className="lightbox-barra">
          <span className="lightbox-nome">{nome}</span>
          <a
            className="lightbox-acao"
            href={url}
            download={nome}
            title="Baixar"
            aria-label={`Baixar ${nome}`}
          >
            <Download size={16} />
          </a>
          <button className="lightbox-acao" onClick={aoFechar} aria-label="Fechar">
            <Close size={16} />
          </button>
        </div>

        {/* O clique na imagem nao fecha; so o clique fora dela. */}
        <img className="lightbox-img" src={url} alt={nome} />
      </div>
    </div>,
    document.body,
  );
}

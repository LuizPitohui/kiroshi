import { forwardRef, type ReactNode } from 'react';
import { MicOff } from '../Icons.js';

/**
 * Cartao de um participante da chamada.
 *
 * O anel de foco optico e a assinatura visual do Kiroshi aqui: quem fala ganha
 * um contorno, nao um brilho. A especificacao pede exatamente isso — "nao
 * aplicar glow intenso sobre toda a borda do cartao a cada fala" — e o motivo
 * e pratico: numa conversa de quatro pessoas o brilho pisca o tempo todo, e o
 * olho para de conseguir ignorar.
 *
 * Quem esta com o microfone desligado mostra um icone, nao so uma cor. Numa
 * grade de oito cartoes, "o cinza e o mudo" e uma regra que ninguem consegue
 * aplicar de relance.
 *
 * O video vem de fora, por `children`, e a referencia passa direto para o
 * elemento — quem anexa a faixa precisa do elemento em si, e ele nunca pode
 * ser desmontado por uma mudanca de tamanho ou de destaque, senao a imagem
 * pisca.
 *
 * Este componente existiu por um tempo sem ninguem usando, enquanto o palco
 * mantinha uma copia propria do mesmo cartao. As duas copias ja tinham
 * divergido: so a do palco anunciava o destaque no rotulo, e so esta tinha o
 * icone de mudo no rodape. Agora e uma so.
 */

export interface ParticipantTileProps {
  nome: string;
  /** O `<video>` ou o avatar. */
  children: ReactNode;
  falando?: boolean;
  semMicrofone?: boolean;
  /** Uma transmissao de tela, que ganha o rotulo "AO VIVO". */
  aoVivo?: boolean;
  /** Em destaque: o cartao grande do palco. */
  destacado?: boolean;
  /** Miniatura na faixa lateral. */
  miniatura?: boolean;
  /**
   * Sem imagem: so o rosto parado.
   *
   * Muda a proporcao do cartao — um avatar e redondo, e 16/9 em volta dele so
   * empurra os outros participantes para longe.
   */
  semImagem?: boolean;
  /** Em tela cheia: as medidas da grade deixam de valer. */
  emTelaCheia?: boolean;
  /**
   * Aviso curto ao lado do nome, como a qualidade da conexao.
   *
   * Fica no rodape, junto do nome, porque e sobre AQUELA pessoa. Uma barra de
   * aviso no topo do palco diria "a chamada esta instavel" quando o problema e
   * de um participante so.
   */
  aviso?: ReactNode;
  /** Acoes no canto, visiveis no hover e no foco. */
  acoes?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  /**
   * Botao direito, ou a tecla de menu de contexto: abre o cartao da pessoa.
   *
   * Aceita os dois tipos de evento porque os dois caminhos existem, e tudo
   * que quem recebe usa — `preventDefault` e `currentTarget` — os dois tem.
   */
  onContextMenu?: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

export const ParticipantTile = forwardRef<HTMLDivElement, ParticipantTileProps>(
  function ParticipantTile(
    {
      nome,
      children,
      falando = false,
      semMicrofone = false,
      aoVivo = false,
      destacado = false,
      miniatura = false,
      semImagem = false,
      emTelaCheia = false,
      aviso,
      acoes,
      onClick,
      onDoubleClick,
      onContextMenu,
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={[
          'tile',
          falando ? 'speaking' : '',
          destacado ? 'spot' : '',
          miniatura ? 'mini' : '',
          semImagem ? 'faceless' : '',
          emTelaCheia ? 'fullscreen' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={
          // O rotulo carrega o estado porque a cor e o anel nao chegam ao
          // leitor de tela. O destaque entra aqui tambem: sem isso, quem usa
          // leitor clica para destacar e nao recebe confirmacao de nada.
          [
            nome,
            falando ? 'falando' : null,
            semMicrofone ? 'microfone desligado' : null,
            onClick ? (destacado ? 'em destaque' : 'clique para destacar') : null,
          ]
            .filter(Boolean)
            .join(', ')
        }
        onKeyDown={(e) => {
          /*
            O menu de contexto tambem pelo teclado.

            `ContextMenu` e Shift+F10 sao como se abre menu de contexto sem
            mouse no Windows. Sem isto, o cartao da pessoa — e com ele o
            controle de volume e o pedido de amizade — existiria so para quem
            usa mouse. Vem antes da guarda do `onClick` de proposito: um
            quadro pode ter cartao sem ser clicavel.
          */
          if (onContextMenu && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
            e.preventDefault();
            onContextMenu(e);
            return;
          }

          if (!onClick) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {children}

        {aoVivo && <span className="tile-live">AO VIVO</span>}

        <div className="tile-rodape">
          {semMicrofone && <MicOff size={12} className="tile-mudo" aria-hidden="true" />}
          <span className="tile-nome">{nome}</span>
          {aviso}
        </div>

        {acoes && <div className="tile-tools">{acoes}</div>}
      </div>
    );
  },
);

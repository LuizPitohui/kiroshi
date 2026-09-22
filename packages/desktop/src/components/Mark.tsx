/**
 * A marca do Kiroshi, para usar dentro da interface.
 *
 * A GEOMETRIA
 *
 * Um hexagono vertical com dois cantos opostos chanfrados a 45 graus — o
 * superior esquerdo e o inferior direito — cortado por uma barra diagonal
 * paralela aos chanfros. Le como um "O" cortado: fechado o bastante para ser
 * um simbolo, aberto o bastante para nao virar um selo.
 *
 * A barra nao e um traco desenhado por cima: e o fundo aparecendo entre as
 * duas metades. Por isso o desenho sao duas formas, e nao uma com uma linha —
 * assim ele funciona sobre qualquer superficie, inclusive uma foto, sem
 * precisar saber a cor de tras.
 *
 * POR QUE `currentColor`
 *
 * O desenho nao carrega cor propria. Ele herda a do texto onde estiver, entao
 * a mesma marca serve creme na tela de entrada, ciano quando ativa e cinza
 * quando apagada — sem tres arquivos que saem de sincronia.
 *
 * O desenho anterior era uma iris dentro de um anel hexagonal aberto, com um
 * ponto ambar de foco. Saiu inteiro: a identidade nova nao e um olho.
 */

interface MarkProps {
  size?: number;
  /** Sem cor, herda a do texto ao redor. */
  color?: string;
  className?: string;
}

/*
  Proporcao 210 x 292, medida da arte: mais alto que largo.

  O chanfro e de 85 unidades nos dois eixos, que e o que da os 45 graus. A
  barra corta na mesma inclinacao, entrando pela lateral esquerda e saindo
  pela direita, com 40 unidades de folga vertical — perto de 28 de largura
  real, ja que a diagonal estica a medida.
*/
export function Mark({ size = 16, color, className }: MarkProps) {
  return (
    <svg
      width={(size * 210) / 292}
      height={size}
      viewBox="0 0 210 292"
      fill={color ?? 'currentColor'}
      className={className}
      role="img"
      aria-label="Kiroshi"
    >
      {/*
        Metade de cima: chanfro superior esquerdo, topo, desce pela direita ate
        a barra, e volta pela diagonal ate a lateral esquerda.
      */}
      <path d="M 85 0 L 210 0 L 210 17 L 0 227 L 0 85 Z" />
      {/*
        Metade de baixo: comeca onde a barra encontra a lateral direita, desce,
        pega o chanfro inferior direito e sobe pela diagonal.
      */}
      <path d="M 210 57 L 210 207 L 125 292 L 0 292 L 0 267 Z" />
    </svg>
  );
}

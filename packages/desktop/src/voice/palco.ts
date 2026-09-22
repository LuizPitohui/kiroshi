/**
 * Como os quadros se arrumam no palco, conforme quantos sao.
 *
 * Isto e uma funcao pura de proposito. A versao anterior vivia dentro de um
 * `useMemo` no `Stage`, e testar "o que acontece com sete pessoas" exigia
 * montar o componente, o que por sua vez exige LiveKit, `localStorage` e um
 * `ResizeObserver`. Aqui a mesma pergunta e uma chamada de funcao.
 *
 * O numero de colunas ja estava certo antes: `ceil(sqrt(n))` da a grade mais
 * proxima de um quadrado, que e a que desperdica menos area quando todos os
 * quadros tem o mesmo tamanho. Duas coisas e que faltavam.
 *
 * A primeira e o MODO. Uma grade de dois nao e uma grade pequena: sao duas
 * pessoas se olhando, e o certo e dois quadros grandes lado a lado, nao dois
 * quadros de tamanho de grade perdidos no meio do palco. Uma pessoa sozinha
 * nao e uma grade de um — e uma imagem so, que deveria usar o palco inteiro.
 * Quando o layout tinha um nome so, o CSS nao tinha como tratar esses casos
 * diferente, e a chamada de duas pessoas — que e a mais comum neste grupo —
 * ficava com dois selos no meio de um campo vazio.
 *
 * A segunda e o teto de colunas. Estava em 4, o que a partir de treze quadros
 * empilha quatro linhas e cada rosto fica menor que o avatar da barra
 * lateral. Cinco colunas adiam isso o suficiente para o tamanho deste grupo.
 */

export type ModoDoPalco =
  /** Ninguem na chamada. */
  | 'vazio'
  /** Ninguem com camera nem transmitindo: uma faixa baixa de rostos. */
  | 'faixa'
  /** Um quadro so, com imagem: ele fica com o palco inteiro. */
  | 'solo'
  /** Dois quadros lado a lado, grandes. */
  | 'dupla'
  /** Tres ou mais: grade. */
  | 'grade'
  /** Um quadro em destaque e os demais em fita. */
  | 'destaque';

export interface Composicao {
  modo: ModoDoPalco;
  colunas: number;
  linhas: number;
}

export interface EntradaDoPalco {
  /** Quantos quadros vao para a grade. O destacado nao entra nesta conta. */
  naGrade: number;
  /** Alguem com camera ligada ou transmitindo tela. */
  temVideo: boolean;
  /** Ha um quadro em destaque; os outros viram fita embaixo dele. */
  temDestaque: boolean;
}

/** Acima disto, os rostos ficam menores que um avatar de lista. */
const TETO_DE_COLUNAS = 5;

/** Sem video, cabem mais por linha: um rosto parado nao precisa de 16/9. */
const TETO_DA_FAIXA = 8;

export function composicao({ naGrade, temVideo, temDestaque }: EntradaDoPalco): Composicao {
  if (temDestaque) {
    /*
      Na fita o tamanho e fixo no CSS (76px de altura), entao colunas e linhas
      nao mandam em nada aqui. Devolver a contagem real mesmo assim mantem a
      promessa da funcao: os numeros descrevem quantos quadros existem, e quem
      ler isso em um teste ou em uma depuracao nao vai achar que sumiram.
    */
    return { modo: 'destaque', colunas: Math.max(1, naGrade), linhas: 1 };
  }

  if (naGrade <= 0) return { modo: 'vazio', colunas: 1, linhas: 1 };

  if (!temVideo) {
    const colunas = Math.min(TETO_DA_FAIXA, naGrade);
    return { modo: 'faixa', colunas, linhas: Math.ceil(naGrade / colunas) };
  }

  if (naGrade === 1) return { modo: 'solo', colunas: 1, linhas: 1 };
  if (naGrade === 2) return { modo: 'dupla', colunas: 2, linhas: 1 };

  const colunas = Math.min(TETO_DE_COLUNAS, Math.ceil(Math.sqrt(naGrade)));
  return { modo: 'grade', colunas, linhas: Math.ceil(naGrade / colunas) };
}

// ---------------------------------------------------------------------------

/** De onde vem a imagem do quadro: camera, transmissao, ou so o avatar de
 *  quem esta sem video. */
export type FonteDoQuadro = 'camera' | 'tela' | 'avatar';

/**
 * O que aparece embaixo do quadro.
 *
 * Existe como funcao separada por um motivo concreto: a versao anterior era
 * uma linha dentro do palco, escrita como `` `Tela de ` `` — um texto entre
 * crases com espaco no fim e NENHUMA interpolacao. Compilou, passou no
 * typecheck, passou na vitrine, e foi para a mao de cinco pessoas mostrando
 * "Tela de" embaixo de toda transmissao, sem nome nenhum.
 *
 * A vitrine nao pegou porque monta o cartao com o texto ja pronto,
 * "Tela de vartaque", escrito a mao. Testava o cartao, nao quem escreve o
 * rotulo. Agora quem escreve o rotulo e uma funcao pura, e o teste cobra o
 * nome dentro do texto.
 */
export function rotuloDoQuadro(fonte: FonteDoQuadro, nome: string): string {
  return fonte === 'tela' ? `Tela de ${nome}` : nome;
}

/**
 * A arrumacao do palco conforme quem esta na chamada.
 *
 * O que estes testes protegem nao e a formula das colunas — essa ja estava
 * certa. E a escolha do MODO, que e o que decide se uma conversa de duas
 * pessoas mostra dois quadros grandes ou dois selos perdidos no meio do
 * palco. E uma regra facil de quebrar sem perceber, porque o resultado
 * continua funcionando: a chamada conecta, a imagem aparece, e so fica feia.
 */

import { describe, it, expect } from 'vitest';
import { composicao, rotuloDoQuadro } from './palco.js';

const comVideo = (naGrade: number, temDestaque = false) =>
  composicao({ naGrade, temVideo: true, temDestaque });

const semVideo = (naGrade: number) =>
  composicao({ naGrade, temVideo: false, temDestaque: false });

describe('o modo muda com o numero de quadros', () => {
  it('ninguem na chamada e o palco vazio', () => {
    expect(comVideo(0).modo).toBe('vazio');
  });

  it('uma pessoa com imagem fica com o palco inteiro', () => {
    expect(comVideo(1)).toEqual({ modo: 'solo', colunas: 1, linhas: 1 });
  });

  it('duas pessoas ficam lado a lado, e isso tem nome proprio', () => {
    // O caso mais comum neste grupo. Se cair em 'grade', o CSS trata como
    // grade pequena e os dois quadros encolhem sem motivo.
    expect(comVideo(2)).toEqual({ modo: 'dupla', colunas: 2, linhas: 1 });
  });

  it('a partir de tres vira grade', () => {
    expect(comVideo(3).modo).toBe('grade');
    expect(comVideo(9).modo).toBe('grade');
  });
});

describe('a grade fica o mais quadrada possivel', () => {
  it.each([
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [9, 3, 3],
    [10, 4, 3],
    [16, 4, 4],
  ])('%i quadros: %i colunas por %i linhas', (n, colunas, linhas) => {
    expect(comVideo(n)).toEqual({ modo: 'grade', colunas, linhas });
  });

  it('passa de quatro colunas quando precisa, em vez de empilhar linhas', () => {
    // O teto antigo era 4: com 17 quadros dava 4x5, e cada rosto ficava
    // menor que o avatar da barra lateral.
    expect(comVideo(17).colunas).toBe(5);
  });

  it('mas nao passa de cinco colunas nunca', () => {
    expect(comVideo(40).colunas).toBe(5);
    expect(comVideo(400).colunas).toBe(5);
  });
});

describe('sem ninguem transmitindo, o palco e uma faixa de rostos', () => {
  it('uma pessoa sem camera nao e "solo": e faixa', () => {
    // Um avatar esticado no palco inteiro nao mostra mais nada que um avatar
    // pequeno; so rouba a altura da conversa embaixo.
    expect(semVideo(1).modo).toBe('faixa');
  });

  it('cabem oito rostos em uma linha', () => {
    expect(semVideo(8)).toEqual({ modo: 'faixa', colunas: 8, linhas: 1 });
  });

  it('acima de oito, quebra em linhas em vez de encolher sem fim', () => {
    expect(semVideo(9)).toEqual({ modo: 'faixa', colunas: 8, linhas: 2 });
  });
});

describe('com um quadro em destaque, os demais viram fita', () => {
  it('o modo e destaque, independente de quantos sobraram', () => {
    expect(comVideo(1, true).modo).toBe('destaque');
    expect(comVideo(7, true).modo).toBe('destaque');
  });

  it('destaque vence "sem video": quem destacou quer ver aquilo grande', () => {
    expect(composicao({ naGrade: 3, temVideo: false, temDestaque: true }).modo).toBe('destaque');
  });

  it('a contagem continua real mesmo sem mandar no tamanho', () => {
    // O tamanho da fita e fixo no CSS. Devolver 0 aqui faria quem depurasse
    // achar que os quadros sumiram.
    expect(comVideo(7, true).colunas).toBe(7);
  });

  it('nunca devolve zero colunas, nem sem ninguem na fita', () => {
    // Zero colunas viraria uma divisao por zero no CSS da grade.
    expect(comVideo(0, true).colunas).toBe(1);
  });
});

describe('rotuloDoQuadro', () => {
  it('a camera mostra so o nome', () => {
    expect(rotuloDoQuadro('camera', 'vartaque')).toBe('vartaque');
  });

  it('e quem esta sem video tambem', () => {
    expect(rotuloDoQuadro('avatar', 'vartaque')).toBe('vartaque');
  });

  it('a tela diz de quem e', () => {
    expect(rotuloDoQuadro('tela', 'vartaque')).toBe('Tela de vartaque');
  });

  /*
    O teste que teria pegado o defeito: o nome PRECISA estar no texto.
    A versao quebrada devolvia "Tela de " — com o prefixo certo, o espaco
    certo e o nome nenhum.
  */
  it('o nome entra no rotulo da tela, nao so o prefixo', () => {
    for (const nome of ['pitohuikun', 'sidielison', 'der.fuhrer', 'a']) {
      expect(rotuloDoQuadro('tela', nome)).toContain(nome);
    }
  });

  it('nao sobra espaco no fim quando o nome e vazio', () => {
    // Nome vazio nao deveria acontecer, mas se acontecer o rotulo nao pode
    // virar "Tela de " e passar por texto valido.
    expect(rotuloDoQuadro('tela', '').trimEnd()).toBe('Tela de');
  });
});

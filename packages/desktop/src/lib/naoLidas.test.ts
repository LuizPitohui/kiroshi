/**
 * Onde o divisor de "nao lidas" cai, e quando ele nao deve existir.
 *
 * O que estes testes protegem e o silencio: as regras aqui sao quase todas
 * sobre NAO mostrar o divisor em situacoes onde mostrar seria mentira. Um
 * divisor no lugar errado nao quebra nada — so aponta para um ponto da
 * conversa onde a pessoa nunca esteve, e ela confia nele.
 */

import { describe, it, expect } from 'vitest';
import { corteDeNaoLidas, quantasNaoLidas, type MensagemParaCorte } from './naoLidas.js';

/** Ids crescentes, como os snowflakes reais. */
const msg = (id: number, autor = 'outra'): MensagemParaCorte => ({
  id: String(100 + id),
  authorId: autor,
});

const EU = 'eu';

const corte = (
  mensagens: MensagemParaCorte[],
  ultimaLida: string | null,
  historicoCompleto = true,
) => corteDeNaoLidas({ mensagens, ultimaLida, euSou: EU, historicoCompleto });

describe('o divisor cai logo depois do que ja foi lido', () => {
  it('com tres lidas e duas novas, corta na quarta', () => {
    const lista = [msg(1), msg(2), msg(3), msg(4), msg(5)];
    expect(corte(lista, '103')).toBe(3);
  });

  it('tudo lido nao tem divisor', () => {
    const lista = [msg(1), msg(2), msg(3)];
    expect(corte(lista, '103')).toBeNull();
  });

  it('conversa vazia nao tem divisor', () => {
    expect(corte([], '103')).toBeNull();
  });
});

describe('as minhas mensagens nao sao "nao lidas"', () => {
  it('se so eu falei depois do marcador, nao ha divisor', () => {
    // Acontece toda vez que se responde e se volta depois: sem esta regra o
    // divisor aparecia logo acima da propria resposta.
    const lista = [msg(1), msg(2, EU), msg(3, EU)];
    expect(corte(lista, '101')).toBeNull();
  });

  it('o divisor pula as minhas e para na primeira dos outros', () => {
    const lista = [msg(1), msg(2, EU), msg(3, EU), msg(4), msg(5)];
    expect(corte(lista, '101')).toBe(3);
  });
});

describe('canal nunca aberto: depende de ter o historico inteiro', () => {
  it('com o historico completo, o divisor vai no comeco', () => {
    const lista = [msg(1), msg(2)];
    expect(corte(lista, null, true)).toBe(0);
  });

  it('com o historico pela metade, nao ha divisor', () => {
    // A mensagem do topo e so a mais antiga que coube na janela. Um divisor
    // ali diria "voce parou aqui" apontando para um ponto qualquer do meio.
    const lista = [msg(1), msg(2)];
    expect(corte(lista, null, false)).toBeNull();
  });

  it('e se o comeco for so coisa minha, tambem nao ha', () => {
    const lista = [msg(1, EU), msg(2, EU)];
    expect(corte(lista, null, true)).toBeNull();
  });
});

describe('o divisor no primeiro item exige que ali seja o comeco', () => {
  it('historico pela metade e tudo novo: sem divisor', () => {
    // Senao o divisor sugeriria que a conversa inteira e nova, quando na
    // verdade so nao carregamos o que vem antes.
    const lista = [msg(8), msg(9)];
    expect(corte(lista, '105', false)).toBeNull();
  });

  it('historico completo e tudo novo: divisor no topo', () => {
    const lista = [msg(8), msg(9)];
    expect(corte(lista, '105', true)).toBe(0);
  });
});

describe('a contagem bate com o divisor', () => {
  it('conta so o que esta do corte para baixo', () => {
    const lista = [msg(1), msg(2), msg(3), msg(4)];
    expect(quantasNaoLidas(lista, 2, EU)).toBe(2);
  });

  it('e nao conta as minhas', () => {
    const lista = [msg(1), msg(2), msg(3, EU), msg(4)];
    expect(quantasNaoLidas(lista, 1, EU)).toBe(2);
  });

  it('sem divisor, zero', () => {
    expect(quantasNaoLidas([msg(1)], null, EU)).toBe(0);
  });
});

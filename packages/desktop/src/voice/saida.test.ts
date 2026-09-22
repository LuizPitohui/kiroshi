/**
 * Zerar o volume de alguem tem que silenciar. Sempre.
 *
 * Isto chegou aos usuarios duas vezes seguidas, por caminhos diferentes:
 *
 *   1. `Math.min(1, ...)` no volume do elemento — o deslizante ia a 200% e
 *      nada acontecia acima de 100%;
 *
 *   2. a cadeia de Web Audio ligada em `createMediaElementSource`, que nao
 *      funciona com `srcObject` — o grafo recebia zero e o elemento seguia
 *      tocando por fora, em volume fixo.
 *
 * O que as duas tem em comum: o controle parecia existir e nao existia. Por
 * isso `ajustar` agora mexe nos DOIS caminhos, e estes testes cobrem o caminho
 * que nao precisa de Web Audio — justamente o que sobra quando o grafo falha,
 * que e quando o defeito aparece.
 */
import { describe, it, expect } from 'vitest';
import { SaidaDeAudio, GANHO_MAXIMO } from './saida.js';

/** Um elemento de audio de mentira: so os campos que importam aqui. */
function elementoFalso(): HTMLMediaElement {
  return { muted: false, volume: 1 } as HTMLMediaElement;
}

describe('elemento fora do grafo', () => {
  /*
    O teste central. Um elemento que nunca entrou na cadeia — porque o fluxo
    nao tinha chegado, porque o contexto nao subiu — continua tendo que
    obedecer. Silenciar alguem nao pode depender de o Web Audio ter dado certo.
  */
  it('zerar silencia mesmo sem a cadeia', () => {
    const saida = new SaidaDeAudio();
    const el = elementoFalso();

    saida.ajustar(el, 0);

    expect(el.muted).toBe(true);
    expect(el.volume).toBe(0);
  });

  it('e voltar do zero devolve o som', () => {
    const saida = new SaidaDeAudio();
    const el = elementoFalso();

    saida.ajustar(el, 0);
    saida.ajustar(el, 1);

    expect(el.muted).toBe(false);
    expect(el.volume).toBe(1);
  });

  it('volume intermediario chega ao elemento', () => {
    const saida = new SaidaDeAudio();
    const el = elementoFalso();

    saida.ajustar(el, 0.35);

    expect(el.muted).toBe(false);
    expect(el.volume).toBeCloseTo(0.35, 5);
  });

  /*
    Fora do grafo vale o teto do proprio elemento, que a especificacao fixa em
    1. Passar disso lanca `IndexSizeError` — foi assim que o defeito original
    ficou escondido atras de um `Math.min`.
  */
  it('acima de 100% para em 1, que e o teto do elemento', () => {
    const saida = new SaidaDeAudio();
    const el = elementoFalso();

    saida.ajustar(el, 2);

    expect(el.volume).toBe(1);
    expect(el.muted).toBe(false);
  });
});

describe('limites', () => {
  it('valor negativo vira silencio, nao excecao', () => {
    const saida = new SaidaDeAudio();
    const el = elementoFalso();

    saida.ajustar(el, -5);

    expect(el.muted).toBe(true);
    expect(el.volume).toBe(0);
  });

  it('o teto do ganho comporta os dois controles no maximo', () => {
    // Volume geral a 200% com a pessoa a 200% pede 4.
    expect(GANHO_MAXIMO).toBeGreaterThanOrEqual(4);
  });
});

describe('a cadeia so nasce quando ha o que ligar', () => {
  /*
    `ativa` falso de saida importa: o controlador decide caminhos com base
    nele, e um contexto de audio criado sem necessidade fica suspenso
    esperando um gesto que talvez nunca venha.
  */
  it('uma saida recem-criada nao tem contexto', () => {
    expect(new SaidaDeAudio().ativa).toBe(false);
  });

  it('desligar um elemento que nunca entrou nao quebra', () => {
    const saida = new SaidaDeAudio();
    expect(() => saida.desligar(elementoFalso())).not.toThrow();
  });
});

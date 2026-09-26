/**
 * O microfone em um canal (mono.worklet.js), sem o navegador: o processador
 * roda aqui com um AudioWorkletProcessor de mentira e blocos de 128 amostras.
 *
 * O que estes testes protegem e o pedido do dono em 2026-09-26: "as pessoas so
 * escutam minha voz de um lado do fone". A voz tem que sair em UM canal (que o
 * app manda para os dois lados), e inteira: sem perder volume quando vem de um
 * lado so.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const TAXA = 48000;
const BLOCO = 128;

interface Processador {
  process(entradas: Float32Array[][], saidas: Float32Array[][]): boolean;
}
let Mono: new () => Processador;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletProcessor = class {};
  g.sampleRate = TAXA;
  g.registerProcessor = () => undefined;
  // @ts-expect-error: arquivo JS do AudioWorklet, sem tipos.
  Mono = (await import('./mono.worklet.js')).MonoDoMicrofone;
});

/** Um sinal de "voz": seno de 300 Hz com o valor eficaz pedido. */
const voz = (rms: number) => (i: number) => rms * Math.SQRT2 * Math.sin((2 * Math.PI * 300 * i) / TAXA);
/** Ruido pseudoaleatorio (sempre o mesmo), com o valor eficaz pedido. */
function ruido(rms: number, semente = 1) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return rms * Math.sqrt(3) * (2 * (s / 2147483648) - 1);
  };
}
const silencio = () => () => 0;

/** Roda `segundos` com um gerador por canal; devolve a saida inteira. */
function rodar(p: Processador, canais: Array<(i: number) => number>, segundos: number, inicio = 0): Float32Array {
  const blocos = Math.round((segundos * TAXA) / BLOCO);
  const saida = new Float32Array(blocos * BLOCO);
  for (let b = 0; b < blocos; b++) {
    const entrada = canais.map((gerar) => {
      const x = new Float32Array(BLOCO);
      for (let i = 0; i < BLOCO; i++) x[i] = gerar(inicio + b * BLOCO + i);
      return x;
    });
    const out = [new Float32Array(BLOCO)];
    expect(p.process([entrada], [out])).toBe(true);
    saida.set(out[0]!, b * BLOCO);
  }
  return saida;
}

const rmsDe = (x: Float32Array, de = 0) => {
  let s = 0;
  for (let i = de; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - de));
};
const db = (x: number) => 20 * Math.log10(x);
/** O valor eficaz depois do primeiro meio segundo (a decisao ja tomada). */
const firme = (x: Float32Array) => rmsDe(x, TAXA / 2);

describe('microfone em um canal', () => {
  it('mono passa como esta', () => {
    const p = new Mono();
    const gerar = voz(0.1);
    const saida = rodar(p, [gerar], 0.1);
    for (let i = 0; i < saida.length; i++) expect(saida[i]).toBeCloseTo(gerar(i), 6);
  });

  it('voz so no esquerdo sai inteira, sem os 6 dB da media simples', () => {
    const saida = rodar(new Mono(), [voz(0.1), silencio()], 1);
    expect(Math.abs(db(firme(saida) / 0.1))).toBeLessThan(0.2);
  });

  it('voz so no direito tambem (o portao antigo nem abria)', () => {
    const saida = rodar(new Mono(), [silencio(), voz(0.1)], 1);
    expect(Math.abs(db(firme(saida) / 0.1))).toBeLessThan(0.2);
  });

  it('a mesma voz nos dois canais sai como a voz', () => {
    const gerar = voz(0.1);
    const saida = rodar(new Mono(), [gerar, gerar], 1);
    expect(Math.abs(db(firme(saida) / 0.1))).toBeLessThan(0.2);
  });

  it('dois canais diferentes e do mesmo nivel: os dois contam (media)', () => {
    const saida = rodar(new Mono(), [ruido(0.1, 1), ruido(0.1, 2)], 1);
    // Media de dois sinais independentes de mesmo nivel: 3 dB abaixo de cada um.
    expect(db(firme(saida) / 0.1)).toBeCloseTo(-3, 0);
  });

  it('chiado baixo no canal vazio nao entra na conta', () => {
    const saida = rodar(new Mono(), [voz(0.1), ruido(0.1 / 300, 3)], 1); // ~50 dB abaixo
    expect(Math.abs(db(firme(saida) / 0.1))).toBeLessThan(0.2);
  });

  it('o silencio entre as frases nao desfaz a decisao', () => {
    const p = new Mono();
    rodar(p, [voz(0.1), silencio()], 1);
    rodar(p, [silencio(), silencio()], 3, TAXA);
    // A frase seguinte ja comeca inteira: nada de 6 dB a menos no comeco.
    const volta = rodar(p, [voz(0.1), silencio()], 0.05, 4 * TAXA);
    expect(Math.abs(db(rmsDe(volta) / 0.1))).toBeLessThan(0.2);
  });

  it('histerese: um canal 12 dB abaixo continua contando se ja contava', () => {
    const forte = voz(0.1);
    const fraco = (i: number) => forte(i) * 10 ** (-12 / 20);
    const saida = rodar(new Mono(), [forte, fraco], 1);
    // Media dos dois (mesma forma de onda): (1 + 0,25) / 2 = 0,63 -> -4 dB.
    expect(db(firme(saida) / 0.1)).toBeCloseTo(db((1 + 10 ** (-12 / 20)) / 2), 1);
  });

  it('arranjo de 4 microfones com voz em 2: media so dos 2', () => {
    const gerar = voz(0.1);
    const saida = rodar(new Mono(), [gerar, gerar, silencio(), silencio()], 1);
    expect(Math.abs(db(firme(saida) / 0.1))).toBeLessThan(0.2);
  });

  it('sem entrada, silencio', () => {
    const p = new Mono();
    const out = [new Float32Array(BLOCO).fill(1)];
    expect(p.process([[]], [out])).toBe(true);
    expect(Math.max(...out[0]!.map(Math.abs))).toBe(0);
  });

  it('troca de voz de um lado para outro sem estalo (rampa)', () => {
    const p = new Mono();
    rodar(p, [voz(0.1), silencio()], 1);
    const troca = rodar(p, [silencio(), voz(0.1)], 1, TAXA);
    // Nenhuma amostra passa do pico da voz: a troca de peso nao cria degrau.
    const pico = 0.1 * Math.SQRT2;
    expect(Math.max(...troca.map(Math.abs))).toBeLessThanOrEqual(pico * 1.001);
    expect(Math.abs(db(firme(troca) / 0.1))).toBeLessThan(0.2);
  });
});

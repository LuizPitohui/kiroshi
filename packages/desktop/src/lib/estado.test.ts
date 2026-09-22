/**
 * A faixa de estado so vale se ela nao mentir.
 *
 * Um instrumento que mostra numero errado e pior que instrumento nenhum: ele
 * e consultado justamente no momento ruim, quando a pessoa ja esta tentando
 * entender por que a voz esta picotando. Estes testes cobrem os casos em que
 * seria facil mentir sem ninguem notar — o zero que finge medicao, a contagem
 * que esquece de contar voce, o grau que classifica errado.
 */
import { describe, it, expect } from 'vitest';
import { lerElo, lerLatencia, lerVoz, lerRelogio } from './estado.js';

describe('o elo com o servidor', () => {
  it('conectado le como bom', () => {
    expect(lerElo('ready').grau).toBe('bom');
  });

  /*
    `identifying` e o soquete ja de pe, aguardando o servidor conferir a
    sessao. Dura frações de segundo. Pintar de ambar nesse intervalo faria a
    faixa piscar em toda conexao normal, e quem ve um aviso piscar sem motivo
    aprende a nao olhar mais para ele.
  */
  it('e confirmar a sessao NAO e motivo de aviso', () => {
    expect(lerElo('identifying').grau).toBe('bom');
  });

  it('religando avisa, sem alarmar', () => {
    const r = lerElo('reconnecting');
    expect(r.grau).toBe('atencao');
    expect(r.rotulo).toBe('RELIGANDO');
  });

  it('sem conexao e o unico caso vermelho', () => {
    expect(lerElo('failed').grau).toBe('ruim');
    expect(lerElo('connecting').grau).not.toBe('ruim');
    expect(lerElo('idle').grau).not.toBe('ruim');
  });

  it('todo estado tem descricao para leitor de tela', () => {
    const estados = ['idle', 'connecting', 'identifying', 'ready', 'reconnecting', 'failed'] as const;
    for (const e of estados) {
      expect(lerElo(e).descricao.length).toBeGreaterThan(8);
    }
  });
});

describe('a latencia', () => {
  /*
    O caso que importa: fora de chamada nao ha medicao. Zero seria uma mentira
    PRECISA — "medi e deu zero" — e zero milissegundos ainda por cima leria
    como conexao perfeita, que e o oposto de "nao sei".
  */
  it('sem medicao vira traco, nunca zero', () => {
    expect(lerLatencia(null).texto).toBe('--');
  });

  it('e numero quebrado tambem', () => {
    expect(lerLatencia(Number.NaN).texto).toBe('--');
    expect(lerLatencia(Number.POSITIVE_INFINITY).texto).toBe('--');
  });

  it('boa ate 60ms', () => {
    expect(lerLatencia(42)).toEqual({ texto: '42MS', grau: 'bom' });
    expect(lerLatencia(59).grau).toBe('bom');
  });

  it('atencao entre 60 e 150', () => {
    expect(lerLatencia(60).grau).toBe('atencao');
    expect(lerLatencia(149).grau).toBe('atencao');
  });

  it('ruim de 150 em diante, que e onde a conversa quebra', () => {
    expect(lerLatencia(150).grau).toBe('ruim');
    expect(lerLatencia(400).grau).toBe('ruim');
  });

  it('arredonda em vez de mostrar casa decimal', () => {
    expect(lerLatencia(42.6).texto).toBe('43MS');
  });

  it('negativo nao aparece na tela', () => {
    expect(lerLatencia(-5).texto).toBe('0MS');
  });
});

describe('quantas pessoas na chamada', () => {
  /*
    `participants` e a lista dos OUTROS — quem esta lendo nao aparece nela.
    Mostrar o numero cru daria "3" numa sala de quatro, e quem conta cabecas
    na tela concluiria que o aplicativo perdeu alguem.
  */
  it('conta voce junto', () => {
    expect(lerVoz(true, 3)).toBe('4');
  });

  it('sozinho na sala e um, nao zero', () => {
    expect(lerVoz(true, 0)).toBe('1');
  });

  it('fora de chamada e traco', () => {
    expect(lerVoz(false, 0)).toBe('--');
    expect(lerVoz(false, 5)).toBe('--');
  });
});

describe('o relogio', () => {
  it('tem segundos, que e o que prova que a tela esta viva', () => {
    expect(lerRelogio(new Date(2026, 8, 22, 5, 31, 42))).toBe('05:31:42');
  });

  it('e cada campo vai com dois digitos', () => {
    expect(lerRelogio(new Date(2026, 8, 22, 9, 5, 3))).toBe('09:05:03');
  });

  it('meia-noite nao vira 24', () => {
    expect(lerRelogio(new Date(2026, 8, 22, 0, 0, 0))).toBe('00:00:00');
  });
});

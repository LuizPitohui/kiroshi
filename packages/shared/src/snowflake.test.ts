import { describe, expect, it } from 'vitest';
import {
  compareIds,
  generateId,
  idFromTimestamp,
  isSnowflake,
  ORDER_EPOCH,
  SnowflakeGenerator,
  timestampOf,
} from './snowflake.js';

describe('SnowflakeGenerator', () => {
  it('nunca repete, mesmo gerando muito rapido', () => {
    const gen = new SnowflakeGenerator(1, 1);
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i++) ids.add(gen.next());
    expect(ids.size).toBe(20_000);
  });

  it('gera ids crescentes', () => {
    const gen = new SnowflakeGenerator(1, 1);
    let previous = gen.next();
    for (let i = 0; i < 5_000; i++) {
      const current = gen.next();
      expect(compareIds(current, previous)).toBe(1);
      previous = current;
    }
  });

  it('workers diferentes nunca colidem no mesmo ms', () => {
    const a = new SnowflakeGenerator(1, 0);
    const b = new SnowflakeGenerator(2, 0);
    const ids = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      ids.add(a.next());
      ids.add(b.next());
    }
    expect(ids.size).toBe(2_000);
  });

  it('nao emite id duplicado se o relogio voltar', () => {
    const gen = new SnowflakeGenerator(3, 3);
    const before = Date.now;
    let fake = 1_760_000_000_000;
    Date.now = () => fake;
    const ids = new Set<string>();
    try {
      for (let i = 0; i < 100; i++) ids.add(gen.next());
      fake -= 5_000; // NTP puxou o relogio para tras
      for (let i = 0; i < 100; i++) ids.add(gen.next());
    } finally {
      Date.now = before;
    }
    expect(ids.size).toBe(200);
  });
});

describe('timestampOf', () => {
  it('recupera o momento de criacao', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    const ts = timestampOf(id).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it('idFromTimestamp e coerente com timestampOf', () => {
    const when = new Date('2025-06-15T12:00:00.000Z');
    expect(timestampOf(idFromTimestamp(when)).getTime()).toBe(when.getTime());
  });

  it('a epoca corresponde a 2024-01-01', () => {
    expect(new Date(Number(ORDER_EPOCH)).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('compareIds', () => {
  it('compara numericamente, nao como string', () => {
    // Como texto "9" > "10"; como numero nao.
    expect(compareIds('9', '10')).toBe(-1);
  });

  it('retorna zero para iguais', () => {
    expect(compareIds('12345', '12345')).toBe(0);
  });

  it('ordena uma lista corretamente', () => {
    const ids = ['100', '9', '1000', '20'];
    expect([...ids].sort(compareIds)).toEqual(['9', '20', '100', '1000']);
  });
});

describe('isSnowflake', () => {
  it('aceita id gerado', () => {
    expect(isSnowflake(generateId())).toBe(true);
  });

  it('rejeita lixo', () => {
    expect(isSnowflake('abc')).toBe(false);
    expect(isSnowflake('')).toBe(false);
    expect(isSnowflake('-1')).toBe(false);
    expect(isSnowflake('1.5')).toBe(false);
    expect(isSnowflake(123 as unknown)).toBe(false);
    expect(isSnowflake(null)).toBe(false);
  });

  it('rejeita numero acima de 64 bits', () => {
    expect(isSnowflake('99999999999999999999')).toBe(false);
  });
});

describe('compareIds nao derruba quem chama', () => {
  /*
    Estes casos vem de um defeito real em producao: a mensagem otimista do
    compositor usava id "temp-<snowflake>", que chegava aqui e estourava no
    BigInt. A excecao subia pela ordenacao da lista e abortava o envio antes
    da requisicao sair — sem mensagem, sem erro na tela. Num canal vazio nao
    havia comparacao, entao a primeira mensagem passava e todas as seguintes
    falhavam caladas.
  */
  it('aceita id que nao e snowflake sem lancar', () => {
    expect(() => compareIds('temp-123', '456')).not.toThrow();
    expect(() => compareIds('456', 'temp-123')).not.toThrow();
    expect(() => compareIds('abc', 'def')).not.toThrow();
    expect(() => compareIds('', '')).not.toThrow();
  });

  it('coloca o que nao e snowflake depois do que e', () => {
    expect(compareIds('temp-1', '999')).toBe(1);
    expect(compareIds('999', 'temp-1')).toBe(-1);
  });

  it('desempata entre dois nao-snowflakes de forma estavel', () => {
    expect(compareIds('aaa', 'bbb')).toBe(-1);
    expect(compareIds('bbb', 'aaa')).toBe(1);
    expect(compareIds('igual', 'igual')).toBe(0);
  });

  it('continua ordenando snowflakes por valor, nao por texto', () => {
    // Como texto, "9" > "10"; como numero, nao.
    expect(compareIds('9', '10')).toBe(-1);
    expect(compareIds('359560585490903040', '359560585490903041')).toBe(-1);
  });

  it('uma lista com id invalido no meio ainda ordena', () => {
    const ids = ['300', 'temp-1', '100', '200'];
    expect(() => [...ids].sort(compareIds)).not.toThrow();
    expect([...ids].sort(compareIds)).toEqual(['100', '200', '300', 'temp-1']);
  });
});

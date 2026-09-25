import { describe, expect, it } from 'vitest';
import { quemChamar } from './chamada.js';

const nada = new Set<string>();

describe('quemChamar', () => {
  it('numa DM, toca para o outro lado', () => {
    expect(quemChamar({ destinatarios: ['a', 'b'], naChamada: ['a'], quemPede: 'a', bloqueados: nada })).toEqual(['b']);
  });

  it('num grupo, toca para todos que ainda nao entraram', () => {
    expect(
      quemChamar({ destinatarios: ['a', 'b', 'c', 'd'], naChamada: ['a', 'c'], quemPede: 'a', bloqueados: nada }),
    ).toEqual(['b', 'd']);
  });

  it('nao toca para quem tem bloqueio com quem liga', () => {
    expect(
      quemChamar({ destinatarios: ['a', 'b', 'c'], naChamada: ['a'], quemPede: 'a', bloqueados: new Set(['b']) }),
    ).toEqual(['c']);
  });

  it('quem liga nunca toca para si, mesmo fora da lista da chamada', () => {
    expect(quemChamar({ destinatarios: ['a', 'b'], naChamada: [], quemPede: 'a', bloqueados: nada })).toEqual(['b']);
  });

  it('lista repetida nao toca duas vezes', () => {
    expect(quemChamar({ destinatarios: ['a', 'b', 'b'], naChamada: ['a'], quemPede: 'a', bloqueados: nada })).toEqual(['b']);
  });

  it('com todo mundo dentro, ninguem toca', () => {
    expect(quemChamar({ destinatarios: ['a', 'b'], naChamada: ['a', 'b'], quemPede: 'b', bloqueados: nada })).toEqual([]);
  });
});

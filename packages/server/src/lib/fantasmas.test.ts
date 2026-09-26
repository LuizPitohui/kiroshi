import { describe, expect, it } from 'vitest';
import { chaveDaAusencia, conferirFantasmas } from './fantasmas.js';

const sala = (canal: string): string => `channel_${canal}`;
const PRAZO = 60_000;
const estado = (userId: string, channelId = 'c1', sessionId = 's1') => ({ userId, channelId, sessionId });
const presentes = (pares: Record<string, string[]>) =>
  new Map(Object.entries(pares).map(([canal, ids]) => [sala(canal), new Set(ids)]));

describe('conferencia dos estados de voz com o SFU', () => {
  it('quem esta na sala fica, e nao conta ausencia', () => {
    const r = conferirFantasmas([estado('a')], presentes({ c1: ['a'] }), sala, new Map(), 1_000, PRAZO);
    expect(r.encerrar).toEqual([]);
    expect(r.ausentes.size).toBe(0);
  });

  it('a primeira ausencia so comeca a contar: ninguem sai de primeira', () => {
    const r = conferirFantasmas([estado('a')], presentes({}), sala, new Map(), 1_000, PRAZO);
    expect(r.encerrar).toEqual([]);
    expect(r.ausentes.get(chaveDaAusencia(estado('a')))).toBe(1_000);
  });

  it('ausente ha menos que o prazo: continua na lista (entrando ou reconectando)', () => {
    const antes = new Map([[chaveDaAusencia(estado('a')), 1_000]]);
    const r = conferirFantasmas([estado('a')], presentes({}), sala, antes, 1_000 + PRAZO - 1, PRAZO);
    expect(r.encerrar).toEqual([]);
  });

  it('ausente pelo prazo inteiro: sai', () => {
    const antes = new Map([[chaveDaAusencia(estado('a')), 1_000]]);
    const r = conferirFantasmas([estado('a')], presentes({}), sala, antes, 1_000 + PRAZO, PRAZO);
    expect(r.encerrar).toEqual([estado('a')]);
    expect(r.ausentes.size).toBe(0);
  });

  it('voltou para a sala antes do prazo: a conta zera', () => {
    const antes = new Map([[chaveDaAusencia(estado('a')), 1_000]]);
    const r = conferirFantasmas([estado('a')], presentes({ c1: ['a'] }), sala, antes, 50_000, PRAZO);
    expect(r.ausentes.size).toBe(0);
    // e se sumir de novo, conta do zero
    const r2 = conferirFantasmas([estado('a')], presentes({}), sala, r.ausentes, 55_000, PRAZO);
    expect(r2.ausentes.get(chaveDaAusencia(estado('a')))).toBe(55_000);
  });

  it('estar na sala de OUTRO canal nao conta: a pessoa consta num canal e esta em outro', () => {
    const antes = new Map([[chaveDaAusencia(estado('a', 'c1')), 0]]);
    const r = conferirFantasmas([estado('a', 'c1')], presentes({ c2: ['a'] }), sala, antes, PRAZO, PRAZO);
    expect(r.encerrar).toEqual([estado('a', 'c1')]);
  });

  it('trocar de canal ou de sessao comeca a conta de novo', () => {
    const antes = new Map([[chaveDaAusencia(estado('a', 'c1', 's1')), 0]]);
    const trocouCanal = conferirFantasmas([estado('a', 'c2', 's1')], presentes({}), sala, antes, PRAZO, PRAZO);
    expect(trocouCanal.encerrar).toEqual([]);
    const trocouSessao = conferirFantasmas([estado('a', 'c1', 's2')], presentes({}), sala, antes, PRAZO, PRAZO);
    expect(trocouSessao.encerrar).toEqual([]);
  });

  it('quem saiu do banco some da conta sozinho', () => {
    const antes = new Map([[chaveDaAusencia(estado('a')), 0], [chaveDaAusencia(estado('b')), 0]]);
    const r = conferirFantasmas([estado('b')], presentes({ c1: ['b'] }), sala, antes, 10, PRAZO);
    expect(r.ausentes.size).toBe(0);
  });

  it('cada pessoa e decidida por si: um fantasma nao leva quem esta na sala', () => {
    const antes = new Map([[chaveDaAusencia(estado('fantasma')), 0]]);
    const r = conferirFantasmas([estado('fantasma'), estado('real')], presentes({ c1: ['real'] }), sala, antes, PRAZO, PRAZO);
    expect(r.encerrar.map((e) => e.userId)).toEqual(['fantasma']);
  });
});

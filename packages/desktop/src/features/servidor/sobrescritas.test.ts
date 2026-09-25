import { describe, expect, it } from 'vitest';
import { Permission } from '@kiroshi/shared';
import { bitsDe, comEstado, estadoDoBit, paraEnviar, privadoDeFato, sincronizado, valorHerdado, vazia } from './sobrescritas.js';

const V = Permission.VIEW_CHANNEL;
const S = Permission.SEND_MESSAGES;

describe('tres estados por permissao', () => {
  it('le negar, permitir e herdar', () => {
    const bits = bitsDe({ allow: String(S), deny: String(V) });
    expect(estadoDoBit(bits, V)).toBe('negar');
    expect(estadoDoBit(bits, S)).toBe('permitir');
    expect(estadoDoBit(bits, Permission.ATTACH_FILES)).toBe('herdar');
  });

  it('trocar o estado mexe so naquele bit', () => {
    let bits = bitsDe({ allow: String(S), deny: String(V) });
    bits = comEstado(bits, V, 'permitir');
    expect(bits).toEqual({ allow: S | V, deny: 0n });
    bits = comEstado(bits, S, 'herdar');
    expect(bits).toEqual({ allow: V, deny: 0n });
    bits = comEstado(bits, V, 'negar');
    expect(bits).toEqual({ allow: 0n, deny: V });
  });

  it('sem nenhum bit dito, a sobrescrita e vazia', () => {
    expect(vazia(comEstado(bitsDe({ allow: '0', deny: String(V) }), V, 'herdar'))).toBe(true);
  });

  it('vai para o servidor como texto', () => {
    expect(paraEnviar({ allow: V, deny: S })).toEqual({ allow: String(V), deny: String(S) });
  });

  it('o herdado vem da categoria e, sem nada la, do cargo', () => {
    expect(valorHerdado(V, { allow: 0n, deny: V }, V)).toEqual({ permitido: false, de: 'categoria' });
    expect(valorHerdado(S, { allow: 0n, deny: V }, S)).toEqual({ permitido: true, de: 'cargo' });
    expect(valorHerdado(S, null, 0n)).toEqual({ permitido: false, de: 'cargo' });
    expect(valorHerdado(S, null, Permission.ADMINISTRATOR)).toEqual({ permitido: true, de: 'cargo' });
    expect(valorHerdado(S, null, null)).toBeNull();
  });

  it('privado de fato: pelo canal, pela categoria ou pelo proprio everyone', () => {
    const vazio = { allow: 0n, deny: 0n };
    expect(privadoDeFato({ allow: 0n, deny: V }, null, V)).toBe(true);
    expect(privadoDeFato(vazio, { allow: 0n, deny: V }, V)).toBe(true);
    expect(privadoDeFato({ allow: V, deny: 0n }, { allow: 0n, deny: V }, V)).toBe(false);
    expect(privadoDeFato(vazio, null, 0n)).toBe(true);
    expect(privadoDeFato(vazio, null, V)).toBe(false);
  });

  it('sem sobrescrita, o canal da categoria esta sincronizado', () => {
    expect(sincronizado({ parentId: 'c', overwrites: [] })).toBe(true);
    expect(sincronizado({ parentId: 'c', overwrites: [{ targetId: 'g', targetType: 'ROLE', allow: '1', deny: '0' }] })).toBe(false);
    expect(sincronizado({ parentId: null, overwrites: [] })).toBe(false);
  });
});

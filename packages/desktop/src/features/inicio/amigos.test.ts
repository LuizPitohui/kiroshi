import { describe, expect, it } from 'vitest';
import type { PresenceStatus, Relationship, VoiceState } from '@kiroshi/shared';
import { amigosEmVoz, filtrarPorBusca, relacoesDaAba } from './amigos.js';

const relacao = (id: string, type: Relationship['type'], displayName: string, username = displayName.toLowerCase()): Relationship => ({
  id: `r${id}`,
  type,
  createdAt: '2026-09-25T00:00:00.000Z',
  user: { id, username, displayName, avatarUrl: null } as Relationship['user'],
});

const todas = [
  relacao('1', 'FRIEND', 'Zé'),
  relacao('2', 'FRIEND', 'ana'),
  relacao('3', 'FRIEND', 'Bruno'),
  relacao('4', 'PENDING_OUTGOING', 'Carla'),
  relacao('5', 'PENDING_INCOMING', 'Duda'),
  relacao('6', 'PENDING_INCOMING', 'Beto'),
  relacao('7', 'BLOCKED', 'Troll'),
];
const status: Record<string, PresenceStatus> = { '1': 'ONLINE', '2': 'OFFLINE', '3': 'DND' };
const statusDe = (id: string): PresenceStatus => status[id] ?? 'OFFLINE';
const nomes = (rs: Relationship[]) => rs.map((r) => r.user.displayName);

describe('relacoesDaAba', () => {
  it('online: amigos que nao estao offline, por nome sem ligar para caixa', () => {
    expect(nomes(relacoesDaAba(todas, 'online', statusDe))).toEqual(['Bruno', 'Zé']);
  });
  it('todos: todos os amigos', () => {
    expect(nomes(relacoesDaAba(todas, 'todos', statusDe))).toEqual(['ana', 'Bruno', 'Zé']);
  });
  it('pendentes: recebidos primeiro, depois enviados', () => {
    expect(nomes(relacoesDaAba(todas, 'pendentes', statusDe))).toEqual(['Beto', 'Duda', 'Carla']);
  });
  it('bloqueados: so os bloqueios', () => {
    expect(nomes(relacoesDaAba(todas, 'bloqueados', statusDe))).toEqual(['Troll']);
  });
});

describe('filtrarPorBusca', () => {
  it('acha sem acento e sem caixa, pelo nome ou pelo usuario', () => {
    const lista = [relacao('1', 'FRIEND', 'João', 'jp_gamer'), relacao('2', 'FRIEND', 'Maria')];
    expect(nomes(filtrarPorBusca(lista, 'joao'))).toEqual(['João']);
    expect(nomes(filtrarPorBusca(lista, 'GAMER'))).toEqual(['João']);
  });
  it('busca vazia devolve tudo', () => {
    expect(filtrarPorBusca(todas, '  ')).toHaveLength(todas.length);
  });
});

describe('amigosEmVoz', () => {
  const voz = (userId: string, channelId: string | null, joinedAt: string): VoiceState =>
    ({ userId, channelId, guildId: null, joinedAt }) as VoiceState;

  it('so amigos em algum canal, na ordem em que entraram', () => {
    const estados = [voz('3', 'c1', '2026-09-25T10:02:00Z'), voz('9', 'c1', '2026-09-25T10:00:00Z'), voz('1', 'c2', '2026-09-25T10:01:00Z')];
    expect(amigosEmVoz(['1', '3'], estados).map((v) => v.userId)).toEqual(['1', '3']);
  });
});

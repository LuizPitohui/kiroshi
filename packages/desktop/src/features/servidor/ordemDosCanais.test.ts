import { describe, expect, it } from 'vitest';
import type { Channel } from '@kiroshi/shared';
import { moverCanal, moverCategoria } from './ordemDosCanais.js';

const canal = (id: string, type: Channel['type'], position: number): Channel => ({
  id,
  type,
  guildId: 'g',
  name: id,
  topic: null,
  position,
  parentId: 'cat',
  nsfw: false,
  rateLimitPerUser: 0,
  bitrate: null,
  userLimit: null,
  overwrites: [],
  recipientIds: [],
  ownerId: null,
  iconUrl: null,
  lastMessageId: null,
  createdAt: '',
});

// Na ordem da tela: texto antes de voz.
const grupo = [canal('geral', 'GUILD_TEXT', 0), canal('clipes', 'GUILD_TEXT', 1), canal('voz', 'GUILD_VOICE', 0), canal('jogos', 'GUILD_VOICE', 1)];

describe('moverCanal', () => {
  it('troca dois canais de texto e renumera o grupo', () => {
    expect(moverCanal(grupo, 1, 0)).toEqual([
      { id: 'clipes', position: 0 },
      { id: 'geral', position: 1 },
      { id: 'voz', position: 2 },
      { id: 'jogos', position: 3 },
    ]);
  });

  it('nao poe texto no meio da voz', () => {
    expect(moverCanal(grupo, 1, 2)).toBeNull();
    expect(moverCanal(grupo, 2, 1)).toBeNull();
  });

  it('fora da lista ou no mesmo lugar, nada', () => {
    expect(moverCanal(grupo, 0, 0)).toBeNull();
    expect(moverCanal(grupo, 3, 4)).toBeNull();
    expect(moverCanal(grupo, 0, -1)).toBeNull();
  });
});

describe('moverCategoria', () => {
  it('sobe a categoria', () => {
    const cats = [canal('a', 'GUILD_CATEGORY', 0), canal('b', 'GUILD_CATEGORY', 1)];
    expect(moverCategoria(cats, 1, 0)).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Channel } from '@kiroshi/shared';
import { agruparCanais, iniciaisDe, rasoIgual } from './organizar.js';

function canal(id: string, type: Channel['type'], position: number, parentId: string | null = null): Channel {
  return {
    id,
    type,
    guildId: '1',
    name: id,
    topic: null,
    position,
    parentId,
    nsfw: false,
    rateLimitPerUser: 0,
    bitrate: null,
  } as unknown as Channel;
}

describe('agruparCanais', () => {
  const canais = [
    canal('voz-geral', 'GUILD_VOICE', 0, 'cat-voz'),
    canal('cat-texto', 'GUILD_CATEGORY', 0),
    canal('cat-voz', 'GUILD_CATEGORY', 1),
    canal('solto', 'GUILD_TEXT', 5),
    canal('geral', 'GUILD_TEXT', 1, 'cat-texto'),
    canal('avisos', 'GUILD_ANNOUNCEMENT', 0, 'cat-texto'),
    canal('voz-na-texto', 'GUILD_VOICE', 0, 'cat-texto'),
    canal('orfao', 'GUILD_TEXT', 2, 'categoria-que-sumiu'),
  ];

  it('canais soltos (e os de categoria que nao existe) vem primeiro, sem cabecalho', () => {
    const [primeiro] = agruparCanais(canais);
    expect(primeiro?.categoria).toBeNull();
    expect(primeiro?.canais.map((c) => c.id)).toEqual(['orfao', 'solto']);
  });

  it('categorias na ordem do servidor; dentro, texto antes de voz e cada um pela posicao', () => {
    const grupos = agruparCanais(canais);
    expect(grupos.map((g) => g.categoria?.id ?? null)).toEqual([null, 'cat-texto', 'cat-voz']);
    expect(grupos[1]?.canais.map((c) => c.id)).toEqual(['avisos', 'geral', 'voz-na-texto']);
    expect(grupos[2]?.canais.map((c) => c.id)).toEqual(['voz-geral']);
  });

  it('servidor sem categoria nenhuma vira um grupo so', () => {
    const grupos = agruparCanais([canal('a', 'GUILD_TEXT', 1), canal('b', 'GUILD_TEXT', 0)]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.canais.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('iniciaisDe', () => {
  it('ate duas palavras, em maiuscula', () => {
    expect(iniciaisDe('Arasaka')).toBe('A');
    expect(iniciaisDe('night city crew')).toBe('NC');
    expect(iniciaisDe('  espacos   demais  ')).toBe('ED');
  });

  it('nome vazio nao deixa o botao em branco', () => {
    expect(iniciaisDe('')).toBe('?');
  });
});

describe('rasoIgual', () => {
  it('compara item a item', () => {
    const x = { a: 1 };
    expect(rasoIgual([x, 2], [x, 2])).toBe(true);
    expect(rasoIgual([x], [{ a: 1 }])).toBe(false);
    expect(rasoIgual([1, 2], [1])).toBe(false);
  });
});

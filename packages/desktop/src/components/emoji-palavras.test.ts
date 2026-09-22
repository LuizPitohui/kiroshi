/**
 * A busca de emoji filtrava so o nome do grupo, entao "feliz" e "coracao" nao
 * achavam nada. Estes testes cobrem as duas metades do conserto: cada emoji
 * tem palavra, e a palavra acha o emoji.
 */

import { describe, it, expect } from 'vitest';
import { PALAVRAS_DE_EMOJI, emojiCombina, normalizar } from './emoji-palavras.js';
import { GROUPS } from './EmojiPicker.js';

const TODOS = Object.keys(PALAVRAS_DE_EMOJI);
const NO_SELETOR = GROUPS.flatMap((g) => g.emojis);

function buscar(termo: string): string[] {
  const alvo = normalizar(termo);
  return TODOS.filter((e) => emojiCombina(e, alvo));
}

describe('palavras de emoji', () => {
  /*
    Confere contra a lista de verdade, nao contra um numero escolhido a mao.
    Assim, quem acrescentar um emoji no seletor e esquecer das palavras ve o
    teste falhar apontando exatamente qual ficou de fora — em vez de a busca
    ficar silenciosamente cega para ele.
  */
  it('todo emoji do seletor tem palavras de busca', () => {
    const semPalavras = NO_SELETOR.filter((e) => !PALAVRAS_DE_EMOJI[e]);
    expect(semPalavras).toEqual([]);
  });

  it('nenhum emoji fica com a lista de palavras vazia', () => {
    const vazios = TODOS.filter((e) => PALAVRAS_DE_EMOJI[e]!.trim().length === 0);
    expect(vazios).toEqual([]);
  });

  it('nao ha palavras sobrando para emoji que nao esta no seletor', () => {
    const orfaos = TODOS.filter((e) => !NO_SELETOR.includes(e));
    expect(orfaos).toEqual([]);
  });

  it('o seletor nao repete emoji', () => {
    expect(new Set(NO_SELETOR).size).toBe(NO_SELETOR.length);
  });
});

describe('buscar emoji', () => {
  it('acha pelo que a pessoa realmente digita', () => {
    expect(buscar('risada')).toContain('😂');
    expect(buscar('coracao')).toContain('❤️');
    expect(buscar('fogo')).toContain('🔥');
    expect(buscar('joia')).toContain('👍');
    expect(buscar('festa')).toContain('🎉');
    expect(buscar('pizza')).toContain('🍕');
    expect(buscar('raiva')).toContain('😡');
    expect(buscar('dormindo')).toContain('😴');
  });

  it('acha com e sem acento', () => {
    expect(buscar('coração')).toContain('❤️');
    expect(buscar('coracao')).toContain('❤️');
  });

  it('nao diferencia maiuscula de minuscula', () => {
    expect(buscar('FOGO')).toContain('🔥');
    expect(buscar('FoGo')).toContain('🔥');
  });

  it('acha por pedaco do termo, como quem digita no meio', () => {
    expect(buscar('gargalh')).toContain('🤣');
    expect(buscar('aniver')).toContain('🎂');
  });

  it('acha por giria e por termo tecnico', () => {
    expect(buscar('kkk')).toContain('😂');
    expect(buscar('grana')).toContain('💰');
    expect(buscar('gamer')).toContain('🎮');
    expect(buscar('academia')).toContain('💪');
  });

  it('um termo generico traz mais de um resultado', () => {
    expect(buscar('coracao').length).toBeGreaterThan(5);
    expect(buscar('gato').length).toBeGreaterThan(5);
    expect(buscar('dinheiro').length).toBeGreaterThan(3);
  });

  it('termo sem correspondencia devolve lista vazia', () => {
    expect(buscar('xyzabc123')).toEqual([]);
  });

  it('emoji desconhecido nao quebra a comparacao', () => {
    expect(() => emojiCombina('🫥', 'qualquer')).not.toThrow();
    expect(emojiCombina('🫥', 'qualquer')).toBe(false);
  });
});

describe('normalizar', () => {
  it('tira acento e caixa', () => {
    expect(normalizar('Coração')).toBe('coracao');
    expect(normalizar('AÇÚCAR')).toBe('acucar');
    expect(normalizar('já')).toBe('ja');
  });

  it('deixa texto sem acento intacto', () => {
    expect(normalizar('fogo')).toBe('fogo');
  });
});

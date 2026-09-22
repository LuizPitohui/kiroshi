import { describe, expect, it } from 'vitest';
import {
  escapeMarkdown,
  extractUrls,
  formatCustomEmoji,
  isOnlyEmojis,
  parseCustomEmojis,
  parseMentions,
  toPlainText,
} from './markdown.js';

describe('parseMentions', () => {
  it('extrai usuarios, cargos e canais', () => {
    const r = parseMentions('oi <@111> e <@&222>, vejam <#333>');
    expect(r.userIds).toEqual(['111']);
    expect(r.roleIds).toEqual(['222']);
    expect(r.channelIds).toEqual(['333']);
  });

  it('remove duplicatas', () => {
    expect(parseMentions('<@111> <@111> <@111>').userIds).toEqual(['111']);
  });

  it('detecta everyone e here', () => {
    expect(parseMentions('atencao @everyone').everyone).toBe(true);
    expect(parseMentions('@here alguem ai').here).toBe(true);
  });

  it('nao aciona everyone quando faz parte de outra palavra', () => {
    expect(parseMentions('email@everyone.com').everyone).toBe(false);
  });

  it('ignora mencoes dentro de bloco de codigo', () => {
    const r = parseMentions('```\n<@111> @everyone\n```');
    expect(r.userIds).toEqual([]);
    expect(r.everyone).toBe(false);
  });

  it('ignora mencoes dentro de codigo inline', () => {
    const r = parseMentions('use `<@111>` para mencionar');
    expect(r.userIds).toEqual([]);
  });

  it('pega mencao fora do bloco de codigo mas nao a de dentro', () => {
    const r = parseMentions('<@999> olha:\n```\n<@111>\n```');
    expect(r.userIds).toEqual(['999']);
  });
});

describe('parseCustomEmojis', () => {
  it('le emoji estatico e animado', () => {
    const r = parseCustomEmojis('<:pepe:123> e <a:dance:456>');
    expect(r).toEqual([
      { id: '123', name: 'pepe', animated: false },
      { id: '456', name: 'dance', animated: true },
    ]);
  });

  it('formata de volta para a mesma sintaxe', () => {
    expect(formatCustomEmoji('pepe', '123')).toBe('<:pepe:123>');
    expect(formatCustomEmoji('dance', '456', true)).toBe('<a:dance:456>');
  });
});

describe('extractUrls', () => {
  it('encontra urls', () => {
    const urls = extractUrls('veja https://exemplo.com/a e http://outro.org');
    expect(urls).toEqual(['https://exemplo.com/a', 'http://outro.org']);
  });

  it('tira pontuacao final grudada', () => {
    expect(extractUrls('olha https://exemplo.com.')).toEqual(['https://exemplo.com']);
  });

  it('ignora url em bloco de codigo', () => {
    expect(extractUrls('```https://exemplo.com```')).toEqual([]);
  });

  it('respeita o limite', () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://e${i}.com`).join(' ');
    expect(extractUrls(many, 3)).toHaveLength(3);
  });
});

describe('toPlainText', () => {
  it('resolve mencoes com o dicionario dado', () => {
    const out = toPlainText('oi <@111> em <#333>', {
      user: (id) => (id === '111' ? 'ana' : undefined),
      channel: (id) => (id === '333' ? 'geral' : undefined),
    });
    expect(out).toBe('oi @ana em #geral');
  });

  it('usa rotulo generico quando nao resolve', () => {
    expect(toPlainText('<@999>')).toBe('@desconhecido');
  });

  it('tira a formatacao', () => {
    expect(toPlainText('**forte** e _leve_')).toBe('forte e leve');
  });

  it('esconde o conteudo do spoiler', () => {
    expect(toPlainText('||segredo||')).toBe('spoiler');
  });
});

describe('escapeMarkdown', () => {
  it('escapa os marcadores', () => {
    expect(escapeMarkdown('**oi**')).toBe('\\*\\*oi\\*\\*');
  });
});

describe('isOnlyEmojis', () => {
  it('reconhece so emojis customizados', () => {
    expect(isOnlyEmojis('<:pepe:123> <:pepe:123>')).toBe(true);
  });

  it('reconhece so emojis unicode', () => {
    expect(isOnlyEmojis('🎉🎊')).toBe(true);
  });

  it('nega quando ha texto junto', () => {
    expect(isOnlyEmojis('oi 🎉')).toBe(false);
  });

  it('nega string vazia', () => {
    expect(isOnlyEmojis('   ')).toBe(false);
  });
});

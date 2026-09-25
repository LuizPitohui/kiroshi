import { describe, expect, it } from 'vitest';
import { analisar, type Bloco, type Trecho } from './markdown.js';

/** Os trechos de uma mensagem de um bloco so, para os casos em linha. */
function trechos(conteudo: string): Trecho[] {
  const blocos = analisar(conteudo);
  expect(blocos).toHaveLength(1);
  const [bloco] = blocos as [Bloco];
  if (bloco.tipo === 'codigo') throw new Error('esperava texto');
  return bloco.filhos;
}

const t = (texto: string): Trecho => ({ tipo: 'texto', texto });

describe('analisar: formatacao', () => {
  it('texto puro fica um trecho so', () => {
    expect(trechos('oi, tudo bem?')).toEqual([t('oi, tudo bem?')]);
  });

  it('negrito, italico, sublinhado, riscado e spoiler', () => {
    expect(trechos('**a** *b* __c__ ~~d~~ ||e||')).toEqual([
      { tipo: 'negrito', filhos: [t('a')] },
      t(' '),
      { tipo: 'italico', filhos: [t('b')] },
      t(' '),
      { tipo: 'sublinhado', filhos: [t('c')] },
      t(' '),
      { tipo: 'riscado', filhos: [t('d')] },
      t(' '),
      { tipo: 'spoiler', filhos: [t('e')] },
    ]);
  });

  it('italico por fora de negrito nao se perde (a 1.x perdia)', () => {
    expect(trechos('*a **b** c*')).toEqual([
      { tipo: 'italico', filhos: [t('a '), { tipo: 'negrito', filhos: [t('b')] }, t(' c')] },
    ]);
  });

  it('tres asteriscos: italico e negrito juntos', () => {
    const [unico] = trechos('***x***');
    expect(unico?.tipo).toBe('italico');
    expect(unico).toEqual({ tipo: 'italico', filhos: [{ tipo: 'negrito', filhos: [t('x')] }] });
  });

  it('sublinhado no meio da palavra nao vira italico', () => {
    expect(trechos('abre o nome_do_arquivo.txt')).toEqual([t('abre o nome_do_arquivo.txt')]);
  });

  it('sublinhado na borda da palavra vira italico, inclusive com acento', () => {
    expect(trechos('isso é _muito_ bom')).toEqual([t('isso é '), { tipo: 'italico', filhos: [t('muito')] }, t(' bom')]);
    expect(trechos('olá_mundo_')).toEqual([t('olá_mundo_')]);
  });

  it('asterisco com espaco e conta, nao italico', () => {
    expect(trechos('2 * 3 * 4')).toEqual([t('2 * 3 * 4')]);
  });

  it('marcador sem par fica como texto', () => {
    expect(trechos('**sem fim')).toEqual([t('**sem fim')]);
    expect(trechos('~so um')).toEqual([t('~so um')]);
  });

  it('barra escapa a formatacao', () => {
    expect(trechos('\\*nao italico\\*')).toEqual([t('*nao italico*')]);
    expect(trechos('\\_\\_x\\_\\_')).toEqual([t('__x__')]);
  });

  it('barra que nao escapa nada continua ali (caminho do Windows)', () => {
    expect(trechos('C:\\Users\\kaya')).toEqual([t('C:\\Users\\kaya')]);
  });
});

describe('analisar: codigo', () => {
  it('codigo em linha nao e interpretado por dentro', () => {
    expect(trechos('rode `npm **i**` agora')).toEqual([
      t('rode '),
      { tipo: 'codigo', texto: 'npm **i**' },
      t(' agora'),
    ]);
  });

  it('negrito passa por cima de codigo (a 1.x mostrava os asteriscos)', () => {
    expect(trechos('**veja `isto` aqui**')).toEqual([
      { tipo: 'negrito', filhos: [t('veja '), { tipo: 'codigo', texto: 'isto' }, t(' aqui')] },
    ]);
  });

  it('dois acentos graves permitem acento dentro', () => {
    expect(trechos('``a ` b``')).toEqual([{ tipo: 'codigo', texto: 'a ` b' }]);
  });

  it('acento escapado nao abre codigo', () => {
    expect(trechos('\\`nada\\`')).toEqual([t('`nada`')]);
  });

  it('bloco de codigo com linguagem, sem as quebras da sintaxe', () => {
    expect(analisar('antes\n```ts\nconst a = 1;\n```\ndepois')).toEqual([
      { tipo: 'texto', filhos: [t('antes')] },
      { tipo: 'codigo', linguagem: 'ts', texto: 'const a = 1;' },
      { tipo: 'texto', filhos: [t('depois')] },
    ]);
  });

  it('bloco de uma linha nao confunde o conteudo com a linguagem', () => {
    expect(analisar('```python```')).toEqual([{ tipo: 'codigo', linguagem: null, texto: 'python' }]);
  });

  it('mencao dentro de bloco de codigo e texto', () => {
    expect(analisar('```\n<@123> @everyone\n```')).toEqual([
      { tipo: 'codigo', linguagem: null, texto: '<@123> @everyone' },
    ]);
  });

  it('cerca vazia fica como texto', () => {
    expect(analisar('``````')).toEqual([{ tipo: 'texto', filhos: [t('``````')] }]);
  });
});

describe('analisar: mencoes, emojis e links', () => {
  it('pessoa, cargo, canal e emoji do servidor', () => {
    expect(trechos('<@1> <@!2> <@&3> <#4> <:gato:5> <a:dança:6>')).toEqual([
      { tipo: 'pessoa', id: '1' },
      t(' '),
      { tipo: 'pessoa', id: '2' },
      t(' '),
      { tipo: 'cargo', id: '3' },
      t(' '),
      { tipo: 'canal', id: '4' },
      t(' '),
      { tipo: 'emoji', nome: 'gato', id: '5', animado: false },
      // nome de emoji so aceita [a-zA-Z0-9_]: com cedilha nao e emoji
      t(' <a:dança:6>'),
    ]);
  });

  it('@everyone so com a mesma borda do servidor', () => {
    expect(trechos('@everyone bora')).toEqual([{ tipo: 'todos', alvo: 'everyone' }, t(' bora')]);
    expect(trechos('email@everyone.com')).toEqual([t('email@everyone.com')]);
  });

  it('link com sublinhado no caminho continua inteiro (a 1.x quebrava)', () => {
    expect(trechos('https://x.com/a_b_c')).toEqual([{ tipo: 'link', url: 'https://x.com/a_b_c' }]);
  });

  it('pontuacao do fim da frase fica fora do link', () => {
    expect(trechos('veja https://x.com/a.')).toEqual([t('veja '), { tipo: 'link', url: 'https://x.com/a' }, t('.')]);
  });

  it('parentese so sai do link se estiver sobrando', () => {
    expect(trechos('(https://x.com/a)')).toEqual([t('('), { tipo: 'link', url: 'https://x.com/a' }, t(')')]);
    expect(trechos('https://pt.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      { tipo: 'link', url: 'https://pt.wikipedia.org/wiki/Foo_(bar)' },
    ]);
  });

  it('negrito em volta de link', () => {
    expect(trechos('**https://x.com**')).toEqual([{ tipo: 'negrito', filhos: [{ tipo: 'link', url: 'https://x.com' }] }]);
  });

  it('link entre <> perde os sinais', () => {
    expect(trechos('<https://x.com/a>')).toEqual([{ tipo: 'link', url: 'https://x.com/a' }]);
  });

  it('so o esquema nao e link', () => {
    expect(trechos('https://')).toEqual([t('https://')]);
  });

  it('mencao escapada fica como texto', () => {
    expect(trechos('\\<@123>')).toEqual([t('<@123>')]);
  });

  it('marcador interno vindo no texto nao aponta para trecho nenhum', () => {
    expect(trechos('<@1> \ue100')).toEqual([{ tipo: 'pessoa', id: '1' }, t(' \ufffd')]);
  });
});

describe('analisar: citacao', () => {
  it('linhas citadas seguidas viram uma citacao so', () => {
    expect(analisar('> um\n> dois\nfora')).toEqual([
      { tipo: 'citacao', filhos: [t('um\ndois')] },
      { tipo: 'texto', filhos: [t('fora')] },
    ]);
  });

  it('>>> cita ate o fim', () => {
    expect(analisar('antes\n>>> tudo\nisto')).toEqual([
      { tipo: 'texto', filhos: [t('antes')] },
      { tipo: 'citacao', filhos: [t('tudo\nisto')] },
    ]);
  });

  it('> sem espaco nao e citacao', () => {
    expect(analisar('>nao')).toEqual([{ tipo: 'texto', filhos: [t('>nao')] }]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  aplicarSugestao,
  consultaNoCursor,
  escolhaDaSugestao,
  escolhasDoConteudo,
  paraEdicao,
  paraEnvio,
  pontuar,
  sugerir,
  type Dicionario,
  type FontesDeSugestao,
} from './mencoes.js';

/** A consulta com o cursor no fim do texto. */
const noFim = (texto: string) => consultaNoCursor(texto, texto.length);

describe('consultaNoCursor', () => {
  it('abre com @, # e : no comeco ou depois de espaco', () => {
    expect(noFim('@ka')).toEqual({ gatilho: '@', termo: 'ka', inicio: 0, fim: 3 });
    expect(noFim('oi #ger')).toEqual({ gatilho: '#', termo: 'ger', inicio: 3, fim: 7 });
    expect(noFim('top :fo')).toEqual({ gatilho: ':', termo: 'fo', inicio: 4, fim: 7 });
  });

  it('@ sozinho ja abre a lista', () => {
    expect(noFim('chama o @')?.termo).toBe('');
  });

  it('nao abre no meio de palavra, email, hora ou endereco', () => {
    expect(noFim('email@ka')).toBeNull();
    expect(noFim('as 12:30')).toBeNull();
    expect(noFim('https://x.com/@ka')).toBeNull();
  });

  it(': pede dois caracteres', () => {
    expect(noFim('ok :f')).toBeNull();
  });

  it('espaco depois do termo fecha a consulta', () => {
    expect(noFim('@kaya ')).toBeNull();
  });

  it('nao abre dentro de codigo', () => {
    expect(noFim('`@ka')).toBeNull();
    expect(noFim('```\n@ka')).toBeNull();
    expect(noFim('`x` @ka')?.termo).toBe('ka');
  });

  it('respeita o cursor no meio do texto', () => {
    expect(consultaNoCursor('@ka depois', 3)).toEqual({ gatilho: '@', termo: 'ka', inicio: 0, fim: 3 });
  });
});

describe('pontuar', () => {
  it('igual > comeca com > palavra comeca com > contem', () => {
    expect(pontuar('kaya', ['kaya'])).toBe(100);
    expect(pontuar('ka', ['kaya'])).toBe(80);
    expect(pontuar('fer', ['luiz fernando'])).toBe(60);
    expect(pontuar('ay', ['kaya'])).toBe(40);
    expect(pontuar('zz', ['kaya'])).toBe(-1);
  });

  it('sem acento e sem caixa', () => {
    expect(pontuar('joao', ['João'])).toBe(100);
  });
});

const FONTES: FontesDeSugestao = {
  pessoas: [
    { id: '1', username: 'kaya', nome: 'Kaya', avatarUrl: null },
    { id: '2', username: 'rafa.m', nome: 'Rafael', avatarUrl: null },
    { id: '3', username: 'pitohui', nome: 'Luiz Fernando', avatarUrl: null },
  ],
  cargos: [{ id: '10', nome: 'ADM', cor: '#dc2626', membros: 1 }],
  podeMencionarTodos: false,
  canais: [
    { id: '20', nome: 'geral', categoria: 'Texto' },
    { id: '21', nome: 'clipes', categoria: 'Texto' },
  ],
  emojis: [{ id: '30', nome: 'gato_dj', url: 'u', animado: false }],
};

describe('sugerir', () => {
  it('@ traz pessoas e cargos, o mais parecido primeiro', () => {
    const r = sugerir({ gatilho: '@', termo: 'ra', inicio: 0, fim: 3 }, FONTES);
    expect(r.map((s) => s.rotulo)).toEqual(['Rafael']);
    const tudo = sugerir({ gatilho: '@', termo: '', inicio: 0, fim: 1 }, FONTES);
    expect(tudo.map((s) => s.tipo)).toEqual(['pessoa', 'pessoa', 'pessoa', 'cargo']);
  });

  it('acha pelo nome de exibicao e insere o nome de usuario', () => {
    const [s] = sugerir({ gatilho: '@', termo: 'fern', inicio: 0, fim: 5 }, FONTES);
    expect(s).toMatchObject({ rotulo: 'Luiz Fernando', inserir: '@pitohui ' });
  });

  it('@everyone so para quem pode', () => {
    const sem = sugerir({ gatilho: '@', termo: 'every', inicio: 0, fim: 6 }, FONTES);
    expect(sem).toEqual([]);
    const com = sugerir({ gatilho: '@', termo: 'every', inicio: 0, fim: 6 }, { ...FONTES, podeMencionarTodos: true });
    expect(com.map((s) => s.rotulo)).toEqual(['@everyone']);
  });

  it('# traz canais', () => {
    expect(sugerir({ gatilho: '#', termo: 'cl', inicio: 0, fim: 3 }, FONTES).map((s) => s.inserir)).toEqual(['#clipes ']);
  });

  it(': traz os do servidor e os unicode pelas palavras em portugues', () => {
    const r = sugerir({ gatilho: ':', termo: 'gato', inicio: 0, fim: 5 }, FONTES);
    expect(r[0]).toMatchObject({ tipo: 'emoji', rotulo: 'gato_dj', inserir: ':gato_dj: ' });
    const fogo = sugerir({ gatilho: ':', termo: 'fogo', inicio: 0, fim: 5 }, FONTES);
    expect(fogo.some((s) => s.tipo === 'emoji' && s.inserir === '🔥 ')).toBe(true);
  });

  it(': poe primeiro o emoji cujo nome e o termo', () => {
    const [primeiro] = sugerir({ gatilho: ':', termo: 'fog', inicio: 0, fim: 4 }, { ...FONTES, emojis: [] });
    expect(primeiro).toMatchObject({ inserir: '🔥 ', rotulo: 'fogo' });
  });
});

describe('aplicarSugestao', () => {
  it('troca a consulta e poe o cursor depois do espaco', () => {
    const texto = 'oi @ka';
    const consulta = noFim(texto)!;
    const [s] = sugerir(consulta, FONTES);
    expect(aplicarSugestao(texto, consulta, s!)).toEqual({ texto: 'oi @kaya ', cursor: 9 });
  });

  it('nao dobra o espaco que ja existe', () => {
    const texto = '@ka tudo bem';
    const consulta = consultaNoCursor(texto, 3)!;
    const [s] = sugerir(consulta, FONTES);
    expect(aplicarSugestao(texto, consulta, s!)).toEqual({ texto: '@kaya tudo bem', cursor: 5 });
  });
});

const DIC: Dicionario = {
  pessoas: [
    { id: '1', username: 'kaya', nomes: ['Kaya'] },
    { id: '2', username: 'rafa.m', nomes: ['Rafa', 'Rafael'] },
    { id: '3', username: 'pitohui', nomes: ['Luiz Fernando'] },
    { id: '4', username: 'outro', nomes: ['Rafa'] },
  ],
  cargos: [
    { id: '10', nome: 'Moderador Chefe' },
    { id: '11', nome: 'kaya' },
  ],
  canais: [{ id: '20', nome: 'geral' }],
  emojis: [
    { id: '30', nome: 'gato', animado: false },
    { id: '31', nome: 'danca', animado: true },
  ],
};

describe('paraEnvio', () => {
  it('troca nome de usuario, canal e emoji pelas marcas', () => {
    expect(paraEnvio('oi @kaya, veja #geral :gato: :danca:', DIC)).toBe('oi <@1>, veja <#20> <:gato:30> <a:danca:31>');
  });

  it('pontuacao depois do nome nao atrapalha; letra depois, sim', () => {
    expect(paraEnvio('@rafa.m.', DIC)).toBe('<@2>.');
    expect(paraEnvio('@kayaaa', DIC)).toBe('@kayaaa');
  });

  it('nome de exibicao so quando unico', () => {
    expect(paraEnvio('@Luiz Fernando', DIC)).toBe('<@3>');
    expect(paraEnvio('@Rafael', DIC)).toBe('<@2>');
    // Duas pessoas se chamam "Rafa": ninguem e chamado por engano.
    expect(paraEnvio('@Rafa', DIC)).toBe('@Rafa');
  });

  it('pessoa ganha de cargo com o mesmo nome; o nome mais longo ganha do mais curto', () => {
    expect(paraEnvio('@kaya', DIC)).toBe('<@1>');
    expect(paraEnvio('@Moderador Chefe', DIC)).toBe('<@&10>');
  });

  it('caixa nao importa para pessoa, cargo e canal', () => {
    expect(paraEnvio('@KAYA #Geral', DIC)).toBe('<@1> <#20>');
  });

  it('@everyone e @here ficam como texto', () => {
    expect(paraEnvio('@everyone @here', { ...DIC, pessoas: [...DIC.pessoas, { id: '9', username: 'everyone', nomes: [] }] })).toBe(
      '@everyone @here',
    );
  });

  it('nao toca codigo, endereco, email, escape nem marca pronta', () => {
    expect(paraEnvio('`@kaya` ```\n#geral\n```', DIC)).toBe('`@kaya` ```\n#geral\n```');
    expect(paraEnvio('https://x.com/@kaya/#geral', DIC)).toBe('https://x.com/@kaya/#geral');
    expect(paraEnvio('a@kaya.com', DIC)).toBe('a@kaya.com');
    expect(paraEnvio('\\@kaya', DIC)).toBe('\\@kaya');
    expect(paraEnvio('<@1> <:gato:30>', DIC)).toBe('<@1> <:gato:30>');
  });

  it('emoji desconhecido e hora ficam como estao', () => {
    expect(paraEnvio(':nao_existe: 12:gato:', DIC)).toBe(':nao_existe: 12:gato:');
  });

  describe('usuario e cargo com o mesmo nome (o caso do dono: usuario adm, cargo ADM)', () => {
    const COLISAO: Dicionario = {
      ...DIC,
      pessoas: [...DIC.pessoas, { id: '5', username: 'adm', nomes: ['ADM PATRNO'] }],
      cargos: [...DIC.cargos, { id: '12', nome: 'ADM' }],
    };

    it('escrito igual ao cargo, e o cargo; igual ao usuario, e a pessoa', () => {
      expect(paraEnvio('@ADM venham', COLISAO)).toBe('<@&12> venham');
      expect(paraEnvio('@adm venha', COLISAO)).toBe('<@5> venha');
    });

    it('caixa diferente dos dois: a pessoa, como antes', () => {
      expect(paraEnvio('@Adm', COLISAO)).toBe('<@5>');
    });

    it('o que foi escolhido na lista vale, mesmo com a caixa igual', () => {
      // Cargo "kaya" e usuario "kaya": so a escolha distingue.
      expect(paraEnvio('@kaya', DIC)).toBe('<@1>');
      expect(paraEnvio('@kaya', DIC, new Map([['@kaya', '<@&11>']]))).toBe('<@&11>');
    });

    it('a escolha pelo cargo e pela pessoa na mesma mensagem', () => {
      const escolhidas = new Map([
        ['@ADM', '<@&12>'],
        ['@adm', '<@5>'],
      ]);
      expect(paraEnvio('@ADM e @adm', COLISAO, escolhidas)).toBe('<@&12> e <@5>');
    });

    it('a sugestao da lista vira a escolha certa', () => {
      const [pessoa, cargo] = [
        sugerir({ gatilho: '@', termo: 'adm', inicio: 0, fim: 4 }, fontesDe(COLISAO)).find((s) => s.tipo === 'pessoa'),
        sugerir({ gatilho: '@', termo: 'adm', inicio: 0, fim: 4 }, fontesDe(COLISAO)).find((s) => s.tipo === 'cargo'),
      ];
      expect(escolhaDaSugestao(pessoa!)).toEqual(['@adm', '<@5>']);
      expect(escolhaDaSugestao(cargo!)).toEqual(['@ADM', '<@&12>']);
    });

    it('editar uma mensagem com o cargo devolve o cargo', () => {
      expect(paraEnvio(paraEdicao('<@&12> venham', COLISAO), COLISAO)).toBe('<@&12> venham');
    });

    it('editar devolve cargo e pessoa mesmo com o nome identico (cargo kaya, usuario kaya)', () => {
      const conteudo = '<@&11> e <@1>';
      const texto = paraEdicao(conteudo, DIC);
      expect(texto).toBe('@kaya e @kaya');
      // Sem as escolhas, os dois virariam a pessoa; com elas, cada um o que era...
      // mas o mesmo texto para dois donos nao tem como separar: vale o ultimo.
      expect(paraEnvio('@kaya', DIC, escolhasDoConteudo('<@&11>', DIC))).toBe('<@&11>');
      expect(paraEnvio('@kaya', DIC, escolhasDoConteudo('<@1>', DIC))).toBe('<@1>');
      expect(escolhasDoConteudo('<@!1> <@&10>', DIC)).toEqual(
        new Map([
          ['@kaya', '<@1>'],
          ['@Moderador Chefe', '<@&10>'],
        ]),
      );
    });
  });
});

/** As fontes da lista a partir do dicionario (para os testes de colisao). */
function fontesDe(d: Dicionario): FontesDeSugestao {
  return {
    pessoas: d.pessoas.map((p) => ({ id: p.id, username: p.username, nome: p.nomes[0] ?? p.username, avatarUrl: null })),
    cargos: d.cargos.map((c) => ({ id: c.id, nome: c.nome, cor: null, membros: 1 })),
    podeMencionarTodos: false,
    canais: [],
    emojis: [],
  };
}

describe('paraEdicao', () => {
  it('as marcas voltam a ser nomes', () => {
    expect(paraEdicao('oi <@1> <@&10> <#20> <a:danca:31>', DIC)).toBe('oi @kaya @Moderador Chefe #geral :danca:');
  });

  it('marca de quem nao se conhece fica como esta', () => {
    expect(paraEdicao('<@999> <#998>', DIC)).toBe('<@999> <#998>');
  });

  it('ida e volta devolve o mesmo conteudo', () => {
    const original = 'oi <@1>, <@&10> e <@3> em <#20> <:gato:30> `<@1>`';
    expect(paraEnvio(paraEdicao(original, DIC), DIC)).toBe(original);
  });
});

/**
 * A mensagem certa para cada falha de captura.
 *
 * O teste que importa aqui e o de NAO falar de camera quando o assunto e
 * tela. Esse defeito nao quebra nada, nao aparece em log nenhum, e manda a
 * pessoa fechar Teams, Zoom e OBS para resolver um problema que nao tem nada
 * a ver com isso. Ela fecha, tenta de novo, falha igual, e conclui que o
 * aplicativo esta quebrado.
 */

import { describe, it, expect } from 'vitest';
import { explicarFalhaDeMidia, codigoDaFalha } from './falhas.js';

/** Um erro como o navegador entrega: nome proprio, mensagem tecnica. */
const falha = (nome: string, mensagem = 'detalhe tecnico'): Error => {
  const e = new Error(mensagem);
  e.name = nome;
  return e;
};

const NOMES = [
  'NotAllowedError',
  'PermissionDeniedError',
  'NotFoundError',
  'DevicesNotFoundError',
  'NotReadableError',
  'TrackStartError',
  'OverconstrainedError',
  'ConstraintNotSatisfiedError',
  'AbortError',
];

describe('falha de tela nunca fala de camera', () => {
  it.each(NOMES)('%s', (nome) => {
    const texto = explicarFalhaDeMidia(falha(nome), 'tela');
    expect(texto.toLowerCase()).not.toContain('camera');
  });

  it('nem manda fechar programas de videochamada', () => {
    // Era o texto que aparecia de verdade na tela de quem tentava transmitir.
    const texto = explicarFalhaDeMidia(falha('NotReadableError'), 'tela');
    expect(texto).not.toMatch(/Teams|Zoom|OBS/);
  });
});

describe('falha de camera continua falando de camera', () => {
  it.each(['NotFoundError', 'NotReadableError', 'OverconstrainedError'])('%s', (nome) => {
    expect(explicarFalhaDeMidia(falha(nome), 'camera').toLowerCase()).toContain('camera');
  });
});

describe('o conselho aponta para a causa provavel', () => {
  it('tela recusada pelo Windows fala de tela cheia exclusiva', () => {
    // De longe o caso mais comum: o jogo toma conta da placa de video e o
    // Windows nao entrega a imagem para mais ninguem.
    const texto = explicarFalhaDeMidia(falha('NotReadableError'), 'tela');
    expect(texto).toMatch(/tela cheia/i);
    expect(texto).toMatch(/janela|borderless/i);
  });

  it('qualidade recusada manda baixar a qualidade', () => {
    expect(explicarFalhaDeMidia(falha('OverconstrainedError'), 'tela')).toMatch(/qualidade/i);
  });

  it('tela que sumiu manda escolher de novo', () => {
    expect(explicarFalhaDeMidia(falha('NotFoundError'), 'tela')).toMatch(/escolha de novo/i);
  });

  it('permissao negada de tela aponta Gravacao de tela, nao Camera', () => {
    const texto = explicarFalhaDeMidia(falha('NotAllowedError'), 'tela');
    expect(texto).toMatch(/Gravacao de tela/);
  });
});

describe('o nome tecnico vai junto, para a proxima captura de tela servir', () => {
  it('aparece entre parenteses', () => {
    expect(explicarFalhaDeMidia(falha('NotReadableError'), 'tela')).toContain(
      '(NotReadableError)',
    );
  });

  it('um Error comum nao ganha parenteses inuteis', () => {
    // `Error` e o nome padrao de qualquer `new Error()`: nao informa nada.
    const texto = explicarFalhaDeMidia(new Error('Entre em um canal de voz'), 'tela');
    expect(texto).not.toContain('(Error)');
    expect(texto).toContain('Entre em um canal de voz');
  });

  it('codigoDaFalha devolve nulo quando nao ha nome util', () => {
    expect(codigoDaFalha(new Error('qualquer'))).toBeNull();
    expect(codigoDaFalha('um texto solto')).toBeNull();
    expect(codigoDaFalha(null)).toBeNull();
  });

  it('e o nome quando ha', () => {
    expect(codigoDaFalha(falha('NotReadableError'))).toBe('NotReadableError');
  });
});

describe('erro desconhecido nao vira silencio', () => {
  it('repassa a mensagem tecnica com o nome', () => {
    const texto = explicarFalhaDeMidia(falha('CoisaNovaError', 'faltou algo'), 'tela');
    expect(texto).toContain('faltou algo');
    expect(texto).toContain('(CoisaNovaError)');
  });
});

describe('falha do som da transmissao e um assunto proprio', () => {
  /*
    Este bloco existe porque o mesmo erro ja foi cometido duas vezes: usar o
    texto de uma fonte para explicar a falha de outra. A imagem ja esta no ar
    quando estas frases aparecem, e mandar a pessoa mexer no modo de tela
    cheia do jogo por causa da placa de som e o mesmo engano de antes.
  */
  it.each(NOMES)('%s nao fala de tela cheia nem de escolher monitor', (nome) => {
    const texto = explicarFalhaDeMidia(falha(nome), 'som-da-tela');
    expect(texto).not.toMatch(/tela cheia|borderless|monitor inteiro|outra tela/i);
  });

  it.each(NOMES)('%s nao fala de camera', (nome) => {
    expect(explicarFalhaDeMidia(falha(nome), 'som-da-tela').toLowerCase()).not.toContain('camera');
  });

  it('o caso comum aponta para programa segurando a saida de audio', () => {
    const texto = explicarFalhaDeMidia(falha('NotReadableError'), 'som-da-tela');
    expect(texto).toMatch(/exclusivo/i);
    expect(texto).toMatch(/audio/i);
  });

  /*
    A mensagem tem que dizer ONDE resolver, nao so o que aconteceu.

    Sem o caminho, quem batia nisso tinha que perguntar a alguem onde fica o
    ajuste de modo exclusivo do Windows — e a mensagem virava o comeco de uma
    conversa em vez do fim de um problema. Aconteceu de verdade, com uma pessoa
    do grupo, e foi preciso alguem no meio repassando o passo a passo.
  */
  it('e diz onde clicar para resolver', () => {
    const texto = explicarFalhaDeMidia(falha('NotReadableError'), 'som-da-tela');
    expect(texto).toMatch(/mmsys.cpl/i);
    expect(texto).toMatch(/propriedades/i);
    expect(texto).toMatch(/avancado/i);
  });

  it('sem dispositivo de saida, manda conferir o fone', () => {
    expect(explicarFalhaDeMidia(falha('NotFoundError'), 'som-da-tela')).toMatch(/fone|caixas/i);
  });

  it('continua carregando o nome tecnico', () => {
    expect(explicarFalhaDeMidia(falha('NotReadableError'), 'som-da-tela')).toContain(
      '(NotReadableError)',
    );
  });
});

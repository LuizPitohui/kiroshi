/**
 * Como um punhado de mensagens vira uma frase falada.
 *
 * O que estes testes protegem e o tempo de quem ouve. Anunciar cinco
 * mensagens inteiras enfileira meio minuto de fala que nao da para
 * interromper nem pular, e a pessoa perde o controle do proprio aplicativo
 * ate a fila acabar. Errar para o outro lado — resumir o que devia ser lido
 * inteiro — custa a informacao.
 */

import { describe, it, expect, vi } from 'vitest';
import { resumirChegadas, anunciar, assinarAnuncios } from './anunciar.js';

describe('uma mensagem so vai inteira', () => {
  it('diz quem falou e o que falou', () => {
    expect(resumirChegadas([{ autor: 'vartaque', texto: 'bora jogar' }])).toBe(
      'vartaque: bora jogar',
    );
  });

  it('corta o que passa do limite de leitura', () => {
    const longa = 'a'.repeat(200);
    const saida = resumirChegadas([{ autor: 'pito', texto: longa }]);
    expect(saida.endsWith('...')).toBe(true);
    expect(saida.length).toBeLessThan(160);
  });

  it('mensagem so com anexo nao vira so um nome solto', () => {
    // Acontece toda vez que alguem manda uma imagem sem legenda. Sem esta
    // regra o anuncio seria "vartaque:" e nada mais.
    expect(resumirChegadas([{ autor: 'vartaque', texto: '   ' }])).toBe(
      'vartaque enviou um anexo',
    );
  });
});

describe('varias juntas viram resumo', () => {
  it('mesma pessoa: conta quantas', () => {
    const tres = [
      { autor: 'pito', texto: 'uma' },
      { autor: 'pito', texto: 'duas' },
      { autor: 'pito', texto: 'tres' },
    ];
    expect(resumirChegadas(tres)).toBe('pito enviou 3 mensagens');
  });

  it('duas pessoas: nomeia as duas', () => {
    const duas = [
      { autor: 'pito', texto: 'oi' },
      { autor: 'varta', texto: 'oi' },
    ];
    expect(resumirChegadas(duas)).toBe('2 mensagens novas de pito e varta');
  });

  it('muita gente: nomeia duas e conta o resto', () => {
    // A lista inteira de nomes vira um trava-linguas que nao ajuda ninguem.
    const varias = [
      { autor: 'a', texto: '1' },
      { autor: 'b', texto: '2' },
      { autor: 'c', texto: '3' },
      { autor: 'd', texto: '4' },
    ];
    expect(resumirChegadas(varias)).toBe('4 mensagens novas de a e b e mais 2');
  });

  it('a mesma pessoa repetida nao conta como duas', () => {
    const mistura = [
      { autor: 'pito', texto: '1' },
      { autor: 'varta', texto: '2' },
      { autor: 'pito', texto: '3' },
    ];
    expect(resumirChegadas(mistura)).toBe('3 mensagens novas de pito e varta');
  });
});

describe('nada a dizer', () => {
  it('lista vazia nao produz frase', () => {
    expect(resumirChegadas([])).toBe('');
  });
});

describe('a fila de anuncios', () => {
  it('entrega a quem assinou', () => {
    const ouvinte = vi.fn();
    const cancelar = assinarAnuncios(ouvinte);
    anunciar('a chamada caiu', 'urgente');
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte.mock.calls[0]![0]).toMatchObject({
      texto: 'a chamada caiu',
      urgencia: 'urgente',
    });
    cancelar();
  });

  it('cada anuncio tem id proprio, mesmo com texto repetido', () => {
    // Leitor de tela so fala quando o conteudo da regiao muda. Sem o id, a
    // segunda vez que alguem entra na chamada passaria em silencio.
    const vistos: number[] = [];
    const cancelar = assinarAnuncios((a) => vistos.push(a.id));
    anunciar('entrou na chamada');
    anunciar('entrou na chamada');
    expect(vistos).toHaveLength(2);
    expect(vistos[0]).not.toBe(vistos[1]);
    cancelar();
  });

  it('texto vazio nao anuncia nada', () => {
    const ouvinte = vi.fn();
    const cancelar = assinarAnuncios(ouvinte);
    anunciar('   ');
    expect(ouvinte).not.toHaveBeenCalled();
    cancelar();
  });

  it('cancelar a assinatura para de receber', () => {
    const ouvinte = vi.fn();
    assinarAnuncios(ouvinte)();
    anunciar('nada deve chegar');
    expect(ouvinte).not.toHaveBeenCalled();
  });
});

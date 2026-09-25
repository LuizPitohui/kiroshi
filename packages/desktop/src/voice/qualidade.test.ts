/**
 * Quanta banda cada modo de transmissao recebe.
 *
 * Esta conta decide se "1080p 60 fps" no seletor entrega 1080p a 60 fps ou
 * uma promessa vazia. Um numero baixo demais nao quebra nada de forma
 * visivel: a chamada conecta, a imagem aparece, e so fica ruim — que e o
 * defeito mais dificil de perceber olhando codigo.
 *
 * O historico: era fixo em 3 Mbps para tudo. Dava para 720p, e era por isso
 * que 1080p saia lavado e 60 fps nunca acontecia de verdade.
 */

import { describe, it, expect } from 'vitest';
import { bitrateDeTela, camadasDeTela, degradacaoDoConteudo, dicaDoConteudo, restricoesDeTela } from './qualidade.js';

describe('cada modo do seletor recebe banda propria', () => {
  it('720p30 e o modo leve', () => {
    expect(bitrateDeTela(720, 30)).toBe(1_500_000);
  });

  it('1080p30 ganha mais que o antigo valor fixo de 3 Mbps', () => {
    expect(bitrateDeTela(1080, 30)).toBeGreaterThan(3_000_000);
  });

  it('1080p60 ganha o dobro de 1080p30, porque sao o dobro de quadros', () => {
    expect(bitrateDeTela(1080, 60)).toBe(bitrateDeTela(1080, 30) * 2);
  });
});

describe('a ordem entre os modos', () => {
  it('mais resolucao nunca recebe menos banda', () => {
    expect(bitrateDeTela(1080, 30)).toBeGreaterThan(bitrateDeTela(720, 30));
    expect(bitrateDeTela(1080, 60)).toBeGreaterThan(bitrateDeTela(720, 60));
  });

  it('mais quadros nunca recebe menos banda', () => {
    expect(bitrateDeTela(720, 60)).toBeGreaterThan(bitrateDeTela(720, 30));
    expect(bitrateDeTela(1080, 60)).toBeGreaterThan(bitrateDeTela(1080, 30));
  });
});

describe('alturas fora dos tres modos do seletor', () => {
  it('trata altura menor que 720 como o modo leve', () => {
    // Janela pequena compartilhada, nao a tela inteira.
    expect(bitrateDeTela(480, 30)).toBe(bitrateDeTela(720, 30));
  });

  it('trata 1440p e 4K como 1080p, que e o teto que a captura impoe', () => {
    // A captura ja reduz para a altura pedida; se chegar mais, nao deve
    // receber menos banda do que 1080p.
    expect(bitrateDeTela(1440, 60)).toBe(bitrateDeTela(1080, 60));
    expect(bitrateDeTela(2160, 30)).toBe(bitrateDeTela(1080, 30));
  });

  it('a fronteira e em 720, nao acima dela', () => {
    expect(bitrateDeTela(720, 30)).toBe(1_500_000);
    expect(bitrateDeTela(721, 30)).toBe(4_000_000);
  });
});

describe('valores que uma rede domestica aguenta', () => {
  it('nenhum modo passa de 8 Mbps de subida', () => {
    // Acima disso o upload de fibra domestica comum comeca a sofrer, e quem
    // transmite e justamente quem paga o custo.
    for (const altura of [480, 720, 1080, 1440, 2160]) {
      for (const fps of [30, 60]) {
        expect(bitrateDeTela(altura, fps)).toBeLessThanOrEqual(8_000_000);
      }
    }
  });
});

describe('as restricoes da captura de tela', () => {
  it('limitam a altura, que e o que significa "1080p"', () => {
    const r = restricoesDeTela(1080, 60);
    expect(r.height).toEqual({ ideal: 1080, max: 1080 });
    expect(r.frameRate).toEqual({ ideal: 60, max: 60 });
  });

  /*
    O teste que existe por causa de um defeito real.

    Havia um teto de largura de `(altura * 21) / 9` = 2520px para 1080p, posto
    ali com a intencao de "nao cortar monitor ultrawide". Nenhum ultrawide
    cabia nele: 2560x1080 precisa de 2560px e 3440x1440 precisa de 2580px. O
    pedido ficava impossivel e a captura falhava para justamente quem o teto
    dizia proteger.
  */
  it('nao poem teto de largura nenhum', () => {
    expect(restricoesDeTela(1080, 60)).not.toHaveProperty('width');
  });

  it.each([
    ['2560x1080 (21:9)', 2560, 1080],
    ['3440x1440 (21:9)', 3440, 1440],
    ['5120x1440 (32:9)', 5120, 1440],
    ['1920x1080 (16:9)', 1920, 1080],
    ['3840x2160 (16:9)', 3840, 2160],
  ])('%s cabe no pedido de 1080p', (_nome, largura, alturaReal) => {
    const r = restricoesDeTela(1080, 60);
    // A largura que o monitor teria ao ser reduzido para a altura pedida.
    const larguraReduzida = Math.round(1080 * (largura / alturaReal));
    const semTeto = !('width' in r);
    expect(semTeto || larguraReduzida <= 99999).toBe(true);
    // E a altura pedida nunca passa da altura real quando a tela e menor.
    expect(r.height.max).toBe(1080);
  });
});

describe('as camadas da transmissao de tela', () => {
  /*
    Estes testes nascem de uma medicao no SFU de uma chamada real: a camada de
    topo estava em 2500 kbps e 15 fps, porque o LiveKit descarta
    `videoEncoding` para tela e caiu no proprio padrao. E so havia duas
    camadas, 540p e 1080p, entao qualquer aperto de banda derrubava um degrau
    enorme de uma vez.
  */
  it('720p tem so a camada baixa abaixo dela', () => {
    expect(camadasDeTela(720, 30)).toHaveLength(1);
    expect(camadasDeTela(720, 30)[0]).toMatchObject({ altura: 360 });
  });

  it('1080p ganha um degrau no meio, para a queda nao ser de um salto so', () => {
    const c = camadasDeTela(1080, 60);
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.altura)).toEqual([360, 720]);
  });

  it('as camadas sobem em resolucao e em banda', () => {
    const c = camadasDeTela(1080, 60);
    expect(c[1]!.altura).toBeGreaterThan(c[0]!.altura);
    expect(c[1]!.bitrate).toBeGreaterThan(c[0]!.bitrate);
  });

  it('nenhuma camada chega perto do teto do topo', () => {
    // Camada intermediaria gorda demais come a banda que o topo precisa.
    const topo = bitrateDeTela(1080, 60);
    for (const c of camadasDeTela(1080, 60)) expect(c.bitrate).toBeLessThan(topo / 2);
  });

  it('a camada baixa cabe em rede ruim', () => {
    expect(camadasDeTela(1080, 60)[0]!.bitrate).toBeLessThanOrEqual(500_000);
  });
});

describe('o conteudo escolhido no seletor', () => {
  it('jogo: dica de movimento, fluidez primeiro e camada baixa a 30 fps', () => {
    expect(dicaDoConteudo('movimento')).toBe('motion');
    expect(degradacaoDoConteudo('movimento')).toBe('maintain-framerate');
    expect(camadasDeTela(1080, 60, 'movimento')[0]).toMatchObject({ altura: 360, fps: 30 });
    // Pedir 30 no modo de 30 nao vira 60, e o de 720p30 tambem vai a 30.
    expect(camadasDeTela(720, 30, 'movimento')[0]!.fps).toBe(30);
  });

  it('texto: dica de detalhe, resolucao primeiro', () => {
    expect(dicaDoConteudo('detalhe')).toBe('detail');
    expect(degradacaoDoConteudo('detalhe')).toBe('maintain-resolution');
  });

  it('texto em 1080p cai para 720p legivel, nunca para 360p', () => {
    const c = camadasDeTela(1080, 30, 'detalhe');
    expect(c).toEqual([{ largura: 1280, altura: 720, bitrate: 600_000, fps: 5 }]);
  });

  it('texto em 720p mantem a camada de 360p a 15 fps', () => {
    expect(camadasDeTela(720, 30, 'detalhe')).toEqual([{ largura: 640, altura: 360, bitrate: 500_000, fps: 15 }]);
  });
});

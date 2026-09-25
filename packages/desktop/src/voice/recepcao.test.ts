import { describe, expect, it } from 'vitest';
import { recepcaoPara, type QuadroParaRecepcao } from './recepcao.js';

const tela = (parte: Partial<QuadroParaRecepcao> = {}): QuadroParaRecepcao => ({
  fonte: 'tela',
  alturaCss: 282,
  densidade: 1,
  visivel: true,
  preferencia: 'auto',
  ...parte,
});

describe('recepcaoPara: transmissao', () => {
  it('quadro pequeno ao lado do chat nao cai mais para 360p (era o 360p15 das travadas)', () => {
    expect(recepcaoPara(tela({ alturaCss: 282 }))).toEqual({ ativa: true, qualidade: 'media' });
    expect(recepcaoPara(tela({ alturaCss: 76 }))).toEqual({ ativa: true, qualidade: 'media' });
  });

  it('em destaque numa janela de 1080p pede 1080p', () => {
    expect(recepcaoPara(tela({ alturaCss: 760 })).qualidade).toBe('alta');
  });

  it('a escala do Windows conta: 450 px a 150% sao 675 px de verdade', () => {
    expect(recepcaoPara(tela({ alturaCss: 450, densidade: 1.5 })).qualidade).toBe('alta');
    expect(recepcaoPara(tela({ alturaCss: 450, densidade: 1 })).qualidade).toBe('media');
  });

  it('a escolha fixa vence o tamanho, para cima e para baixo', () => {
    expect(recepcaoPara(tela({ alturaCss: 100, preferencia: 'alta' })).qualidade).toBe('alta');
    expect(recepcaoPara(tela({ alturaCss: 900, preferencia: 'baixa' })).qualidade).toBe('baixa');
  });

  it('o que ninguem ve e pausado', () => {
    expect(recepcaoPara(tela({ visivel: false })).ativa).toBe(false);
    expect(recepcaoPara(tela({ alturaCss: 0 })).ativa).toBe(false);
  });
});

describe('recepcaoPara: camera', () => {
  const camera = (alturaCss: number, densidade = 1) => recepcaoPara({ fonte: 'camera', alturaCss, densidade, visivel: true, preferencia: 'auto' });

  it('segue o tamanho: fita, grade e destaque', () => {
    expect(camera(92).qualidade).toBe('baixa');
    expect(camera(300).qualidade).toBe('media');
    expect(camera(600).qualidade).toBe('alta');
  });

  it('densidade invalida vale 1', () => {
    expect(recepcaoPara({ fonte: 'camera', alturaCss: 300, densidade: 0, visivel: true, preferencia: 'auto' }).qualidade).toBe('media');
  });
});

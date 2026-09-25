import { describe, expect, it } from 'vitest';
import { GRADE, chaveDoVideo, montarQuadros, quadroEmDestaque, type ParticipanteParaQuadro } from './quadros.js';

const p = (userId: string, parte: Partial<ParticipanteParaQuadro> = {}): ParticipanteParaQuadro => ({
  userId,
  isLocal: false,
  hasVideo: false,
  hasScreenShare: false,
  assistindo: [],
  ...parte,
});

describe('montarQuadros', () => {
  it('toda pessoa tem quadro, com ou sem camera', () => {
    const q = montarQuadros([p('eu', { isLocal: true }), p('kaya', { hasVideo: true })], []);
    expect(q.map((x) => [x.chave, x.video])).toEqual([
      ['eu:pessoa', false],
      ['kaya:pessoa', true],
    ]);
  });

  it('transmissao vem antes das pessoas, e a dos outros comeca como convite', () => {
    const q = montarQuadros([p('eu', { isLocal: true }), p('kaya', { hasScreenShare: true })], []);
    expect(q[0]).toMatchObject({ chave: 'kaya:tela', convite: true, video: false });
  });

  it('aceitar o convite liga o video', () => {
    const [tela] = montarQuadros([p('kaya', { hasScreenShare: true })], ['kaya']);
    expect(tela).toMatchObject({ convite: false, video: true });
  });

  it('a minha transmissao aparece sempre, sem convite', () => {
    const [tela] = montarQuadros([p('eu', { isLocal: true, hasScreenShare: true })], []);
    expect(tela).toMatchObject({ local: true, convite: false, video: true });
  });

  it('conta os espectadores pelos atributos de cada um, sem contar quem transmite', () => {
    const q = montarQuadros(
      [
        p('kaya', { hasScreenShare: true, assistindo: ['kaya'] }),
        p('rafa', { assistindo: ['kaya'] }),
        p('lele', { assistindo: ['kaya', 'outro'] }),
        p('bruno'),
      ],
      [],
    );
    expect(q.find((x) => x.chave === 'kaya:tela')?.espectadores).toBe(2);
  });

  it('a chave do video separa camera de tela', () => {
    expect(chaveDoVideo({ userId: 'k', tipo: 'tela' })).toBe('k|tela');
    expect(chaveDoVideo({ userId: 'k', tipo: 'pessoa' })).toBe('k|camera');
  });
});

describe('quadroEmDestaque', () => {
  const quadros = montarQuadros([p('eu', { isLocal: true, hasScreenShare: true }), p('kaya', { hasScreenShare: true }), p('rafa', { hasScreenShare: true })], ['rafa']);

  it('a escolha da pessoa vale enquanto o quadro existir', () => {
    expect(quadroEmDestaque(quadros, 'eu:pessoa')).toBe('eu:pessoa');
    expect(quadroEmDestaque(quadros, 'sumiu:tela')).toBe('rafa:tela');
  });

  it('escolher a grade vence o destaque automatico', () => {
    expect(quadroEmDestaque(quadros, GRADE)).toBeNull();
  });

  it('sem escolha, sobe a transmissao que estou assistindo — nunca convite, nunca a minha', () => {
    expect(quadroEmDestaque(quadros, null)).toBe('rafa:tela');
    expect(quadroEmDestaque(montarQuadros([p('kaya', { hasScreenShare: true })], []), null)).toBeNull();
    expect(quadroEmDestaque(montarQuadros([p('eu', { isLocal: true, hasScreenShare: true })], []), null)).toBeNull();
  });
});

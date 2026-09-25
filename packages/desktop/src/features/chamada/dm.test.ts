import { describe, expect, it } from 'vitest';
import type { Call } from '@kiroshi/shared';
import { chamadaQueToca, descreverChamada, duracaoDaChamada, nomeDaConversa } from './dm.js';

const inicio = '2026-09-25T10:00:00.000Z';
const depois = (ms: number) => new Date(new Date(inicio).getTime() + ms).toISOString();

describe('duracaoDaChamada', () => {
  it('menos de um minuto e "alguns segundos"', () => {
    expect(duracaoDaChamada(inicio, depois(59_000))).toBe('alguns segundos');
  });
  it('minutos no singular e no plural', () => {
    expect(duracaoDaChamada(inicio, depois(60_000))).toBe('1 minuto');
    expect(duracaoDaChamada(inicio, depois(12 * 60_000 + 30_000))).toBe('12 minutos');
  });
  it('horas cheias e horas com minutos', () => {
    expect(duracaoDaChamada(inicio, depois(60 * 60_000))).toBe('1 hora');
    expect(duracaoDaChamada(inicio, depois(2 * 60 * 60_000))).toBe('2 horas');
    expect(duracaoDaChamada(inicio, depois(65 * 60_000))).toBe('1 h 5 min');
  });
  it('data estragada nao vira "NaN minutos"', () => {
    expect(duracaoDaChamada('lixo', inicio)).toBe('alguns segundos');
  });
});

describe('descreverChamada', () => {
  const encerrada = (participantIds: string[]) => ({
    authorId: 'a',
    createdAt: inicio,
    call: { participantIds, endedAt: depois(5 * 60_000) },
  });

  it('no ar: quem ligou iniciou uma chamada', () => {
    const r = descreverChamada({ mensagem: encerrada(['a']), autor: 'Rafa', euSou: 'b', noAr: true });
    expect(r).toEqual({ texto: 'Rafa iniciou uma chamada.', perdida: false, noAr: true });
  });

  it('quem participou ve a duracao', () => {
    expect(descreverChamada({ mensagem: encerrada(['a', 'b']), autor: 'Rafa', euSou: 'b', noAr: false }).texto).toBe(
      'Rafa iniciou uma chamada que durou 5 minutos.',
    );
  });

  it('quem ligou fala de si como "Você", mesmo sem ninguem atender', () => {
    expect(descreverChamada({ mensagem: encerrada(['a']), autor: 'Rafa', euSou: 'a', noAr: false }).texto).toBe(
      'Você iniciou uma chamada que durou 5 minutos.',
    );
  });

  it('quem nao entrou perdeu a chamada', () => {
    const r = descreverChamada({ mensagem: encerrada(['a']), autor: 'Rafa', euSou: 'b', noAr: false });
    expect(r).toEqual({ texto: 'Chamada perdida de Rafa.', perdida: true, noAr: false });
  });

  it('sem hora de fim e fora do ar (API reiniciada): encerrada, sem duracao inventada', () => {
    const r = descreverChamada({
      mensagem: { authorId: 'a', createdAt: inicio, call: { participantIds: ['a', 'b'], endedAt: null } },
      autor: 'Rafa',
      euSou: 'b',
      noAr: false,
    });
    expect(r.texto).toBe('Rafa iniciou uma chamada.');
  });
});

describe('chamadaQueToca', () => {
  const chamada = (channelId: string, ringing: string[], startedAt: string): Call => ({
    channelId,
    messageId: `m${channelId}`,
    ringing,
    startedAt,
  });

  it('toca a que me chama', () => {
    expect(chamadaQueToca([chamada('1', ['eu'], inicio)], 'eu', null)?.channelId).toBe('1');
  });

  it('nao toca a que chama outra pessoa', () => {
    expect(chamadaQueToca([chamada('1', ['outro'], inicio)], 'eu', null)).toBeNull();
  });

  it('nao toca a chamada em que ja estou (atendi aqui e o servidor ainda nao avisou)', () => {
    expect(chamadaQueToca([chamada('1', ['eu'], inicio)], 'eu', '1')).toBeNull();
  });

  it('com duas, a mais recente', () => {
    const r = chamadaQueToca([chamada('1', ['eu'], inicio), chamada('2', ['eu'], depois(1000))], 'eu', null);
    expect(r?.channelId).toBe('2');
  });

  it('sem sessao, nada toca', () => {
    expect(chamadaQueToca([chamada('1', ['eu'], inicio)], null, null)).toBeNull();
  });
});

describe('nomeDaConversa', () => {
  const nomes: Record<string, string> = { a: 'Ana', b: 'Bia', c: 'Caio' };
  const nomeDe = (id: string) => nomes[id] ?? '?';

  it('DM: o outro lado', () => {
    expect(nomeDaConversa({ type: 'DM', name: null, recipientIds: ['eu', 'a'] }, 'eu', nomeDe)).toBe('Ana');
  });
  it('grupo sem nome: os outros, em ordem', () => {
    expect(nomeDaConversa({ type: 'GROUP_DM', name: null, recipientIds: ['a', 'eu', 'b', 'c'] }, 'eu', nomeDe)).toBe('Ana, Bia, Caio');
  });
  it('grupo com nome: o nome', () => {
    expect(nomeDaConversa({ type: 'GROUP_DM', name: 'Squad', recipientIds: ['a', 'eu'] }, 'eu', nomeDe)).toBe('Squad');
  });
  it('sozinho na conversa', () => {
    expect(nomeDaConversa({ type: 'DM', name: null, recipientIds: ['eu'] }, 'eu', nomeDe)).toBe('Conversa');
  });
});

import { describe, expect, it } from 'vitest';
import { montarLinhas, quemDigita, rotuloDoDia, type MensagemParaLinha } from './linhas.js';

/** Quinta-feira, 24 de setembro de 2026, 22h. */
const AGORA = new Date(2026, 8, 24, 22, 0, 0);

let proximo = 100;
function msg(autor: string, quando: Date, extra: Partial<MensagemParaLinha> = {}): MensagemParaLinha {
  return { id: String(proximo++), authorId: autor, createdAt: quando.toISOString(), type: 'DEFAULT', reference: null, ...extra };
}
const as = (h: number, min: number, dia = 24) => new Date(2026, 8, dia, h, min);

/** So o essencial de cada linha, para os testes lerem como a tela. */
function resumo(linhas: ReturnType<typeof montarLinhas>): string[] {
  return linhas.map((l) =>
    l.tipo === 'dia'
      ? `// ${l.rotulo}${l.novas ? ` +${l.novas} novas` : ''}`
      : l.tipo === 'novas'
        ? `NOVAS ${l.quantas}`
        : `${l.continua ? '  ' : ''}#${l.indice}`,
  );
}

describe('montarLinhas', () => {
  it('a mesma pessoa dentro de 7 minutos continua o bloco', () => {
    const m = [msg('kaya', as(22, 0)), msg('kaya', as(22, 3)), msg('kaya', as(22, 9, 24))];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '  #1', '  #2']);
  });

  it('passou de 7 minutos, abre bloco novo', () => {
    const m = [msg('kaya', as(21, 0)), msg('kaya', as(21, 7))];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '#1']);
  });

  it('outra pessoa abre bloco novo', () => {
    const m = [msg('kaya', as(21, 0)), msg('rafa', as(21, 1))];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '#1']);
  });

  it('resposta nunca continua a anterior', () => {
    const m = [msg('kaya', as(21, 0)), msg('kaya', as(21, 1), { type: 'REPLY', reference: { messageId: '1' } })];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '#1']);
  });

  it('mensagem de sistema nao agrupa nem e agrupada', () => {
    const m = [msg('kaya', as(21, 0)), msg('kaya', as(21, 1), { type: 'PINNED_MESSAGE' }), msg('kaya', as(21, 2))];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '#1', '#2']);
  });

  it('a virada da meia-noite separa, mesmo com vinte minutos de distancia', () => {
    const m = [msg('kaya', as(23, 50, 23)), msg('kaya', as(0, 10, 24))];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Ontem', '#0', '// Hoje', '#1']);
  });

  it('o divisor de novas quebra o bloco', () => {
    const m = [msg('kaya', as(22, 0)), msg('kaya', as(22, 1)), msg('kaya', as(22, 2))];
    expect(resumo(montarLinhas(m, 1, 2, AGORA))).toEqual(['// Hoje', '#0', 'NOVAS 2', '#1', '  #2']);
  });

  it('divisor em cima de um dia novo vira uma linha so', () => {
    const m = [msg('kaya', as(20, 0, 23)), msg('rafa', as(9, 0, 24))];
    expect(resumo(montarLinhas(m, 1, 1, AGORA))).toEqual(['// Ontem', '#0', '// Hoje +1 novas', '#1']);
  });

  it('sem nao lidas, o corte nao desenha nada', () => {
    const m = [msg('kaya', as(22, 0)), msg('kaya', as(22, 1))];
    expect(resumo(montarLinhas(m, 1, 0, AGORA))).toEqual(['// Hoje', '#0', '  #1']);
  });

  it('data invalida nao quebra a lista', () => {
    const m = [msg('kaya', as(22, 0)), { ...msg('kaya', as(22, 1)), createdAt: 'lixo' }];
    expect(resumo(montarLinhas(m, null, 0, AGORA))).toEqual(['// Hoje', '#0', '#1']);
  });
});

describe('rotuloDoDia', () => {
  it('hoje e ontem por calendario', () => {
    expect(rotuloDoDia(as(0, 1).toISOString(), AGORA)).toBe('Hoje');
    expect(rotuloDoDia(as(23, 59, 23).toISOString(), AGORA)).toBe('Ontem');
  });

  it('dentro da semana, o nome do dia sem "-feira"', () => {
    expect(rotuloDoDia(as(12, 0, 21).toISOString(), AGORA)).toBe('segunda, 21 de setembro');
  });

  it('fora da semana, a data; outro ano, com o ano', () => {
    expect(rotuloDoDia(as(12, 0, 10).toISOString(), AGORA)).toBe('10 de setembro');
    expect(rotuloDoDia(new Date(2025, 11, 31, 12).toISOString(), AGORA)).toBe('31 de dezembro de 2025');
  });
});

describe('quemDigita', () => {
  it('um, dois, tres e muitos', () => {
    expect(quemDigita([])).toBe('');
    expect(quemDigita(['kaya'])).toBe('kaya está digitando…');
    expect(quemDigita(['kaya', 'rafa'])).toBe('kaya e rafa estão digitando…');
    expect(quemDigita(['a', 'b', 'c'])).toBe('a, b e c estão digitando…');
    expect(quemDigita(['a', 'b', 'c', 'd'])).toBe('Várias pessoas estão digitando…');
  });
});

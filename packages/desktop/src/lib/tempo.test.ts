/**
 * O dia da mensagem, com o "agora" INJETADO.
 *
 * Sem o segundo parametro estes testes seriam bombas-relogio: passariam hoje e
 * reprovariam na virada do mes, ou numa segunda-feira, ou no dia em que
 * alguem rodasse a suite as 23h59. Teste que depende do relogio da maquina
 * reprova sozinho e manda procurar defeito onde nao tem.
 */
import { describe, it, expect } from 'vitest';
import { diaDaMensagem } from './tempo.js';

/** Quinta-feira, 22 de setembro de 2026, 10h. */
const AGORA = new Date(2026, 8, 22, 10, 0, 0);

describe('o caso comum nao gasta palavra', () => {
  /*
    O teste central. A calha ja escreve o horario; se este tambem escrevesse
    "hoje" em toda mensagem, o dado estaria duplicado na tela inteira.
  */
  it('hoje nao vira texto nenhum', () => {
    expect(diaDaMensagem(new Date(2026, 8, 22, 5, 12).toISOString(), AGORA)).toBe('');
  });

  it('nem no primeiro minuto do dia', () => {
    expect(diaDaMensagem(new Date(2026, 8, 22, 0, 0).toISOString(), AGORA)).toBe('');
  });

  it('nem no ultimo', () => {
    expect(diaDaMensagem(new Date(2026, 8, 22, 23, 59).toISOString(), AGORA)).toBe('');
  });
});

describe('a virada de dia e por calendario, nao por horas', () => {
  /*
    Este e o caso que uma subtracao de milissegundos erra. Vinte minutos
    separam as duas mensagens, e elas estao em dias diferentes — que e
    justamente o que quem le precisa enxergar.
  */
  it('23h50 de ontem e "ontem", mesmo a vinte minutos da meia-noite', () => {
    const quaseMeiaNoite = new Date(2026, 8, 21, 23, 50);
    const logoDepois = new Date(2026, 8, 22, 0, 10);
    expect(diaDaMensagem(quaseMeiaNoite.toISOString(), logoDepois)).toBe('ontem');
  });

  it('e 00h10 de hoje nao e', () => {
    const logoDepois = new Date(2026, 8, 22, 0, 10);
    expect(diaDaMensagem(logoDepois.toISOString(), logoDepois)).toBe('');
  });
});

describe('dentro da semana, o nome do dia situa melhor que a data', () => {
  it('sabado passado e "sabado", nao 19/09', () => {
    expect(diaDaMensagem(new Date(2026, 8, 19, 14, 0).toISOString(), AGORA)).toBe('sábado');
  });

  it('e o dia da semana vem sem o "-feira" que so ocupa espaco', () => {
    const resultado = diaDaMensagem(new Date(2026, 8, 18, 14, 0).toISOString(), AGORA);
    expect(resultado).not.toContain('feira');
    expect(resultado).toBe('sexta');
  });

  /*
    O limite existe porque o nome do dia deixa de identificar: "terca" pode
    ser a de tres semanas atras, e ai ele passa a enganar em vez de situar.
  */
  it('passou de seis dias, volta a ser data', () => {
    const antigo = diaDaMensagem(new Date(2026, 8, 10, 14, 0).toISOString(), AGORA);
    expect(antigo).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('e o limite nao corta por horas do dia', () => {
    // 16/09 as 23h e seis dias antes de 22/09: ainda dentro, e ainda nome.
    expect(diaDaMensagem(new Date(2026, 8, 16, 23, 0).toISOString(), AGORA)).toBe('quarta');
  });
});

describe('entrada estragada nao vira lixo na tela', () => {
  /*
    `new Date('abacaxi')` devolve um objeto valido cujo tempo e NaN, e
    `toLocaleDateString` nele imprime "Invalid Date". Sem esta guarda, um
    carimbo corrompido vindo do servidor apareceria escrito na conversa.
  */
  it('data invalida vira vazio, nao "Invalid Date"', () => {
    expect(diaDaMensagem('abacaxi', AGORA)).toBe('');
  });

  it('texto vazio tambem', () => {
    expect(diaDaMensagem('', AGORA)).toBe('');
  });
});

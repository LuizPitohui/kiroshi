/**
 * Quando o Enter envia a mensagem.
 *
 * Isto merece teste porque o erro e silencioso e caro nos dois sentidos: uma
 * mensagem sai pela metade, ou a tecla nao faz nada e a pessoa acha que o
 * aplicativo travou. E o Enter do teclado numerico e o caso classico de
 * defeito que so aparece para quem usa aquele teclado — ninguem tropeca nele
 * testando na mao.
 */

import { describe, it, expect } from 'vitest';
import { deveEnviar } from './leitura.js';

describe('modo padrao: Enter envia', () => {
  it('Enter sozinho envia', () => {
    expect(deveEnviar({ key: 'Enter' }, 'enter')).toBe(true);
  });

  it('Shift+Enter quebra a linha', () => {
    expect(deveEnviar({ key: 'Enter', shiftKey: true }, 'enter')).toBe(false);
  });

  it('Ctrl+Enter nao envia duas vezes', () => {
    // Quem tem o costume do outro modo aperta Ctrl+Enter aqui por reflexo. O
    // certo e nao enviar: o caractere tambem nao entra, e nada acontece — que
    // e melhor do que mandar quando nao se esperava.
    expect(deveEnviar({ key: 'Enter', ctrlKey: true }, 'enter')).toBe(false);
  });

  it('Alt+Enter nao envia', () => {
    expect(deveEnviar({ key: 'Enter', altKey: true }, 'enter')).toBe(false);
  });
});

describe('modo ctrl-enter: Enter quebra a linha', () => {
  it('Enter sozinho NAO envia', () => {
    expect(deveEnviar({ key: 'Enter' }, 'ctrl-enter')).toBe(false);
  });

  it('Ctrl+Enter envia', () => {
    expect(deveEnviar({ key: 'Enter', ctrlKey: true }, 'ctrl-enter')).toBe(true);
  });

  it('Cmd+Enter tambem envia', () => {
    expect(deveEnviar({ key: 'Enter', metaKey: true }, 'ctrl-enter')).toBe(true);
  });

  it('Shift+Enter continua quebrando a linha', () => {
    expect(deveEnviar({ key: 'Enter', shiftKey: true }, 'ctrl-enter')).toBe(false);
  });

  it('Ctrl+Shift+Enter nao envia', () => {
    expect(deveEnviar({ key: 'Enter', ctrlKey: true, shiftKey: true }, 'ctrl-enter')).toBe(false);
  });
});

describe('as tres formas de a tecla se apresentar', () => {
  it.each([
    ['key Enter', { key: 'Enter' }],
    ['key Return legado', { key: 'Return' }],
    ['code Enter', { key: 'Unidentified', code: 'Enter' }],
    ['Enter do teclado numerico', { key: 'Unidentified', code: 'NumpadEnter' }],
  ] as [string, { key: string; code?: string }][])('%s envia', (_nome, tecla) => {
    expect(deveEnviar(tecla, 'enter')).toBe(true);
  });
});

describe('outras teclas nunca enviam', () => {
  it.each(['a', 'Escape', 'Tab', ' ', 'ArrowDown'])('%s', (key) => {
    expect(deveEnviar({ key }, 'enter')).toBe(false);
    expect(deveEnviar({ key, ctrlKey: true }, 'ctrl-enter')).toBe(false);
  });
});

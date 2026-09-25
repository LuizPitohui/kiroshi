import { describe, expect, it } from 'vitest';
import { atalhoDaTecla, atalhoDoMouse, nomeDaTecla, rotuloDoAtalho, teclaBate } from './atalhos.js';

const tecla = (code: string, mod: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mod,
});

describe('nomeDaTecla', () => {
  it('letras, numeros, teclado numerico e as com nome', () => {
    expect(nomeDaTecla('KeyV')).toBe('V');
    expect(nomeDaTecla('Digit4')).toBe('4');
    expect(nomeDaTecla('Numpad1')).toBe('Num 1');
    expect(nomeDaTecla('Space')).toBe('Espaço');
    expect(nomeDaTecla('AltRight')).toBe('Alt Gr');
    expect(nomeDaTecla('F13')).toBe('F13');
  });
});

describe('rotuloDoAtalho', () => {
  it('combinacao na ordem Ctrl, Shift, Alt, Windows', () => {
    expect(rotuloDoAtalho({ tipo: 'tecla', codigo: 'KeyM', ctrl: true, shift: true, alt: false, meta: false })).toBe('Ctrl + Shift + M');
  });
  it('modificador que e a propria tecla nao aparece duas vezes', () => {
    expect(rotuloDoAtalho({ tipo: 'tecla', codigo: 'ControlLeft', ctrl: true, shift: false, alt: false, meta: false })).toBe('Ctrl');
  });
  it('mouse e nenhum', () => {
    expect(rotuloDoAtalho({ tipo: 'mouse', botao: 4 })).toBe('Mouse 4 (voltar)');
    expect(rotuloDoAtalho(null)).toBe('Nenhum');
  });
});

describe('atalhoDaTecla', () => {
  it('falar: a tecla sozinha, ignorando o que esta apertado junto', () => {
    expect(atalhoDaTecla(tecla('KeyV', { shiftKey: true }), 'falar')).toEqual({ tipo: 'tecla', codigo: 'KeyV', ctrl: false, shift: false, alt: false, meta: false });
  });
  it('o nome vem do caractere da tecla no teclado de quem escolheu (ABNT2)', () => {
    expect(rotuloDoAtalho(atalhoDaTecla({ ...tecla('Semicolon'), key: 'ç' }, 'falar'))).toBe('Ç');
    expect(rotuloDoAtalho(atalhoDaTecla({ ...tecla('Space'), key: ' ' }, 'falar'))).toBe('Espaço');
  });
  it('falar aceita um modificador sozinho (Alt Gr, Caps Lock)', () => {
    expect(atalhoDaTecla(tecla('AltRight', { altKey: true }), 'falar')?.tipo).toBe('tecla');
  });
  it('mutar: modificador sozinho ainda nao e o atalho', () => {
    expect(atalhoDaTecla(tecla('ShiftLeft', { shiftKey: true }), 'mutar')).toBeNull();
    expect(atalhoDaTecla(tecla('KeyM', { ctrlKey: true, shiftKey: true }), 'mutar')).toEqual({ tipo: 'tecla', codigo: 'KeyM', ctrl: true, shift: true, alt: false, meta: false });
  });
  it('Esc cancela a captura', () => {
    expect(atalhoDaTecla(tecla('Escape'), 'falar')).toBeNull();
  });
});

describe('atalhoDoMouse', () => {
  it('meio, voltar e avancar viram a numeracao da escuta; esquerdo e direito nao', () => {
    expect(atalhoDoMouse(1)).toEqual({ tipo: 'mouse', botao: 3 });
    expect(atalhoDoMouse(3)).toEqual({ tipo: 'mouse', botao: 4 });
    expect(atalhoDoMouse(4)).toEqual({ tipo: 'mouse', botao: 5 });
    expect(atalhoDoMouse(0)).toBeNull();
    expect(atalhoDoMouse(2)).toBeNull();
  });
});

describe('teclaBate', () => {
  const mutar = { tipo: 'tecla' as const, codigo: 'KeyM', ctrl: true, shift: true, alt: false, meta: false };
  it('combinacao exige os mesmos modificadores', () => {
    expect(teclaBate(mutar, tecla('KeyM', { ctrlKey: true, shiftKey: true }), 'mutar')).toBe(true);
    expect(teclaBate(mutar, tecla('KeyM', { ctrlKey: true }), 'mutar')).toBe(false);
  });
  it('falar bate com qualquer modificador', () => {
    const falar = { tipo: 'tecla' as const, codigo: 'KeyV', ctrl: false, shift: false, alt: false, meta: false };
    expect(teclaBate(falar, tecla('KeyV', { shiftKey: true }), 'falar')).toBe(true);
  });
});

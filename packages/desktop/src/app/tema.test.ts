import { describe, expect, it } from 'vitest';
import { temaEfetivo } from './tema.js';

describe('temaEfetivo', () => {
  it('escolha explicita ignora o sistema', () => {
    expect(temaEfetivo('escuro', true)).toBe('escuro');
    expect(temaEfetivo('claro', false)).toBe('claro');
  });

  it('"sistema" segue a preferencia do computador', () => {
    expect(temaEfetivo('sistema', true)).toBe('claro');
    expect(temaEfetivo('sistema', false)).toBe('escuro');
  });
});

import { describe, expect, it } from 'vitest';
import { problemaNoUsername, sugerirUsername } from './sugestao.js';

describe('sugerirUsername', () => {
  it('usa a parte do email antes do @, no formato do servidor', () => {
    expect(sugerirUsername('Joao.Silva@gmail.com', 'João Silva')).toBe('joao.silva');
    expect(sugerirUsername('ana-maria@gmail.com', null)).toBe('ana_maria');
  });

  it('sem email, usa o nome, sem acento', () => {
    expect(sugerirUsername(null, 'Conceição Ávila')).toBe('conceicao_avila');
  });

  it('nome reservado ganha sufixo', () => {
    expect(sugerirUsername('admin@gmail.com', null)).toBe('admin_1');
  });

  it('curto demais ou vazio vira algo valido', () => {
    expect(sugerirUsername('a@b.com', null)).toMatch(/^[a-z0-9._]{2,32}$/);
    expect(sugerirUsername(null, null)).toBe('usuario');
  });

  it('corta em 32', () => {
    expect(sugerirUsername(`${'x'.repeat(40)}@gmail.com`, null)).toHaveLength(32);
  });
});

describe('problemaNoUsername', () => {
  it('diz o que falta', () => {
    expect(problemaNoUsername('a')).toMatch(/2 caracteres/);
    expect(problemaNoUsername('Com-Hifen')).toMatch(/minúsculas/);
    expect(problemaNoUsername('everyone')).toMatch(/reservado/);
    expect(problemaNoUsername('kaya_2')).toBeNull();
  });
});

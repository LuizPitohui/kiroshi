import { describe, expect, it } from 'vitest';
import { descreverAparelho, vistoHa } from './aparelhos.js';

describe('descreverAparelho', () => {
  it('o app pelo nome e versao', () => {
    const beta =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Kiroshi Beta/1.15.0 Chrome/140.0.0.0 Electron/38.8.6 Safari/537.36';
    expect(descreverAparelho(beta)).toBe('Kiroshi Beta 1.15.0 · Windows');
    const normal = beta.replace('Kiroshi Beta/1.15.0', 'Kiroshi/1.15.0');
    expect(descreverAparelho(normal)).toBe('Kiroshi 1.15.0 · Windows');
  });
  it('Electron sem o nome do produto ainda e o Kiroshi', () => {
    expect(descreverAparelho('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Electron/38.8.6')).toBe('Kiroshi · Windows');
  });
  it('navegadores e programas', () => {
    expect(descreverAparelho('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36')).toBe('Navegador Chrome · Linux');
    expect(descreverAparelho('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36 Edg/140')).toBe('Navegador Edge · Windows');
    expect(descreverAparelho('node')).toBe('Programa');
    expect(descreverAparelho(null)).toBe('Aparelho desconhecido');
  });
});

describe('vistoHa', () => {
  const agora = Date.parse('2026-09-25T12:00:00Z');
  it('de agora a dias', () => {
    expect(vistoHa('2026-09-25T11:59:30Z', agora)).toBe('agora');
    expect(vistoHa('2026-09-25T11:55:00Z', agora)).toBe('há 5 minutos');
    expect(vistoHa('2026-09-25T09:00:00Z', agora)).toBe('há 3 horas');
    expect(vistoHa('2026-09-24T11:00:00Z', agora)).toBe('há 1 dia');
  });
});

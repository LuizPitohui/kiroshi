import { describe, expect, it } from 'vitest';
import { linkDosArgumentos, rotaDoLink } from './links.js';

describe('links kiroshi://', () => {
  it('convite vira a rota do convite, com o codigo intacto', () => {
    expect(rotaDoLink('kiroshi://convite/Ab3dEf7h')).toBe('#/convite/Ab3dEf7h');
    expect(rotaDoLink('kiroshi://convite/Ab3dEf7h/')).toBe('#/convite/Ab3dEf7h');
    expect(rotaDoLink('KIROSHI://CONVITE/Ab3dEf7h')).toBe('#/convite/Ab3dEf7h');
  });

  it('ignora o que nao conhece', () => {
    expect(rotaDoLink('kiroshi://convite/')).toBeNull();
    expect(rotaDoLink('kiroshi://convite/abc')).toBeNull();
    expect(rotaDoLink('kiroshi://convite/Ab3dEf7h/extra')).toBeNull();
    expect(rotaDoLink('kiroshi://ajustes/conta')).toBeNull();
    expect(rotaDoLink('https://order.arasaka.fun/convite/Ab3dEf7h')).toBeNull();
    expect(rotaDoLink('kiroshi://convite/Ab3d%2F..%2Fx')).toBeNull();
    expect(rotaDoLink('nao e url')).toBeNull();
  });

  it('acha o link no meio dos argumentos do Windows', () => {
    expect(linkDosArgumentos(['C:\\Kiroshi Beta.exe', '--hidden'])).toBeNull();
    expect(linkDosArgumentos(['C:\\Kiroshi Beta.exe', '--allow-file-access', 'kiroshi://convite/Ab3dEf7h'])).toBe('#/convite/Ab3dEf7h');
  });
});

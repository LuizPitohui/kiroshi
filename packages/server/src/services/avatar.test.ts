/**
 * A foto de perfil em GIF: parada em todo lugar, animada quando a pessoa fala.
 *
 * O que estes testes protegem e o que o dono pediu em 2026-09-26: a foto
 * parada TEM que ser parada (um quadro so), porque e ela que aparece em todo
 * lugar e nas versoes antigas do app; a animada tem que continuar animada,
 * repetir para sempre e sair no tamanho certo.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
const PASTA = mkdtempSync(path.join(tmpdir(), 'kiroshi-avatar-'));
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.STORAGE_DIR = PASTA;
process.env.PUBLIC_BASE_URL = 'https://kiroshi.teste';

const { storeAvatar, lerDataUrlDeImagem, AVATAR_ANIMADO_MAX_BYTES } = await import('./storage.js');

afterAll(() => rmSync(PASTA, { recursive: true, force: true }));

/**
 * Um GIF animado de verdade, sem biblioteca: paleta de 128 cores e LZW sem
 * compressao (um codigo de 8 bits por pixel, com CLEAR a cada 125 para a
 * tabela nunca passar de 8 bits). Cada quadro e de uma cor so.
 */
function gifAnimado(largura: number, altura: number, cores: [number, number, number][], centesimos = 10): Buffer {
  const b: number[] = [];
  const u16 = (v: number) => b.push(v & 0xff, v >> 8);
  b.push(...Buffer.from('GIF89a'));
  u16(largura);
  u16(altura);
  b.push(0xf6, 0, 0); // tabela global de 128 cores
  for (let i = 0; i < 128; i++) b.push(...(cores[i] ?? [0, 0, 0]));
  b.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00); // repete sempre
  cores.forEach((_, indice) => {
    b.push(0x21, 0xf9, 0x04, 0x00);
    u16(centesimos);
    b.push(0x00, 0x00);
    b.push(0x2c);
    u16(0);
    u16(0);
    u16(largura);
    u16(altura);
    b.push(0x00, 0x07); // sem tabela local; LZW com codigo minimo de 7 bits
    const codigos: number[] = [];
    let desdeOClear = 0;
    for (let p = 0; p < largura * altura; p++) {
      if (desdeOClear === 0) codigos.push(0x80);
      codigos.push(indice);
      desdeOClear = (desdeOClear + 1) % 125;
    }
    codigos.push(0x81);
    for (let i = 0; i < codigos.length; i += 255) {
      const bloco = codigos.slice(i, i + 255);
      b.push(bloco.length, ...bloco);
    }
    b.push(0x00);
  });
  b.push(0x3b);
  return Buffer.from(b);
}

/**
 * LZW de verdade (a regra de tamanho de codigo do omggif) para `total` pixels
 * da cor 0. Uma cor so comprime ~2700:1: e assim que se faz um GIF "bomba".
 */
function lzwDeUmaCor(total: number, minimo: number): number[] {
  const clear = 1 << minimo;
  const fim = clear + 1;
  let tamanho = minimo + 1;
  let proximo = fim + 1;
  let tabela = new Map<number, number>();
  const saida: number[] = [];
  let acumulado = 0;
  let bits = 0;
  const emitir = (codigo: number) => {
    acumulado |= codigo << bits;
    bits += tamanho;
    while (bits >= 8) {
      saida.push(acumulado & 0xff);
      acumulado >>>= 8;
      bits -= 8;
    }
  };
  emitir(clear);
  let atual = 0;
  for (let i = 1; i < total; i++) {
    const achou = tabela.get(atual);
    if (achou !== undefined) {
      atual = achou;
      continue;
    }
    emitir(atual);
    if (proximo === 4096) {
      emitir(clear);
      proximo = fim + 1;
      tamanho = minimo + 1;
      tabela = new Map();
    } else {
      if (proximo >= 1 << tamanho) tamanho++;
      tabela.set(atual, proximo++);
    }
    atual = 0;
  }
  emitir(atual);
  emitir(fim);
  if (bits > 0) saida.push(acumulado & 0xff);
  return saida;
}

/** Um GIF "bomba": poucos KB que abertos viram largura x altura x quadros pixels. */
function gifBomba(largura: number, altura: number, quadros: number): Buffer {
  const b: number[] = [];
  const u16 = (v: number) => b.push(v & 0xff, v >> 8);
  b.push(...Buffer.from('GIF89a'));
  u16(largura);
  u16(altura);
  b.push(0xf0, 0, 0, 220, 38, 38, 255, 255, 255); // tabela global de 2 cores
  b.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  const dados = lzwDeUmaCor(largura * altura, 2);
  const blocos: number[] = [];
  for (let i = 0; i < dados.length; i += 255) {
    const bloco = dados.slice(i, i + 255);
    blocos.push(bloco.length, ...bloco);
  }
  for (let q = 0; q < quadros; q++) {
    b.push(0x21, 0xf9, 0x04, 0x00, 10, 0, 0x00, 0x00);
    b.push(0x2c, 0, 0, 0, 0);
    u16(largura);
    u16(altura);
    b.push(0x00, 0x02);
    for (const x of blocos) b.push(x);
    b.push(0x00);
  }
  b.push(0x3b);
  return Buffer.from(b);
}

const arquivoDe = (url: string): string => path.join(PASTA, url.split('/attachments/')[1] ?? '');
const CORES: [number, number, number][] = [
  [220, 38, 38],
  [34, 197, 94],
  [59, 130, 246],
  [250, 204, 21],
  [168, 85, 247],
  [244, 244, 245],
];

describe('foto de perfil em GIF', () => {
  it('o GIF de teste e animado mesmo (6 quadros)', async () => {
    const m = await sharp(gifAnimado(300, 200, CORES), { animated: true }).metadata();
    expect(m.pages).toBe(6);
  });

  it('vira duas: a parada, com um quadro so, e a animada', async () => {
    const r = await storeAvatar(gifAnimado(300, 200, CORES), 8 * 1024 * 1024);
    expect(r.animatedUrl).not.toBeNull();

    const parada = await sharp(readFileSync(arquivoDe(r.url)), { animated: true }).metadata();
    expect(parada.format).toBe('webp');
    expect(parada.pages ?? 1).toBe(1);
    // 300x200: quadrada no menor lado, sem ampliar para 256.
    expect([parada.width, parada.height]).toEqual([200, 200]);

    const animada = await sharp(readFileSync(arquivoDe(r.animatedUrl!)), { animated: true }).metadata();
    expect(animada.format).toBe('webp');
    expect(animada.pages).toBe(6);
    expect([animada.width, animada.pageHeight]).toEqual([160, 160]);
    // Repete para sempre: um GIF de uma vez so pararia depois da primeira fala.
    expect(animada.loop).toBe(0);
  });

  it('a parada e o PRIMEIRO quadro', async () => {
    const r = await storeAvatar(gifAnimado(300, 200, CORES), 8 * 1024 * 1024);
    const { data } = await sharp(readFileSync(arquivoDe(r.url))).raw().toBuffer({ resolveWithObject: true });
    const [vermelho, verde, azul] = [data[0]!, data[1]!, data[2]!];
    // WebP com perda: perto da cor do primeiro quadro, e longe das outras.
    expect(Math.abs(vermelho - 220)).toBeLessThan(20);
    expect(Math.abs(verde - 38)).toBeLessThan(20);
    expect(Math.abs(azul - 38)).toBeLessThan(20);
  });

  it('imagem grande sai no tamanho do alvo, quadrada', async () => {
    const r = await storeAvatar(gifAnimado(600, 400, CORES.slice(0, 3)), 8 * 1024 * 1024);
    const parada = await sharp(readFileSync(arquivoDe(r.url))).metadata();
    expect([parada.width, parada.height]).toEqual([256, 256]);
    const animada = await sharp(readFileSync(arquivoDe(r.animatedUrl!)), { animated: true }).metadata();
    expect([animada.width, animada.pageHeight, animada.pages]).toEqual([160, 160, 3]);
  });

  it('GIF pequeno nao e ampliado, mas fica quadrado', async () => {
    const r = await storeAvatar(gifAnimado(90, 60, CORES.slice(0, 2)), 8 * 1024 * 1024);
    const animada = await sharp(readFileSync(arquivoDe(r.animatedUrl!)), { animated: true }).metadata();
    expect([animada.width, animada.pageHeight]).toEqual([60, 60]);
  });

  it('foto parada (PNG) continua uma so, sem animada', async () => {
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#dc2626' } }).png().toBuffer();
    const r = await storeAvatar(png, 8 * 1024 * 1024);
    expect(r.animatedUrl).toBeNull();
    const m = await sharp(readFileSync(arquivoDe(r.url))).metadata();
    expect([m.format, m.width, m.height]).toEqual(['webp', 256, 256]);
  });

  it('recusa o que passa do limite de tamanho', async () => {
    await expect(storeAvatar(Buffer.alloc(1024), 100)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('recusa o que nao e imagem', async () => {
    await expect(storeAvatar(Buffer.from('isto nao e um gif'), 8 * 1024 * 1024)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('GIF bomba (poucos KB, 280 milhoes de pixels) e recusado como grande demais, sem erro 500', async () => {
    const bomba = gifBomba(2000, 2000, 70);
    expect(bomba.length).toBeLessThan(512 * 1024);
    await expect(storeAvatar(bomba, 8 * 1024 * 1024)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: expect.stringMatching(/grande demais/),
    });
  });

  it('GIF abaixo do teto de pixels ainda converte', async () => {
    // 2000x2000x10 = 40 milhoes de pixels: uma cor so, vira um quadro so na animada.
    const r = await storeAvatar(gifBomba(2000, 2000, 10), 8 * 1024 * 1024);
    const parada = await sharp(readFileSync(arquivoDe(r.url))).metadata();
    expect([parada.width, parada.height]).toEqual([256, 256]);
  });

  it('GIF cortado no meio aproveita os quadros inteiros, como o navegador', async () => {
    const inteiro = gifAnimado(300, 200, CORES);
    const cortado = inteiro.subarray(0, Math.floor(inteiro.length * 0.6));
    const r = await storeAvatar(cortado, 8 * 1024 * 1024);
    const animada = await sharp(readFileSync(arquivoDe(r.animatedUrl!)), { animated: true }).metadata();
    expect(animada.pages).toBeGreaterThanOrEqual(2);
    expect(animada.pages).toBeLessThan(6);
  });

  it('o teto da animada fica abaixo do limite de envio', () => {
    expect(AVATAR_ANIMADO_MAX_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});

describe('data URL de imagem', () => {
  it('aceita GIF e devolve os bytes', () => {
    const gif = gifAnimado(10, 10, CORES.slice(0, 2));
    expect(lerDataUrlDeImagem(`data:image/gif;base64,${gif.toString('base64')}`).equals(gif)).toBe(true);
  });

  it('recusa tipo que nao e imagem aceita', () => {
    expect(() => lerDataUrlDeImagem('data:text/html;base64,PGh0bWw+')).toThrow(/PNG, JPEG, GIF ou WebP/);
  });

  it('recusa o que nao e data URL', () => {
    expect(() => lerDataUrlDeImagem('https://outro.site/foto.gif')).toThrow(/data URL/);
  });
});

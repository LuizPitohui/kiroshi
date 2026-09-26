import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ANIMADAS, MAX_BYTES_ANIMADAS, baixarAnimada, esquecerTodas, guardadas } from './fotosAnimadas.js';

const MB = 1024 * 1024;
let pedidos: string[];
let tamanhoDe: (url: string) => number;
let resposta: (url: string) => 'ok' | 'rede' | '404' | '503';

beforeEach(() => {
  pedidos = [];
  tamanhoDe = () => 100;
  resposta = () => 'ok';
  vi.stubGlobal('fetch', async (url: string) => {
    pedidos.push(url);
    const r = resposta(url);
    if (r === 'rede') throw new TypeError('Failed to fetch');
    if (r === '404') return new Response('nao achei', { status: 404 });
    if (r === '503') return new Response('fora do ar', { status: 503 });
    return new Response(new Uint8Array(tamanhoDe(url)));
  });
});

afterEach(() => {
  esquecerTodas();
  vi.unstubAllGlobals();
});

describe('bytes das fotos animadas', () => {
  it('baixa uma vez por endereco, mesmo com pedidos ao mesmo tempo', async () => {
    const [a, b] = await Promise.all([baixarAnimada('u1'), baixarAnimada('u1')]);
    await baixarAnimada('u1');
    expect(pedidos).toEqual(['u1']);
    expect(a).toBe(b);
    expect(a?.size).toBe(100);
  });

  it('falha de rede devolve null e a proxima fala tenta de novo', async () => {
    resposta = () => 'rede';
    expect(await baixarAnimada('u1')).toBeNull();
    resposta = () => 'ok';
    expect((await baixarAnimada('u1'))?.size).toBe(100);
    expect(pedidos).toEqual(['u1', 'u1']);
    expect(guardadas()).toEqual({ quantas: 1, bytes: 100 });
  });

  it('404 fica lembrado: anexo nao volta, e nao se pede de novo a cada fala', async () => {
    resposta = () => '404';
    expect(await baixarAnimada('u1')).toBeNull();
    expect(await baixarAnimada('u1')).toBeNull();
    expect(pedidos).toEqual(['u1']);
    expect(guardadas()).toEqual({ quantas: 1, bytes: 0 });
  });

  it('erro 5xx e tratado como falha passageira', async () => {
    resposta = () => '503';
    expect(await baixarAnimada('u1')).toBeNull();
    resposta = () => 'ok';
    expect((await baixarAnimada('u1'))?.size).toBe(100);
    expect(pedidos).toEqual(['u1', 'u1']);
  });

  it('passou do teto de bytes: sai a mais esquecida', async () => {
    tamanhoDe = () => 10 * MB;
    for (const u of ['a', 'b', 'c']) await baixarAnimada(u);
    expect(guardadas()).toEqual({ quantas: 3, bytes: 30 * MB });
    await baixarAnimada('a'); // usada de novo: vai para o fim da fila
    await baixarAnimada('d'); // 40 MB: sai a 'b'
    expect(guardadas()).toEqual({ quantas: 3, bytes: 30 * MB });
    pedidos = [];
    for (const u of ['a', 'c', 'd']) await baixarAnimada(u);
    expect(pedidos).toEqual([]);
    await baixarAnimada('b');
    expect(pedidos).toEqual(['b']);
  });

  it('uma animada maior que o teto fica (acabou de chegar, vai tocar), e as outras saem', async () => {
    tamanhoDe = (u) => (u === 'grande' ? MAX_BYTES_ANIMADAS + MB : MB);
    await baixarAnimada('p1');
    await baixarAnimada('p2');
    expect((await baixarAnimada('grande'))?.size).toBe(MAX_BYTES_ANIMADAS + MB);
    expect(guardadas()).toEqual({ quantas: 1, bytes: MAX_BYTES_ANIMADAS + MB });
  });

  it('passou do teto de quantidade: sai a primeira', async () => {
    for (let i = 0; i <= MAX_ANIMADAS; i++) await baixarAnimada(`u${i}`);
    expect(guardadas()).toEqual({ quantas: MAX_ANIMADAS, bytes: MAX_ANIMADAS * 100 });
    pedidos = [];
    await baixarAnimada('u0');
    expect(pedidos).toEqual(['u0']);
  });
});

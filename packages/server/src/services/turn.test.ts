/**
 * O relay e para quem nao alcanca o servidor direto. O que estes testes
 * protegem nao e o caminho feliz, e sim a regra de que ele nunca pode
 * atrapalhar quem nao precisa dele: um problema com a Cloudflare nao pode
 * impedir ninguem de entrar na chamada.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { montarIceServers, limparCacheDeTurn } = await import('./turn.js');
const { config } = await import('../config.js');

type Mutavel = {
  turnServers: unknown[];
  turnKeyId: string | null;
  turnApiToken: string | null;
};
const voz = config.voice as unknown as Mutavel;

const original = {
  turnServers: voz.turnServers,
  turnKeyId: voz.turnKeyId,
  turnApiToken: voz.turnApiToken,
};

/*
  A forma real da resposta, copiada de uma chamada de verdade: uma LISTA com
  STUN sem credencial e TURN com. Tratar como objeto unico foi o que deixou o
  relay desligado em silencio depois de um 201.
*/
const RESPOSTA_BOA = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
      ],
      username: 'usuario-efemero',
      credential: 'senha-efemera',
    },
  ],
};

function responder(corpo: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    })),
  );
}

beforeEach(() => {
  limparCacheDeTurn();
  voz.turnServers = [];
  voz.turnKeyId = 'chave-de-teste';
  voz.turnApiToken = 'token-de-teste';
});

afterEach(() => {
  vi.unstubAllGlobals();
  voz.turnServers = original.turnServers;
  voz.turnKeyId = original.turnKeyId;
  voz.turnApiToken = original.turnApiToken;
});

describe('sem nada configurado', () => {
  it('devolve lista vazia em vez de falhar', async () => {
    voz.turnKeyId = null;
    voz.turnApiToken = null;
    await expect(montarIceServers()).resolves.toEqual([]);
  });

  it('nao chama a rede quando nao ha chave', async () => {
    voz.turnKeyId = null;
    voz.turnApiToken = null;
    const espiao = vi.fn();
    vi.stubGlobal('fetch', espiao);
    await montarIceServers();
    expect(espiao).not.toHaveBeenCalled();
  });
});

describe('lista fixa no ambiente', () => {
  it('ganha da Cloudflare, para dar como trocar de provedor', async () => {
    voz.turnServers = [{ urls: ['turn:outro.exemplo:3478'], username: 'a', credential: 'b' }];
    const espiao = vi.fn();
    vi.stubGlobal('fetch', espiao);

    const r = await montarIceServers();
    expect(r).toEqual(voz.turnServers);
    expect(espiao).not.toHaveBeenCalled();
  });
});

/** A entrada que realmente retransmite: STUN vem junto e so descobre endereco. */
const relayDe = (lista: Awaited<ReturnType<typeof montarIceServers>>) =>
  lista.find((s) => s.username && s.credential);

describe('credenciais da Cloudflare', () => {
  it('preserva as duas entradas: STUN e TURN', async () => {
    responder(RESPOSTA_BOA);
    const r = await montarIceServers();
    expect(r).toHaveLength(2);
    expect(r.some((s) => s.urls.some((u) => u.startsWith('stun:')))).toBe(true);
  });

  it('traz o relay com usuario e senha', async () => {
    responder(RESPOSTA_BOA);
    const relay = relayDe(await montarIceServers());
    expect(relay?.username).toBe('usuario-efemero');
    expect(relay?.credential).toBe('senha-efemera');
  });

  it('descarta a porta 53, que os navegadores recusam', async () => {
    responder(RESPOSTA_BOA);
    const relay = relayDe(await montarIceServers());

    // Compara a porta, nao o texto: ":53" tambem aparece dentro de ":5349".
    const portas = relay!.urls.map((u) => Number(/:(\d+)$/.exec(u.split('?')[0]!)?.[1]));
    expect(portas).not.toContain(53);
    expect(relay!.urls.length).toBeGreaterThan(1);
  });

  it('nao confunde a 5349 do TLS com a 53', async () => {
    responder(RESPOSTA_BOA);
    const relay = relayDe(await montarIceServers());
    expect(relay!.urls.some((u) => u.includes('5349'))).toBe(true);
  });

  it('recusa resposta que so traz STUN, sem relay de verdade', async () => {
    // Um 201 com so STUN daria impressao de relay configurado enquanto quem
    // precisa dele continuaria sem voz.
    responder({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] });
    await expect(montarIceServers()).resolves.toEqual([]);
  });

  it('reusa o que ja pediu, para reconexao nao virar rajada', async () => {
    responder(RESPOSTA_BOA);
    const espiao = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await montarIceServers();
    await montarIceServers();
    await montarIceServers();

    expect(espiao).toHaveBeenCalledTimes(1);
  });
});

describe('quando a Cloudflare falha', () => {
  it('nao lanca: entrar na chamada nao pode depender do relay', async () => {
    responder({ erro: 'sem autorizacao' }, false, 401);
    await expect(montarIceServers()).resolves.toEqual([]);
  });

  it('nao lanca quando a rede cai', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    );
    await expect(montarIceServers()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a resposta vem sem servidores', async () => {
    responder({ iceServers: { urls: [] } });
    await expect(montarIceServers()).resolves.toEqual([]);
  });

  it('segura o que ja tinha quando uma renovacao falha', async () => {
    // Relay antigo ainda serve; ficar sem nenhum e que deixaria alguem mudo.
    responder(RESPOSTA_BOA);
    const bons = await montarIceServers();
    expect(bons).toHaveLength(2);

    limparCacheDeTurn();
    responder(RESPOSTA_BOA);
    await montarIceServers();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('caiu');
      }),
    );
    // Ainda dentro da validade: o cache responde sem tocar na rede.
    await expect(montarIceServers()).resolves.toHaveLength(2);
  });
});

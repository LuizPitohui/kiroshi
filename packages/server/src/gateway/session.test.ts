/**
 * Buffer, sequencia e retomada de uma sessao de gateway.
 *
 * O que estes testes protegem: uma queda curta de rede nao pode custar
 * mensagens. O RESUME existe para isso, e ele so cumpre o que promete se o
 * que acontece DURANTE a queda entrar no buffer.
 */

import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { GatewayCloseCode, SESSION_REPLAY_BUFFER } from '@kiroshi/shared';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { GatewaySession, fechamentoDeProposito } = await import('./session.js');

const ABERTO = 1;
const FECHADO = 3;

function socketFalso() {
  return { readyState: ABERTO, OPEN: ABERTO, send: vi.fn(), close: vi.fn() };
}

type SocketFalso = ReturnType<typeof socketFalso>;

function comoWs(socket: SocketFalso): WebSocket {
  return socket as unknown as WebSocket;
}

/** Os `seq` que chegaram ao socket, na ordem. */
function seqs(socket: SocketFalso): number[] {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string).s as number);
}

const MENSAGEM = {} as never;

describe('despacho com o socket fechado', () => {
  it('guarda no buffer e avanca o seq, sem tentar enviar', () => {
    const socket = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(socket), 'login-1');

    sessao.dispatch('MESSAGE_CREATE', MENSAGEM);
    socket.readyState = FECHADO;
    sessao.dispatch('MESSAGE_CREATE', MENSAGEM);
    sessao.dispatch('MESSAGE_UPDATE', MENSAGEM);

    expect(sessao.seq).toBe(3);
    expect(seqs(socket)).toEqual([1]);
  });

  it('o RESUME entrega o que aconteceu durante a queda, na ordem', () => {
    const antigo = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(antigo), 'login-1');

    sessao.dispatch('MESSAGE_CREATE', MENSAGEM); // seq 1, o cliente viu
    antigo.readyState = FECHADO;
    sessao.dispatch('MESSAGE_CREATE', MENSAGEM); // seq 2, perdido na queda
    sessao.dispatch('MESSAGE_DELETE', MENSAGEM); // seq 3, perdido na queda

    const novo = socketFalso();
    sessao.attachSocket(comoWs(novo));

    expect(sessao.replayFrom(1)).toBe(2);
    expect(seqs(novo)).toEqual([2, 3]);
  });

  it('quem esta em dia nao recebe nada de novo', () => {
    const sessao = new GatewaySession('s1', 'u1', comoWs(socketFalso()), 'login-1');
    sessao.dispatch('MESSAGE_CREATE', MENSAGEM);
    expect(sessao.replayFrom(1)).toBe(0);
  });

  it('cliente que diz ter visto o futuro refaz do zero', () => {
    const sessao = new GatewaySession('s1', 'u1', comoWs(socketFalso()), 'login-1');
    sessao.dispatch('MESSAGE_CREATE', MENSAGEM);
    expect(sessao.replayFrom(5)).toBeNull();
  });
});

describe('eventos que nunca entram no buffer', () => {
  it('um evento de digitacao logo depois do ultimo visto nao vira lacuna', () => {
    const socket = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(socket), 'login-1');

    sessao.dispatch('MESSAGE_CREATE', MENSAGEM); // seq 1, o cliente viu
    socket.readyState = FECHADO;
    sessao.dispatch('TYPING_START', MENSAGEM); // seq 2, nunca entra no buffer
    for (let i = 0; i < SESSION_REPLAY_BUFFER; i++) sessao.dispatch('MESSAGE_CREATE', MENSAGEM);

    /*
      O buffer ficou com 3..514: tudo que o cliente nao viu e pode ser
      reenviado esta la. A conta antiga olhava o evento mais velho do buffer
      (3), via que ele nao era o seguinte ao visto (2) e mandava refazer tudo
      do zero, sem que nada tivesse se perdido.
    */
    const novo = socketFalso();
    sessao.attachSocket(comoWs(novo));
    expect(sessao.replayFrom(1)).toBe(SESSION_REPLAY_BUFFER);
    expect(seqs(novo)[0]).toBe(3);
  });
});

describe('buffer cheio', () => {
  it('quem perdeu um evento que ja saiu do buffer refaz do zero', () => {
    const socket = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(socket), 'login-1');

    sessao.dispatch('MESSAGE_CREATE', MENSAGEM); // seq 1, o cliente viu
    socket.readyState = FECHADO;
    for (let i = 0; i < SESSION_REPLAY_BUFFER + 1; i++) sessao.dispatch('MESSAGE_CREATE', MENSAGEM);

    expect(sessao.replayFrom(1)).toBeNull();
  });

  it('quem so perdeu o que ainda esta no buffer recebe tudo', () => {
    const socket = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(socket), 'login-1');

    for (let i = 0; i < SESSION_REPLAY_BUFFER + 10; i++) sessao.dispatch('MESSAGE_CREATE', MENSAGEM);
    const visto = sessao.seq;
    socket.readyState = FECHADO;
    sessao.dispatch('MESSAGE_CREATE', MENSAGEM);

    const novo = socketFalso();
    sessao.attachSocket(comoWs(novo));
    expect(sessao.replayFrom(visto)).toBe(1);
  });
});

describe('fechamento atrasado de um socket antigo', () => {
  it('nao marca como caida a sessao que ja esta em outro socket', () => {
    const antigo = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(antigo), 'login-1');

    const novo = socketFalso();
    sessao.close(GatewayCloseCode.SESSION_REPLACED, 'retomada em outro socket');
    sessao.attachSocket(comoWs(novo));

    // O `close` do socket antigo chega depois da troca.
    sessao.socketFechou(comoWs(antigo));
    expect(sessao.disconnectedAt).toBeNull();
    expect(sessao.isOpen).toBe(true);
  });

  it('a queda do socket atual continua contando', () => {
    const socket = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(socket), 'login-1');
    expect(sessao.socketFechou(comoWs(socket))).toBe(true);
    expect(sessao.disconnectedAt).not.toBeNull();
  });

  it('diz quando o socket que fechou ja nao era o da sessao', () => {
    const antigo = socketFalso();
    const sessao = new GatewaySession('s1', 'u1', comoWs(antigo), 'login-1');
    sessao.close(GatewayCloseCode.SESSION_REPLACED, 'retomada em outro socket');
    sessao.attachSocket(comoWs(socketFalso()));
    expect(sessao.socketFechou(comoWs(antigo))).toBe(false);
  });
});

describe('fechamento de proposito (a voz sai na hora)', () => {
  it('1001 (o app fechou ou reiniciou) e 1000 (logout)', () => {
    expect(fechamentoDeProposito(1001)).toBe(true);
    expect(fechamentoDeProposito(1000)).toBe(true);
  });

  it('queda de rede (1006), sem codigo (1005) e o app reconectando (4000) esperam a retomada', () => {
    expect(fechamentoDeProposito(1006)).toBe(false);
    expect(fechamentoDeProposito(1005)).toBe(false);
    expect(fechamentoDeProposito(4000)).toBe(false);
  });
});

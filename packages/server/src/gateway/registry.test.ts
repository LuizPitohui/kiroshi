/**
 * Entrega de eventos do gateway, sem banco e sem socket de verdade.
 *
 * O que estes testes protegem: o token de voz vai para UMA sessao. Emitido
 * para a conta inteira, ele fazia qualquer outro aparelho logado entrar na
 * chamada sozinho e abrir o microfone.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { GatewaySession } = await import('./session.js');
const { sessions, dispatchToSession, dispatchToUser } = await import('./registry.js');

function socketFalso() {
  return { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() };
}

type SocketFalso = ReturnType<typeof socketFalso>;

const criadas: InstanceType<typeof GatewaySession>[] = [];

function sessao(id: string, userId: string): { sessao: InstanceType<typeof GatewaySession>; socket: SocketFalso } {
  const socket = socketFalso();
  const s = new GatewaySession(id, userId, socket as unknown as WebSocket, `login-${id}`);
  sessions.add(s);
  criadas.push(s);
  return { sessao: s, socket };
}

/** Nomes dos eventos que chegaram ao socket falso, na ordem. */
function recebidos(socket: SocketFalso): string[] {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string).t as string);
}

const TOKEN = {
  channelId: '10',
  guildId: '1',
  url: 'wss://sfu',
  token: 't',
  roomName: 'channel_10',
  iceServers: [],
  forceRelay: false,
};

afterEach(() => {
  for (const s of criadas.splice(0)) sessions.remove(s);
});

describe('dispatchToSession', () => {
  it('entrega so a sessao pedida, e nao as outras da mesma conta', () => {
    const computador = sessao('s1', 'u1');
    const celular = sessao('s2', 'u1');

    expect(dispatchToSession('u1', 's1', 'VOICE_SERVER_UPDATE', TOKEN)).toBe(1);

    expect(recebidos(computador.socket)).toEqual(['VOICE_SERVER_UPDATE']);
    expect(recebidos(celular.socket)).toEqual([]);
  });

  it('nao entrega a sessao de outra conta, mesmo com o id certo', () => {
    const alheia = sessao('s3', 'u2');
    expect(dispatchToSession('u1', 's3', 'VOICE_SERVER_UPDATE', TOKEN)).toBe(0);
    expect(recebidos(alheia.socket)).toEqual([]);
  });

  it('sessao que nao existe neste processo nao quebra nada', () => {
    expect(dispatchToSession('u1', 'nao-existe', 'VOICE_SERVER_UPDATE', TOKEN)).toBe(0);
  });

  it('dispatchToUser continua indo para todas as sessoes da conta', () => {
    const a = sessao('s4', 'u3');
    const b = sessao('s5', 'u3');
    dispatchToUser('u3', 'USER_UPDATE', {} as never);
    expect(recebidos(a.socket)).toEqual(['USER_UPDATE']);
    expect(recebidos(b.socket)).toEqual(['USER_UPDATE']);
  });
});

describe('sessao que caiu e ainda pode ser retomada', () => {
  it('continua recebendo no buffer, sem envio, e avanca o seq', () => {
    // Pular a sessao sem socket aberto era o que fazia o RESUME perder tudo
    // o que acontecia durante a queda.
    const caida = sessao('s6', 'u4');
    caida.socket.readyState = 3;
    caida.sessao.socketFechou(caida.sessao.socket);

    expect(dispatchToUser('u4', 'USER_UPDATE', {} as never)).toBe(1);
    expect(caida.sessao.seq).toBe(1);
    expect(recebidos(caida.socket)).toEqual([]);
  });

  it('sessao encerrada, fora do registro, nao recebe mais nada', () => {
    const encerrada = sessao('s7', 'u5');
    sessions.remove(encerrada.sessao);
    expect(dispatchToUser('u5', 'USER_UPDATE', {} as never)).toBe(0);
    expect(encerrada.sessao.seq).toBe(0);
  });
});

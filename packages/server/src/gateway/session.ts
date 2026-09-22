import type { WebSocket } from 'ws';
import {
  GatewayCloseCode,
  GatewayOpcode,
  NON_REPLAYABLE_EVENTS,
  SESSION_REPLAY_BUFFER,
  type GatewayEnvelope,
  type GatewayEventMap,
  type GatewayEventName,
  type PresenceStatus,
} from '@kiroshi/shared';
import { logger } from '../logger.js';

interface BufferedEvent {
  seq: number;
  name: GatewayEventName;
  payload: unknown;
}

/**
 * Uma conexao autenticada. Guarda o buffer de replay para que uma queda curta
 * de rede seja retomada sem recarregar o estado inteiro.
 */
export class GatewaySession {
  readonly id: string;
  readonly userId: string;
  socket: WebSocket;

  /** Sequencia do ultimo evento enviado. */
  seq = 0;

  /** Servidores que esta sessao acompanha. */
  readonly guildIds = new Set<string>();

  /** Canais de DM que esta sessao acompanha. */
  readonly privateChannelIds = new Set<string>();

  status: PresenceStatus = 'ONLINE';
  customStatus: string | null = null;

  /** Momento do ultimo HEARTBEAT recebido. */
  lastHeartbeat = Date.now();

  /** Setado quando o socket cai; a sessao ainda pode ser retomada ate expirar. */
  disconnectedAt: number | null = null;

  /** Enquanto true, ignoramos o socket antigo apos uma troca por RESUME. */
  private closed = false;

  private readonly buffer: BufferedEvent[] = [];

  constructor(id: string, userId: string, socket: WebSocket) {
    this.id = id;
    this.userId = userId;
    this.socket = socket;
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  send(envelope: GatewayEnvelope): void {
    if (!this.isOpen) return;
    try {
      this.socket.send(JSON.stringify(envelope));
    } catch (error) {
      logger.warn({ error, sessionId: this.id }, 'falha ao escrever no socket');
    }
  }

  /** Envia um evento, incrementando a sequencia e guardando para replay. */
  dispatch<E extends GatewayEventName>(name: E, payload: GatewayEventMap[E]): void {
    this.seq += 1;

    if (!NON_REPLAYABLE_EVENTS.includes(name)) {
      this.buffer.push({ seq: this.seq, name, payload });
      if (this.buffer.length > SESSION_REPLAY_BUFFER) this.buffer.shift();
    }

    this.send({ op: GatewayOpcode.DISPATCH, t: name, s: this.seq, d: payload });
  }

  /**
   * Reenvia tudo que veio depois de `afterSeq`. Devolve null quando o buffer
   * ja passou desse ponto e a sessao precisa ser refeita do zero.
   */
  replayFrom(afterSeq: number): number | null {
    if (afterSeq > this.seq) return null; // cliente alega ter visto o futuro
    if (afterSeq === this.seq) return 0;

    const oldest = this.buffer[0];
    if (!oldest || oldest.seq > afterSeq + 1) return null; // lacuna no buffer

    let replayed = 0;
    for (const event of this.buffer) {
      if (event.seq <= afterSeq) continue;
      this.send({ op: GatewayOpcode.DISPATCH, t: event.name, s: event.seq, d: event.payload });
      replayed += 1;
    }
    return replayed;
  }

  /** Troca o socket ao retomar a sessao, sem perder a sequencia nem o buffer. */
  attachSocket(socket: WebSocket): void {
    this.socket = socket;
    this.disconnectedAt = null;
    this.lastHeartbeat = Date.now();
    this.closed = false;
  }

  close(code: GatewayCloseCode, reason: string): void {
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      // Socket ja estava morto; nada a fazer.
    }
  }

  markDisconnected(): void {
    this.disconnectedAt = Date.now();
  }
}

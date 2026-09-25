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

  /**
   * A sessao de login (linha em Session, o `sid` do token) que abriu esta
   * conexao. E por ela que encerrar uma sessao encontra a conexao para
   * derrubar. Muda no RESUME, que pode chegar com o token de outra sessao da
   * mesma conta.
   */
  authSessionId: string;

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

  /**
   * O `seq` do evento mais novo que ja saiu do buffer por falta de espaco.
   *
   * E o que diz, com exatidao, se uma retomada ainda tem como completar o que
   * falta. A conta antiga olhava so o evento mais velho do buffer, e errava
   * quando o seguinte ao do cliente era um evento que nunca entra no buffer
   * (digitacao, token de voz): via lacuna onde nao faltava nada.
   */
  private descartadoAte = 0;

  constructor(id: string, userId: string, socket: WebSocket, authSessionId: string) {
    this.id = id;
    this.userId = userId;
    this.socket = socket;
    this.authSessionId = authSessionId;
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

  /**
   * Registra um evento para esta sessao: avanca a sequencia, guarda para
   * replay e envia, se o socket estiver aberto.
   *
   * Guardar e enviar sao independentes DE PROPOSITO. Quem chama despacha para
   * toda sessao do registro, inclusive a que caiu e ainda pode ser retomada.
   * Antes o despacho pulava a sessao sem socket aberto, entao nada do que
   * acontecia durante a queda entrava no buffer: o RESUME respondia
   * "replayed: 0" e o cliente seguia sem as mensagens do intervalo, sem saber
   * que faltava alguma coisa.
   */
  dispatch<E extends GatewayEventName>(name: E, payload: GatewayEventMap[E]): void {
    this.seq += 1;

    if (!NON_REPLAYABLE_EVENTS.includes(name)) {
      this.buffer.push({ seq: this.seq, name, payload });
      if (this.buffer.length > SESSION_REPLAY_BUFFER) {
        const descartado = this.buffer.shift();
        if (descartado) this.descartadoAte = descartado.seq;
      }
    }

    this.send({ op: GatewayOpcode.DISPATCH, t: name, s: this.seq, d: payload });
  }

  /**
   * Reenvia tudo que veio depois de `afterSeq`. Devolve null quando algum
   * evento que o cliente nao viu ja saiu do buffer e a sessao precisa ser
   * refeita do zero.
   */
  replayFrom(afterSeq: number): number | null {
    if (afterSeq > this.seq) return null; // cliente alega ter visto o futuro
    if (afterSeq === this.seq) return 0;

    // Um evento com seq maior que o do cliente saiu do buffer: nao ha como
    // completar o que falta. Os que nunca entram no buffer nao contam.
    if (afterSeq < this.descartadoAte) return null;

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

  /**
   * Um socket desta sessao fechou. So conta como queda se ele ainda e o
   * socket dela.
   *
   * Uma retomada pode trocar o socket enquanto o antigo ainda termina de
   * fechar. O `close` atrasado do antigo marcava a sessao ja reanexada como
   * desconectada, e dois minutos depois a varredura a descartava viva: o
   * socket novo seguia aberto, sem receber mais nada.
   */
  socketFechou(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.disconnectedAt = Date.now();
  }
}

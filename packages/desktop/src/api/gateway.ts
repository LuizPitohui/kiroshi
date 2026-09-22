import {
  GatewayOpcode,
  NON_RESUMABLE_CLOSE_CODES,
  type GatewayEnvelope,
  type GatewayEventMap,
  type GatewayEventName,
  type HelloPayload,
  type InvalidSessionPayload,
  type PresenceStatus,
  type VoiceStateUpdatePayload,
} from '@kiroshi/shared';
import { api } from './client.js';
import { acaoDepoisDeRenovar, acaoParaQueda } from './queda.js';

/**
 * Cliente do gateway.
 *
 * O trabalho de verdade aqui e a reconexao. Um app de voz fica aberto o dia
 * inteiro: a maquina hiberna, o wifi troca de ponto, o tunel reinicia. Em
 * todos esses casos queremos voltar sem recarregar a interface, e o RESUME
 * do protocolo permite isso enquanto a sessao ainda existir no servidor.
 */

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'identifying'
  | 'ready'
  | 'reconnecting'
  | 'failed';

type EventHandler<E extends GatewayEventName> = (payload: GatewayEventMap[E]) => void;
type StateHandler = (state: ConnectionState) => void;

/** Espera entre tentativas: cresce ate 30 s e para de crescer. */
function backoffDelay(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  // Jitter evita que todos os clientes voltem no mesmo instante depois de
  // uma queda do servidor.
  return base + Math.random() * 1000;
}

class GatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private sessionId: string | null = null;
  private seq = 0;
  private attempt = 0;

  private state: ConnectionState = 'idle';
  private intentionalClose = false;

  /** Ultimo HEARTBEAT_ACK; se parar de chegar, a conexao esta zumbi. */
  private lastAck = 0;
  private heartbeatInterval = 41_250;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly stateHandlers = new Set<StateHandler>();

  private pendingPresence: { status: PresenceStatus; customStatus: string | null } | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  on<E extends GatewayEventName>(event: E, handler: EventHandler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    if (!api.getAccessToken()) return;

    /*
      Renova ANTES de abrir a conexao.

      O gateway conecta em momentos que ninguem escolheu — principalmente ao
      voltar de uma queda de internet. Nessa hora o access token quase sempre
      ja venceu, porque ele vive quinze minutos, e identificar-se com ele faz o
      servidor recusar. Era dai que vinha o "toda vez que cai a internet o
      aplicativo desloga".
    */
    if (!(await api.accessTokenValido())) return;

    // Outra tentativa pode ter aberto a conexao enquanto esperavamos acima.
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    this.intentionalClose = false;
    this.setState(this.sessionId ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(api.getGatewayUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      // Nada a fazer: o servidor manda HELLO e a conversa comeca ali.
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(event.data as string);
    });

    socket.addEventListener('close', (event) => {
      this.cleanupSocket();
      if (this.intentionalClose) {
        this.setState('idle');
        return;
      }
      this.handleDisconnect(event.code);
    });

    socket.addEventListener('error', () => {
      // O evento close vem logo em seguida e cuida da reconexao.
    });
  }

  private handleMessage(raw: string): void {
    let envelope: GatewayEnvelope;
    try {
      envelope = JSON.parse(raw) as GatewayEnvelope;
    } catch {
      return;
    }

    switch (envelope.op) {
      case GatewayOpcode.HELLO: {
        const hello = envelope.d as HelloPayload;
        this.heartbeatInterval = hello.heartbeatInterval;
        this.startHeartbeat();
        this.identifyOrResume();
        return;
      }

      case GatewayOpcode.HEARTBEAT_ACK:
        this.lastAck = Date.now();
        return;

      case GatewayOpcode.INVALID_SESSION: {
        const payload = envelope.d as InvalidSessionPayload;
        // Sessao perdida: comeca do zero na proxima tentativa.
        this.sessionId = null;
        this.seq = 0;
        if (payload?.resumable) {
          this.identifyOrResume();
        } else {
          this.send({ op: GatewayOpcode.IDENTIFY, d: this.buildIdentify() });
        }
        return;
      }

      case GatewayOpcode.RECONNECT:
        this.socket?.close(4000, 'reconnect pedido pelo servidor');
        return;

      case GatewayOpcode.DISPATCH: {
        if (typeof envelope.s === 'number') this.seq = envelope.s;
        const name = envelope.t;
        if (!name) return;

        if (name === 'READY') {
          const ready = envelope.d as GatewayEventMap['READY'];
          this.sessionId = ready.sessionId;
          this.attempt = 0;
          this.setState('ready');
        } else if (name === 'RESUMED') {
          this.attempt = 0;
          this.setState('ready');
        }

        const set = this.handlers.get(name);
        if (set) {
          for (const handler of set) {
            try {
              handler(envelope.d);
            } catch (error) {
              console.error(`erro no handler de ${name}`, error);
            }
          }
        }
        return;
      }

      default:
        return;
    }
  }

  private buildIdentify() {
    return {
      token: api.getAccessToken() ?? '',
      properties: {
        os: navigator.platform,
        client: 'kiroshi-desktop',
        version: __VERSAO__,
      },
      ...(this.pendingPresence
        ? {
            presence: {
              status: this.pendingPresence.status,
              customStatus: this.pendingPresence.customStatus,
            },
          }
        : {}),
    };
  }

  private identifyOrResume(): void {
    this.setState('identifying');

    if (this.sessionId && this.seq > 0) {
      this.send({
        op: GatewayOpcode.RESUME,
        d: { token: api.getAccessToken() ?? '', sessionId: this.sessionId, seq: this.seq },
      });
      return;
    }

    this.send({ op: GatewayOpcode.IDENTIFY, d: this.buildIdentify() });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastAck = Date.now();

    this.heartbeatTimer = setInterval(() => {
      // Sem ACK por dois intervalos, a conexao esta morta mesmo que o socket
      // pareca aberto: derruba para forcar a reconexao.
      if (Date.now() - this.lastAck > this.heartbeatInterval * 2.5) {
        this.socket?.close(4000, 'sem ack');
        return;
      }
      this.send({ op: GatewayOpcode.HEARTBEAT });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    this.socket = null;
  }

  private handleDisconnect(code: number): void {
    if (NON_RESUMABLE_CLOSE_CODES.includes(code)) {
      this.sessionId = null;
      this.seq = 0;
    }

    switch (acaoParaQueda(code)) {
      case 'parar':
        // Outro aparelho assumiu. A sessao continua valida; so nao aqui.
        this.setState('failed');
        return;

      case 'renovar-e-reconectar':
        void this.renovarEReconectar();
        return;

      default:
        this.agendarReconexao();
    }
  }

  /**
   * O servidor recusou o token. Renova antes de desistir.
   *
   * Esta e a UNICA porta do gateway para o logout, e ela so abre depois que o
   * servidor recusa tambem a renovacao — ou seja, quando a sessao acabou de
   * verdade. Um token vencido por falta de internet nao chega aqui.
   */
  private async renovarEReconectar(): Promise<void> {
    this.setState('reconnecting');

    // Forcado: o servidor recusou um token que o relogio local pode ainda
    // considerar valido, entao pedir "renove se preciso" nao faria nada.
    const token = await api.accessTokenValido(true);

    if (acaoDepoisDeRenovar(Boolean(token)) === 'sair') {
      this.setState('failed');
      api.setTokens(null);
      return;
    }

    this.agendarReconexao();
  }

  private agendarReconexao(): void {
    this.setState('reconnecting');

    const delay = backoffDelay(this.attempt);
    this.attempt += 1;

    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private send(envelope: GatewayEnvelope): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(envelope));
  }

  // ---------------------------------------------------------------------------
  // Acoes da interface
  // ---------------------------------------------------------------------------

  updatePresence(status: PresenceStatus, customStatus: string | null): void {
    this.pendingPresence = { status, customStatus };
    this.send({ op: GatewayOpcode.PRESENCE_UPDATE, d: { status, customStatus } });
  }

  updateVoiceState(payload: VoiceStateUpdatePayload): void {
    this.send({ op: GatewayOpcode.VOICE_STATE_UPDATE, d: payload });
  }

  requestGuildMembers(guildId: string, query = '', limit = 1000): void {
    this.send({ op: GatewayOpcode.REQUEST_GUILD_MEMBERS, d: { guildId, query, limit } });
  }

  sendTyping(channelId: string): void {
    this.send({ op: GatewayOpcode.TYPING, d: { channelId } });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.sessionId = null;
    this.seq = 0;
    this.attempt = 0;
    this.socket?.close(1000, 'logout');
    this.socket = null;
    this.setState('idle');
  }

  /** Forca uma reconexao imediata, usado quando a rede volta. */
  reconnectNow(): void {
    if (this.state === 'ready') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this.connect();
  }
}

export const gateway = new GatewayClient();

// A rede voltando e um bom motivo para tentar de novo sem esperar o backoff.
window.addEventListener('online', () => gateway.reconnectNow());

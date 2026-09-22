/**
 * IDs no estilo snowflake do Twitter/Discord: inteiro de 64 bits ordenavel por
 * tempo, gerado sem coordenacao entre processos.
 *
 *   42 bits  ms desde ORDER_EPOCH   (~139 anos de alcance)
 *    5 bits  id do worker           (0-31)
 *    5 bits  id do processo         (0-31)
 *   12 bits  sequencia              (4096 ids por ms por processo)
 *
 * Transitam como string decimal, porque JSON nao tem inteiro de 64 bits.
 * Ordenar IDs lexicograficamente NAO funciona; compare com compareIds.
 */

/** 2024-01-01T00:00:00.000Z */
export const ORDER_EPOCH = 1704067200000n;

const WORKER_BITS = 5n;
const PROCESS_BITS = 5n;
const SEQUENCE_BITS = 12n;

const MAX_WORKER = (1n << WORKER_BITS) - 1n;
const MAX_PROCESS = (1n << PROCESS_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

const PROCESS_SHIFT = SEQUENCE_BITS;
const WORKER_SHIFT = SEQUENCE_BITS + PROCESS_BITS;
const TIMESTAMP_SHIFT = SEQUENCE_BITS + PROCESS_BITS + WORKER_BITS;

export class SnowflakeGenerator {
  private readonly workerId: bigint;
  private readonly processId: bigint;
  private sequence = 0n;
  private lastTimestamp = -1n;

  constructor(workerId = 0, processId = 0) {
    this.workerId = BigInt(workerId) & MAX_WORKER;
    this.processId = BigInt(processId) & MAX_PROCESS;
  }

  next(): string {
    let timestamp = BigInt(Date.now());

    if (timestamp < this.lastTimestamp) {
      // Relogio andou para tras (NTP). Em vez de emitir id duplicado,
      // continua no ultimo timestamp conhecido ate o relogio alcancar.
      timestamp = this.lastTimestamp;
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // Estourou 4096 ids neste ms: avanca para o proximo.
        timestamp = this.waitNextMillis(timestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      ((timestamp - ORDER_EPOCH) << TIMESTAMP_SHIFT) |
      (this.workerId << WORKER_SHIFT) |
      (this.processId << PROCESS_SHIFT) |
      this.sequence;

    return id.toString();
  }

  private waitNextMillis(current: bigint): bigint {
    let timestamp = BigInt(Date.now());
    while (timestamp <= current) timestamp = BigInt(Date.now());
    return timestamp;
  }
}

/**
 * Identifica o gerador. No servidor vem do ambiente e do pid; no cliente, onde
 * `process` nao existe (o renderer roda com contextIsolation), cai em valores
 * aleatorios. Os ids do cliente sao so temporarios, para o envio otimista, e
 * nunca precisam ser unicos entre maquinas.
 */
function generatorIds(): { worker: number; process: number } {
  const env = globalThis as { process?: { env?: Record<string, string | undefined>; pid?: number } };

  if (typeof env.process?.pid === 'number') {
    return {
      worker: Number(env.process.env?.ORDER_WORKER_ID ?? 0) % 32,
      process: env.process.pid % 32,
    };
  }

  return {
    worker: Math.floor(Math.random() * 32),
    process: Math.floor(Math.random() * 32),
  };
}

const ids = generatorIds();
const defaultGenerator = new SnowflakeGenerator(ids.worker, ids.process);

export function generateId(): string {
  return defaultGenerator.next();
}

/** Momento de criacao codificado dentro do id. */
export function timestampOf(id: string): Date {
  const value = BigInt(id) >> TIMESTAMP_SHIFT;
  return new Date(Number(value + ORDER_EPOCH));
}

/**
 * Compara dois ids numericamente. Use em sort, nunca a comparacao de string.
 *
 * Nao lanca. Isso ja custou caro: um id que nao era snowflake chegou aqui, o
 * `BigInt` estourou, e a excecao subiu pelo comparador ate abortar o envio de
 * mensagem inteiro — sem erro na tela, sem requisicao, nada. Um comparador que
 * lanca derruba quem o chamou, e quem chama um comparador quase nunca espera
 * por isso.
 *
 * O que nao for snowflake vai para o fim da ordem e desempata por texto. Isso
 * mantem a funcao total e deixa o pior caso sendo uma ordenacao estranha em
 * vez de uma tela que nao responde.
 */
export function compareIds(a: string, b: string): number {
  const x = paraNumero(a);
  const y = paraNumero(b);

  if (x === null || y === null) {
    if (x === null && y === null) return a < b ? -1 : a > b ? 1 : 0;
    // Quem nao e snowflake fica depois de quem e.
    return x === null ? 1 : -1;
  }

  return x < y ? -1 : x > y ? 1 : 0;
}

function paraNumero(id: string): bigint | null {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

/** Snowflake sintetico para um instante, util em paginacao por data. */
export function idFromTimestamp(date: Date | number): string {
  const ms = BigInt(typeof date === 'number' ? date : date.getTime());
  return ((ms - ORDER_EPOCH) << TIMESTAMP_SHIFT).toString();
}

const SNOWFLAKE_RE = /^\d{1,20}$/;

export function isSnowflake(value: unknown): value is string {
  if (typeof value !== 'string' || !SNOWFLAKE_RE.test(value)) return false;
  try {
    const n = BigInt(value);
    return n >= 0n && n < 1n << 63n;
  } catch {
    return false;
  }
}

import type { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Barramento de eventos entre processos do gateway.
 *
 * Com um unico processo, que e o caso de uma instalacao para um grupo de
 * amigos, o barramento em memoria basta e e mais confiavel: nao ha rede no
 * meio, nao ha dependencia para subir. Se um dia houver mais de uma instancia,
 * defina REDIS_URL e o mesmo codigo passa a publicar via Redis pub/sub sem
 * nenhuma outra mudanca.
 */

export type BusHandler = (channel: string, payload: unknown) => void;

export interface Bus {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(pattern: string, handler: BusHandler): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'memory' | 'redis';
}

function patternToRegExp(pattern: string): RegExp {
  // Mesma semantica do psubscribe do Redis: * casa com qualquer coisa.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

class MemoryBus implements Bus {
  readonly kind = 'memory' as const;
  private readonly handlers: { pattern: RegExp; handler: BusHandler }[] = [];

  async publish(channel: string, payload: unknown): Promise<void> {
    for (const { pattern, handler } of this.handlers) {
      if (!pattern.test(channel)) continue;
      try {
        handler(channel, payload);
      } catch (error) {
        logger.error({ error, channel }, 'handler do barramento lancou');
      }
    }
  }

  async subscribe(pattern: string, handler: BusHandler): Promise<void> {
    this.handlers.push({ pattern: patternToRegExp(pattern), handler });
  }

  async close(): Promise<void> {
    this.handlers.length = 0;
  }
}

class RedisBus implements Bus {
  readonly kind = 'redis' as const;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe(pattern: string, handler: BusHandler): Promise<void> {
    await this.sub.psubscribe(pattern);
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        handler(channel, JSON.parse(message));
      } catch (error) {
        logger.error({ error, channel }, 'payload invalido no barramento');
      }
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

let instance: Bus | null = null;

export async function createBus(): Promise<Bus> {
  if (instance) return instance;

  if (!config.redisUrl) {
    logger.info('barramento em memoria (defina REDIS_URL para multiplos processos)');
    instance = new MemoryBus();
    return instance;
  }

  const { Redis: IORedis } = await import('ioredis');
  const pub = new IORedis(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
  const sub = new IORedis(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });

  pub.on('error', (error: Error) => logger.error({ error }, 'erro no redis (publisher)'));
  sub.on('error', (error: Error) => logger.error({ error }, 'erro no redis (subscriber)'));

  await Promise.all([pub.connect(), sub.connect()]);
  logger.info('barramento via redis');

  instance = new RedisBus(pub, sub);
  return instance;
}

export function getBus(): Bus {
  if (!instance) throw new Error('barramento nao inicializado; chame createBus primeiro');
  return instance;
}

export async function closeBus(): Promise<void> {
  await instance?.close();
  instance = null;
}

/** Nomes de canal do barramento, em um lugar so para evitar erro de digitacao. */
export const BusChannel = {
  /** Evento destinado a todas as sessoes de um usuario. */
  user: (userId: string) => `order:user:${userId}`,
  /** Evento destinado a todos os membros de um servidor. */
  guild: (guildId: string) => `order:guild:${guildId}`,
  /** Evento destinado a quem esta em um canal (DMs e voz). */
  channel: (channelId: string) => `order:channel:${channelId}`,
  /** Mudancas de presenca. */
  presence: () => 'order:presence',
  allUsers: 'order:user:*',
  allGuilds: 'order:guild:*',
  allChannels: 'order:channel:*',
} as const;

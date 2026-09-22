import { ApiError } from '../errors.js';

/**
 * Limitador por janela deslizante, em memoria.
 *
 * Para 10 usuarios em um processo, uma estrutura em memoria e suficiente e nao
 * adiciona dependencia. Se um dia houver mais de uma instancia, este modulo e o
 * ponto a trocar por uma implementacao com Redis.
 */

interface Entry {
  /** Momentos das requisicoes dentro da janela. */
  hits: number[];
}

const buckets = new Map<string, Entry>();

export interface RateLimitRule {
  points: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milissegundos ate liberar, quando bloqueado. */
  retryAfterMs: number;
}

export function check(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const cutoff = now - rule.windowMs;

  let entry = buckets.get(key);
  if (!entry) {
    entry = { hits: [] };
    buckets.set(key, entry);
  }

  // Descarta o que saiu da janela.
  while (entry.hits.length > 0 && entry.hits[0]! <= cutoff) entry.hits.shift();

  if (entry.hits.length >= rule.points) {
    const oldest = entry.hits[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + rule.windowMs - now),
    };
  }

  entry.hits.push(now);
  return {
    allowed: true,
    remaining: rule.points - entry.hits.length,
    retryAfterMs: 0,
  };
}

/** Consome um ponto e lanca 429 se estourar. */
export function consume(key: string, rule: RateLimitRule): void {
  const result = check(key, rule);
  if (result.allowed) return;
  throw new ApiError(
    'RATE_LIMITED',
    'Devagar. Tente de novo em instantes.',
    { retryAfterMs: result.retryAfterMs },
  );
}

/** Devolve um ponto, quando a acao acabou nao acontecendo. */
export function refund(key: string): void {
  const entry = buckets.get(key);
  entry?.hits.pop();
}

export function reset(key: string): void {
  buckets.delete(key);
}

/** Limpeza periodica das chaves que ficaram sem uso. */
export function startJanitor(intervalMs = 300_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      // Uma hora sem nenhum hit e sinal de que a chave morreu.
      const last = entry.hits[entry.hits.length - 1] ?? 0;
      if (now - last > 3_600_000) buckets.delete(key);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export function clearAll(): void {
  buckets.clear();
}

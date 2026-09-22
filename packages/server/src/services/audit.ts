import { generateId } from '@kiroshi/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

/**
 * Registro de acoes administrativas.
 *
 * Nunca lanca: um audit log que quebra a acao que estava registrando e pior
 * que um audit log com um buraco. Falha vira aviso e a operacao segue.
 */
export async function recordAudit(
  guildId: string,
  actorId: string,
  action: string,
  targetId: string | null,
  changes: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  try {
    // Remove chaves undefined, que viram null inutil no JSON.
    const cleaned = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== undefined),
    );

    await prisma.auditLogEntry.create({
      data: {
        id: generateId(),
        guildId,
        actorId,
        action,
        targetId,
        changes: cleaned as object,
        reason: reason?.slice(0, 512) ?? null,
      },
    });
  } catch (error) {
    logger.warn({ error, guildId, action }, 'nao consegui gravar no audit log');
  }
}

/** Apaga entradas antigas; o historico completo nao serve para nada aqui. */
export async function pruneAuditLog(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600_000);
  const { count } = await prisma.auditLogEntry.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

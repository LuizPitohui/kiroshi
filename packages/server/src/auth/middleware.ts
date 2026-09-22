import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { ApiError, unauthorized } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido por requireAuth. Ausente em rotas publicas. */
    auth?: { userId: string; sessionId: string };
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

/**
 * Valida o access token. Nao consulta o banco no caminho feliz: o JWT ja
 * carrega userId e sessionId, e a expiracao curta limita a janela em que uma
 * sessao revogada continua valendo.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) throw unauthorized();

  const claims = await verifyAccessToken(token);
  request.auth = { userId: claims.sub, sessionId: claims.sid };
}

/**
 * Como requireAuth, mas confirma no banco que a sessao ainda existe e que a
 * conta nao foi desativada. Use em operacoes sensiveis: trocar senha, mexer
 * no 2FA, apagar servidor.
 */
export async function requireFreshAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  const auth = request.auth;
  if (!auth) throw unauthorized();

  const session = await prisma.session.findUnique({
    where: { id: auth.sessionId },
    select: { expiresAt: true, user: { select: { disabledAt: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    throw unauthorized('Sessao encerrada. Entre de novo.');
  }
  if (session.user.disabledAt) {
    throw new ApiError('FORBIDDEN', 'Esta conta esta desativada.');
  }
}

/** Autentica quando ha token, mas segue adiante quando nao ha. */
export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  if (!token) return;
  try {
    const claims = await verifyAccessToken(token);
    request.auth = { userId: claims.sub, sessionId: claims.sid };
  } catch {
    // Token invalido em rota opcional e tratado como visitante.
  }
}

/** Atalho para ler o usuario autenticado dentro do handler. */
export function currentUserId(request: FastifyRequest): string {
  if (!request.auth) throw unauthorized();
  return request.auth.userId;
}

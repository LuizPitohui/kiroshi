import { TOKEN_TTL, generateId } from '@kiroshi/shared';
import { prisma } from '../db.js';
import { generateToken } from './password.js';
import { hashRefreshToken, signAccessToken } from './tokens.js';

/**
 * Abrir uma sessao: a linha no banco e o par de tokens.
 *
 * Morava dentro de `routes/auth.ts`, onde so o login alcancava. Saiu de la
 * quando o login com Google passou a precisar da mesma coisa — e uma rota
 * importar de outra rota seria pior do que as duas importarem daqui.
 */

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function createSession(
  userId: string,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<SessionResult> {
  const sessionId = generateId();
  const refreshToken = generateToken(32);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: userAgent?.slice(0, 300),
      ipAddress: ip?.slice(0, 64),
      expiresAt: new Date(Date.now() + TOKEN_TTL.refreshSecs * 1000),
    },
  });

  return {
    accessToken: await signAccessToken(userId, sessionId),
    refreshToken,
    expiresIn: TOKEN_TTL.accessSecs,
  };
}

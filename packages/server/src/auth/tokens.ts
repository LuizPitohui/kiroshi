import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { TOKEN_TTL } from '@kiroshi/shared';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

/**
 * Dois tokens:
 *
 *  - accessToken: JWT curto (15 min), enviado em toda requisicao e no IDENTIFY
 *    do gateway. Nao consulta o banco para validar.
 *  - refreshToken: opaco e longo (60 dias), guardado com hash no banco em uma
 *    linha de Session. Revogar uma sessao e apagar essa linha.
 *
 * O access carrega o sessionId para que revogar a sessao tambem derrube o
 * gateway daquele dispositivo na proxima renovacao.
 */

const ISSUER = 'kiroshi';
const AUDIENCE = 'kiroshi-client';

/**
 * O produto se chamava Order, e os tokens emitidos com o nome antigo ainda
 * estao no bolso de quem esta logado. Aceitar os dois na verificacao evita
 * desconectar todo mundo por causa de uma troca de marca; a emissao ja usa so
 * o nome novo, entao os antigos somem sozinhos quando expirarem.
 *
 * Pode sair depois de 2026-11-18, quando o refresh token mais longo emitido
 * sob o nome antigo (60 dias) ja tera vencido.
 */
const ISSUERS_ACEITOS = [ISSUER, 'order'];
const AUDIENCES_ACEITAS = [AUDIENCE, 'order-client'];

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  sid: string;
  /** Marca tokens de bot, que nao tem sessao de usuario. */
  bot?: boolean;
}

export interface MfaChallengeClaims extends JWTPayload {
  sub: string;
  purpose: 'mfa';
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL.accessSecs}s`)
    .sign(config.jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: ISSUERS_ACEITOS,
      audience: AUDIENCES_ACEITAS,
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new ApiError('UNAUTHORIZED', 'Token malformado.');
    }
    return payload as AccessTokenClaims;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UNAUTHORIZED', 'Sessao expirada. Entre de novo.');
  }
}

/**
 * Token intermediario emitido quando a senha esta certa mas falta o 2FA.
 * Vive 5 minutos e so serve para concluir o login.
 */
export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({ purpose: 'mfa' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL.mfaChallengeSecs}s`)
    .sign(config.jwtSecret);
}

export async function verifyMfaChallenge(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: ISSUERS_ACEITOS,
      audience: AUDIENCES_ACEITAS,
    });
    if (payload.purpose !== 'mfa' || typeof payload.sub !== 'string') {
      throw new ApiError('UNAUTHORIZED', 'Token de verificacao invalido.');
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UNAUTHORIZED', 'Verificacao expirada. Faca login de novo.');
  }
}

/**
 * O refresh token e guardado com SHA-256 em vez de argon2: ele ja tem 256 bits
 * de entropia, entao nao ha o que quebrar por forca bruta, e o hash rapido
 * permite procurar a sessao por indice.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

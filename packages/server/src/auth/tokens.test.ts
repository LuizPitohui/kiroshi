/**
 * O que estes testes protegem: a troca de nome do produto nao pode deslogar
 * ninguem.
 *
 * Os tokens passaram a ser emitidos como "kiroshi", mas quem ja estava logado
 * carrega tokens assinados como "order". Se a verificacao recusar os antigos,
 * todas as sessoes caem de uma vez no deploy — o tipo de estrago que so
 * aparece em producao, com gente reclamando.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { signAccessToken, verifyAccessToken, signMfaChallenge, verifyMfaChallenge } = await import(
  './tokens.js'
);
const { config } = await import('../config.js');

const USUARIO = '359514397032390656';
const SESSAO = '359514397288243200';

/** Reproduz um token como o servidor assinava antes da troca de nome. */
async function tokenAntigo(extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ sid: SESSAO, ...extra })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(USUARIO)
    .setIssuer('order')
    .setAudience('order-client')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(config.jwtSecret);
}

describe('tokens de acesso', () => {
  it('aceita um token emitido com o nome novo', async () => {
    const token = await signAccessToken(USUARIO, SESSAO);
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe(USUARIO);
    expect(claims.sid).toBe(SESSAO);
  });

  it('ainda aceita um token emitido com o nome antigo', async () => {
    const claims = await verifyAccessToken(await tokenAntigo());
    expect(claims.sub).toBe(USUARIO);
    expect(claims.sid).toBe(SESSAO);
  });

  it('emite so com o nome novo', async () => {
    const token = await signAccessToken(USUARIO, SESSAO);
    const corpo = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(corpo.iss).toBe('kiroshi');
    expect(corpo.aud).toBe('kiroshi-client');
  });

  it('recusa um token assinado com outro segredo', async () => {
    const outro = new TextEncoder().encode('um-segredo-completamente-diferente-aqui');
    const token = await new SignJWT({ sid: SESSAO })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(USUARIO)
      .setIssuer('kiroshi')
      .setAudience('kiroshi-client')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(outro);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it('recusa um emissor que nunca foi nosso', async () => {
    const token = await new SignJWT({ sid: SESSAO })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(USUARIO)
      .setIssuer('outro-servico')
      .setAudience('kiroshi-client')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(config.jwtSecret);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it('recusa um token vencido', async () => {
    const token = await new SignJWT({ sid: SESSAO })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(USUARIO)
      .setIssuer('kiroshi')
      .setAudience('kiroshi-client')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(config.jwtSecret);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it('recusa um token sem sessao', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(USUARIO)
      .setIssuer('kiroshi')
      .setAudience('kiroshi-client')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(config.jwtSecret);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});

describe('desafio de 2FA', () => {
  it('vai e volta', async () => {
    const token = await signMfaChallenge(USUARIO);
    expect(await verifyMfaChallenge(token)).toBe(USUARIO);
  });

  it('um token de acesso nao serve como desafio de 2FA', async () => {
    // Sem esta checagem, quem tivesse um access token poderia pular o segundo
    // fator apresentando-o na etapa de verificacao.
    const token = await signAccessToken(USUARIO, SESSAO);
    await expect(verifyMfaChallenge(token)).rejects.toThrow();
  });

  it('um desafio de 2FA nao serve como token de acesso', async () => {
    const token = await signMfaChallenge(USUARIO);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});

import type { FastifyInstance } from 'fastify';
import {
  RATE_LIMITS,
  TOKEN_TTL,
  changePasswordSchema,
  disableTotpSchema,
  enableTotpSchema,
  generateId,
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@kiroshi/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, badRequest, unauthorized } from '../errors.js';
import { logger } from '../logger.js';
import {
  fakeVerify,
  generateToken,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../auth/password.js';
import {
  hashRefreshToken,
  signAccessToken,
  signMfaChallenge,
  verifyMfaChallenge,
} from '../auth/tokens.js';
import {
  buildOtpAuthUrl,
  buildQrCodeDataUrl,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyTotp,
} from '../auth/totp.js';
import { requireAuth, requireFreshAuth } from '../auth/middleware.js';
import { createSession } from '../auth/sessao.js';
import { consume } from '../lib/ratelimit.js';
import { SELF_USER_SELECT, toSelfUser } from '../lib/serialize.js';

/**
 * Confirma a identidade com a senha atual — quando existe uma.
 *
 * Conta criada pelo Google pode nao ter senha nenhuma. Nesses casos a
 * confirmacao ja veio da sessao, conferida por `requireFreshAuth`, e exigir
 * uma senha que nao existe trancaria a pessoa para fora do 2FA e de definir a
 * primeira senha.
 *
 * Quem TEM senha continua obrigado a informa-la. A regra mora aqui, num lugar
 * so, e nao espalhada pelas quatro rotas que conferem senha: o schema deixou
 * o campo opcional, e sem esta funcao "opcional no schema" viraria
 * "dispensavel de verdade".
 */
async function confirmarComSenha(
  passwordHash: string | null,
  informada: string | undefined,
  mensagem = 'Senha incorreta.',
): Promise<void> {
  if (!passwordHash) return;
  if (!informada) throw new ApiError('INVALID_CREDENTIALS', mensagem);
  if (!(await verifyPassword(passwordHash, informada))) {
    throw new ApiError('INVALID_CREDENTIALS', mensagem);
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.post('/auth/register', async (request, reply) => {
    consume(`register:${request.ip}`, RATE_LIMITS.register);

    const body = registerSchema.parse(request.body);

    // Cadastro fechado exige um convite valido, que tambem ja coloca a pessoa
    // no servidor correspondente.
    let inviteGuildId: string | null = null;
    if (!config.allowOpenRegistration) {
      if (!body.inviteCode) {
        throw new ApiError(
          'REGISTRATION_CLOSED',
          'Este servidor exige um codigo de convite para criar conta.',
        );
      }
      const invite = await prisma.invite.findUnique({ where: { code: body.inviteCode } });
      if (
        !invite ||
        (invite.expiresAt && invite.expiresAt < new Date()) ||
        (invite.maxUses > 0 && invite.uses >= invite.maxUses)
      ) {
        throw new ApiError('INVITE_INVALID', 'Convite invalido ou expirado.');
      }
      inviteGuildId = invite.guildId;
    }

    const [emailTaken, usernameTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }),
      prisma.user.findUnique({ where: { username: body.username }, select: { id: true } }),
    ]);
    if (emailTaken) throw new ApiError('EMAIL_TAKEN', 'Este email ja esta em uso.');
    if (usernameTaken) throw new ApiError('USERNAME_TAKEN', 'Este nome de usuario ja existe.');

    const user = await prisma.user.create({
      data: {
        id: generateId(),
        email: body.email,
        username: body.username,
        displayName: body.displayName ?? body.username,
        passwordHash: await hashPassword(body.password),
      },
      select: SELF_USER_SELECT,
    });

    logger.info({ userId: user.id, username: user.username }, 'conta criada');

    const session = await createSession(user.id, request.headers['user-agent'], request.ip);

    // O convite so e consumido depois da conta existir, para nao gastar um uso
    // se algo falhar no meio.
    if (inviteGuildId && body.inviteCode) {
      const { acceptInvite } = await import('../services/invites.js');
      await acceptInvite(body.inviteCode, user.id).catch((error: unknown) => {
        logger.warn({ error, userId: user.id }, 'falha ao entrar no servidor do convite');
      });
    }

    return reply.status(201).send({ user: toSelfUser(user), ...session });
  });

  // -------------------------------------------------------------------------
  app.post('/auth/login', async (request) => {
    consume(`login:${request.ip}`, RATE_LIMITS.login);

    const body = loginSchema.parse(request.body);
    const login = body.login.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
      select: {
        id: true,
        passwordHash: true,
        disabledAt: true,
        totpEnabled: true,
        totpSecret: true,
        backupCodes: true,
      },
    });

    if (!user) {
      // Gasta o mesmo tempo do caminho real para nao revelar quem existe.
      await fakeVerify();
      throw new ApiError('INVALID_CREDENTIALS', 'Email, usuario ou senha incorretos.');
    }

    const passwordOk = await verifyPassword(user.passwordHash, body.password);
    if (!passwordOk) {
      throw new ApiError('INVALID_CREDENTIALS', 'Email, usuario ou senha incorretos.');
    }
    if (user.disabledAt) {
      throw new ApiError('FORBIDDEN', 'Esta conta esta desativada.');
    }

    if (user.totpEnabled) {
      const hasCode = Boolean(body.totpCode || body.backupCode);
      if (!hasCode) {
        // Senha certa, falta o segundo fator: devolve um token curto que so
        // serve para completar a verificacao.
        throw new ApiError('MFA_REQUIRED', 'Informe o codigo do seu app autenticador.', {
          mfaToken: await signMfaChallenge(user.id),
        });
      }

      const verified = await verifySecondFactor(user, body.totpCode, body.backupCode);
      if (!verified) throw new ApiError('INVALID_MFA_CODE', 'Codigo invalido ou ja usado.');
    }

    // Aproveita o login para atualizar o hash quando os parametros mudarem.
    if (needsRehash(user.passwordHash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.password) },
      });
    }

    const session = await createSession(user.id, request.headers['user-agent'], request.ip);
    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: SELF_USER_SELECT,
    });

    logger.info({ userId: user.id }, 'login');
    return { user: toSelfUser(full), ...session };
  });

  // -------------------------------------------------------------------------
  /** Conclui o login quando o 2FA foi pedido separadamente. */
  app.post('/auth/login/mfa', async (request) => {
    consume(`mfa:${request.ip}`, RATE_LIMITS.login);

    const body = request.body as { mfaToken?: string; totpCode?: string; backupCode?: string };
    if (!body.mfaToken) throw badRequest('mfaToken e obrigatorio.');

    const userId = await verifyMfaChallenge(body.mfaToken);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, totpSecret: true, backupCodes: true, disabledAt: true },
    });
    if (!user || user.disabledAt) throw unauthorized();

    const verified = await verifySecondFactor(user, body.totpCode, body.backupCode);
    if (!verified) throw new ApiError('INVALID_MFA_CODE', 'Codigo invalido ou ja usado.');

    const session = await createSession(user.id, request.headers['user-agent'], request.ip);
    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: SELF_USER_SELECT,
    });

    return { user: toSelfUser(full), ...session };
  });

  // -------------------------------------------------------------------------
  app.post('/auth/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    const hash = hashRefreshToken(body.refreshToken);

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: { select: { disabledAt: true } },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      throw unauthorized('Sessao expirada. Entre de novo.');
    }
    if (session.user.disabledAt) {
      throw new ApiError('FORBIDDEN', 'Esta conta esta desativada.');
    }

    // Rotaciona o refresh token: se alguem capturou o antigo, ele morre aqui.
    const nextRefresh = generateToken(32);
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(nextRefresh),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + TOKEN_TTL.refreshSecs * 1000),
      },
    });

    return {
      accessToken: await signAccessToken(session.userId, session.id),
      refreshToken: nextRefresh,
      expiresIn: TOKEN_TTL.accessSecs,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/auth/logout', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!;
    await prisma.session.delete({ where: { id: auth.sessionId } }).catch(() => undefined);
    return { ok: true };
  });

  /** Encerra todas as sessoes, util quando a senha vazou. */
  app.post('/auth/logout/all', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const { count } = await prisma.session.deleteMany({ where: { userId: auth.userId } });
    return { ok: true, closed: count };
  });

  app.get('/auth/sessions', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!;
    const rows = await prisma.session.findMany({
      where: { userId: auth.userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((r) => ({
      ...r,
      current: r.id === auth.sessionId,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
    }));
  });

  app.delete('/auth/sessions/:id', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const { id } = request.params as { id: string };
    await prisma.session.deleteMany({ where: { id, userId: auth.userId } });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  app.post('/auth/password', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const body = changePasswordSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { passwordHash: true },
    });
    await confirmarComSenha(user.passwordHash, body.currentPassword, 'Senha atual incorreta.');

    await prisma.user.update({
      where: { id: auth.userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    // Trocar a senha derruba os outros dispositivos, mas nao o atual.
    await prisma.session.deleteMany({
      where: { userId: auth.userId, id: { not: auth.sessionId } },
    });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // 2FA
  // -------------------------------------------------------------------------

  /** Passo 1: gera o segredo e o QR. So vale depois de confirmar com um codigo. */
  app.post('/auth/totp/setup', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { username: true, totpEnabled: true },
    });
    if (user.totpEnabled) throw badRequest('O 2FA ja esta ativo nesta conta.');

    const secret = generateTotpSecret();
    // Guardamos o segredo sem ativar; so vira 2FA de verdade no /enable.
    await prisma.user.update({ where: { id: auth.userId }, data: { totpSecret: secret } });

    const otpAuthUrl = buildOtpAuthUrl(secret, user.username);
    return {
      secret,
      otpAuthUrl,
      qrCode: await buildQrCodeDataUrl(otpAuthUrl),
    };
  });

  /** Passo 2: confirma o codigo, ativa e entrega os codigos de recuperacao. */
  app.post('/auth/totp/enable', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const body = enableTotpSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { passwordHash: true, totpSecret: true, totpEnabled: true },
    });
    if (user.totpEnabled) throw badRequest('O 2FA ja esta ativo nesta conta.');
    if (!user.totpSecret) throw badRequest('Comece pelo /auth/totp/setup.');
    await confirmarComSenha(user.passwordHash, body.password);
    if (!verifyTotp(user.totpSecret, body.code)) {
      throw new ApiError('INVALID_MFA_CODE', 'Codigo incorreto. Confira o relogio do aparelho.');
    }

    const backupCodes = generateBackupCodes();
    await prisma.user.update({
      where: { id: auth.userId },
      data: { totpEnabled: true, backupCodes: await hashBackupCodes(backupCodes) },
    });

    logger.info({ userId: auth.userId }, '2FA ativado');
    // Os codigos aparecem uma unica vez; depois so restam os hashes.
    return { ok: true, backupCodes };
  });

  app.post('/auth/totp/disable', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const body = disableTotpSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { passwordHash: true, totpSecret: true, totpEnabled: true },
    });
    if (!user.totpEnabled || !user.totpSecret) throw badRequest('O 2FA nao esta ativo.');
    await confirmarComSenha(user.passwordHash, body.password);
    if (!verifyTotp(user.totpSecret, body.code)) {
      throw new ApiError('INVALID_MFA_CODE', 'Codigo incorreto.');
    }

    await prisma.user.update({
      where: { id: auth.userId },
      data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
    });

    logger.info({ userId: auth.userId }, '2FA desativado');
    return { ok: true };
  });

  /** Gera codigos novos, invalidando os antigos. */
  app.post('/auth/totp/backup-codes', { preHandler: requireFreshAuth }, async (request) => {
    const auth = request.auth!;
    const body = enableTotpSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { passwordHash: true, totpSecret: true, totpEnabled: true },
    });
    if (!user.totpEnabled || !user.totpSecret) throw badRequest('O 2FA nao esta ativo.');
    await confirmarComSenha(user.passwordHash, body.password);
    if (!verifyTotp(user.totpSecret, body.code)) {
      throw new ApiError('INVALID_MFA_CODE', 'Codigo incorreto.');
    }

    const backupCodes = generateBackupCodes();
    await prisma.user.update({
      where: { id: auth.userId },
      data: { backupCodes: await hashBackupCodes(backupCodes) },
    });
    return { backupCodes };
  });
}

/** Confere TOTP ou codigo de recuperacao, consumindo o codigo quando usado. */
async function verifySecondFactor(
  user: { id: string; totpSecret: string | null; backupCodes: string[] },
  totpCode?: string,
  backupCode?: string,
): Promise<boolean> {
  if (totpCode && user.totpSecret && verifyTotp(user.totpSecret, totpCode)) {
    return true;
  }

  if (backupCode) {
    const { valid, remaining } = await consumeBackupCode(user.backupCodes, backupCode);
    if (valid) {
      await prisma.user.update({
        where: { id: user.id },
        data: { backupCodes: remaining },
      });
      logger.warn(
        { userId: user.id, remaining: remaining.length },
        'login com codigo de recuperacao',
      );
      return true;
    }
  }

  return false;
}

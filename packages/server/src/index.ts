import type { Server as HttpServer } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { LIMITS, RATE_LIMITS } from '@kiroshi/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectDatabase, disconnectDatabase, prisma } from './db.js';
import { closeBus, createBus } from './bus.js';
import { ApiError } from './errors.js';
import { attachGateway } from './gateway/server.js';
import { subscribeToBus } from './gateway/events.js';
import { ipDaRequisicao } from './lib/ip-do-cliente.js';
import { consume, startJanitor } from './lib/ratelimit.js';
import { authRoutes } from './routes/auth.js';
import { authGoogleRoutes } from './routes/auth-google.js';
import { paginasRoutes } from './routes/paginas.js';
import { channelRoutes } from './routes/channels.js';
import { expressionRoutes } from './routes/expressions.js';
import { guildRoutes } from './routes/guilds.js';
import { inviteRoutes } from './routes/invites.js';
import { messageRoutes } from './routes/messages.js';
import { relationshipRoutes } from './routes/relationships.js';
import { uploadRoutes } from './routes/uploads.js';
import { downloadRoutes } from './routes/download.js';
import { userRoutes } from './routes/users.js';
import { voiceRoutes } from './routes/voice.js';
import { pruneAuditLog } from './services/audit.js';
import { pruneExpiredInvites } from './services/invites.js';
import { ensureStorageDir, pruneOrphanAttachments } from './services/storage.js';
import { clearStaleVoiceStates, iniciarConferenciaDaVoz, isVoiceEnabled } from './services/voice.js';

async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    /*
      Confia no X-Forwarded-For so quando quem conecta e local: o cloudflared,
      pelo loopback do host ou pelo gateway da rede do Docker.

      Era `true`, que confia em qualquer um e faz o `request.ip` sair do
      primeiro valor do cabecalho — o valor que o proprio cliente escreve. O
      limite por IP usa `ipDaRequisicao`, que prefere o CF-Connecting-IP; isto
      so deixa o `request.ip` de reserva certo tambem.
    */
    trustProxy: ['loopback', 'linklocal', 'uniquelocal'],
    bodyLimit: 12 * 1024 * 1024,
    // Em producao o log de cada requisicao so gera ruido; erros continuam saindo.
    // O Fastify 5 avisa que esta opcao sai na versao 6; a alternativa
    // (logController) exige implementar o controlador inteiro, o que nao se
    // justifica so para desligar uma linha de log.
    disableRequestLogging: config.isProduction,
  });

  await app.register(cors, {
    // O app desktop nao manda Origin; a lista serve para um cliente web futuro.
    origin: config.corsOrigins ?? true,
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: LIMITS.attachmentBytes, files: 1, fields: 10 },
  });

  /**
   * Um DELETE ou POST sem payload costuma chegar com content-type json e corpo
   * vazio, porque a maioria dos clientes HTTP define o cabecalho sempre. O
   * parser padrao do Fastify trata isso como erro; aqui vira um objeto vazio,
   * que e o que as rotas esperam.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (!body || body.trim().length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        done(new ApiError('BAD_REQUEST', 'O corpo da requisicao nao e um JSON valido.'), undefined);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tratamento de erro centralizado
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send(error.toJSON());
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Alguns campos estao invalidos.',
          details: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      });
    }

    // Erros do Fastify com status proprio (payload grande, JSON malformado).
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      const message = error instanceof Error ? error.message : 'Requisicao invalida.';
      return reply.status(status).send({
        error: { code: 'BAD_REQUEST', message },
      });
    }

    // Violacao de unicidade do Prisma vira conflito, nao 500.
    if ((error as { code?: string }).code === 'P2002') {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'Este registro ja existe.' },
      });
    }
    if ((error as { code?: string }).code === 'P2025') {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Registro nao encontrado.' },
      });
    }

    request.log.error({ err: error, url: request.url }, 'erro nao tratado');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Algo deu errado do nosso lado.' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Rota ${request.method} ${request.url} nao existe.` },
    });
  });

  // Limite global por IP, antes de qualquer rota.
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/attachments/')) return;
    if (request.url === '/health') return;
    consume(`global:${ipDaRequisicao(request)}`, RATE_LIMITS.global);
  });

  // ---------------------------------------------------------------------------
  app.get('/health', async () => {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      version: 1,
      voice: isVoiceEnabled(),
      dbLatencyMs: Date.now() - start,
      uptimeSecs: Math.floor(process.uptime()),
    };
  });

  /** Informa ao cliente o que este servidor suporta, antes do login. */
  app.get('/api/info', async () => ({
    name: 'Kiroshi',
    gatewayVersion: 1,
    voiceEnabled: isVoiceEnabled(),
    openRegistration: config.allowOpenRegistration,
    limits: {
      attachmentBytes: LIMITS.attachmentBytes,
      messageContent: LIMITS.messageContent.max,
    },
  }));

  // Paginas publicas: ficam na raiz, fora do prefixo da API.
  await app.register(paginasRoutes);

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(authGoogleRoutes);
      await api.register(userRoutes);
      await api.register(guildRoutes);
      await api.register(channelRoutes);
      await api.register(messageRoutes);
      await api.register(relationshipRoutes);
      await api.register(inviteRoutes);
      await api.register(voiceRoutes);
      await api.register(expressionRoutes);
    },
    { prefix: '/api/v1' },
  );

  // Uploads ficam fora do prefixo: as URLs de anexo entram em <img src> e
  // ficam gravadas nas mensagens, entao devem ser curtas e estaveis.
  await app.register(uploadRoutes);

  // Tambem fora do prefixo: este endereco e digitado e mandado por mensagem,
  // entao quanto mais curto melhor.
  await app.register(downloadRoutes);

  return app;
}

async function main(): Promise<void> {
  await connectDatabase();
  await createBus();
  await subscribeToBus();
  await ensureStorageDir();

  // Depois de uma queda, o banco pode ter estados de voz de quem ja nao esta
  // conectado. Nenhuma sessao sobrevive ao restart, entao limpamos todos.
  await clearStaleVoiceStates();

  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });

  // app.server e tipado como a uniao de http/http2; nao configuramos http2,
  // entao aqui e sempre um Server de http.
  attachGateway(app.server as HttpServer);
  startJanitor();

  // Quem consta na chamada sem estar na sala do SFU sai sozinho (services/voice.ts).
  const pararConferenciaDaVoz = iniciarConferenciaDaVoz();

  // Faxina periodica. unref para nao segurar o processo no shutdown.
  const maintenance = setInterval(
    () => {
      void pruneOrphanAttachments().catch(() => undefined);
      void pruneExpiredInvites().catch(() => undefined);
      void pruneAuditLog().catch(() => undefined);
    },
    6 * 3600_000,
  );
  maintenance.unref();

  logger.info(
    {
      port: config.port,
      env: config.env,
      voice: isVoiceEnabled() ? 'ativa' : 'desligada',
      registration: config.allowOpenRegistration ? 'aberta' : 'por convite',
    },
    'Kiroshi no ar',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'encerrando');

    clearInterval(maintenance);
    pararConferenciaDaVoz();
    // Fecha o HTTP primeiro para parar de aceitar pedidos novos, depois solta
    // banco e barramento.
    await app.close().catch(() => undefined);
    await closeBus().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'promise rejeitada sem tratamento');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'excecao nao capturada');
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ error }, 'falha ao subir o servidor');
  process.exit(1);
});

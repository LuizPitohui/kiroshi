import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  // Os dois lados do ternario anterior eram iguais, o que sugeria uma diferenca
  // entre producao e desenvolvimento que nunca existiu.
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error({ target: e.target }, e.message));
prisma.$on('warn', (e) => logger.warn({ target: e.target }, e.message));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  // Uma consulta de verdade prova que o banco responde, nao so que o socket abriu.
  await prisma.$queryRaw`SELECT 1`;
  logger.info('banco conectado');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export type Prisma = typeof prisma;

/** Transacao com o mesmo tipo do client, para passar adiante nos servicos. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

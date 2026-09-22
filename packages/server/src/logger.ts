import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  // Em producao o log vai para stdout em JSON, que o docker/journald coleta.
  transport: config.isProduction
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 },
      },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'refreshToken',
      'totpSecret',
      'backupCodes',
      '*.password',
      '*.token',
    ],
    censor: '[oculto]',
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

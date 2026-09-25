import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Configuracao lida do ambiente uma unica vez, na subida. Se algo obrigatorio
 * faltar, o processo morre aqui com uma mensagem clara, em vez de falhar
 * meia hora depois no meio de um pedido.
 */

/**
 * Le o .env do diretorio do pacote. Em producao as variaveis vem do docker
 * compose e nao existe arquivo; nesse caso simplesmente nao ha o que carregar.
 * Variavel ja presente no ambiente sempre ganha do arquivo.
 */
function loadEnvFile(): void {
  const candidates = [
    process.env.KIROSHI_ENV_FILE,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'packages/server/.env'),
  ].filter((p): p is string => Boolean(p));

  const file = candidates.find((p) => existsSync(p));
  if (!file) return;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(separator + 1).trim();
    // Aspas envolvendo o valor sao delimitador, nao conteudo.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v])),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres; gere com: openssl rand -base64 48'),

  REDIS_URL: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  TURN_SERVERS: z.string().optional(),
  /*
    Chave do TURN gerenciado da Cloudflare.

    Fica so no servidor: com ela da para emitir credenciais curtas para cada
    sessao e revogar depois. Mandar a chave ao cliente seria o contrario
    disso — um segredo fixo na mao de todo mundo, sem como revogar.
  */
  CLOUDFLARE_TURN_KEY_ID: z.string().optional(),
  CLOUDFLARE_TURN_API_TOKEN: z.string().optional(),
  FORCE_TURN_RELAY: boolish(false),
  /*
    Chamada em conversa direta: quanto dura o toque e quanto tempo alguem pode
    ficar sozinho antes de o servidor desligar (a regra dos 3 minutos, F5 em
    docs/conhecimento/01-pedidos-e-backlog.md). Mudar so para teste: ninguem
    espera 3 minutos de verdade num teste de ponta a ponta.
  */
  DM_CALL_RING_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  DM_CALL_ALONE_SECONDS: z.coerce.number().int().min(5).max(3600).default(180),

  /*
    Credenciais do login com Google.

    Ausentes, o login com Google simplesmente nao aparece — o servidor sobe
    igual. E opcional de proposito: quem hospeda uma copia do Kiroshi nao
    deveria precisar de conta no Google Cloud para ter um servidor funcionando.

    O segredo fica so aqui. Ele nunca vai para o aplicativo: e o servidor que
    troca o codigo do Google pelo token, justamente para nao embutir segredo
    num .exe que qualquer pessoa abre.
  */
  /*
    Para onde mandar pedido sobre dados pessoais.

    Aparece na pagina publica de privacidade. Opcional: sem ele a pagina diz
    para falar com quem administra pelo proprio aplicativo, que continua
    verdade. Nao tem valor padrao de proposito — endereco de e-mail de alguem
    nao deve ficar cravado no codigo-fonte.
  */
  CONTATO_PRIVACIDADE: z.string().email().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  STORAGE_DIR: z.string().default('./uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),

  ALLOW_OPEN_REGISTRATION: boolish(false),
  CORS_ORIGINS: z.string().optional(),

  /** Identifica o processo na geracao de snowflake quando houver varios. */
  KIROSHI_WORKER_ID: z.coerce.number().int().min(0).max(31).default(0),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`\nConfiguracao invalida:\n${problems}\n`);
    process.exit(1);
  }

  const env = parsed.data;

  let turnServers: { urls: string[]; username?: string; credential?: string }[] = [];
  if (env.TURN_SERVERS) {
    try {
      const raw: unknown = JSON.parse(env.TURN_SERVERS);
      turnServers = z.array(iceServerSchema).parse(raw);
    } catch (error) {
      // Derrubar o boot e proposital: TURN so e configurado por quem esta
      // tentando fazer a voz funcionar para alguem. Subir com ele desligado em
      // silencio faria a pessoa reiniciar, testar, continuar sem voz e nao ter
      // pista do motivo.
      //
      // O erro cru do Zod nao ajuda quem esta editando um .env as pressas, por
      // isso o exemplo vem junto.
      const motivo = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.error(
        [
          '',
          'TURN_SERVERS nao e uma lista valida de servidores ICE.',
          `  motivo: ${motivo}`,
          '',
          '  Formato esperado (tudo em uma linha, aspas incluidas):',
          '  TURN_SERVERS=[{"urls":["turn:turn.exemplo.com:3478?transport=udp"],"username":"chave","credential":"segredo"}]',
          '',
          '  Erros comuns: aspas simples no lugar de duplas, "urls" como texto',
          '  em vez de lista, ou o valor sem aspas no .env quando ha espacos.',
          '',
        ].join('\n'),
      );
      process.exit(1);
    }
  }

  const voiceEnabled = Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    workerId: env.KIROSHI_WORKER_ID,

    databaseUrl: env.DATABASE_URL,
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
    redisUrl: env.REDIS_URL,

    voice: {
      enabled: voiceEnabled,
      url: env.LIVEKIT_URL ?? '',
      apiKey: env.LIVEKIT_API_KEY ?? '',
      apiSecret: env.LIVEKIT_API_SECRET ?? '',
      turnServers,
      turnKeyId: env.CLOUDFLARE_TURN_KEY_ID ?? null,
      turnApiToken: env.CLOUDFLARE_TURN_API_TOKEN ?? null,
      forceRelay: env.FORCE_TURN_RELAY,
      toqueMs: env.DM_CALL_RING_SECONDS * 1000,
      sozinhoMs: env.DM_CALL_ALONE_SECONDS * 1000,
    },

    contatoPrivacidade: env.CONTATO_PRIVACIDADE ?? null,

    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? null,
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? null,
    },

    storageDir: env.STORAGE_DIR,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),

    allowOpenRegistration: env.ALLOW_OPEN_REGISTRATION,
    corsOrigins: env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  } as const;
}

export const config = load();
export type Config = typeof config;

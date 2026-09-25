import type { FastifyInstance } from 'fastify';
import { INVITE_CODE_PATTERN, LIMITS, RATE_LIMITS, generateId, novoUsernameSchema } from '@kiroshi/shared';
import { conviteDoCadastro, entrarPeloCadastro } from '../services/invites.js';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, badRequest } from '../errors.js';
import { logger } from '../logger.js';
import { generateToken, hashPassword } from '../auth/password.js';
import { signMfaChallenge } from '../auth/tokens.js';
import { createSession } from '../auth/sessao.js';
import { requireAuth, requireFreshAuth } from '../auth/middleware.js';
import { encerrarSessoesDeGateway } from '../gateway/server.js';
import { ipDaRequisicao } from '../lib/ip-do-cliente.js';
import { consume } from '../lib/ratelimit.js';
import { SELF_USER_SELECT, toSelfUser } from '../lib/serialize.js';
import {
  assinarProva,
  conferirEstado,
  conferirProva,
  enderecoDeConsentimento,
  googleConfigurado,
  identidadePeloCodigo,
  retornoPermitido,
  type IdentidadeDoGoogle,
  type IntencaoDoGoogle,
} from '../auth/google.js';

/**
 * Login com Google.
 *
 * O caminho inteiro, de ponta a ponta:
 *
 *   1. o aplicativo levanta um ouvinte em 127.0.0.1 numa porta sorteada;
 *   2. pede /auth/google/start e recebe o endereco da tela do Google;
 *   3. abre essa tela no NAVEGADOR DO SISTEMA — o Google recusa webview;
 *   4. a pessoa escolhe a conta, o Google chama /auth/google/callback;
 *   5. o servidor troca o codigo pela identidade e guarda o desfecho;
 *   6. manda o navegador de volta ao loopback com um bilhete de uso unico;
 *   7. o aplicativo troca o bilhete pelo desfecho, por HTTPS.
 *
 * O bilhete existe por causa do passo 6: o que passa pelo navegador acaba no
 * historico. Um bilhete de uso unico que vive dois minutos e inutil depois de
 * usado; uma sessao no endereco valeria sessenta dias.
 *
 * NENHUM passo aqui casa conta por email. O email do Kiroshi nunca foi
 * verificado — quem registrasse com o Gmail de outra pessoa receberia a conta
 * dela de presente no dia em que ela entrasse pelo Google. O vinculo e sempre
 * explicito e feito por quem ja provou ser dono da conta do Kiroshi.
 */

// ---------------------------------------------------------------------------

/** O que o aplicativo descobre ao trocar o bilhete. */
type Desfecho =
  | { tipo: 'sessao'; userId: string }
  | { tipo: 'mfa'; mfaToken: string }
  | { tipo: 'sem-conta'; prova: string; email: string | null; nome: string | null }
  | { tipo: 'vinculado'; email: string | null }
  | { tipo: 'prova-de-senha'; prova: string }
  /** Esqueci a senha: a conta que o Google vinculado abre, para a pessoa conferir. */
  | { tipo: 'prova-de-recuperacao'; prova: string; username: string; displayName: string }
  | { tipo: 'erro'; codigo: string; mensagem: string };

interface Bilhete {
  desfecho: Desfecho;
  expiraEm: number;
}

/**
 * Os bilhetes vivem na memoria do processo.
 *
 * Nao vao para o banco nem para o Redis de proposito: duram dois minutos, sao
 * usados uma vez, e o servidor e um processo so. Reiniciar no meio de um
 * login faz a pessoa clicar de novo — que e melhor do que uma tabela a mais
 * para guardar o que ja nasce vencido.
 */
const BILHETES = new Map<string, Bilhete>();
const VIDA_DO_BILHETE_MS = 2 * 60 * 1000;

function guardarBilhete(desfecho: Desfecho): string {
  limparBilhetesVencidos();
  const id = generateToken(32);
  BILHETES.set(id, { desfecho, expiraEm: Date.now() + VIDA_DO_BILHETE_MS });
  return id;
}

function usarBilhete(id: string): Desfecho | null {
  limparBilhetesVencidos();
  const bilhete = BILHETES.get(id);
  if (!bilhete) return null;
  // Uso unico: sai do mapa na primeira leitura, deu certo ou nao.
  BILHETES.delete(id);
  if (bilhete.expiraEm < Date.now()) return null;
  return bilhete.desfecho;
}

/*
  Varredura por demanda, sem temporizador.

  Um `setInterval` seguraria o processo vivo e apareceria em todo teste que
  reclama de handle aberto. Como todo caminho que toca o mapa passa por aqui,
  e o mapa nunca tem mais que alguns itens, varrer na hora sai de graca.
*/
function limparBilhetesVencidos(): void {
  const agora = Date.now();
  for (const [id, bilhete] of BILHETES) {
    if (bilhete.expiraEm < agora) BILHETES.delete(id);
  }
}

// ---------------------------------------------------------------------------

const inicioSchema = z.object({
  intencao: z.enum(['entrar', 'vincular', 'senha', 'recuperar']),
  retorno: z.string().min(1).max(200),
});

const registroSchema = z.object({
  prova: z.string().min(1),
  // O mesmo formato do cadastro por senha. Antes aceitava hifen, que o resto
  // do sistema recusa: nao dava para mandar amizade a quem entrou assim.
  username: novoUsernameSchema,
  displayName: z.string().trim().min(LIMITS.displayName.min).max(LIMITS.displayName.max).optional(),
  inviteCode: z.string().regex(INVITE_CODE_PATTERN).optional(),
});

// Ate 128, como o login: antes aceitava 200, e a senha nao servia para entrar.
const senhaSchema = z.object({
  prova: z.string().min(1),
  newPassword: z.string().min(LIMITS.password.min).max(LIMITS.password.max),
});

/** Manda o navegador de volta para o aplicativo, com bilhete ou com erro. */
function voltarParaOAplicativo(retorno: string, parametros: Record<string, string>): string {
  const url = new URL(retorno);
  for (const [chave, valor] of Object.entries(parametros)) {
    url.searchParams.set(chave, valor);
  }
  return url.toString();
}

export async function authGoogleRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  /**
   * Diz se este servidor tem login com Google, e se a conta de quem perguntou
   * ja esta vinculada.
   *
   * Sem autenticacao responde so a primeira parte: a tela de login precisa
   * saber se mostra o botao, e quem esta nela ainda nao tem sessao.
   */
  app.get('/auth/google', { preHandler: requireAuth }, async (request) => {
    const vinculo = await prisma.linkedAccount.findUnique({
      where: { userId_provider: { userId: request.auth!.userId, provider: 'GOOGLE' } },
      select: { email: true, linkedAt: true },
    });

    return {
      disponivel: googleConfigurado(),
      vinculado: Boolean(vinculo),
      email: vinculo?.email ?? null,
      vinculadoEm: vinculo?.linkedAt.toISOString() ?? null,
    };
  });

  // -------------------------------------------------------------------------
  /** So a disponibilidade, para a tela de login decidir se mostra o botao. */
  app.get('/auth/google/disponivel', async () => ({ disponivel: googleConfigurado() }));

  // -------------------------------------------------------------------------
  app.post('/auth/google/start', async (request, reply) => {
    consume(`google:${ipDaRequisicao(request)}`, RATE_LIMITS.login);

    if (!googleConfigurado()) {
      throw new ApiError('GOOGLE_UNAVAILABLE', 'Este servidor nao tem login com Google ativado.');
    }

    const body = inicioSchema.parse(request.body);

    if (!retornoPermitido(body.retorno)) {
      throw badRequest('Endereco de retorno nao permitido.');
    }

    /*
      Vincular e trocar senha exigem ja estar logado.

      Sao acoes SOBRE uma conta existente, e a conta e identificada pela
      sessao, nunca pelo email que o Google devolver. Entrar e recuperar, ao
      contrario, sao publicos: quem chega aqui ainda nao tem sessao, e a conta
      sai do vinculo com o Google.
    */
    let userId: string | undefined;
    if (body.intencao === 'vincular' || body.intencao === 'senha') {
      await requireAuth(request, reply);
      userId = request.auth?.userId;
      if (!userId) throw new ApiError('UNAUTHORIZED', 'Entre na conta antes.');
    }

    const url = await enderecoDeConsentimento({
      intencao: body.intencao as IntencaoDoGoogle,
      retorno: body.retorno,
      userId,
    });

    return { url };
  });

  // -------------------------------------------------------------------------
  /**
   * Onde o Google devolve o navegador.
   *
   * Responde sempre com um redirecionamento, inclusive no erro: quem esta
   * olhando e um navegador, e uma pagina de erro nossa deixaria a pessoa presa
   * fora do aplicativo. O erro volta como parametro e quem explica e a
   * interface, que e onde a pessoa ja esta.
   */
  app.get('/auth/google/callback', async (request, reply) => {
    const consulta = request.query as { code?: string; state?: string; error?: string };

    if (!consulta.state) {
      // Sem estado nao ha para onde voltar: e o unico caso que morre aqui.
      return reply.status(400).send('Pedido invalido.');
    }

    const estado = await conferirEstado(consulta.state);

    if (consulta.error || !consulta.code) {
      const bilhete = guardarBilhete({
        tipo: 'erro',
        codigo: consulta.error ?? 'sem_codigo',
        mensagem:
          consulta.error === 'access_denied'
            ? 'Voce cancelou a autorizacao no Google.'
            : 'O Google nao concluiu a autorizacao.',
      });
      return reply.redirect(voltarParaOAplicativo(estado.retorno, { entrega: bilhete }));
    }

    let identidade: IdentidadeDoGoogle;
    try {
      identidade = await identidadePeloCodigo(consulta.code);
    } catch (erro) {
      logger.warn({ erro }, 'falha ao trocar o codigo do Google');
      const bilhete = guardarBilhete({
        tipo: 'erro',
        codigo: 'troca_falhou',
        mensagem: 'Nao consegui confirmar sua conta no Google. Tente de novo.',
      });
      return reply.redirect(voltarParaOAplicativo(estado.retorno, { entrega: bilhete }));
    }

    const desfecho = await decidirDesfecho(estado.intencao, estado.userId, identidade);
    const bilhete = guardarBilhete(desfecho);
    return reply.redirect(voltarParaOAplicativo(estado.retorno, { entrega: bilhete }));
  });

  // -------------------------------------------------------------------------
  /** O aplicativo troca o bilhete pelo desfecho, e abre a sessao se for o caso. */
  app.post('/auth/google/concluir', async (request) => {
    const body = request.body as { entrega?: string };
    if (!body.entrega) throw badRequest('entrega e obrigatoria.');

    const desfecho = usarBilhete(body.entrega);
    if (!desfecho) {
      throw new ApiError('GOOGLE_STATE_INVALID', 'Esta confirmacao ja foi usada ou expirou.');
    }

    if (desfecho.tipo === 'erro') {
      throw new ApiError('GOOGLE_REJECTED', desfecho.mensagem);
    }

    if (desfecho.tipo === 'sessao') {
      const sessao = await createSession(
        desfecho.userId,
        request.headers['user-agent'],
        ipDaRequisicao(request),
      );
      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: desfecho.userId },
        select: SELF_USER_SELECT,
      });
      logger.info({ userId: desfecho.userId }, 'login pelo Google');
      return { tipo: 'sessao' as const, user: toSelfUser(usuario), ...sessao };
    }

    return desfecho;
  });

  // -------------------------------------------------------------------------
  /**
   * Cria uma conta a partir de uma identidade do Google ja confirmada.
   *
   * Continua respeitando o cadastro fechado: se o servidor exige convite, a
   * conta do Google nao dispensa o codigo. Entrar por Google e uma forma de
   * provar quem voce e, nao um passe para dentro. Com o cadastro aberto, o
   * convite (se veio) so poe a conta nova no servidor dele.
   */
  app.post('/auth/google/registrar', async (request, reply) => {
    consume(`register:${ipDaRequisicao(request)}`, RATE_LIMITS.register);

    const body = registroSchema.parse(request.body);
    const { google } = await conferirProva(body.prova, 'registro');

    const convite = await conviteDoCadastro(body.inviteCode, config.allowOpenRegistration);

    // Entre a prova e aqui alguem pode ter vinculado esta mesma conta.
    const jaVinculada = await prisma.linkedAccount.findUnique({
      where: { provider_providerId: { provider: 'GOOGLE', providerId: google.id } },
      select: { id: true },
    });
    if (jaVinculada) {
      throw new ApiError('GOOGLE_ALREADY_LINKED', 'Esta conta do Google ja esta em uso aqui.');
    }

    /*
      O email vem do Google e entra como email da conta.

      E o unico lugar onde um email do Google vira email do Kiroshi — e vale
      porque aqui a conta esta NASCENDO: nao ha conta alheia para reivindicar.
      Sem email verificado pelo Google, a conta fica com um endereco interno,
      que nao serve para login por senha e nao colide com ninguem.
    */
    const email =
      google.emailVerificado && google.email ? google.email : `${google.id}@google.local`;

    const [emailEmUso, usernameEmUso] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.findUnique({ where: { username: body.username }, select: { id: true } }),
    ]);
    if (emailEmUso) {
      throw new ApiError(
        'EMAIL_TAKEN',
        'Ja existe uma conta com este email. Entre nela e vincule o Google nos Ajustes.',
      );
    }
    if (usernameEmUso) throw new ApiError('USERNAME_TAKEN', 'Este nome de usuario ja existe.');

    // O teto do servidor inteiro so gasta com um pedido que ia mesmo criar conta:
    // pedido invalido nao pode esgotar o cadastro de todo mundo.
    consume('register:global', RATE_LIMITS.registerGlobal);

    const usuario = await prisma.$transaction(async (tx) => {
      const criado = await tx.user.create({
        data: {
          id: generateId(),
          email,
          username: body.username,
          displayName: body.displayName ?? google.nome ?? body.username,
          // Sem senha: esta conta entra pelo Google. Pode definir uma depois.
          passwordHash: null,
        },
        select: SELF_USER_SELECT,
      });

      await tx.linkedAccount.create({
        data: {
          id: generateId(),
          userId: criado.id,
          provider: 'GOOGLE',
          providerId: google.id,
          email: google.email,
        },
      });

      return criado;
    });

    logger.info({ userId: usuario.id, username: usuario.username }, 'conta criada pelo Google');

    const sessao = await createSession(usuario.id, request.headers['user-agent'], ipDaRequisicao(request));
    const guildId = await entrarPeloCadastro(convite, usuario.id);

    return reply.status(201).send({ user: toSelfUser(usuario), ...sessao, guildId });
  });

  // -------------------------------------------------------------------------
  /**
   * Esqueci a senha (fatia 7): uma senha nova provando pelo Google vinculado,
   * sem estar logado. A recuperacao do Kiroshi e so esta — decisao do dono:
   * o servidor nao manda email.
   *
   * Nao abre nada que o Google ja nao abrisse: entrar pelo Google vinculado ja
   * da a conta inteira. O que muda e que a pessoa sai daqui com uma senha que
   * funciona. E o 2FA continua valendo: com ele ligado, a resposta pede o
   * codigo do app, como o login pelo Google pede.
   */
  app.post('/auth/google/recuperar', async (request) => {
    consume(`senha-google:${ipDaRequisicao(request)}`, RATE_LIMITS.login);

    const body = senhaSchema.parse(request.body);
    const { userId } = await conferirProva(body.prova, 'recuperacao');

    const usuario = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, disabledAt: true, totpEnabled: true },
    });
    if (!usuario || usuario.disabledAt) throw new ApiError('FORBIDDEN', 'Esta conta esta desativada.');

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    // Senha trocada por recuperacao derruba todas as sessoes: se alguem tinha
    // tomado a conta, cai junto — inclusive do gateway.
    await prisma.session.deleteMany({ where: { userId } });
    encerrarSessoesDeGateway(userId);
    logger.info({ userId }, 'senha recuperada pelo Google');

    if (usuario.totpEnabled) {
      return { tipo: 'mfa' as const, mfaToken: await signMfaChallenge(userId) };
    }
    const sessao = await createSession(userId, request.headers['user-agent'], ipDaRequisicao(request));
    const eu = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SELF_USER_SELECT });
    return { tipo: 'sessao' as const, user: toSelfUser(eu), ...sessao };
  });

  // -------------------------------------------------------------------------
  /**
   * Define uma senha nova sem saber a antiga, provando pelo Google.
   *
   * Isto torna a conta do Google uma chave mestra do Kiroshi: quem entrar no
   * Gmail da pessoa consegue trocar a senha dela aqui. Foi uma escolha
   * consciente de quem administra este servidor, em troca de nao depender de
   * email de recuperacao.
   *
   * O que NAO muda: o 2FA continua valendo. Uma senha nova nao dispensa o
   * codigo do autenticador no proximo login.
   */
  app.post('/auth/google/senha', async (request) => {
    consume(`senha-google:${ipDaRequisicao(request)}`, RATE_LIMITS.login);

    const body = senhaSchema.parse(request.body);
    const { userId } = await conferirProva(body.prova, 'senha');

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    // Trocar senha por recuperacao derruba TODAS as sessoes, inclusive a de
    // quem pediu: se a conta foi tomada, o invasor cai junto — agora tambem
    // do gateway, onde antes seguia conectado.
    await prisma.session.deleteMany({ where: { userId } });
    encerrarSessoesDeGateway(userId);

    logger.info({ userId }, 'senha redefinida pelo Google');
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  /**
   * Desfaz o vinculo.
   *
   * Recusa quando sobraria uma conta sem nenhuma forma de entrar. Prefiro uma
   * recusa explicavel a alguem se trancar do lado de fora com um clique.
   */
  app.delete('/auth/google', { preHandler: requireFreshAuth }, async (request) => {
    const userId = request.auth!.userId;

    const usuario = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!usuario.passwordHash) {
      throw new ApiError(
        'CONFLICT',
        'Defina uma senha antes de desvincular: sem ela voce ficaria sem como entrar.',
      );
    }

    await prisma.linkedAccount.deleteMany({ where: { userId, provider: 'GOOGLE' } });
    logger.info({ userId }, 'Google desvinculado');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------

/**
 * O que fazer com a identidade que o Google confirmou.
 *
 * Separado das rotas porque e a regra do produto, nao o transporte: aqui mora
 * a decisao de quem entra, quem precisa de 2FA e quem ainda nao tem conta.
 */
async function decidirDesfecho(
  intencao: IntencaoDoGoogle,
  userIdDoPedido: string | undefined,
  google: IdentidadeDoGoogle,
): Promise<Desfecho> {
  const vinculo = await prisma.linkedAccount.findUnique({
    where: { provider_providerId: { provider: 'GOOGLE', providerId: google.id } },
    select: { userId: true },
  });

  if (intencao === 'vincular') {
    if (!userIdDoPedido) {
      return { tipo: 'erro', codigo: 'sem_sessao', mensagem: 'Entre na conta antes de vincular.' };
    }
    if (vinculo && vinculo.userId !== userIdDoPedido) {
      return {
        tipo: 'erro',
        codigo: 'ja_vinculada',
        mensagem: 'Esta conta do Google ja esta ligada a outra conta do Kiroshi.',
      };
    }

    // Outro Google ja ligado a esta conta: antes era trocado em silencio, e o
    // Google antigo perdia o acesso sem a pessoa saber. Agora pede para
    // desvincular primeiro.
    const atual = await prisma.linkedAccount.findUnique({
      where: { userId_provider: { userId: userIdDoPedido, provider: 'GOOGLE' } },
      select: { providerId: true, email: true },
    });
    if (atual && atual.providerId !== google.id) {
      return {
        tipo: 'erro',
        codigo: 'outro_vinculado',
        mensagem: `Esta conta ja esta ligada a outro Google${atual.email ? ` (${atual.email})` : ''}. Desvincule aquele antes.`,
      };
    }

    await prisma.linkedAccount.upsert({
      where: { userId_provider: { userId: userIdDoPedido, provider: 'GOOGLE' } },
      create: {
        id: generateId(),
        userId: userIdDoPedido,
        provider: 'GOOGLE',
        providerId: google.id,
        email: google.email,
      },
      update: { providerId: google.id, email: google.email },
    });

    logger.info({ userId: userIdDoPedido }, 'Google vinculado');
    return { tipo: 'vinculado', email: google.email };
  }

  if (intencao === 'senha') {
    if (!userIdDoPedido) {
      return { tipo: 'erro', codigo: 'sem_sessao', mensagem: 'Entre na conta antes.' };
    }
    if (!vinculo || vinculo.userId !== userIdDoPedido) {
      return {
        tipo: 'erro',
        codigo: 'nao_vinculada',
        mensagem: 'Esta conta do Google nao e a vinculada a esta conta do Kiroshi.',
      };
    }
    return {
      tipo: 'prova-de-senha',
      prova: await assinarProva({ proposito: 'senha', userId: userIdDoPedido }),
    };
  }

  if (intencao === 'recuperar') {
    // Sem sessao: a conta sai do vinculo com o Google, nunca do email.
    if (!vinculo) {
      return {
        tipo: 'erro',
        codigo: 'nao_vinculada',
        mensagem:
          'Nenhuma conta do Kiroshi usa este Google. A recuperacao e so pelo Google vinculado: sem ele, fale com quem administra o servidor.',
      };
    }
    const conta = await prisma.user.findUnique({
      where: { id: vinculo.userId },
      select: { id: true, username: true, displayName: true, disabledAt: true },
    });
    if (!conta || conta.disabledAt) {
      return { tipo: 'erro', codigo: 'desativada', mensagem: 'Esta conta esta desativada.' };
    }
    return {
      tipo: 'prova-de-recuperacao',
      prova: await assinarProva({ proposito: 'recuperacao', userId: conta.id }),
      username: conta.username,
      displayName: conta.displayName,
    };
  }

  // Entrar.
  if (!vinculo) {
    /*
      Nenhuma conta do Kiroshi ligada a esta do Google.

      Nao procuramos por email de proposito — ver o cabecalho do arquivo. O
      que volta e a prova de que a pessoa controla esta conta do Google, para
      ela poder criar uma conta nova se quiser.
    */
    return {
      tipo: 'sem-conta',
      prova: await assinarProva({ proposito: 'registro', google }),
      email: google.email,
      nome: google.nome,
    };
  }

  const usuario = await prisma.user.findUnique({
    where: { id: vinculo.userId },
    select: { id: true, disabledAt: true, totpEnabled: true },
  });
  if (!usuario) {
    return { tipo: 'erro', codigo: 'conta_sumiu', mensagem: 'A conta vinculada nao existe mais.' };
  }
  if (usuario.disabledAt) {
    return { tipo: 'erro', codigo: 'desativada', mensagem: 'Esta conta esta desativada.' };
  }

  /*
    O Google NAO pula o segundo fator.

    Quem ligou o 2FA decidiu que uma credencial so nao basta para abrir a
    conta. Aceitar o Google sozinho aqui transformaria o 2FA em enfeite: o
    caminho mais fraco passa a valer por todos.
  */
  if (usuario.totpEnabled) {
    return { tipo: 'mfa', mfaToken: await signMfaChallenge(usuario.id) };
  }

  return { tipo: 'sessao', userId: usuario.id };
}

import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

/**
 * Conversa com o Google e as regras que cercam essa conversa.
 *
 * O aplicativo nunca fala com o Google direto. Ele abre o navegador do
 * sistema, o Google devolve o codigo para o NOSSO servidor, e o servidor faz
 * a troca pelo token. Duas razoes:
 *
 *   o segredo do cliente fica no servidor, nunca dentro de um .exe que
 *   qualquer pessoa abre com um editor de texto;
 *
 *   o Google recusa autenticacao dentro de webview embutida
 *   (`disallowed_useragent`), entao tem que ser o navegador de verdade.
 *
 * O caminho de volta e um endereco de loopback que o proprio aplicativo
 * levanta — e por isso que `retornoPermitido` existe e e tao restritiva.
 */

const EMISSORES = ['https://accounts.google.com', 'accounts.google.com'];
const CHAVES = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const TROCA = 'https://oauth2.googleapis.com/token';

/**
 * So o necessario para saber quem e.
 *
 * Nenhum escopo sensivel: nao lemos email, agenda nem arquivo nenhum. Alem de
 * ser o certo, escopo nao sensivel e o que dispensa a revisao do Google para
 * publicar o aplicativo.
 */
const ESCOPOS = 'openid email profile';

export interface IdentidadeDoGoogle {
  /** O `sub`: identificador estavel, o unico campo que serve para casar contas. */
  id: string;
  email: string | null;
  emailVerificado: boolean;
  nome: string | null;
  foto: string | null;
}

export function googleConfigurado(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

function exigirConfiguracao(): { clientId: string; clientSecret: string } {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new ApiError('GOOGLE_UNAVAILABLE', 'Este servidor nao tem login com Google ativado.');
  }
  return { clientId: config.google.clientId, clientSecret: config.google.clientSecret };
}

/** O endereco que o Google chama de volta. Tem que bater exatamente com o
 *  cadastrado no console do Google. */
export function enderecoDeRetornoDoGoogle(): string {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/api/v1/auth/google/callback`;
}

/**
 * O endereco de loopback que o aplicativo levanta e para onde devolvemos a
 * entrega.
 *
 * ISTO E A PECA DE SEGURANCA DESTE ARQUIVO. Sem esta validacao o servidor
 * viraria um redirecionador aberto: bastaria pedir
 * `/auth/google/start?retorno=https://site-do-atacante/` para receber, no site
 * do atacante, um token que abre a conta de quem clicou.
 *
 * Por isso a regra e uma lista curta do que PODE, nao uma lista do que nao
 * pode:
 *
 *   esquema http, e so — https em loopback exigiria certificado;
 *   maquina 127.0.0.1 ou [::1], escritas assim, em numero;
 *   porta presente (o aplicativo sorteia uma);
 *   sem usuario, sem senha e sem consulta no endereco.
 *
 * `localhost` fica de fora de proposito: e um nome, e nome se resolve — quem
 * controlar a resolucao de nomes da maquina aponta `localhost` para onde
 * quiser. O numero nao se resolve.
 */
export function retornoPermitido(retorno: string): boolean {
  let url: URL;
  try {
    url = new URL(retorno);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:') return false;
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== '::1') {
    return false;
  }
  if (!url.port) return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;

  return true;
}

/** Para onde o aplicativo quer ir depois de provar quem e no Google. */
export type IntencaoDoGoogle = 'entrar' | 'vincular' | 'senha' | 'recuperar';

const INTENCOES: readonly IntencaoDoGoogle[] = ['entrar', 'vincular', 'senha', 'recuperar'];

export interface EstadoDoGoogle {
  intencao: IntencaoDoGoogle;
  retorno: string;
  /** Quem pediu, quando a intencao exige ja estar logado. */
  userId?: string;
}

const EMISSOR = 'kiroshi';
const PLATEIA = 'kiroshi-google';

/**
 * O `state` vai assinado e volta conferido.
 *
 * E o que impede duas coisas: alguem forjar um retorno que nunca pedimos
 * (CSRF na volta do OAuth) e alguem trocar o endereco de retorno no meio do
 * caminho. Dura cinco minutos, que e tempo de sobra para escolher uma conta
 * na tela do Google.
 */
export async function assinarEstado(estado: EstadoDoGoogle): Promise<string> {
  return new SignJWT({ ...estado })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(EMISSOR)
    .setAudience(PLATEIA)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(config.jwtSecret);
}

export async function conferirEstado(token: string): Promise<EstadoDoGoogle> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: EMISSOR,
      audience: PLATEIA,
    });

    const intencao = payload.intencao;
    const retorno = payload.retorno;
    if (
      !INTENCOES.includes(intencao as IntencaoDoGoogle) ||
      typeof retorno !== 'string'
    ) {
      throw new ApiError('GOOGLE_STATE_INVALID', 'Pedido do Google malformado.');
    }

    /*
      Confere de novo na volta.

      O endereco ja foi validado na ida, mas conferir outra vez custa nada e
      fecha a porta caso algum caminho futuro passe a assinar estado sem
      validar antes.
    */
    if (!retornoPermitido(retorno)) {
      throw new ApiError('GOOGLE_STATE_INVALID', 'Endereco de retorno nao permitido.');
    }

    return {
      intencao: intencao as IntencaoDoGoogle,
      retorno,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('GOOGLE_STATE_INVALID', 'Pedido do Google expirado. Tente de novo.');
  }
}

/** A tela de escolha de conta do Google, com tudo que ela precisa saber. */
export async function enderecoDeConsentimento(estado: EstadoDoGoogle): Promise<string> {
  const { clientId } = exigirConfiguracao();

  const parametros = new URLSearchParams({
    client_id: clientId,
    redirect_uri: enderecoDeRetornoDoGoogle(),
    response_type: 'code',
    scope: ESCOPOS,
    state: await assinarEstado(estado),
    /*
      `select_account` de proposito, sempre.

      Sem isto o Google entra direto com a conta ja aberta no navegador, e
      quem tem duas contas vincula a errada sem perceber — e desvincular
      depois e mais trabalho do que escolher agora.
    */
    prompt: 'select_account',
  });

  return `${AUTORIZACAO}?${parametros.toString()}`;
}

/**
 * Troca o codigo pelo token e devolve quem a pessoa e.
 *
 * O `id_token` chega por uma conexao TLS direta com o Google, autenticada com
 * o nosso segredo — mesmo assim a assinatura e conferida contra as chaves
 * publicas dele. Custa um pedido em cache e tira do caminho toda uma classe
 * de engano.
 */
export async function identidadePeloCodigo(codigo: string): Promise<IdentidadeDoGoogle> {
  const { clientId, clientSecret } = exigirConfiguracao();

  const resposta = await fetch(TROCA, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: enderecoDeRetornoDoGoogle(),
      grant_type: 'authorization_code',
    }),
  });

  if (!resposta.ok) {
    throw new ApiError('GOOGLE_REJECTED', 'O Google recusou a autenticacao. Tente de novo.');
  }

  const corpo = (await resposta.json()) as { id_token?: string };
  if (!corpo.id_token) {
    throw new ApiError('GOOGLE_REJECTED', 'O Google nao devolveu a identidade.');
  }

  const { payload } = await jwtVerify(corpo.id_token, CHAVES, {
    issuer: EMISSORES,
    audience: clientId,
  });

  if (typeof payload.sub !== 'string') {
    throw new ApiError('GOOGLE_REJECTED', 'O Google devolveu uma identidade sem identificador.');
  }

  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerificado: payload.email_verified === true,
    nome: typeof payload.name === 'string' ? payload.name : null,
    foto: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

// ---------------------------------------------------------------------------

/**
 * Provas curtas emitidas depois que o Google confirmou quem a pessoa e.
 *
 * Existem porque a conversa com o Google termina no NAVEGADOR, e o que o
 * navegador recebe nao pode ser a sessao: endereco vai para o historico, e
 * historico vaza. O que volta e um bilhete de uso unico; a prova e o que o
 * aplicativo recebe em troca, por HTTPS, para concluir o que pediu.
 *
 * Duram cinco minutos e servem para uma coisa so, marcada no proposito. Sem
 * essa marca, a prova de "posso criar conta" tambem abriria "posso trocar a
 * senha de alguem".
 */

export type PropositoDaProva = 'registro' | 'senha' | 'recuperacao';

interface ProvaDeRegistro {
  proposito: 'registro';
  google: IdentidadeDoGoogle;
}

interface ProvaDeSenha {
  proposito: 'senha';
  userId: string;
}

/**
 * Esqueci a senha (fatia 7): quem nao tem sessao prova pelo Google vinculado
 * e escolhe uma senha nova. Separada da de senha de proposito: aquela nasce
 * de alguem ja logado, esta de alguem de fora.
 */
interface ProvaDeRecuperacao {
  proposito: 'recuperacao';
  userId: string;
}

export type Prova = ProvaDeRegistro | ProvaDeSenha | ProvaDeRecuperacao;

const PLATEIA_DA_PROVA = 'kiroshi-google-prova';

export async function assinarProva(prova: Prova): Promise<string> {
  return new SignJWT({ ...prova })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(EMISSOR)
    .setAudience(PLATEIA_DA_PROVA)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(config.jwtSecret);
}

export async function conferirProva<P extends PropositoDaProva>(
  token: string,
  proposito: P,
): Promise<Extract<Prova, { proposito: P }>> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: EMISSOR,
      audience: PLATEIA_DA_PROVA,
    }));
  } catch {
    throw new ApiError('GOOGLE_STATE_INVALID', 'Esta confirmacao expirou. Comece de novo.');
  }

  // O proposito e conferido FORA do try: uma prova valida mas do tipo errado e
  // um erro de uso, nao uma expiracao, e a mensagem tem que dizer isso.
  if (payload.proposito !== proposito) {
    throw new ApiError('GOOGLE_STATE_INVALID', 'Esta confirmacao nao serve para esta acao.');
  }

  return payload as unknown as Extract<Prova, { proposito: P }>;
}

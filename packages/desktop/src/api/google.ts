import type { SelfUser } from '@kiroshi/shared';
import { api } from './client.js';

/**
 * O fluxo do login com Google, do lado de quem clica.
 *
 * Tres passos, nesta ordem, e a ordem importa:
 *
 *   1. o aplicativo levanta uma porta local e sabe o endereco de retorno;
 *   2. o servidor assina esse endereco dentro do estado e devolve a URL do
 *      Google;
 *   3. o navegador do sistema abre, a pessoa escolhe a conta, e a resposta
 *      volta pela porta local.
 *
 * O endereco precisa existir ANTES do passo 2 justamente porque vai assinado:
 * se mudasse depois, o servidor recusaria a volta — que e exatamente o que se
 * quer se alguem tentar trocar o destino no meio.
 */

export type IntencaoDoGoogle = 'entrar' | 'vincular' | 'senha';

export interface SessaoDoGoogle {
  tipo: 'sessao';
  user: SelfUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type DesfechoDoGoogle =
  | SessaoDoGoogle
  /** A conta tem 2FA: falta o codigo do autenticador. */
  | { tipo: 'mfa'; mfaToken: string }
  /** Ninguem aqui usa essa conta do Google ainda. */
  | { tipo: 'sem-conta'; prova: string; email: string | null; nome: string | null }
  | { tipo: 'vinculado'; email: string | null }
  | { tipo: 'prova-de-senha'; prova: string };

export interface EstadoDoVinculo {
  disponivel: boolean;
  vinculado: boolean;
  email: string | null;
  vinculadoEm: string | null;
}

/** Erro que a interface mostra como recado, nao como defeito. */
export class GoogleCancelado extends Error {
  constructor(mensagem = 'Login com Google cancelado.') {
    super(mensagem);
    this.name = 'GoogleCancelado';
  }
}

/** Este servidor tem login com Google ligado? */
export async function googleDisponivel(): Promise<boolean> {
  try {
    const r = await api.get<{ disponivel: boolean }>('/auth/google/disponivel');
    return r.disponivel;
  } catch {
    // Servidor antigo, sem a rota: o botao simplesmente nao aparece.
    return false;
  }
}

export async function estadoDoVinculo(): Promise<EstadoDoVinculo> {
  return api.get<EstadoDoVinculo>('/auth/google');
}

export async function desvincularGoogle(): Promise<void> {
  await api.delete('/auth/google');
}

/**
 * Faz a volta inteira e devolve o desfecho.
 *
 * `entrar` vale sem sessao; `vincular` e `senha` exigem estar logado, porque
 * sao acoes sobre uma conta existente e a conta vem da sessao — nunca do email
 * que o Google devolver.
 */
export async function conversarComGoogle(intencao: IntencaoDoGoogle): Promise<DesfechoDoGoogle> {
  const retorno = await window.kiroshi.google.preparar();

  let url: string;
  try {
    const inicio = await api.post<{ url: string }>(
      '/auth/google/start',
      { intencao, retorno },
      { auth: intencao !== 'entrar' },
    );
    url = inicio.url;
  } catch (erro) {
    // A porta ja esta aberta: fecha antes de propagar, senao fica orfa ate o
    // prazo estourar e a proxima tentativa teria que derrubar esta.
    await window.kiroshi.google.cancelar();
    throw erro;
  }

  const { entrega, erro } = await window.kiroshi.google.abrirEEsperar(url);
  if (erro || !entrega) {
    throw new GoogleCancelado(
      erro === 'tempo esgotado'
        ? 'A janela do Google ficou aberta tempo demais. Tente de novo.'
        : 'Login com Google cancelado.',
    );
  }

  return api.post<DesfechoDoGoogle>('/auth/google/concluir', { entrega }, { auth: false });
}

/** Cria a conta a partir de uma identidade do Google ja confirmada. */
export async function registrarComGoogle(dados: {
  prova: string;
  username: string;
  displayName?: string;
  inviteCode?: string;
}): Promise<SessaoDoGoogle & { tipo: 'sessao' }> {
  const r = await api.post<Omit<SessaoDoGoogle, 'tipo'>>('/auth/google/registrar', dados, {
    auth: false,
  });
  return { tipo: 'sessao', ...r };
}

/** Define uma senha nova provando pelo Google, sem saber a antiga. */
export async function definirSenhaComGoogle(prova: string, novaSenha: string): Promise<void> {
  await api.post('/auth/google/senha', { prova, newPassword: novaSenha }, { auth: false });
}

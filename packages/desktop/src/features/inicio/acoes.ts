import type { Channel } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { navegar } from '../../app/rotas.js';
import { avisar } from '../../design/primitivos/index.js';
import { voice } from '../../voice/controller.js';
import { entrarNaVoz } from '../casca/acoesDeVoz.js';
import { motivo } from '../conversa/acoes.js';

/*
  O que se faz a partir do Inicio e das conversas diretas: amizade, abrir a
  conversa, ligar, atender e recusar. Toda falha vira aviso com o motivo que o
  servidor deu — a 1.x engolia a maioria.
*/

/** A DM ja aberta com esta pessoa, se houver. */
function dmExistente(userId: string): Channel | null {
  const s = useStore.getState();
  const eu = s.user?.id;
  if (!eu) return null;
  for (const canal of s.channels.values()) {
    if (canal.type === 'DM' && canal.recipientIds.includes(userId) && canal.recipientIds.includes(eu)) return canal;
  }
  return null;
}

/** Abre (ou reabre) a conversa direta com alguem e leva ate ela. */
export async function abrirConversa(userId: string): Promise<string | null> {
  const existente = dmExistente(userId);
  if (existente) {
    navegar({ tela: 'dm', canalId: existente.id });
    return existente.id;
  }
  try {
    const canal = await api.post<Channel>('/users/@me/channels', { recipientIds: [userId] });
    useStore.getState().upsertChannel(canal);
    navegar({ tela: 'dm', canalId: canal.id });
    return canal.id;
  } catch (erro) {
    avisar.erro('Não consegui abrir a conversa', motivo(erro, 'Tente de novo.'));
    return null;
  }
}

/**
 * Liga numa conversa: e so entrar na voz dela — o servidor faz tocar para os
 * outros. Com video, a camera abre assim que a chamada conecta.
 */
export async function ligar(canalId: string, opcoes: { video?: boolean } = {}): Promise<void> {
  navegar({ tela: 'dm', canalId });
  await entrarNaVoz(canalId, null);
  const v = voice.getState();
  if (opcoes.video && v.connected && v.channelId === canalId) {
    await voice.setCamera(true).catch((erro: unknown) => {
      avisar.erro('A câmera não abriu', erro instanceof Error ? erro.message : undefined);
    });
  }
}

/** Liga para um amigo, abrindo a conversa se precisar. */
export async function ligarPara(userId: string, opcoes: { video?: boolean } = {}): Promise<void> {
  const canalId = await abrirConversa(userId);
  if (canalId) await ligar(canalId, opcoes);
}

/** Atender e entrar na chamada: o servidor para o toque em todos os aparelhos. */
export function atender(canalId: string): Promise<void> {
  return ligar(canalId);
}

/**
 * Recusar: para de tocar em todos os aparelhos desta conta. Some da tela na
 * hora, sem esperar o servidor — um toque que continua depois do clique parece
 * que o botao nao funcionou.
 */
export async function recusar(canalId: string): Promise<void> {
  const s = useStore.getState();
  const chamada = s.calls.get(canalId);
  const eu = s.user?.id;
  if (chamada && eu) s.setCall({ ...chamada, ringing: chamada.ringing.filter((id) => id !== eu) });
  try {
    await api.post(`/channels/${canalId}/call/stop-ringing`, {});
  } catch (erro) {
    avisar.erro('Não consegui recusar a chamada', motivo(erro, 'Tente de novo.'));
  }
}

/** Toca de novo para quem ainda nao entrou. */
export async function tocarDeNovo(canalId: string): Promise<void> {
  try {
    await api.post(`/channels/${canalId}/call/ring`, {});
  } catch (erro) {
    avisar.erro('Não consegui chamar de novo', motivo(erro, 'Tente de novo.'));
  }
}

// ---------------------------------------------------------------------------
// Amizade
// ---------------------------------------------------------------------------

/** Manda o pedido pelo nome de usuario. Devolve o que dizer a quem pediu. */
export async function pedirAmizade(usuario: string): Promise<{ ok: boolean; mensagem: string }> {
  const nome = usuario.trim().replace(/^@/, '');
  if (!nome) return { ok: false, mensagem: 'Digite o nome de usuário.' };
  // Nome de exibição ("Nilton Ferreira") não é nome de usuário: o servidor
  // respondia "campos inválidos", e a pessoa não sabia o que tinha errado.
  if (!/^[a-zA-Z0-9._]{2,32}$/.test(nome)) {
    return {
      ok: false,
      mensagem: 'Isso parece o nome de exibição. Use o nome de usuário (o que vem depois do @ no perfil) ou escolha a pessoa na lista.',
    };
  }
  try {
    const resposta = await api.post<{ status: string }>('/relationships', { username: nome });
    return resposta.status === 'FRIEND'
      ? { ok: true, mensagem: `Vocês agora são amigos — @${nome} já tinha te convidado.` }
      : { ok: true, mensagem: `Pedido enviado para @${nome}.` };
  } catch (erro) {
    if (erro instanceof ApiRequestError && erro.status === 404) {
      return { ok: false, mensagem: `Ninguém usa @${nome}. Confira no perfil da pessoa o que vem depois do @.` };
    }
    return { ok: false, mensagem: motivo(erro, 'Não consegui enviar o pedido.') };
  }
}

async function tentar(acao: () => Promise<unknown>, falha: string): Promise<void> {
  try {
    await acao();
  } catch (erro) {
    avisar.erro(falha, motivo(erro, 'Tente de novo.'));
  }
}

export const aceitarPedido = (id: string) => tentar(() => api.put(`/relationships/${id}`), 'Não consegui aceitar o pedido');
/** Recusar, cancelar, desfazer amizade e desbloquear: a mesma rota nos quatro casos. */
export const desfazerRelacao = (id: string) => tentar(() => api.delete(`/relationships/${id}`), 'Não consegui concluir');
export const bloquear = (userId: string) => tentar(() => api.put(`/relationships/block/${userId}`), 'Não consegui bloquear');
/** Fecha a conversa na lista, sem apagar nada: ela volta com a proxima mensagem. */
export const fecharConversa = (canalId: string) => tentar(() => api.delete(`/channels/${canalId}/close`), 'Não consegui fechar a conversa');

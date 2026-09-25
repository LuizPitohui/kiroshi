import type { Message } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { avisar } from '../../design/primitivos/index.js';

/*
  O que se faz com mensagens, fora dos componentes.

  Regra da interface nova: nada e engolido. A 1.x fazia `.catch(() =>
  undefined)` em editar, apagar e reagir — o servidor recusava, a tela nao
  mudava e ninguem sabia por que. Aqui toda falha vira aviso com o motivo que
  o servidor deu.
*/

export const TAMANHO_DA_PAGINA = 50;

export function motivo(erro: unknown, padrao: string): string {
  return erro instanceof ApiRequestError ? erro.message : padrao;
}

const store = () => useStore.getState();

/**
 * O historico inicial, uma vez por canal.
 *
 * Falha nao vira "canal vazio": a 1.x gravava uma lista vazia e completa, e a
 * tela dizia "este e o comeco do canal" num canal cheio que so nao tinha
 * carregado. Aqui o erro sobe para quem mostra, com botao de tentar de novo.
 */
export async function carregarHistorico(canalId: string): Promise<void> {
  const atual = store().messages.get(canalId);
  if (atual?.loaded || atual?.loading) return;
  store().setMessagesLoading(canalId, true);
  try {
    const itens = await api.get<Message[]>(`/channels/${canalId}/messages?limit=${TAMANHO_DA_PAGINA}`);
    store().setMessages(canalId, itens, itens.length === TAMANHO_DA_PAGINA);
  } catch (erro) {
    store().setMessagesLoading(canalId, false);
    throw erro;
  }
}

/** Uma pagina mais antiga. Devolve quantas chegaram. */
export async function carregarAnteriores(canalId: string): Promise<number> {
  const atual = store().messages.get(canalId);
  const maisAntiga = atual?.items[0];
  if (!atual || atual.loading || !atual.hasMore || !maisAntiga) return 0;
  store().setMessagesLoading(canalId, true);
  try {
    const itens = await api.get<Message[]>(`/channels/${canalId}/messages?limit=${TAMANHO_DA_PAGINA}&before=${maisAntiga.id}`);
    store().prependMessages(canalId, itens, itens.length === TAMANHO_DA_PAGINA);
    return itens.length;
  } catch (erro) {
    store().setMessagesLoading(canalId, false);
    throw erro;
  }
}

export async function editar(mensagem: Message, conteudo: string): Promise<void> {
  const anterior = mensagem;
  // Otimista: a edicao aparece na hora; o MESSAGE_UPDATE do servidor confirma.
  store().updateMessage({ ...mensagem, content: conteudo, editedAt: new Date().toISOString() });
  try {
    await api.patch(`/channels/${mensagem.channelId}/messages/${mensagem.id}`, { content: conteudo });
  } catch (erro) {
    store().updateMessage(anterior);
    avisar.erro('A edição não foi salva', motivo(erro, 'Tente de novo.'));
    throw erro;
  }
}

/** `avisarFalha` falso quando quem chamou ja mostra o erro (o dialogo de confirmar). */
export async function apagar(mensagem: Message, avisarFalha = true): Promise<void> {
  try {
    await api.delete(`/channels/${mensagem.channelId}/messages/${mensagem.id}`);
    store().deleteMessage(mensagem.channelId, mensagem.id);
  } catch (erro) {
    if (avisarFalha) avisar.erro('A mensagem não foi apagada', motivo(erro, 'Tente de novo.'));
    throw erro;
  }
}

/** Emoji de reacao: o caractere unicode, ou o id do emoji do servidor. */
export type EmojiDeReacao = { emoji: string } | { emojiId: string };

/**
 * Poe ou tira a reacao.
 *
 * Emoji do servidor vai como `emojiId`. A 1.x mandava a marca inteira
 * (`<:gato:123>`) no campo do unicode: o servidor aceitava como texto e a
 * reacao aparecia como os caracteres da marca. E clicar numa reacao de emoji
 * do servidor nao fazia nada, porque so o unicode era tratado.
 */
export async function alternarReacao(mensagem: Message, emoji: EmojiDeReacao, minha: boolean): Promise<void> {
  const rota = `/channels/${mensagem.channelId}/messages/${mensagem.id}/reactions`;
  try {
    if (minha) {
      const consulta = 'emojiId' in emoji ? `emojiId=${emoji.emojiId}` : `emoji=${encodeURIComponent(emoji.emoji)}`;
      await api.delete(`${rota}?${consulta}`);
    } else {
      await api.put(rota, emoji);
    }
  } catch (erro) {
    avisar.erro(minha ? 'A reação não foi tirada' : 'A reação não foi posta', motivo(erro, 'Tente de novo.'));
  }
}

/**
 * Fixa ou desafixa. O estado local muda aqui mesmo: o servidor so avisa que
 * a lista de fixadas do canal mudou, nao qual mensagem.
 */
export async function alternarFixada(mensagem: Message): Promise<boolean> {
  const alvo = !mensagem.pinned;
  const rota = `/channels/${mensagem.channelId}/pins/${mensagem.id}`;
  try {
    if (alvo) await api.put(rota);
    else await api.delete(rota);
    const atual = store().messages.get(mensagem.channelId)?.items.find((m) => m.id === mensagem.id);
    if (atual) store().updateMessage({ ...atual, pinned: alvo });
    avisar.ok(alvo ? 'Mensagem fixada' : 'Mensagem desafixada');
    return true;
  } catch (erro) {
    avisar.erro(alvo ? 'A mensagem não foi fixada' : 'A mensagem não foi desafixada', motivo(erro, 'Tente de novo.'));
    return false;
  }
}

/**
 * Marca o canal como lido ate a mensagem. O marcador local anda na hora; se
 * o servidor falhar, ele volta no proximo READY — nao vale um aviso.
 */
export function marcarComoLida(canalId: string, mensagemId: string): void {
  store().markChannelRead(canalId, mensagemId);
  void api.post(`/channels/${canalId}/ack`, { messageId: mensagemId }).catch(() => undefined);
}

export async function copiarTexto(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    avisar.ok('Copiado');
  } catch {
    avisar.erro('Não consegui copiar', 'A área de transferência recusou.');
  }
}

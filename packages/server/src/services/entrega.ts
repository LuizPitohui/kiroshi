import type { GatewayEventMap, GatewayEventName } from '@kiroshi/shared';
import { emitToGuild } from '../gateway/events.js';
import { logger } from '../logger.js';
import { membrosQueVeem } from './permissions.js';

/**
 * Entrega um evento de canal de servidor so a quem enxerga aquele canal.
 *
 * Todo evento que carrega conteudo ou atividade de um canal passa por aqui:
 * mensagem, edicao, exclusao, reacao, fixacao, digitacao, voz. Antes eles iam
 * para o servidor inteiro, e o filtro de visibilidade existia so no READY e no
 * REST — o socket entregava canal privado a qualquer membro.
 *
 * `incluir` existe para o proprio interessado num aviso sobre ele mesmo (sair
 * da voz por decisao de outra pessoa, por exemplo), que precisa chegar mesmo
 * que a visibilidade dele tenha mudado no meio do caminho.
 *
 * NUNCA lanca. Quando isto roda, a acao ja aconteceu no banco; devolver erro
 * faria o cliente mostrar falha e repetir algo que deu certo. Se a conta de
 * quem ve o canal falhar, o evento nao sai para ninguem — fechado, e nao
 * aberto — e o motivo fica no log.
 */
export async function emitirParaQuemVe<E extends GatewayEventName>(
  guildId: string,
  channelId: string,
  event: E,
  payload: GatewayEventMap[E],
  opcoes: { exceptUserId?: string; incluir?: Iterable<string> } = {},
): Promise<void> {
  let destino: Set<string>;
  try {
    destino = await membrosQueVeem(guildId, channelId);
  } catch (error) {
    logger.error({ error, guildId, channelId, event }, 'nao consegui calcular quem ve o canal');
    return;
  }

  for (const userId of opcoes.incluir ?? []) destino.add(userId);
  emitToGuild(guildId, event, payload, {
    exceptUserId: opcoes.exceptUserId,
    onlyUserIds: destino,
  });
}

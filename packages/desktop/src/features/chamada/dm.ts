import type { Call, Channel, Message } from '@kiroshi/shared';

/*
  As regras da chamada em conversa direta de que a interface precisa, puras:
  o texto do registro na conversa, qual chamada toca neste aparelho e o nome
  da conversa. O servidor decide quem toca e quando para (services/chamadas.ts);
  aqui so se le o que ele mandou.
*/

/** "alguns segundos", "1 minuto", "12 minutos", "1 hora", "1 h 5 min". */
export function duracaoDaChamada(inicio: string, fim: string): string {
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'alguns segundos';
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 60) return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return horas === 1 ? '1 hora' : `${horas} horas`;
  return `${horas} h ${resto} min`;
}

export interface RegistroDeChamada {
  texto: string;
  /** Quem le nao passou por uma chamada que ja acabou. */
  perdida: boolean;
  noAr: boolean;
}

/**
 * O que a mensagem de chamada diz, do ponto de vista de quem le.
 *
 * `noAr` vem do estado das chamadas (CALL_CREATE e CALL_DELETE), nao da
 * mensagem. Sem hora de fim e sem chamada no ar, a chamada e de antes de a API
 * reiniciar: aparece encerrada, sem duracao inventada.
 */
export function descreverChamada({
  mensagem,
  autor,
  euSou,
  noAr,
}: {
  mensagem: Pick<Message, 'authorId' | 'createdAt' | 'call'>;
  autor: string;
  euSou: string | null;
  noAr: boolean;
}): RegistroDeChamada {
  const minha = mensagem.authorId === euSou;
  const quem = minha ? 'Você' : autor;
  if (noAr) return { texto: `${quem} iniciou uma chamada.`, perdida: false, noAr: true };

  const participei = minha || (euSou !== null && (mensagem.call?.participantIds ?? []).includes(euSou));
  if (!participei) return { texto: `Chamada perdida de ${autor}.`, perdida: true, noAr: false };

  const fim = mensagem.call?.endedAt ?? null;
  if (!fim) return { texto: `${quem} iniciou uma chamada.`, perdida: false, noAr: false };
  return {
    texto: `${quem} iniciou uma chamada que durou ${duracaoDaChamada(mensagem.createdAt, fim)}.`,
    perdida: false,
    noAr: false,
  };
}

/**
 * A chamada que toca neste aparelho agora: me chama e eu ainda nao estou
 * nela. Com mais de uma ao mesmo tempo (um grupo e uma DM), a mais recente.
 */
export function chamadaQueToca(chamadas: Iterable<Call>, euSou: string | null, meuCanalDeVoz: string | null): Call | null {
  if (!euSou) return null;
  let escolhida: Call | null = null;
  for (const chamada of chamadas) {
    if (!chamada.ringing.includes(euSou) || chamada.channelId === meuCanalDeVoz) continue;
    if (!escolhida || chamada.startedAt > escolhida.startedAt) escolhida = chamada;
  }
  return escolhida;
}

/** O nome de uma DM ou grupo para quem le: o nome do grupo, ou os outros participantes. */
export function nomeDaConversa(
  canal: Pick<Channel, 'type' | 'name' | 'recipientIds'>,
  euSou: string | null,
  nomeDe: (userId: string) => string,
): string {
  if (canal.type === 'GROUP_DM' && canal.name) return canal.name;
  const outros = (canal.recipientIds ?? []).filter((id) => id !== euSou);
  if (outros.length === 0) return 'Conversa';
  return outros.map(nomeDe).join(', ');
}

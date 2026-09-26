/**
 * Quem consta na chamada sem estar na sala do SFU: a decisao, sem banco nem
 * rede, para ser testada sozinha.
 *
 * O estado de voz no banco e o que todo mundo ve na lista do canal. Ate aqui
 * ele so saia por um pedido do proprio app ("sai") ou quando a sessao do
 * gateway expirava de vez. Quem caia de outro jeito — a voz caindo com o app
 * aberto (o app nao avisava), app travado, versao antiga — ficava na lista de
 * todos, as vezes para sempre: o fantasma que o dono reportou em 2026-09-26.
 *
 * A fonte da verdade sobre quem esta na chamada e a sala do LiveKit. A cada
 * conferencia, o estado que nao tem ninguem com aquela identidade na sala
 * comeca a contar ausencia; passando do prazo, sai. O prazo cobre a entrada
 * (o estado nasce antes de o app conectar ao SFU) e a reconexao do cliente,
 * que tenta por ate ~44 s.
 *
 * Quando o SFU nao responde, quem chama nao passa por aqui: nao saber quem
 * esta na sala nao e o mesmo que saber que ninguem esta.
 */

export interface EstadoParaConferir {
  userId: string;
  channelId: string;
  sessionId: string;
}

/** A chave de uma ausencia: mudar de canal ou de sessao comeca a conta de novo. */
export const chaveDaAusencia = (e: EstadoParaConferir): string => `${e.userId}:${e.channelId}:${e.sessionId}`;

export interface ResultadoDaConferencia<E extends EstadoParaConferir> {
  /** Os estados que passaram do prazo sem ninguem na sala: saem. */
  encerrar: E[];
  /** Desde quando cada estado ainda ausente esta ausente (ms). Substitui o anterior. */
  ausentes: Map<string, number>;
}

/**
 * @param presentes  identidades em cada sala do SFU, por nome da sala
 * @param salaDe     o nome da sala de um canal
 * @param antes      o `ausentes` da conferencia anterior
 */
export function conferirFantasmas<E extends EstadoParaConferir>(
  estados: readonly E[],
  presentes: ReadonlyMap<string, ReadonlySet<string>>,
  salaDe: (channelId: string) => string,
  antes: ReadonlyMap<string, number>,
  agora: number,
  prazoMs: number,
): ResultadoDaConferencia<E> {
  const encerrar: E[] = [];
  const ausentes = new Map<string, number>();

  for (const estado of estados) {
    if (presentes.get(salaDe(estado.channelId))?.has(estado.userId)) continue;
    const chave = chaveDaAusencia(estado);
    const desde = antes.get(chave) ?? agora;
    if (agora - desde >= prazoMs) encerrar.push(estado);
    else ausentes.set(chave, desde);
  }

  // O que nao esta mais no banco (saiu, trocou de canal) some da conta sozinho:
  // `ausentes` so carrega quem ainda consta e ainda esta ausente.
  return { encerrar, ausentes };
}

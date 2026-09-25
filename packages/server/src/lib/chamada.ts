/**
 * Para quem uma chamada de DM toca.
 *
 * Todo mundo da conversa, menos quem pede, quem ja esta na chamada e quem tem
 * bloqueio com quem pede, em qualquer sentido. Numa DM 1:1 com bloqueio nem da
 * para entrar na voz; num grupo a pessoa bloqueada continua la, e o toque nao
 * pode ser o caminho para alcanca-la.
 */
export function quemChamar({
  destinatarios,
  naChamada,
  quemPede,
  bloqueados,
}: {
  destinatarios: readonly string[];
  naChamada: readonly string[];
  quemPede: string;
  bloqueados: ReadonlySet<string>;
}): string[] {
  const dentro = new Set(naChamada);
  return [...new Set(destinatarios)].filter((id) => id !== quemPede && !dentro.has(id) && !bloqueados.has(id));
}

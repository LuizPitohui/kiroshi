/**
 * A ordem dos cargos de um servidor, sem banco: o que a rota de reordenar
 * decide, separado para o teste cobrir sozinho.
 *
 * O everyone fica sempre em 0, embaixo de tudo. Os outros ocupam 1..n na
 * ordem final — renumerar a cada mudanca acaba com as posicoes repetidas que
 * o reordenar antigo aceitava, e com elas a hierarquia ambigua (dois cargos
 * na mesma posicao nao agem um sobre o outro).
 */

export interface CargoNaOrdem {
  id: string;
  position: number;
}

export type ResultadoDaReordem =
  | { ok: true; posicoes: Map<string, number> }
  | { ok: false; motivo: 'EVERYONE' | 'REPETIDO' | 'DESCONHECIDO' | 'HIERARQUIA' };

/** De baixo para cima; empate pela ordem do id, para o resultado nao depender do banco. */
function porPosicao(a: CargoNaOrdem, b: CargoNaOrdem): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Aplica um pedido de reordenar.
 *
 * `topoDoAutor` e o cargo mais alto de quem pede (null quando ele so tem o
 * everyone); `dono` pula a hierarquia. Um cargo conta como movido quando a
 * posicao dele na ORDEM muda, e nao o numero: o cliente manda os numeros
 * renumerados, e um cargo acima do autor que so trocou de numero nao mudou
 * de lugar. Movido, ele precisa estar abaixo do topo do autor antes e depois.
 */
export function reordenarCargos(
  atuais: readonly CargoNaOrdem[],
  pedido: readonly CargoNaOrdem[],
  everyoneId: string,
  autor: { dono: true } | { dono: false; topoDoAutor: string | null },
): ResultadoDaReordem {
  const pedidos = new Map<string, number>();
  for (const p of pedido) {
    if (p.id === everyoneId) return { ok: false, motivo: 'EVERYONE' };
    if (pedidos.has(p.id)) return { ok: false, motivo: 'REPETIDO' };
    pedidos.set(p.id, p.position);
  }

  const cargos = atuais.filter((c) => c.id !== everyoneId);
  const ids = new Set(cargos.map((c) => c.id));
  for (const id of pedidos.keys()) if (!ids.has(id)) return { ok: false, motivo: 'DESCONHECIDO' };

  const antes = [...cargos].sort(porPosicao).map((c) => c.id);
  const indiceAntes = new Map(antes.map((id, i) => [id, i]));

  // Empate entre o pedido e quem ficou onde estava: vale a ordem de antes.
  const depois = [...cargos]
    .map((c) => ({ id: c.id, alvo: pedidos.get(c.id) ?? c.position }))
    .sort((a, b) => a.alvo - b.alvo || indiceAntes.get(a.id)! - indiceAntes.get(b.id)!)
    .map((c) => c.id);
  const indiceDepois = new Map(depois.map((id, i) => [id, i]));

  if (!autor.dono) {
    const topo = autor.topoDoAutor;
    const topoAntes = topo !== null ? indiceAntes.get(topo) : undefined;
    const topoDepois = topo !== null ? indiceDepois.get(topo) : undefined;
    for (const id of antes) {
      if (indiceAntes.get(id) === indiceDepois.get(id)) continue;
      if (topoAntes === undefined || topoDepois === undefined) return { ok: false, motivo: 'HIERARQUIA' };
      if (indiceAntes.get(id)! >= topoAntes || indiceDepois.get(id)! >= topoDepois) {
        return { ok: false, motivo: 'HIERARQUIA' };
      }
    }
  }

  return { ok: true, posicoes: new Map(depois.map((id, i) => [id, i + 1])) };
}

/** O cargo mais alto da lista (o everyone nao conta), ou null. */
export function cargoMaisAlto(cargos: readonly CargoNaOrdem[], everyoneId: string): string | null {
  const ordenados = cargos.filter((c) => c.id !== everyoneId).sort(porPosicao);
  return ordenados.at(-1)?.id ?? null;
}

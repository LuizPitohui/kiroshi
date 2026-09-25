import type { Channel } from '@kiroshi/shared';

/*
  Logica pura da casca, sem React nem store: testavel sozinha (o store puxa o
  cliente da API, que le o localStorage ao carregar).
*/

export interface Grupo {
  categoria: Channel | null;
  canais: Channel[];
}

/**
 * Agrupa por categoria, na ordem do servidor: primeiro os canais soltos (e os
 * de categoria que nao existe mais), depois cada categoria; dentro dela, texto
 * antes de voz (como o Discord), e cada tipo pela posicao.
 */
export function agruparCanais(canais: readonly Channel[]): Grupo[] {
  const peso = (c: Channel) => (c.type === 'GUILD_VOICE' ? 1 : 0);
  const ordem = (a: Channel, b: Channel) => peso(a) - peso(b) || a.position - b.position || a.id.localeCompare(b.id);
  const categorias = canais.filter((c) => c.type === 'GUILD_CATEGORY').sort((a, b) => a.position - b.position);
  const ids = new Set(categorias.map((c) => c.id));
  const soltos = canais.filter((c) => c.type !== 'GUILD_CATEGORY' && (!c.parentId || !ids.has(c.parentId))).sort(ordem);

  const grupos: Grupo[] = [];
  if (soltos.length) grupos.push({ categoria: null, canais: soltos });
  for (const categoria of categorias) {
    grupos.push({ categoria, canais: canais.filter((c) => c.parentId === categoria.id).sort(ordem) });
  }
  return grupos;
}

/** Iniciais do servidor: a primeira letra de ate duas palavras. */
export function iniciaisDe(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  const letras = palavras.slice(0, 2).map((p) => p[0] ?? '');
  return letras.join('').toUpperCase() || '?';
}

/** Igualdade rasa de listas: mesmo tamanho e mesmos itens na mesma ordem. */
export function rasoIgual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

import type { Channel } from '@kiroshi/shared';

/**
 * Reordenar canais sem rede: o pedido que o servidor recebe.
 *
 * Dentro de um grupo a navegacao mostra texto antes de voz (como o Discord),
 * entao so faz sentido trocar de lugar dois canais do mesmo lado: um canal de
 * texto "abaixo" de um de voz voltaria para cima na tela.
 */

const lado = (c: Channel) => (c.type === 'GUILD_VOICE' ? 1 : 0);

/** Leva o canal de `de` para `para` na lista do grupo (na ordem da tela); null se nao da. */
export function moverCanal(lista: readonly Channel[], de: number, para: number): { id: string; position: number }[] | null {
  if (de === para || para < 0 || para >= lista.length) return null;
  const movido = lista[de];
  const destino = lista[para];
  if (!movido || !destino || lado(movido) !== lado(destino)) return null;
  const nova = [...lista];
  nova.splice(de, 1);
  nova.splice(para, 0, movido);
  return nova.map((c, i) => ({ id: c.id, position: i }));
}

/** As categorias entre si, na raiz. */
export function moverCategoria(categorias: readonly Channel[], de: number, para: number): { id: string; position: number }[] | null {
  if (de === para || para < 0 || para >= categorias.length) return null;
  const nova = [...categorias];
  const [movida] = nova.splice(de, 1);
  if (!movida) return null;
  nova.splice(para, 0, movida);
  return nova.map((c, i) => ({ id: c.id, position: i }));
}

export const MODO_LENTO = [
  { rotulo: 'Desligado', segundos: 0 },
  { rotulo: '5 segundos', segundos: 5 },
  { rotulo: '10 segundos', segundos: 10 },
  { rotulo: '30 segundos', segundos: 30 },
  { rotulo: '1 minuto', segundos: 60 },
  { rotulo: '5 minutos', segundos: 300 },
  { rotulo: '15 minutos', segundos: 900 },
  { rotulo: '1 hora', segundos: 3600 },
  { rotulo: '6 horas', segundos: 21_600 },
] as const;

import type { PresenceStatus, Relationship, VoiceState } from '@kiroshi/shared';
import type { AbaDoInicio } from '../../app/rotas.js';

/*
  O que aparece em cada aba do Inicio, puro: a tela so desenha.
*/

const nome = (r: Relationship): string => r.user.displayName || r.user.username;

const porNome = (a: Relationship, b: Relationship): number =>
  nome(a).localeCompare(nome(b), 'pt-BR', { sensitivity: 'base' });

/**
 * Quem aparece em cada aba, em ordem de nome.
 *
 * Em pendentes, os recebidos vem antes dos enviados: sao eles que pedem uma
 * acao de quem esta olhando. Invisivel conta como offline — e o que ele e para
 * os outros.
 */
export function relacoesDaAba(
  relacoes: readonly Relationship[],
  aba: AbaDoInicio,
  statusDe: (userId: string) => PresenceStatus,
): Relationship[] {
  switch (aba) {
    case 'online':
      return relacoes.filter((r) => r.type === 'FRIEND' && statusDe(r.user.id) !== 'OFFLINE').sort(porNome);
    case 'todos':
      return relacoes.filter((r) => r.type === 'FRIEND').sort(porNome);
    case 'pendentes':
      return [
        ...relacoes.filter((r) => r.type === 'PENDING_INCOMING').sort(porNome),
        ...relacoes.filter((r) => r.type === 'PENDING_OUTGOING').sort(porNome),
      ];
    case 'bloqueados':
      return relacoes.filter((r) => r.type === 'BLOCKED').sort(porNome);
  }
}

/** Sem acento e sem caixa: "joao" acha "João". */
function simplificar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Filtra pela busca, no nome de exibicao ou no nome de usuario. */
export function filtrarPorBusca(relacoes: readonly Relationship[], busca: string): Relationship[] {
  const termo = simplificar(busca.trim());
  if (!termo) return [...relacoes];
  return relacoes.filter((r) => simplificar(`${r.user.displayName} ${r.user.username}`).includes(termo));
}

/**
 * Amigos em chamada agora, para o quadro "agora" do Inicio: so os que esta
 * conta enxerga (servidores em comum e conversas diretas), na ordem em que
 * entraram.
 */
export function amigosEmVoz(amigos: readonly string[], estados: Iterable<VoiceState>): VoiceState[] {
  const deles = new Set(amigos);
  return [...estados]
    .filter((v) => v.channelId && deles.has(v.userId))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

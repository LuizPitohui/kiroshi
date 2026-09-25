import type { GuildMember, PresenceStatus, Role } from '@kiroshi/shared';

/**
 * A lista de membros do painel da direita, como a do Discord: quem esta
 * online aparece sob o cargo mais alto que tem "exibir separadamente"; o
 * resto online vai para "Online"; quem esta offline vai todo para "Offline",
 * seja qual for o cargo. Dentro de cada grupo, por nome.
 *
 * Com a fatia 6 os cargos passaram a ser dados de verdade — ate aqui ninguem
 * tinha cargo e o agrupamento nao teria o que agrupar.
 */

export interface Grupo {
  /** O id do cargo, 'online' ou 'offline'. */
  id: string;
  nome: string;
  cor: string | null;
  membros: GuildMember[];
}

export function agruparMembros(
  membros: readonly GuildMember[],
  cargos: readonly Role[],
  statusDe: (userId: string) => PresenceStatus,
  nomeDe: (membro: GuildMember) => string,
): Grupo[] {
  const destacados = cargos.filter((c) => c.hoist).sort((a, b) => b.position - a.position);
  const porCargo = new Map<string, GuildMember[]>(destacados.map((c) => [c.id, []]));
  const online: GuildMember[] = [];
  const offline: GuildMember[] = [];

  for (const membro of membros) {
    if (statusDe(membro.userId) === 'OFFLINE') {
      offline.push(membro);
      continue;
    }
    const cargo = destacados.find((c) => membro.roleIds.includes(c.id));
    if (cargo) porCargo.get(cargo.id)!.push(membro);
    else online.push(membro);
  }

  const porNome = (a: GuildMember, b: GuildMember) => nomeDe(a).localeCompare(nomeDe(b), 'pt-BR', { sensitivity: 'base' });
  const grupos: Grupo[] = [];
  for (const cargo of destacados) {
    const deles = porCargo.get(cargo.id)!;
    if (deles.length) grupos.push({ id: cargo.id, nome: cargo.name, cor: cargo.color, membros: deles.sort(porNome) });
  }
  if (online.length) grupos.push({ id: 'online', nome: 'Online', cor: null, membros: online.sort(porNome) });
  if (offline.length) grupos.push({ id: 'offline', nome: 'Offline', cor: null, membros: offline.sort(porNome) });
  return grupos;
}

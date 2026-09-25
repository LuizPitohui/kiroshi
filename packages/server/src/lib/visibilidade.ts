import {
  Permission,
  computeChannelPermissions,
  has,
  normalizeChannelPermissions,
  type MemberContext,
  type OverwriteLike,
  type RoleLike,
} from '@kiroshi/shared';

/**
 * Quem enxerga cada canal de um servidor, calculado sobre um retrato do banco.
 *
 * Existe porque o gateway entregava os eventos de um canal — mensagem, reacao,
 * fixacao, digitacao, voz — a TODOS os membros do servidor, inclusive a quem
 * nao podia ver aquele canal. O READY e o REST ja filtravam; o socket nao, e
 * bastava um cliente modificado para ler canal privado pelo gateway.
 *
 * A regra e a mesma de `resolveChannelPermissions`, so que aplicada a todos os
 * membros de uma vez: as funcoes de bits do shared, os cargos do membro mais o
 * everyone, e as sobrescritas da categoria antes das do proprio canal. Se as
 * duas contas divergissem, alguem passaria a receber evento de um canal que o
 * REST recusa, ou o contrario — por isso `visibleChannelIds` tambem passou a
 * usar este modulo.
 *
 * Sem banco aqui de proposito: e logica pura, e o teste cobre ela sozinha.
 */

export interface CanalDoRetrato {
  id: string;
  parentId: string | null;
  overwrites: OverwriteLike[];
}

export interface MembroDoRetrato {
  userId: string;
  roleIds: string[];
}

export interface RetratoDaGuild {
  guildId: string;
  ownerId: string;
  /** Todos os cargos do servidor; o everyone tem o mesmo id do servidor. */
  roles: RoleLike[];
  members: MembroDoRetrato[];
  /** Os canais do proprio servidor. */
  channels: CanalDoRetrato[];
  /**
   * Canais de FORA do servidor que algum canal daqui cita como pai.
   *
   * Nao deveria existir, mas o reordenar nunca validou o pai, e
   * `resolveChannelPermissions` busca o pai so pelo id. O retrato reproduz
   * isso para dar exatamente o mesmo resultado; esses canais emprestam
   * sobrescritas e nunca entram nas listas de canais visiveis.
   */
  paisDeFora?: CanalDoRetrato[];
}

interface Indice {
  cargos: Map<string, RoleLike>;
  canais: Map<string, CanalDoRetrato>;
  pais: Map<string, CanalDoRetrato>;
}

/*
  O indice e montado uma vez por retrato, e nao a cada membro: um evento de
  canal percorre todos os membros, e refazer os mapas em cada volta seria
  quadratico sem necessidade.
*/
const indices = new WeakMap<RetratoDaGuild, Indice>();

function indice(retrato: RetratoDaGuild): Indice {
  let atual = indices.get(retrato);
  if (!atual) {
    const canais = new Map(retrato.channels.map((c) => [c.id, c]));
    const pais = new Map(canais);
    for (const canal of retrato.paisDeFora ?? []) pais.set(canal.id, canal);
    atual = { cargos: new Map(retrato.roles.map((r) => [r.id, r])), canais, pais };
    indices.set(retrato, atual);
  }
  return atual;
}

/**
 * O contexto de permissao de um membro, montado como `resolveMember` monta:
 * os cargos que ele tem, mais o everyone, que vale para todo mundo mesmo sem
 * linha em MemberRole.
 */
export function contextoDoMembro(retrato: RetratoDaGuild, membro: MembroDoRetrato): MemberContext {
  const { cargos } = indice(retrato);
  const roles: RoleLike[] = [];
  for (const roleId of membro.roleIds) {
    const cargo = cargos.get(roleId);
    if (cargo) roles.push(cargo);
  }
  const everyone = cargos.get(retrato.guildId);
  if (everyone && !roles.some((r) => r.id === everyone.id)) roles.unshift(everyone);

  return {
    userId: membro.userId,
    guildOwnerId: retrato.ownerId,
    everyoneRoleId: retrato.guildId,
    roles,
  };
}

/** Sobrescritas que valem num canal: as do pai primeiro, as do canal depois. */
export function sobrescritasDoCanal(
  retrato: RetratoDaGuild,
  canal: CanalDoRetrato,
): OverwriteLike[] {
  const pai = canal.parentId ? indice(retrato).pais.get(canal.parentId) : undefined;
  return [...(pai?.overwrites ?? []), ...canal.overwrites];
}

/** Permissoes efetivas de um membro num canal, ja normalizadas. */
export function permissoesNoCanal(
  retrato: RetratoDaGuild,
  membro: MembroDoRetrato,
  canal: CanalDoRetrato,
): bigint {
  return normalizeChannelPermissions(
    computeChannelPermissions(contextoDoMembro(retrato, membro), sobrescritasDoCanal(retrato, canal)),
  );
}

/**
 * Membros que tem `permissao` no canal. Por padrao, quem enxerga o canal.
 *
 * Canal que nao e do servidor devolve ninguem: melhor um evento que nao chega
 * do que um evento que chega a quem nao devia.
 */
export function membrosComPermissao(
  retrato: RetratoDaGuild,
  channelId: string,
  permissao: bigint = Permission.VIEW_CHANNEL,
): Set<string> {
  const quem = new Set<string>();
  const canal = indice(retrato).canais.get(channelId);
  if (!canal) return quem;

  const overwrites = sobrescritasDoCanal(retrato, canal);
  for (const membro of retrato.members) {
    const permissoes = normalizeChannelPermissions(
      computeChannelPermissions(contextoDoMembro(retrato, membro), overwrites),
    );
    if (has(permissoes, permissao)) quem.add(membro.userId);
  }
  return quem;
}

/** Canais do servidor em que o usuario tem `permissao`. Nao membro: nenhum. */
export function canaisComPermissao(
  retrato: RetratoDaGuild,
  userId: string,
  permissao: bigint = Permission.VIEW_CHANNEL,
): Set<string> {
  const canais = new Set<string>();
  const membro = retrato.members.find((m) => m.userId === userId);
  if (!membro) return canais;

  const ctx = contextoDoMembro(retrato, membro);
  for (const canal of retrato.channels) {
    const permissoes = normalizeChannelPermissions(
      computeChannelPermissions(ctx, sobrescritasDoCanal(retrato, canal)),
    );
    if (has(permissoes, permissao)) canais.add(canal.id);
  }
  return canais;
}

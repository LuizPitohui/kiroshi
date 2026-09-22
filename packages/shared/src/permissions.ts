/**
 * Sistema de permissoes estilo Discord: bitfield de 64 bits usando BigInt.
 *
 * A resolucao segue a mesma ordem do Discord:
 *   1. Dono do servidor  -> todas as permissoes, sempre.
 *   2. Permissoes do cargo everyone.
 *   3. OR de todas as permissoes dos cargos do membro.
 *   4. ADMINISTRATOR -> todas as permissoes, ignora overwrites de canal.
 *   5. Overwrite de canal para everyone (deny depois allow).
 *   6. Overwrites de canal dos cargos (deny agregado, depois allow agregado).
 *   7. Overwrite de canal especifico do membro (deny depois allow).
 */

export const Permission = {
  /** Ver canais e ler o historico basico do servidor. */
  VIEW_CHANNEL: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_ROLES: 1n << 2n,
  MANAGE_GUILD: 1n << 3n,
  /** Concede todas as permissoes e ignora overwrites de canal. */
  ADMINISTRATOR: 1n << 4n,
  KICK_MEMBERS: 1n << 5n,
  BAN_MEMBERS: 1n << 6n,
  CREATE_INVITE: 1n << 7n,
  CHANGE_NICKNAME: 1n << 8n,
  MANAGE_NICKNAMES: 1n << 9n,

  // Texto
  SEND_MESSAGES: 1n << 10n,
  READ_MESSAGE_HISTORY: 1n << 11n,
  MANAGE_MESSAGES: 1n << 12n,
  EMBED_LINKS: 1n << 13n,
  ATTACH_FILES: 1n << 14n,
  ADD_REACTIONS: 1n << 15n,
  MENTION_EVERYONE: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 17n,

  // Voz
  CONNECT: 1n << 18n,
  SPEAK: 1n << 19n,
  STREAM: 1n << 20n,
  USE_VAD: 1n << 21n,
  PRIORITY_SPEAKER: 1n << 22n,
  MUTE_MEMBERS: 1n << 23n,
  DEAFEN_MEMBERS: 1n << 24n,
  MOVE_MEMBERS: 1n << 25n,

  // Expressoes
  MANAGE_EMOJIS: 1n << 26n,
  USE_SOUNDBOARD: 1n << 27n,
  MANAGE_SOUNDBOARD: 1n << 28n,

  // Diversos
  VIEW_AUDIT_LOG: 1n << 29n,
  MANAGE_WEBHOOKS: 1n << 30n,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSION_NAMES = Object.keys(Permission) as PermissionName[];

/** Todas as permissoes ligadas. */
export const ALL_PERMISSIONS: bigint = ALL_PERMISSION_NAMES.reduce(
  (acc, name) => acc | Permission[name],
  0n,
);

/** Conjunto padrao do cargo everyone em um servidor novo. */
export const DEFAULT_EVERYONE_PERMISSIONS: bigint =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.USE_EXTERNAL_EMOJIS |
  Permission.CREATE_INVITE |
  Permission.CHANGE_NICKNAME |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM |
  Permission.USE_VAD |
  Permission.USE_SOUNDBOARD;

/** Permissoes aplicadas em canais de DM, onde nao existem cargos. */
export const DM_PERMISSIONS: bigint =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.USE_EXTERNAL_EMOJIS |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM |
  Permission.USE_VAD;

export function has(permissions: bigint, permission: bigint): boolean {
  if ((permissions & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return true;
  return (permissions & permission) === permission;
}

/** Checagem literal, sem o atalho de ADMINISTRATOR. Use para auditoria e UI. */
export function hasExact(permissions: bigint, permission: bigint): boolean {
  return (permissions & permission) === permission;
}

export function toNames(permissions: bigint): PermissionName[] {
  return ALL_PERMISSION_NAMES.filter((n) => (permissions & Permission[n]) === Permission[n]);
}

export function fromNames(names: readonly PermissionName[]): bigint {
  return names.reduce((acc, n) => acc | (Permission[n] ?? 0n), 0n);
}

/** Serializa para string decimal, porque BigInt nao sobrevive a JSON.stringify. */
export function serialize(permissions: bigint): string {
  return permissions.toString();
}

export function deserialize(value: string | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export interface RoleLike {
  id: string;
  /** Posicao na hierarquia; maior numero = mais alto. */
  position: number;
  permissions: bigint;
}

export interface OverwriteLike {
  targetId: string;
  targetType: 'ROLE' | 'MEMBER';
  allow: bigint;
  deny: bigint;
}

export interface MemberContext {
  userId: string;
  guildOwnerId: string;
  /** Cargos do membro, incluindo everyone, cujo id e igual ao id do servidor. */
  roles: readonly RoleLike[];
  /** Id do cargo everyone, que por convencao e igual ao id do servidor. */
  everyoneRoleId: string;
}

/** Permissoes no nivel do servidor, antes de qualquer overwrite de canal. */
export function computeBasePermissions(ctx: MemberContext): bigint {
  if (ctx.userId === ctx.guildOwnerId) return ALL_PERMISSIONS;

  let permissions = 0n;
  for (const role of ctx.roles) permissions |= role.permissions;

  if ((permissions & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }
  return permissions;
}

/** Aplica os overwrites de um canal sobre as permissoes base. */
export function computeChannelPermissions(
  ctx: MemberContext,
  overwrites: readonly OverwriteLike[],
): bigint {
  const base = computeBasePermissions(ctx);

  // Dono e administradores ignoram overwrites por completo.
  if (base === ALL_PERMISSIONS) return ALL_PERMISSIONS;

  let permissions = base;

  const everyoneOverwrite = overwrites.find(
    (o) => o.targetType === 'ROLE' && o.targetId === ctx.everyoneRoleId,
  );
  if (everyoneOverwrite) {
    permissions &= ~everyoneOverwrite.deny;
    permissions |= everyoneOverwrite.allow;
  }

  // Overwrites de cargo sao agregados antes de aplicar: todos os deny, depois todos os allow.
  let roleAllow = 0n;
  let roleDeny = 0n;
  const roleIds = new Set(ctx.roles.map((r) => r.id));
  for (const o of overwrites) {
    if (o.targetType !== 'ROLE') continue;
    if (o.targetId === ctx.everyoneRoleId) continue;
    if (!roleIds.has(o.targetId)) continue;
    roleAllow |= o.allow;
    roleDeny |= o.deny;
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  // Overwrite do membro tem a ultima palavra.
  const memberOverwrite = overwrites.find(
    (o) => o.targetType === 'MEMBER' && o.targetId === ctx.userId,
  );
  if (memberOverwrite) {
    permissions &= ~memberOverwrite.deny;
    permissions |= memberOverwrite.allow;
  }

  return permissions;
}

/**
 * Sem VIEW_CHANNEL o membro nao ve o canal, entao nenhuma outra permissao
 * daquele canal deve valer. Normaliza para evitar vazamento por engano.
 */
export function normalizeChannelPermissions(permissions: bigint): bigint {
  if ((permissions & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return permissions;
  if ((permissions & Permission.VIEW_CHANNEL) !== Permission.VIEW_CHANNEL) return 0n;
  if ((permissions & Permission.READ_MESSAGE_HISTORY) !== Permission.READ_MESSAGE_HISTORY) {
    // Sem historico ainda pode falar, mas nao pode gerenciar mensagens antigas.
    permissions &= ~Permission.MANAGE_MESSAGES;
  }
  return permissions;
}

/** Posicao do cargo mais alto do membro. Dono recebe Infinity. */
export function highestRolePosition(ctx: MemberContext): number {
  if (ctx.userId === ctx.guildOwnerId) return Number.POSITIVE_INFINITY;
  return ctx.roles.reduce((max, r) => (r.position > max ? r.position : max), -1);
}

/**
 * Um membro so pode agir sobre outro (expulsar, banir, mudar cargo) se o cargo
 * mais alto dele estiver estritamente acima do cargo mais alto do alvo.
 */
export function canActOn(actor: MemberContext, target: MemberContext): boolean {
  if (actor.userId === actor.guildOwnerId) return true;
  if (target.userId === target.guildOwnerId) return false;
  return highestRolePosition(actor) > highestRolePosition(target);
}

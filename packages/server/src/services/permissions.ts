import {
  computeBasePermissions,
  computeChannelPermissions,
  canActOn as canActOnShared,
  DM_PERMISSIONS,
  has,
  normalizeChannelPermissions,
  Permission,
  toNames,
  type MemberContext,
  type OverwriteLike,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, forbidden, missingPermissions, notFound } from '../errors.js';

/**
 * Resolve permissoes consultando o banco. A logica de bits vive em @kiroshi/shared
 * e e testada la; aqui so montamos o contexto e aplicamos.
 */

export interface ResolvedMember {
  ctx: MemberContext;
  guildId: string;
  permissions: bigint;
}

/** Carrega o membro com seus cargos e calcula as permissoes no servidor. */
export async function resolveMember(
  guildId: string,
  userId: string,
): Promise<ResolvedMember | null> {
  const [guild, member] = await Promise.all([
    prisma.guild.findUnique({ where: { id: guildId }, select: { ownerId: true } }),
    prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId } },
      select: {
        roles: { select: { role: { select: { id: true, position: true, permissions: true } } } },
      },
    }),
  ]);

  if (!guild || !member) return null;

  // O cargo everyone tem o mesmo id do servidor e vale para todo mundo, mesmo
  // que a linha em MemberRole nao exista.
  const everyone = await prisma.role.findUnique({
    where: { id: guildId },
    select: { id: true, position: true, permissions: true },
  });

  const roles = member.roles.map((r) => r.role);
  if (everyone && !roles.some((r) => r.id === everyone.id)) roles.unshift(everyone);

  const ctx: MemberContext = {
    userId,
    guildOwnerId: guild.ownerId,
    everyoneRoleId: guildId,
    roles,
  };

  return { ctx, guildId, permissions: computeBasePermissions(ctx) };
}

/** Permissoes efetivas dentro de um canal especifico. */
export async function resolveChannelPermissions(
  channelId: string,
  userId: string,
): Promise<{ permissions: bigint; guildId: string | null; channelType: string }> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      type: true,
      guildId: true,
      parentId: true,
      overwrites: { select: { targetId: true, targetType: true, allow: true, deny: true } },
      recipients: { select: { userId: true } },
    },
  });

  if (!channel) throw notFound('Canal');

  // Em DM nao ha cargos: quem participa tem o conjunto fixo, quem nao participa
  // nao tem nada.
  if (channel.type === 'DM' || channel.type === 'GROUP_DM') {
    const participant = channel.recipients.some((r) => r.userId === userId);
    return {
      permissions: participant ? DM_PERMISSIONS : 0n,
      guildId: null,
      channelType: channel.type,
    };
  }

  if (!channel.guildId) return { permissions: 0n, guildId: null, channelType: channel.type };

  const resolved = await resolveMember(channel.guildId, userId);
  if (!resolved) return { permissions: 0n, guildId: channel.guildId, channelType: channel.type };

  // Um canal dentro de categoria herda os overwrites dela; os do proprio canal
  // vem depois e tem prioridade.
  let overwrites: OverwriteLike[] = [];
  if (channel.parentId) {
    const parent = await prisma.channel.findUnique({
      where: { id: channel.parentId },
      select: { overwrites: { select: { targetId: true, targetType: true, allow: true, deny: true } } },
    });
    if (parent) overwrites = parent.overwrites;
  }
  overwrites = [...overwrites, ...channel.overwrites];

  const permissions = normalizeChannelPermissions(
    computeChannelPermissions(resolved.ctx, overwrites),
  );

  return { permissions, guildId: channel.guildId, channelType: channel.type };
}

/** Lanca 403 quando faltar qualquer uma das permissoes pedidas. */
export function assertPermissions(
  permissions: bigint,
  required: bigint | bigint[],
): void {
  const list = Array.isArray(required) ? required : [required];
  const missing = list.filter((p) => !has(permissions, p));
  if (missing.length === 0) return;
  throw missingPermissions(missing.flatMap((m) => toNames(m)));
}

export async function assertGuildPermissions(
  guildId: string,
  userId: string,
  required: bigint | bigint[],
): Promise<ResolvedMember> {
  const resolved = await resolveMember(guildId, userId);
  if (!resolved) throw forbidden('Voce nao e membro deste servidor.');
  assertPermissions(resolved.permissions, required);
  return resolved;
}

export async function assertChannelPermissions(
  channelId: string,
  userId: string,
  required: bigint | bigint[],
): Promise<{ permissions: bigint; guildId: string | null }> {
  const { permissions, guildId } = await resolveChannelPermissions(channelId, userId);
  if (permissions === 0n) throw forbidden('Voce nao tem acesso a este canal.');
  assertPermissions(permissions, required);
  return { permissions, guildId };
}

/**
 * Confere a hierarquia antes de uma acao de moderacao. Sem isso um cargo baixo
 * com KICK_MEMBERS conseguiria expulsar um administrador.
 */
export async function assertCanActOn(
  guildId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  if (actorId === targetId) return;

  const [actor, target] = await Promise.all([
    resolveMember(guildId, actorId),
    resolveMember(guildId, targetId),
  ]);

  if (!actor) throw forbidden('Voce nao e membro deste servidor.');
  if (!target) throw notFound('Membro');

  if (!canActOnShared(actor.ctx, target.ctx)) {
    throw new ApiError(
      'FORBIDDEN',
      'O cargo mais alto desta pessoa esta no seu nivel ou acima dele.',
    );
  }
}

/**
 * Impede criar ou editar um cargo com permissoes que o proprio autor nao tem,
 * e mexer em cargo igual ou acima do seu.
 */
export async function assertCanManageRole(
  guildId: string,
  actorId: string,
  rolePosition: number,
  grantedPermissions: bigint,
): Promise<void> {
  const actor = await resolveMember(guildId, actorId);
  if (!actor) throw forbidden('Voce nao e membro deste servidor.');
  if (actor.ctx.userId === actor.ctx.guildOwnerId) return;

  assertPermissions(actor.permissions, Permission.MANAGE_ROLES);

  const actorHighest = actor.ctx.roles.reduce((max, r) => (r.position > max ? r.position : max), -1);
  if (rolePosition >= actorHighest) {
    throw forbidden('Voce nao pode mexer em um cargo no seu nivel ou acima dele.');
  }

  // Administrador escapa da checagem abaixo porque ja tem tudo.
  if (has(actor.permissions, Permission.ADMINISTRATOR)) return;

  const excess = grantedPermissions & ~actor.permissions;
  if (excess !== 0n) {
    throw new ApiError(
      'FORBIDDEN',
      'Voce nao pode conceder permissoes que voce mesmo nao tem.',
      { excess: toNames(excess) },
    );
  }
}

/** Ids dos canais do servidor que o usuario consegue ver. */
export async function visibleChannelIds(guildId: string, userId: string): Promise<Set<string>> {
  const resolved = await resolveMember(guildId, userId);
  if (!resolved) return new Set();

  const channels = await prisma.channel.findMany({
    where: { guildId },
    select: {
      id: true,
      parentId: true,
      overwrites: { select: { targetId: true, targetType: true, allow: true, deny: true } },
    },
  });

  const byId = new Map(channels.map((c) => [c.id, c]));
  const visible = new Set<string>();

  for (const channel of channels) {
    const parent = channel.parentId ? byId.get(channel.parentId) : undefined;
    const overwrites = [...(parent?.overwrites ?? []), ...channel.overwrites];
    const permissions = normalizeChannelPermissions(
      computeChannelPermissions(resolved.ctx, overwrites),
    );
    if (has(permissions, Permission.VIEW_CHANNEL)) visible.add(channel.id);
  }

  return visible;
}

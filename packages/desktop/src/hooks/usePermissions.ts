import { useMemo } from 'react';
import {
  ALL_PERMISSIONS,
  computeBasePermissions,
  computeChannelPermissions,
  deserialize,
  has,
  normalizeChannelPermissions,
  type MemberContext,
  type OverwriteLike,
  type Permission,
} from '@kiroshi/shared';
import { useStore } from '../store/index.js';

/**
 * Permissoes do proprio usuario, calculadas no cliente com a mesma funcao que
 * o servidor usa.
 *
 * Isto serve so para decidir o que mostrar na interface. O servidor recalcula
 * tudo em cada pedido, entao esconder um botao aqui e conveniencia, nunca a
 * garantia de seguranca.
 */

function buildContext(
  state: ReturnType<typeof useStore.getState>,
  guildId: string,
  userId: string,
): MemberContext | null {
  const guild = state.guilds.get(guildId);
  const member = state.members.get(`${guildId}:${userId}`);
  if (!guild || !member) return null;

  // O cargo everyone tem o id do servidor e vale mesmo sem estar na lista.
  const roleIds = member.roleIds.includes(guildId)
    ? member.roleIds
    : [guildId, ...member.roleIds];

  const roles = roleIds
    .map((id) => state.roles.get(id))
    .filter((role): role is NonNullable<typeof role> => Boolean(role))
    .map((role) => ({
      id: role.id,
      position: role.position,
      permissions: deserialize(role.permissions),
    }));

  return { userId, guildOwnerId: guild.ownerId, everyoneRoleId: guildId, roles };
}

/** Bitfield das permissoes do usuario da sessao no servidor. */
export function useGuildPermissions(guildId: string | null): bigint {
  const state = useStore();
  const selfId = state.user?.id;

  return useMemo(() => {
    if (!guildId || !selfId) return 0n;
    const context = buildContext(state, guildId, selfId);
    if (!context) return 0n;
    return computeBasePermissions(context);
  }, [state, guildId, selfId]);
}

/** Permissoes dentro de um canal, ja com os overwrites aplicados. */
export function useChannelPermissions(channelId: string | null): bigint {
  const state = useStore();
  const selfId = state.user?.id;

  return useMemo(() => {
    if (!channelId || !selfId) return 0n;

    const channel = state.channels.get(channelId);
    if (!channel) return 0n;

    // Em DM nao ha cargos: quem participa pode tudo que uma DM permite.
    if (!channel.guildId) {
      return channel.recipientIds.includes(selfId) ? ALL_PERMISSIONS : 0n;
    }

    const context = buildContext(state, channel.guildId, selfId);
    if (!context) return 0n;

    const parent = channel.parentId ? state.channels.get(channel.parentId) : null;

    const toOverwrite = (o: (typeof channel.overwrites)[number]): OverwriteLike => ({
      targetId: o.targetId,
      targetType: o.targetType,
      allow: deserialize(o.allow),
      deny: deserialize(o.deny),
    });

    const overwrites: OverwriteLike[] = [
      ...(parent?.overwrites ?? []).map(toOverwrite),
      ...channel.overwrites.map(toOverwrite),
    ];

    return normalizeChannelPermissions(computeChannelPermissions(context, overwrites));
  }, [state, channelId, selfId]);
}

/** Atalho legivel: useCan(guildId, Permission.MANAGE_CHANNELS) */
export function useCan(guildId: string | null, permission: bigint): boolean {
  const permissions = useGuildPermissions(guildId);
  return has(permissions, permission);
}

export function useCanInChannel(channelId: string | null, permission: bigint): boolean {
  const permissions = useChannelPermissions(channelId);
  return has(permissions, permission);
}

/** Posicao do cargo mais alto, para comparar hierarquia antes de moderar. */
export function useHighestRolePosition(guildId: string | null, userId: string | null): number {
  const state = useStore();

  return useMemo(() => {
    if (!guildId || !userId) return -1;
    const guild = state.guilds.get(guildId);
    if (guild?.ownerId === userId) return Number.POSITIVE_INFINITY;

    const member = state.members.get(`${guildId}:${userId}`);
    if (!member) return -1;

    return member.roleIds.reduce((max, id) => {
      const role = state.roles.get(id);
      return role && role.position > max ? role.position : max;
    }, -1);
  }, [state, guildId, userId]);
}

export type { Permission };

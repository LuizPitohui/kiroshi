import {
  DM_PERMISSIONS,
  computeBasePermissions,
  computeChannelPermissions,
  deserialize,
  mesclarSobrescritas,
  normalizeChannelPermissions,
  type MemberContext,
  type OverwriteLike,
} from '@kiroshi/shared';
import { useStore } from '../store/index.js';

type Estado = ReturnType<typeof useStore.getState>;

/** O contexto de cargos de um membro num servidor, como o servidor calcula. */
export function contextoDoMembro(s: Estado, guildId: string, userId: string): MemberContext | null {
  const guild = s.guilds.get(guildId);
  const membro = s.members.get(`${guildId}:${userId}`);
  if (!guild || !membro) return null;
  // O cargo everyone tem o id do servidor e vale mesmo fora da lista.
  const ids = membro.roleIds.includes(guildId) ? membro.roleIds : [guildId, ...membro.roleIds];
  return {
    userId,
    guildOwnerId: guild.ownerId,
    everyoneRoleId: guildId,
    roles: ids
      .map((id) => s.roles.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({ id: r.id, position: r.position, permissions: deserialize(r.permissions) })),
  };
}

/** O da propria pessoa. */
export function contextoNoServidor(s: Estado, guildId: string): MemberContext | null {
  const eu = s.user?.id;
  return eu ? contextoDoMembro(s, guildId, eu) : null;
}

/**
 * As permissoes no servidor, sem os ajustes de canal. E o que o servidor
 * confere na moderacao de voz (silenciar, ensurdecer, mover).
 */
export function permissoesNoServidor(s: Estado, guildId: string): bigint {
  const contexto = contextoNoServidor(s, guildId);
  return contexto ? computeBasePermissions(contexto) : 0n;
}

export function usePermissoesNoServidor(guildId: string | null): bigint {
  return useStore((s) => (guildId ? permissoesNoServidor(s, guildId) : 0n));
}

/**
 * As permissoes da propria pessoa num canal, com a mesma funcao do servidor.
 *
 * So decide o que MOSTRAR: o servidor recalcula tudo a cada pedido. Duas
 * diferencas para o `hooks/usePermissions.ts` da 1.x:
 *
 * - **DM usa o conjunto da DM**, e nao "tudo ligado". Com tudo ligado o
 *   cliente mostrava acoes que o servidor sempre recusava.
 * - **O resultado e um numero**, lido por seletor: o hook antigo assinava o
 *   store inteiro e redesenhava quem o usasse a cada evento do gateway.
 */
export function permissoesNoCanal(s: Estado, canalId: string): bigint {
  const eu = s.user?.id;
  const canal = s.channels.get(canalId);
  if (!eu || !canal) return 0n;
  if (!canal.guildId) return canal.recipientIds.includes(eu) ? DM_PERMISSIONS : 0n;

  const contexto = contextoNoServidor(s, canal.guildId);
  if (!contexto) return 0n;

  const pai = canal.parentId ? s.channels.get(canal.parentId) : null;
  const paraOverwrite = (o: (typeof canal.overwrites)[number]): OverwriteLike => ({
    targetId: o.targetId,
    targetType: o.targetType,
    allow: deserialize(o.allow),
    deny: deserialize(o.deny),
  });
  const overwrites = mesclarSobrescritas((pai?.overwrites ?? []).map(paraOverwrite), canal.overwrites.map(paraOverwrite));
  return normalizeChannelPermissions(computeChannelPermissions(contexto, overwrites));
}

export function usePermissoesNoCanal(canalId: string | null): bigint {
  return useStore((s) => (canalId ? permissoesNoCanal(s, canalId) : 0n));
}

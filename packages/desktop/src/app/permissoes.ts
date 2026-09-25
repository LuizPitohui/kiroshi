import {
  DM_PERMISSIONS,
  computeChannelPermissions,
  deserialize,
  normalizeChannelPermissions,
  type MemberContext,
  type OverwriteLike,
} from '@kiroshi/shared';
import { useStore } from '../store/index.js';

type Estado = ReturnType<typeof useStore.getState>;

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

  const guild = s.guilds.get(canal.guildId);
  const membro = s.members.get(`${canal.guildId}:${eu}`);
  if (!guild || !membro) return 0n;

  // O cargo everyone tem o id do servidor e vale mesmo fora da lista.
  const ids = membro.roleIds.includes(canal.guildId) ? membro.roleIds : [canal.guildId, ...membro.roleIds];
  const contexto: MemberContext = {
    userId: eu,
    guildOwnerId: guild.ownerId,
    everyoneRoleId: canal.guildId,
    roles: ids
      .map((id) => s.roles.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({ id: r.id, position: r.position, permissions: deserialize(r.permissions) })),
  };

  const pai = canal.parentId ? s.channels.get(canal.parentId) : null;
  const paraOverwrite = (o: (typeof canal.overwrites)[number]): OverwriteLike => ({
    targetId: o.targetId,
    targetType: o.targetType,
    allow: deserialize(o.allow),
    deny: deserialize(o.deny),
  });
  const overwrites = [...(pai?.overwrites ?? []).map(paraOverwrite), ...canal.overwrites.map(paraOverwrite)];
  return normalizeChannelPermissions(computeChannelPermissions(contexto, overwrites));
}

export function usePermissoesNoCanal(canalId: string | null): bigint {
  return useStore((s) => (canalId ? permissoesNoCanal(s, canalId) : 0n));
}

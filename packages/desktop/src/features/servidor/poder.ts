import { useMemo } from 'react';
import { Permission, has, type MemberContext } from '@kiroshi/shared';
import { useStore } from '../../store/index.js';
import { contextoDoMembro } from '../../app/permissoes.js';
import { meuPoder, type MeuPoder } from './hierarquia.js';

/*
  Os contextos de cargo como hooks.

  O seletor nunca monta objeto novo: le so pedacos que o store ja guarda
  (o servidor, o membro, o mapa de cargos) e a conta vai para o useMemo. Um
  seletor que devolvesse `contextoDoMembro(...)` direto criaria um objeto a
  cada leitura — e o Zustand v5 entra em loop de renderizacao com isso.
*/

export function useContextoDe(guildId: string | null, userId: string | null | undefined): MemberContext | null {
  const guild = useStore((s) => (guildId ? s.guilds.get(guildId) : undefined));
  const membro = useStore((s) => (guildId && userId ? s.members.get(`${guildId}:${userId}`) : undefined));
  const cargos = useStore((s) => s.roles);
  return useMemo(
    () => (guildId && userId && guild && membro ? contextoDoMembro(useStore.getState(), guildId, userId) : null),
    // `cargos` entra porque o contexto le as posicoes e permissoes dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guildId, userId, guild, membro, cargos],
  );
}

/** O que eu posso nos cargos e nas pessoas deste servidor. */
export function usePoder(guildId: string | null): MeuPoder | null {
  const eu = useStore((s) => s.user?.id);
  const ctx = useContextoDe(guildId, eu);
  return useMemo(() => (ctx ? meuPoder(ctx) : null), [ctx]);
}

export type PaginaQueExige = 'visao-geral' | 'membros' | 'cargos' | 'convites' | 'banimentos' | 'canais' | 'emojis' | 'soundboard' | 'auditoria';

/** Quem ve cada pagina dos ajustes: a permissao que o servidor pede para as rotas dela. */
export function podeVerPagina(p: MeuPoder | null, pagina: PaginaQueExige): boolean {
  if (!p) return false;
  const tem = (bit: bigint) => has(p.permissoes, bit);
  switch (pagina) {
    case 'visao-geral':
    case 'convites':
      return tem(Permission.MANAGE_GUILD);
    case 'membros':
      return tem(Permission.MANAGE_ROLES) || tem(Permission.KICK_MEMBERS) || tem(Permission.BAN_MEMBERS) || tem(Permission.MANAGE_NICKNAMES);
    case 'cargos':
      return tem(Permission.MANAGE_ROLES);
    case 'banimentos':
      return tem(Permission.BAN_MEMBERS);
    case 'canais':
      return tem(Permission.MANAGE_CHANNELS);
    case 'emojis':
      return tem(Permission.MANAGE_EMOJIS);
    case 'soundboard':
      return tem(Permission.MANAGE_SOUNDBOARD);
    case 'auditoria':
      return tem(Permission.VIEW_AUDIT_LOG);
  }
}

export const PAGINAS_EM_ORDEM: PaginaQueExige[] = [
  'visao-geral',
  'membros',
  'cargos',
  'convites',
  'banimentos',
  'canais',
  'emojis',
  'soundboard',
  'auditoria',
];

/** A primeira pagina que a pessoa ve, para o menu do servidor abrir nela; null se nenhuma. */
export function primeiraPagina(p: MeuPoder | null): PaginaQueExige | null {
  return PAGINAS_EM_ORDEM.find((pagina) => podeVerPagina(p, pagina)) ?? null;
}

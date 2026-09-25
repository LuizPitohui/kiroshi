import { Permission, has } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { permissoesNoCanal } from '../../app/permissoes.js';
import type { Dicionario, FontesDeSugestao } from './mencoes.js';

/*
  De onde o autocompletar e a traducao de mencoes tiram os nomes.

  Lidos do store NA HORA (getState), e nao por assinatura: sao usados quando
  a pessoa digita um gatilho ou envia, e assinar membros, cargos e canais so
  para isso faria o compositor redesenhar a cada presenca que muda.
*/

type Estado = ReturnType<typeof useStore.getState>;

function pessoasDoCanal(s: Estado, canalId: string) {
  const canal = s.channels.get(canalId);
  if (!canal) return [];
  if (canal.guildId) {
    return selectors.membersOfGuild(s, canal.guildId).map((m) => ({
      id: m.userId,
      username: m.user.username,
      nome: m.nickname || m.user.displayName,
      nomes: [m.nickname, m.user.displayName].filter((n): n is string => Boolean(n)),
      avatarUrl: m.user.avatarUrl,
    }));
  }
  return canal.recipientIds
    .map((id) => s.users.get(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({ id: u.id, username: u.username, nome: u.displayName, nomes: [u.displayName], avatarUrl: u.avatarUrl }));
}

/** Os emojis que valem aqui: os do servidor aberto primeiro. */
function emojisDoCanal(s: Estado, canalId: string) {
  const guildId = s.channels.get(canalId)?.guildId ?? null;
  const externos = has(permissoesNoCanal(s, canalId), Permission.USE_EXTERNAL_EMOJIS);
  const atual = guildId ? s.guilds.get(guildId) : undefined;
  const outros = externos ? [...s.guilds.values()].filter((g) => g.id !== guildId) : [];
  return [...(atual ? [atual] : []), ...outros].flatMap((g) => g.emojis);
}

export function fontesDoCanal(canalId: string): FontesDeSugestao {
  const s = useStore.getState();
  const guildId = s.channels.get(canalId)?.guildId ?? null;
  const permissoes = permissoesNoCanal(s, canalId);
  const podeTodos = Boolean(guildId) && has(permissoes, Permission.MENTION_EVERYONE);
  const membros = guildId ? selectors.membersOfGuild(s, guildId) : [];

  return {
    pessoas: pessoasDoCanal(s, canalId),
    cargos: guildId
      ? selectors
          .rolesOfGuild(s, guildId)
          // O everyone tem o id do servidor e se chama com @everyone.
          .filter((r) => r.id !== guildId && (r.mentionable || podeTodos))
          .map((r) => ({ id: r.id, nome: r.name, cor: r.color, membros: membros.filter((m) => m.roleIds.includes(r.id)).length }))
      : [],
    podeMencionarTodos: podeTodos,
    canais: guildId
      ? selectors
          .channelsOfGuild(s, guildId)
          .filter((c) => c.type === 'GUILD_TEXT' || c.type === 'GUILD_ANNOUNCEMENT')
          .map((c) => ({ id: c.id, nome: c.name ?? '', categoria: c.parentId ? (s.channels.get(c.parentId)?.name ?? null) : null }))
      : [],
    emojis: emojisDoCanal(s, canalId).map((e) => ({ id: e.id, nome: e.name, url: e.url, animado: e.animated })),
  };
}

export function dicionarioDoCanal(canalId: string): Dicionario {
  const s = useStore.getState();
  const guildId = s.channels.get(canalId)?.guildId ?? null;
  return {
    pessoas: pessoasDoCanal(s, canalId).map((p) => ({ id: p.id, username: p.username, nomes: p.nomes })),
    cargos: guildId ? selectors.rolesOfGuild(s, guildId).filter((r) => r.id !== guildId).map((r) => ({ id: r.id, nome: r.name })) : [],
    canais: guildId
      ? selectors
          .channelsOfGuild(s, guildId)
          .filter((c) => c.type === 'GUILD_TEXT' || c.type === 'GUILD_ANNOUNCEMENT' || c.type === 'GUILD_VOICE')
          .map((c) => ({ id: c.id, nome: c.name ?? '' }))
      : [],
    emojis: emojisDoCanal(s, canalId).map((e) => ({ id: e.id, nome: e.name, animado: e.animated })),
  };
}

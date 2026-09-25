import type {
  AuditLogEntry,
  Channel,
  Emoji,
  Guild,
  GuildBan,
  GuildMember,
  GuildWithState,
  Invite,
  InvitePreview,
  Role,
  SoundboardSound,
} from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { navegar } from '../../app/rotas.js';
import { avisar } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';
import { paraEnviar, vazia, type Bits } from './sobrescritas.js';

/*
  Tudo o que os ajustes do servidor pedem ao servidor.

  Duas formas, de proposito:
  - as acoes de um clique (dar cargo, trocar um interruptor) avisam a falha
    num toast, com o motivo que o servidor deu, e devolvem null/false;
  - as que passam por uma confirmacao (expulsar, banir, apagar) deixam o erro
    subir: a propria janela mostra o motivo, sem fechar.

  O store e atualizado com a resposta na hora; o evento do gateway chega logo
  depois com o mesmo dado e nao muda nada. Nada e engolido.
*/

const store = () => useStore.getState();

async function tentar<T>(fazer: () => Promise<T>, falha: string): Promise<T | null> {
  try {
    return await fazer();
  } catch (erro) {
    avisar.erro(falha, motivo(erro, 'Tente de novo.'));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

export function salvarServidor(guildId: string, mudancas: { name?: string; description?: string | null; iconUrl?: string | null }) {
  return tentar(() => api.patch<Guild>(`/guilds/${guildId}`, mudancas), 'Não consegui salvar o servidor');
}

/** Para a confirmacao: o erro sobe. */
export async function apagarServidor(guildId: string): Promise<void> {
  await api.delete(`/guilds/${guildId}`);
  store().removeGuild(guildId);
  navegar({ tela: 'inicio', aba: 'online' });
}

export async function sairDoServidor(guildId: string): Promise<void> {
  await api.post(`/guilds/${guildId}/leave`);
  store().removeGuild(guildId);
  navegar({ tela: 'inicio', aba: 'online' });
}

export async function passarPosse(guildId: string, userId: string): Promise<void> {
  await api.post(`/guilds/${guildId}/owner`, { userId });
}

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

export async function criarCargo(guildId: string): Promise<Role | null> {
  const cargo = await tentar(() => api.post<Role>(`/guilds/${guildId}/roles`, { name: 'novo cargo' }), 'Não consegui criar o cargo');
  if (cargo) store().upsertRole(cargo);
  return cargo;
}

export async function editarCargo(
  guildId: string,
  roleId: string,
  mudancas: Partial<Pick<Role, 'name' | 'color' | 'permissions' | 'hoist' | 'mentionable'>>,
): Promise<boolean> {
  const cargo = await tentar(() => api.patch<Role>(`/guilds/${guildId}/roles/${roleId}`, mudancas), 'Não consegui mudar o cargo');
  if (cargo) store().upsertRole(cargo);
  return Boolean(cargo);
}

export async function apagarCargo(guildId: string, roleId: string): Promise<void> {
  await api.delete(`/guilds/${guildId}/roles/${roleId}`);
  store().removeRole(guildId, roleId);
}

export async function reordenarCargos(guildId: string, posicoes: { id: string; position: number }[]): Promise<boolean> {
  const cargos = await tentar(() => api.patch<Role[]>(`/guilds/${guildId}/roles`, { positions: posicoes }), 'Não consegui reordenar');
  for (const cargo of cargos ?? []) store().upsertRole(cargo);
  return Boolean(cargos);
}

export async function darCargo(guildId: string, userId: string, roleId: string): Promise<boolean> {
  const membro = await tentar(
    () => api.put<GuildMember>(`/guilds/${guildId}/members/${userId}/roles/${roleId}`),
    'Não consegui dar o cargo',
  );
  if (membro) store().upsertMember(membro);
  return Boolean(membro);
}

export async function tirarCargo(guildId: string, userId: string, roleId: string): Promise<boolean> {
  const membro = await tentar(
    () => api.delete<GuildMember>(`/guilds/${guildId}/members/${userId}/roles/${roleId}`),
    'Não consegui tirar o cargo',
  );
  if (membro) store().upsertMember(membro);
  return Boolean(membro);
}

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------

/** Apelido vazio tira o apelido. O erro sobe: a janela do apelido mostra. */
export async function mudarApelido(guildId: string, userId: string, apelido: string): Promise<void> {
  const membro = await api.patch<GuildMember>(`/guilds/${guildId}/members/${userId}`, {
    nickname: apelido.trim() ? apelido.trim() : null,
  });
  store().upsertMember(membro);
}

export async function expulsar(guildId: string, userId: string): Promise<void> {
  await api.delete(`/guilds/${guildId}/members/${userId}`);
  store().removeMember(guildId, userId);
}

export async function banir(guildId: string, userId: string, motivoDoBan: string): Promise<void> {
  await api.put(`/guilds/${guildId}/bans/${userId}`, motivoDoBan.trim() ? { reason: motivoDoBan.trim() } : {});
  store().removeMember(guildId, userId);
}

export function listarBanimentos(guildId: string): Promise<GuildBan[]> {
  return api.get<GuildBan[]>(`/guilds/${guildId}/bans`);
}

export async function desbanir(guildId: string, userId: string): Promise<boolean> {
  return (await tentar(() => api.delete(`/guilds/${guildId}/bans/${userId}`), 'Não consegui tirar o banimento')) !== null;
}

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

/** O link que se manda: abre a pagina do convite, que abre o app. */
export function linkDoConvite(codigo: string): string {
  return `${api.getBaseUrl()}/convite/${codigo}`;
}

export function listarConvites(guildId: string): Promise<Invite[]> {
  return api.get<Invite[]>(`/guilds/${guildId}/invites`);
}

export function criarConvite(guildId: string, opcoes: { maxAgeSecs: number; maxUses: number; channelId?: string | null }) {
  return tentar(() => api.post<Invite>(`/guilds/${guildId}/invites`, opcoes), 'Não consegui criar o convite');
}

export async function revogarConvite(codigo: string): Promise<boolean> {
  return (await tentar(() => api.delete(`/invites/${codigo}`), 'Não consegui revogar o convite')) !== null;
}

export function verConvite(codigo: string): Promise<InvitePreview> {
  return api.get<InvitePreview>(`/invites/${codigo}`);
}

/** Entra pelo convite e abre o servidor (no canal de onde o convite saiu, se ele for visivel). */
export async function aceitarConvite(codigo: string): Promise<void> {
  const r = await api.post<{ guild: GuildWithState; joined: boolean; channelId?: string | null }>(`/invites/${codigo}`);
  store().upsertGuild(r.guild);
  navegar({ tela: 'servidor', guildId: r.guild.id, canalId: r.channelId ?? null }, { substituir: true });
}

/**
 * Manda o convite para um amigo pela conversa direta, sem sair da janela do
 * convite (como o botao "Convidar" do Discord).
 */
export async function convidarPorDm(userId: string, link: string): Promise<boolean> {
  const feito = await tentar(async () => {
    const eu = store().user?.id;
    let canal = [...store().channels.values()].find(
      (c) => c.type === 'DM' && eu !== undefined && c.recipientIds.includes(userId) && c.recipientIds.includes(eu),
    );
    if (!canal) {
      canal = await api.post<Channel>('/users/@me/channels', { recipientIds: [userId] });
      store().upsertChannel(canal);
    }
    await api.post(`/channels/${canal.id}/messages`, { content: link });
    return true;
  }, 'Não consegui mandar o convite');
  return Boolean(feito);
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export async function criarCanal(guildId: string, dados: { name: string; type: Channel['type']; parentId: string | null }): Promise<Channel> {
  const canal = await api.post<Channel>(`/guilds/${guildId}/channels`, dados);
  store().upsertChannel(canal);
  return canal;
}

export async function editarCanal(channelId: string, mudancas: Partial<Pick<Channel, 'name' | 'topic' | 'userLimit' | 'rateLimitPerUser' | 'parentId'>>): Promise<boolean> {
  const canal = await tentar(() => api.patch<Channel>(`/channels/${channelId}`, mudancas), 'Não consegui mudar o canal');
  if (canal) store().upsertChannel(canal);
  return Boolean(canal);
}

export async function apagarCanal(channelId: string): Promise<void> {
  await api.delete(`/channels/${channelId}`);
  store().removeChannel(channelId);
}

export async function reordenarCanais(guildId: string, posicoes: { id: string; position: number; parentId?: string | null }[]): Promise<boolean> {
  const canais = await tentar(() => api.patch<Channel[]>(`/guilds/${guildId}/channels`, { positions: posicoes }), 'Não consegui reorganizar os canais');
  for (const canal of canais ?? []) store().upsertChannel(canal);
  return Boolean(canais);
}

/** Grava a sobrescrita de um cargo ou pessoa; sem nenhum bit dito, apaga. */
export async function gravarSobrescrita(channelId: string, targetId: string, targetType: 'ROLE' | 'MEMBER', bits: Bits): Promise<boolean> {
  const canal = await tentar(
    () =>
      vazia(bits)
        ? api.delete<Channel>(`/channels/${channelId}/permissions/${targetId}`)
        : api.put<Channel>(`/channels/${channelId}/permissions/${targetId}`, { targetType, ...paraEnviar(bits) }),
    'Não consegui mudar a permissão',
  );
  if (canal) store().upsertChannel(canal);
  return Boolean(canal);
}

export async function sincronizarComCategoria(channelId: string): Promise<boolean> {
  const canal = await tentar(() => api.delete<Channel>(`/channels/${channelId}/permissions`), 'Não consegui sincronizar');
  if (canal) store().upsertChannel(canal);
  return Boolean(canal);
}

// ---------------------------------------------------------------------------
// Emojis e sons
// ---------------------------------------------------------------------------

export function enviarEmoji(guildId: string, name: string, image: string) {
  return tentar(() => api.post<Emoji>(`/guilds/${guildId}/emojis`, { name, image }), `Não consegui enviar :${name}:`);
}

export async function renomearEmoji(guildId: string, emojiId: string, name: string): Promise<boolean> {
  return Boolean(await tentar(() => api.patch<Emoji>(`/guilds/${guildId}/emojis/${emojiId}`, { name }), 'Não consegui renomear o emoji'));
}

export async function apagarEmoji(guildId: string, emojiId: string): Promise<void> {
  await api.delete(`/guilds/${guildId}/emojis/${emojiId}`);
}

export function enviarSom(guildId: string, dados: { name: string; audio: string; durationSecs: number; emoji?: string | null; volume?: number }) {
  return tentar(() => api.post<SoundboardSound>(`/guilds/${guildId}/sounds`, dados), `Não consegui enviar ${dados.name}`);
}

export async function editarSom(guildId: string, soundId: string, mudancas: { name?: string; emoji?: string | null; volume?: number }): Promise<boolean> {
  return Boolean(await tentar(() => api.patch<SoundboardSound>(`/guilds/${guildId}/sounds/${soundId}`, mudancas), 'Não consegui mudar o som'));
}

export async function apagarSom(guildId: string, soundId: string): Promise<void> {
  await api.delete(`/guilds/${guildId}/sounds/${soundId}`);
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export function lerAuditoria(guildId: string, filtro: { antesDe?: string; pessoa?: string; acao?: string }): Promise<AuditLogEntry[]> {
  const q = new URLSearchParams({ limit: '50' });
  if (filtro.antesDe) q.set('before', filtro.antesDe);
  if (filtro.pessoa) q.set('actorId', filtro.pessoa);
  if (filtro.acao) q.set('action', filtro.acao);
  return api.get<AuditLogEntry[]>(`/guilds/${guildId}/audit-log?${q.toString()}`);
}

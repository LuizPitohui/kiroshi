import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  compareIds,
  type Channel,
  type Emoji,
  type GuildMember,
  type GuildWithState,
  type Message,
  type Presence,
  type PublicUser,
  type ReadState,
  type Relationship,
  type Role,
  type SelfUser,
  type SoundboardSound,
  type Sticker,
  type VoiceState,
} from '@kiroshi/shared';

/**
 * Estado da aplicacao.
 *
 * Tudo normalizado em Map por id: o gateway manda atualizacoes pontuais
 * ("este membro mudou", "esta mensagem foi editada") e procurar dentro de
 * listas aninhadas a cada evento ficaria caro e cheio de casos especiais.
 *
 * As mensagens ficam em uma lista por canal, ordenada por id, porque e assim
 * que a interface as consome e a ordem por id ja e a ordem cronologica.
 */

export interface GuildRecord {
  id: string;
  name: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  ownerId: string;
  systemChannelId: string | null;
  memberCount: number;
  roleIds: string[];
  channelIds: string[];
  emojis: Emoji[];
  stickers: Sticker[];
  sounds: SoundboardSound[];
}

export interface ChannelMessages {
  items: Message[];
  /** Se ainda ha historico mais antigo para carregar. */
  hasMore: boolean;
  loading: boolean;
  /** Ja carregou o historico inicial ao menos uma vez. */
  loaded: boolean;
}

export interface TypingEntry {
  userId: string;
  expiresAt: number;
}

interface AppState {
  // --- Sessao ---
  user: SelfUser | null;
  connection: 'idle' | 'connecting' | 'identifying' | 'ready' | 'reconnecting' | 'failed';

  // --- Dados ---
  guilds: Map<string, GuildRecord>;
  channels: Map<string, Channel>;
  roles: Map<string, Role>;
  /** Chave: `${guildId}:${userId}` */
  members: Map<string, GuildMember>;
  users: Map<string, PublicUser>;
  messages: Map<string, ChannelMessages>;
  presences: Map<string, Presence>;
  relationships: Map<string, Relationship>;
  readStates: Map<string, ReadState>;
  /** Chave: userId. Um usuario esta em no maximo um canal de voz. */
  voiceStates: Map<string, VoiceState>;
  typing: Map<string, TypingEntry[]>;

  // --- Navegacao ---
  selectedGuildId: string | null;
  /** Ultimo canal visitado em cada servidor, para voltar onde parou. */
  lastChannelByGuild: Map<string, string>;
  selectedChannelId: string | null;

  // --- Acoes de sessao ---
  setUser: (user: SelfUser | null) => void;
  setConnection: (state: AppState['connection']) => void;
  reset: () => void;

  // --- Acoes de dados ---
  applyReady: (payload: {
    user: SelfUser;
    guilds: GuildWithState[];
    privateChannels: Channel[];
    relationships: Relationship[];
    readStates: ReadState[];
    presences: Presence[];
    users: PublicUser[];
  }) => void;
  upsertGuild: (guild: GuildWithState) => void;
  removeGuild: (guildId: string) => void;
  upsertChannel: (channel: Channel) => void;
  removeChannel: (channelId: string) => void;
  upsertRole: (role: Role) => void;
  removeRole: (guildId: string, roleId: string) => void;
  upsertMember: (member: GuildMember) => void;
  removeMember: (guildId: string, userId: string) => void;
  setPresence: (presence: Presence) => void;
  upsertRelationship: (relationship: Relationship) => void;
  removeRelationship: (id: string) => void;
  setVoiceState: (state: VoiceState) => void;
  setGuildEmojis: (guildId: string, emojis: Emoji[]) => void;
  setGuildStickers: (guildId: string, stickers: Sticker[]) => void;
  setGuildSounds: (guildId: string, sounds: SoundboardSound[]) => void;

  // --- Mensagens ---
  prependMessages: (channelId: string, messages: Message[], hasMore: boolean) => void;
  setMessages: (channelId: string, messages: Message[], hasMore: boolean) => void;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  deleteMessage: (channelId: string, messageId: string) => void;
  deleteMessages: (channelId: string, messageIds: string[]) => void;
  setMessagesLoading: (channelId: string, loading: boolean) => void;
  applyReaction: (payload: {
    channelId: string;
    messageId: string;
    reaction: Message['reactions'][number] | null;
    emojiKey: string;
    userId: string;
    added: boolean;
  }) => void;

  // --- Leitura e digitacao ---
  setReadState: (state: ReadState) => void;
  markChannelRead: (channelId: string, messageId: string) => void;
  setTyping: (channelId: string, userId: string) => void;
  pruneTyping: () => void;

  // --- Navegacao ---
  selectGuild: (guildId: string | null) => void;
  selectChannel: (channelId: string | null) => void;
}

const EMPTY_MESSAGES: ChannelMessages = {
  items: [],
  hasMore: true,
  loading: false,
  loaded: false,
};

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/** Insere mantendo a ordem por id e sem duplicar. */
function insertOrdered(items: Message[], message: Message): Message[] {
  const existingIndex = items.findIndex((m) => m.id === message.id);
  if (existingIndex !== -1) {
    const next = [...items];
    next[existingIndex] = message;
    return next;
  }

  // O caso comum e a mensagem mais nova de todas; evita a busca binaria.
  const last = items[items.length - 1];
  if (!last || compareIds(message.id, last.id) > 0) return [...items, message];

  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (compareIds(items[mid]!.id, message.id) < 0) low = mid + 1;
    else high = mid;
  }
  return [...items.slice(0, low), message, ...items.slice(low)];
}

function guildFromState(guild: GuildWithState): GuildRecord {
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    bannerUrl: guild.bannerUrl,
    description: guild.description,
    ownerId: guild.ownerId,
    systemChannelId: guild.systemChannelId,
    memberCount: guild.memberCount,
    roleIds: guild.roles.map((r) => r.id),
    channelIds: guild.channels.map((c) => c.id),
    emojis: guild.emojis,
    stickers: guild.stickers,
    sounds: guild.sounds,
  };
}

export const useStore = create<AppState>((set, get) => ({
  user: null,
  connection: 'idle',

  guilds: new Map(),
  channels: new Map(),
  roles: new Map(),
  members: new Map(),
  users: new Map(),
  messages: new Map(),
  presences: new Map(),
  relationships: new Map(),
  readStates: new Map(),
  voiceStates: new Map(),
  typing: new Map(),

  selectedGuildId: null,
  lastChannelByGuild: new Map(),
  selectedChannelId: null,

  setUser: (user) => set({ user }),
  setConnection: (connection) => set({ connection }),

  reset: () =>
    set({
      user: null,
      connection: 'idle',
      guilds: new Map(),
      channels: new Map(),
      roles: new Map(),
      members: new Map(),
      users: new Map(),
      messages: new Map(),
      presences: new Map(),
      relationships: new Map(),
      readStates: new Map(),
      voiceStates: new Map(),
      typing: new Map(),
      selectedGuildId: null,
      selectedChannelId: null,
      lastChannelByGuild: new Map(),
    }),

  applyReady: (payload) =>
    set(() => {
      const guilds = new Map<string, GuildRecord>();
      const channels = new Map<string, Channel>();
      const roles = new Map<string, Role>();
      const members = new Map<string, GuildMember>();
      const users = new Map<string, PublicUser>();
      const voiceStates = new Map<string, VoiceState>();

      for (const user of payload.users) users.set(user.id, user);

      for (const guild of payload.guilds) {
        guilds.set(guild.id, guildFromState(guild));
        for (const channel of guild.channels) channels.set(channel.id, channel);
        for (const role of guild.roles) roles.set(role.id, role);
        for (const member of guild.members) {
          members.set(memberKey(guild.id, member.userId), member);
          users.set(member.user.id, member.user);
        }
        for (const state of guild.voiceStates) voiceStates.set(state.userId, state);
      }

      for (const channel of payload.privateChannels) channels.set(channel.id, channel);

      const relationships = new Map<string, Relationship>();
      for (const relationship of payload.relationships) {
        relationships.set(relationship.id, relationship);
        users.set(relationship.user.id, relationship.user);
      }

      const presences = new Map<string, Presence>();
      for (const presence of payload.presences) presences.set(presence.userId, presence);

      const readStates = new Map<string, ReadState>();
      for (const readState of payload.readStates) readStates.set(readState.channelId, readState);

      return {
        user: payload.user,
        guilds,
        channels,
        roles,
        members,
        users,
        relationships,
        presences,
        readStates,
        voiceStates,
      };
    }),

  upsertGuild: (guild) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      const channels = new Map(state.channels);
      const roles = new Map(state.roles);
      const members = new Map(state.members);
      const users = new Map(state.users);
      const voiceStates = new Map(state.voiceStates);

      guilds.set(guild.id, guildFromState(guild));
      for (const channel of guild.channels) channels.set(channel.id, channel);
      for (const role of guild.roles) roles.set(role.id, role);
      for (const member of guild.members) {
        members.set(memberKey(guild.id, member.userId), member);
        users.set(member.user.id, member.user);
      }
      for (const voiceState of guild.voiceStates) voiceStates.set(voiceState.userId, voiceState);

      return { guilds, channels, roles, members, users, voiceStates };
    }),

  removeGuild: (guildId) =>
    set((state) => {
      const guild = state.guilds.get(guildId);
      const guilds = new Map(state.guilds);
      guilds.delete(guildId);

      const channels = new Map(state.channels);
      const messages = new Map(state.messages);
      for (const channelId of guild?.channelIds ?? []) {
        channels.delete(channelId);
        messages.delete(channelId);
      }

      const roles = new Map(state.roles);
      for (const roleId of guild?.roleIds ?? []) roles.delete(roleId);

      const members = new Map(state.members);
      for (const key of members.keys()) {
        if (key.startsWith(`${guildId}:`)) members.delete(key);
      }

      // Se a pessoa estava vendo este servidor, volta para as DMs.
      const leavingCurrent = state.selectedGuildId === guildId;

      return {
        guilds,
        channels,
        messages,
        roles,
        members,
        ...(leavingCurrent ? { selectedGuildId: null, selectedChannelId: null } : {}),
      };
    }),

  upsertChannel: (channel) =>
    set((state) => {
      const channels = new Map(state.channels);
      channels.set(channel.id, channel);

      const guilds = new Map(state.guilds);
      if (channel.guildId) {
        const guild = guilds.get(channel.guildId);
        if (guild && !guild.channelIds.includes(channel.id)) {
          guilds.set(channel.guildId, {
            ...guild,
            channelIds: [...guild.channelIds, channel.id],
          });
        }
      }

      return { channels, guilds };
    }),

  removeChannel: (channelId) =>
    set((state) => {
      const channel = state.channels.get(channelId);
      const channels = new Map(state.channels);
      channels.delete(channelId);

      const messages = new Map(state.messages);
      messages.delete(channelId);

      const guilds = new Map(state.guilds);
      if (channel?.guildId) {
        const guild = guilds.get(channel.guildId);
        if (guild) {
          guilds.set(channel.guildId, {
            ...guild,
            channelIds: guild.channelIds.filter((id) => id !== channelId),
          });
        }
      }

      const clearingCurrent = state.selectedChannelId === channelId;
      return {
        channels,
        messages,
        guilds,
        ...(clearingCurrent ? { selectedChannelId: null } : {}),
      };
    }),

  upsertRole: (role) =>
    set((state) => {
      const roles = new Map(state.roles);
      roles.set(role.id, role);

      const guilds = new Map(state.guilds);
      const guild = guilds.get(role.guildId);
      if (guild && !guild.roleIds.includes(role.id)) {
        guilds.set(role.guildId, { ...guild, roleIds: [...guild.roleIds, role.id] });
      }

      return { roles, guilds };
    }),

  removeRole: (guildId, roleId) =>
    set((state) => {
      const roles = new Map(state.roles);
      roles.delete(roleId);

      const guilds = new Map(state.guilds);
      const guild = guilds.get(guildId);
      if (guild) {
        guilds.set(guildId, { ...guild, roleIds: guild.roleIds.filter((id) => id !== roleId) });
      }

      // Tira o cargo apagado de quem o tinha, senao a lista de membros
      // continuaria colorindo por um cargo que nao existe mais.
      const members = new Map(state.members);
      for (const [key, member] of members) {
        if (!member.roleIds.includes(roleId)) continue;
        members.set(key, { ...member, roleIds: member.roleIds.filter((id) => id !== roleId) });
      }

      return { roles, guilds, members };
    }),

  upsertMember: (member) =>
    set((state) => {
      const members = new Map(state.members);
      members.set(memberKey(member.guildId, member.userId), member);

      const users = new Map(state.users);
      users.set(member.user.id, member.user);

      return { members, users };
    }),

  removeMember: (guildId, userId) =>
    set((state) => {
      const members = new Map(state.members);
      members.delete(memberKey(guildId, userId));

      const guilds = new Map(state.guilds);
      const guild = guilds.get(guildId);
      if (guild) {
        guilds.set(guildId, { ...guild, memberCount: Math.max(0, guild.memberCount - 1) });
      }

      return { members, guilds };
    }),

  setPresence: (presence) =>
    set((state) => {
      const presences = new Map(state.presences);
      presences.set(presence.userId, presence);
      return { presences };
    }),

  upsertRelationship: (relationship) =>
    set((state) => {
      const relationships = new Map(state.relationships);
      relationships.set(relationship.id, relationship);

      const users = new Map(state.users);
      users.set(relationship.user.id, relationship.user);

      return { relationships, users };
    }),

  removeRelationship: (id) =>
    set((state) => {
      const relationships = new Map(state.relationships);
      relationships.delete(id);
      return { relationships };
    }),

  setVoiceState: (voiceState) =>
    set((state) => {
      const voiceStates = new Map(state.voiceStates);
      // channelId null significa que a pessoa saiu da voz.
      if (!voiceState.channelId) voiceStates.delete(voiceState.userId);
      else voiceStates.set(voiceState.userId, voiceState);
      return { voiceStates };
    }),

  setGuildEmojis: (guildId, emojis) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      const guild = guilds.get(guildId);
      if (guild) guilds.set(guildId, { ...guild, emojis });
      return { guilds };
    }),

  setGuildStickers: (guildId, stickers) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      const guild = guilds.get(guildId);
      if (guild) guilds.set(guildId, { ...guild, stickers });
      return { guilds };
    }),

  setGuildSounds: (guildId, sounds) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      const guild = guilds.get(guildId);
      if (guild) guilds.set(guildId, { ...guild, sounds });
      return { guilds };
    }),

  // -------------------------------------------------------------------------

  setMessages: (channelId, items, hasMore) =>
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(channelId, { items, hasMore, loading: false, loaded: true });
      return { messages };
    }),

  prependMessages: (channelId, older, hasMore) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId) ?? EMPTY_MESSAGES;

      // O servidor pode repetir mensagens na borda da pagina.
      const existing = new Set(current.items.map((m) => m.id));
      const fresh = older.filter((m) => !existing.has(m.id));

      messages.set(channelId, {
        items: [...fresh, ...current.items],
        hasMore,
        loading: false,
        loaded: true,
      });
      return { messages };
    }),

  addMessage: (message) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(message.channelId) ?? EMPTY_MESSAGES;

      // Reconciliacao do envio otimista: a copia local carrega o mesmo nonce,
      // entao some quando a de verdade chega.
      //
      // O nonce basta para identificar. Antes isto exigia tambem um id com
      // prefixo "temp-", e era esse prefixo que estourava a ordenacao por id
      // numerico; agora a copia local usa um snowflake comum e nao ha mais
      // como distinguir pelo id — nem precisa, porque o nonce e unico por
      // envio.
      let items = current.items;
      if (message.nonce) {
        items = items.filter((m) => m.nonce !== message.nonce);
      }

      messages.set(message.channelId, {
        ...current,
        items: insertOrdered(items, message),
        loaded: true,
      });

      const channels = new Map(state.channels);
      const channel = channels.get(message.channelId);
      if (channel) channels.set(channel.id, { ...channel, lastMessageId: message.id });

      // Quem digitava acabou de mandar: some com o indicador.
      const typing = new Map(state.typing);
      const entries = typing.get(message.channelId);
      if (entries) {
        typing.set(
          message.channelId,
          entries.filter((e) => e.userId !== message.authorId),
        );
      }

      return { messages, channels, typing };
    }),

  updateMessage: (message) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(message.channelId);
      if (!current) return {};

      messages.set(message.channelId, {
        ...current,
        items: current.items.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
      });
      return { messages };
    }),

  deleteMessage: (channelId, messageId) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId);
      if (!current) return {};

      messages.set(channelId, {
        ...current,
        items: current.items.filter((m) => m.id !== messageId),
      });
      return { messages };
    }),

  deleteMessages: (channelId, messageIds) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId);
      if (!current) return {};

      const removing = new Set(messageIds);
      messages.set(channelId, {
        ...current,
        items: current.items.filter((m) => !removing.has(m.id)),
      });
      return { messages };
    }),

  setMessagesLoading: (channelId, loading) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId) ?? EMPTY_MESSAGES;
      messages.set(channelId, { ...current, loading });
      return { messages };
    }),

  applyReaction: ({ channelId, messageId, reaction, emojiKey, userId, added }) =>
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId);
      if (!current) return {};

      const selfId = state.user?.id;

      messages.set(channelId, {
        ...current,
        items: current.items.map((message) => {
          if (message.id !== messageId) return message;

          const keyOf = (r: Message['reactions'][number]) =>
            r.emojiId ? `custom:${r.emojiId}` : (r.emoji ?? '');

          // O servidor manda o estado consolidado; quando vem null, a reacao
          // perdeu o ultimo usuario e deve sumir.
          if (!reaction) {
            return { ...message, reactions: message.reactions.filter((r) => keyOf(r) !== emojiKey) };
          }

          const withMe = { ...reaction, me: added ? userId === selfId : reaction.userIds.includes(selfId ?? '') };
          const index = message.reactions.findIndex((r) => keyOf(r) === emojiKey);

          const reactions =
            index === -1
              ? [...message.reactions, withMe]
              : message.reactions.map((r, i) => (i === index ? withMe : r));

          return { ...message, reactions };
        }),
      });

      return { messages };
    }),

  // -------------------------------------------------------------------------

  setReadState: (readState) =>
    set((state) => {
      const readStates = new Map(state.readStates);
      readStates.set(readState.channelId, readState);
      return { readStates };
    }),

  markChannelRead: (channelId, messageId) =>
    set((state) => {
      const readStates = new Map(state.readStates);
      readStates.set(channelId, { channelId, lastReadMessageId: messageId, mentionCount: 0 });
      return { readStates };
    }),

  setTyping: (channelId, userId) =>
    set((state) => {
      const typing = new Map(state.typing);
      const entries = (typing.get(channelId) ?? []).filter((e) => e.userId !== userId);
      entries.push({ userId, expiresAt: Date.now() + 9000 });
      typing.set(channelId, entries);
      return { typing };
    }),

  pruneTyping: () => {
    const now = Date.now();
    const state = get();
    let changed = false;
    const typing = new Map(state.typing);

    for (const [channelId, entries] of typing) {
      const alive = entries.filter((e) => e.expiresAt > now);
      if (alive.length === entries.length) continue;
      changed = true;
      if (alive.length === 0) typing.delete(channelId);
      else typing.set(channelId, alive);
    }

    if (changed) set({ typing });
  },

  // -------------------------------------------------------------------------

  selectGuild: (guildId) =>
    set((state) => {
      if (guildId === null) {
        return { selectedGuildId: null, selectedChannelId: null };
      }

      const guild = state.guilds.get(guildId);
      if (!guild) return { selectedGuildId: guildId };

      // Volta para o ultimo canal visitado; se nao houver, o primeiro de texto.
      const remembered = state.lastChannelByGuild.get(guildId);
      const stillExists = remembered && state.channels.has(remembered);

      const firstText = guild.channelIds
        .map((id) => state.channels.get(id))
        .filter((c): c is Channel => Boolean(c))
        .filter((c) => c.type === 'GUILD_TEXT' || c.type === 'GUILD_ANNOUNCEMENT')
        .sort((a, b) => a.position - b.position)[0];

      return {
        selectedGuildId: guildId,
        selectedChannelId: stillExists ? remembered : (firstText?.id ?? null),
      };
    }),

  selectChannel: (channelId) =>
    set((state) => {
      if (!channelId) return { selectedChannelId: null };

      const channel = state.channels.get(channelId);
      const lastChannelByGuild = new Map(state.lastChannelByGuild);
      if (channel?.guildId) lastChannelByGuild.set(channel.guildId, channelId);

      return { selectedChannelId: channelId, lastChannelByGuild };
    }),
}));

// ---------------------------------------------------------------------------
// Hooks de lista
// ---------------------------------------------------------------------------

/**
 * Qualquer seletor que monte uma lista nova a cada chamada precisa passar por
 * useShallow.
 *
 * O zustand compara o resultado do seletor com Object.is. Um array recem
 * criado nunca e igual ao anterior, entao o componente renderiza de novo, o
 * seletor roda outra vez, cria outro array, e assim por diante ate o React
 * abortar com "maximum update depth exceeded". Com useShallow a comparacao
 * passa a ser item a item, e como as entidades sao imutaveis no store, a
 * identidade delas so muda quando o dado realmente mudou.
 */

export function useGuildList(): GuildRecord[] {
  return useStore(useShallow((s) => [...s.guilds.values()]));
}

export function useChannelsOfGuild(guildId: string | null): Channel[] {
  return useStore(useShallow((s) => (guildId ? selectors.channelsOfGuild(s, guildId) : [])));
}

export function useMembersOfGuild(guildId: string | null): GuildMember[] {
  return useStore(useShallow((s) => (guildId ? selectors.membersOfGuild(s, guildId) : [])));
}

export function useRolesOfGuild(guildId: string | null): Role[] {
  return useStore(useShallow((s) => (guildId ? selectors.rolesOfGuild(s, guildId) : [])));
}

export function usePrivateChannels(): Channel[] {
  return useStore(useShallow((s) => selectors.privateChannels(s)));
}

export function useRelationships(): Relationship[] {
  return useStore(useShallow((s) => [...s.relationships.values()]));
}

export function useVoiceMembersOf(channelId: string): VoiceState[] {
  return useStore(useShallow((s) => selectors.voiceMembersOf(s, channelId)));
}

export function useTypingIn(channelId: string | null): TypingEntry[] {
  return useStore(useShallow((s) => (channelId ? (s.typing.get(channelId) ?? []) : [])));
}

// ---------------------------------------------------------------------------
// Seletores
// ---------------------------------------------------------------------------

export const selectors = {
  guildList: (state: AppState): GuildRecord[] => [...state.guilds.values()],

  channelsOfGuild: (state: AppState, guildId: string): Channel[] => {
    const guild = state.guilds.get(guildId);
    if (!guild) return [];
    return guild.channelIds
      .map((id) => state.channels.get(id))
      .filter((c): c is Channel => Boolean(c))
      .sort((a, b) => a.position - b.position || compareIds(a.id, b.id));
  },

  membersOfGuild: (state: AppState, guildId: string): GuildMember[] => {
    const result: GuildMember[] = [];
    for (const [key, member] of state.members) {
      if (key.startsWith(`${guildId}:`)) result.push(member);
    }
    return result;
  },

  rolesOfGuild: (state: AppState, guildId: string): Role[] => {
    const guild = state.guilds.get(guildId);
    if (!guild) return [];
    return guild.roleIds
      .map((id) => state.roles.get(id))
      .filter((r): r is Role => Boolean(r))
      .sort((a, b) => b.position - a.position);
  },

  privateChannels: (state: AppState): Channel[] =>
    [...state.channels.values()]
      .filter((c) => c.type === 'DM' || c.type === 'GROUP_DM')
      .sort((a, b) => {
        // Conversa com mensagem mais recente primeiro.
        if (!a.lastMessageId && !b.lastMessageId) return 0;
        if (!a.lastMessageId) return 1;
        if (!b.lastMessageId) return -1;
        return compareIds(b.lastMessageId, a.lastMessageId);
      }),

  messagesOf: (state: AppState, channelId: string): ChannelMessages =>
    state.messages.get(channelId) ?? EMPTY_MESSAGES,

  voiceMembersOf: (state: AppState, channelId: string): VoiceState[] =>
    [...state.voiceStates.values()].filter((v) => v.channelId === channelId),

  /** Quantas mensagens nao lidas o canal tem, aproximado pelo marcador. */
  unreadCount: (state: AppState, channelId: string): number => {
    const readState = state.readStates.get(channelId);
    const channel = state.channels.get(channelId);
    if (!channel?.lastMessageId) return 0;
    if (!readState?.lastReadMessageId) return 1;
    return compareIds(channel.lastMessageId, readState.lastReadMessageId) > 0 ? 1 : 0;
  },

  mentionCount: (state: AppState, channelId: string): number =>
    state.readStates.get(channelId)?.mentionCount ?? 0,

  guildMentionCount: (state: AppState, guildId: string): number => {
    const guild = state.guilds.get(guildId);
    if (!guild) return 0;
    let total = 0;
    for (const channelId of guild.channelIds) {
      total += state.readStates.get(channelId)?.mentionCount ?? 0;
    }
    return total;
  },

  friends: (state: AppState): Relationship[] =>
    [...state.relationships.values()].filter((r) => r.type === 'FRIEND'),

  pendingRequests: (state: AppState): Relationship[] =>
    [...state.relationships.values()].filter(
      (r) => r.type === 'PENDING_INCOMING' || r.type === 'PENDING_OUTGOING',
    ),

  /** Nome a mostrar: apelido no servidor, senao o nome de exibicao. */
  displayNameOf: (state: AppState, userId: string, guildId: string | null): string => {
    if (guildId) {
      const member = state.members.get(`${guildId}:${userId}`);
      if (member?.nickname) return member.nickname;
      if (member) return member.user.displayName;
    }
    return state.users.get(userId)?.displayName ?? 'Desconhecido';
  },

  /** Cor do cargo mais alto que define cor, usada no nome. */
  colorOf: (state: AppState, userId: string, guildId: string | null): string | null => {
    if (!guildId) return null;
    const member = state.members.get(`${guildId}:${userId}`);
    if (!member) return null;

    const colored = member.roleIds
      .map((id) => state.roles.get(id))
      .filter((r): r is Role => Boolean(r?.color))
      .sort((a, b) => b.position - a.position)[0];

    return colored?.color ?? null;
  },
};

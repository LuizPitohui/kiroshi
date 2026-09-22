import { toPlainText, type Message } from '@kiroshi/shared';
import { useStore } from '../store/index.js';
import { voice } from '../voice/controller.js';
import { gateway } from './gateway.js';

/**
 * Liga os eventos do gateway ao estado da interface.
 *
 * Fica em um arquivo so, e nao espalhado pelos componentes, porque a ordem e a
 * completude importam: um evento sem handler vira um bug silencioso em que a
 * tela de um usuario fica diferente da do outro.
 */

let installed = false;

export function installGatewayHandlers(): void {
  if (installed) return;
  installed = true;

  const store = useStore.getState;

  gateway.onStateChange((state) => store().setConnection(state));

  // --- Sessao -------------------------------------------------------------

  gateway.on('READY', (payload) => {
    store().applyReady(payload);

    // Abre no primeiro servidor se ainda nao houver nada selecionado.
    const { selectedGuildId, guilds } = store();
    if (!selectedGuildId && guilds.size > 0) {
      const first = [...guilds.keys()][0];
      if (first) store().selectGuild(first);
    }
  });

  gateway.on('USER_UPDATE', (user) => store().setUser(user));

  gateway.on('PRESENCE_UPDATE', (presence) => store().setPresence(presence));

  // --- Servidores ---------------------------------------------------------

  gateway.on('GUILD_CREATE', (guild) => store().upsertGuild(guild));

  gateway.on('GUILD_UPDATE', (guild) => {
    const current = store().guilds.get(guild.id);
    if (!current) return;
    useStore.setState((state) => {
      const guilds = new Map(state.guilds);
      guilds.set(guild.id, { ...current, ...guild });
      return { guilds };
    });
  });

  gateway.on('GUILD_DELETE', ({ id }) => store().removeGuild(id));

  gateway.on('GUILD_MEMBER_ADD', (member) => {
    store().upsertMember(member);
    useStore.setState((state) => {
      const guilds = new Map(state.guilds);
      const guild = guilds.get(member.guildId);
      if (guild) guilds.set(guild.id, { ...guild, memberCount: guild.memberCount + 1 });
      return { guilds };
    });
  });

  gateway.on('GUILD_MEMBER_UPDATE', (member) => store().upsertMember(member));
  gateway.on('GUILD_MEMBER_REMOVE', ({ guildId, userId }) =>
    store().removeMember(guildId, userId),
  );

  gateway.on('GUILD_MEMBERS_CHUNK', ({ members }) => {
    for (const member of members) store().upsertMember(member);
  });

  gateway.on('GUILD_ROLE_CREATE', (role) => store().upsertRole(role));
  gateway.on('GUILD_ROLE_UPDATE', (role) => store().upsertRole(role));
  gateway.on('GUILD_ROLE_DELETE', ({ guildId, roleId }) => store().removeRole(guildId, roleId));

  gateway.on('GUILD_EMOJIS_UPDATE', ({ guildId, emojis }) =>
    store().setGuildEmojis(guildId, emojis),
  );
  gateway.on('GUILD_STICKERS_UPDATE', ({ guildId, stickers }) =>
    store().setGuildStickers(guildId, stickers),
  );
  gateway.on('GUILD_SOUNDS_UPDATE', ({ guildId, sounds }) =>
    store().setGuildSounds(guildId, sounds),
  );

  // --- Canais -------------------------------------------------------------

  gateway.on('CHANNEL_CREATE', (channel) => store().upsertChannel(channel));
  gateway.on('CHANNEL_UPDATE', (channel) => store().upsertChannel(channel));
  gateway.on('CHANNEL_DELETE', (channel) => store().removeChannel(channel.id));

  gateway.on('CHANNEL_PINS_UPDATE', () => {
    // A lista de fixadas e buscada sob demanda; nada a fazer no estado local.
  });

  // --- Mensagens ----------------------------------------------------------

  gateway.on('MESSAGE_CREATE', (message) => {
    store().addMessage(message);
    notifyIfNeeded(message);
  });

  gateway.on('MESSAGE_UPDATE', (message) => store().updateMessage(message));
  gateway.on('MESSAGE_DELETE', ({ id, channelId }) => store().deleteMessage(channelId, id));
  gateway.on('MESSAGE_DELETE_BULK', ({ ids, channelId }) =>
    store().deleteMessages(channelId, ids),
  );

  gateway.on('MESSAGE_REACTION_ADD', (payload) => {
    store().applyReaction({
      channelId: payload.channelId,
      messageId: payload.messageId,
      reaction: payload.reaction,
      emojiKey: payload.emojiId ? `custom:${payload.emojiId}` : (payload.emoji ?? ''),
      userId: payload.userId,
      added: true,
    });
  });

  gateway.on('MESSAGE_REACTION_REMOVE', (payload) => {
    store().applyReaction({
      channelId: payload.channelId,
      messageId: payload.messageId,
      reaction: payload.reaction,
      emojiKey: payload.emojiId ? `custom:${payload.emojiId}` : (payload.emoji ?? ''),
      userId: payload.userId,
      added: false,
    });
  });

  gateway.on('MESSAGE_ACK', (payload) =>
    store().setReadState({
      channelId: payload.channelId,
      lastReadMessageId: payload.lastReadMessageId,
      mentionCount: payload.mentionCount,
    }),
  );

  gateway.on('TYPING_START', ({ channelId, userId }) => store().setTyping(channelId, userId));

  // --- Amizades -----------------------------------------------------------

  gateway.on('RELATIONSHIP_ADD', (relationship) => store().upsertRelationship(relationship));
  gateway.on('RELATIONSHIP_UPDATE', (relationship) => store().upsertRelationship(relationship));
  gateway.on('RELATIONSHIP_REMOVE', ({ id }) => store().removeRelationship(id));

  // --- Voz ----------------------------------------------------------------

  gateway.on('VOICE_STATE_UPDATE', (state) => {
    store().setVoiceState(state);

    // Este aviso sobre a propria pessoa so chega quando um moderador
    // desconectou: a saida por vontade propria nao volta como eco, justamente
    // para nao derrubar a chamada seguinte quando alguem sai e entra rapido.
    const selfId = store().user?.id;
    if (state.userId === selfId && !state.channelId) {
      void voice.leaveByRemote(null);
    }
  });

  gateway.on('VOICE_SERVER_UPDATE', (payload) => {
    void voice.connect(payload);
  });

  gateway.on('VOICE_CHANNEL_EFFECT', ({ guildId, soundId, userId }) => {
    if (userId === store().user?.id) return; // quem tocou ja ouviu localmente
    const guild = store().guilds.get(guildId);
    const sound = guild?.sounds.find((s) => s.id === soundId);
    if (sound) void voice.playSound(sound.url, sound.volume);
  });

  gateway.on('SPEAKING_UPDATE', () => {
    // A deteccao de fala vem do proprio SFU no cliente; este evento existe
    // para bots e integracoes futuras.
  });

  // O indicador de digitacao precisa sumir sozinho.
  const typingTimer = setInterval(() => store().pruneTyping(), 2000);
  window.addEventListener('beforeunload', () => clearInterval(typingTimer));
}

/** Notificacao nativa quando a mensagem merece: mencao ou DM. */
function notifyIfNeeded(message: Message): void {
  const state = useStore.getState();
  const selfId = state.user?.id;
  if (!selfId || message.authorId === selfId) return;

  const channel = state.channels.get(message.channelId);
  const isDm = channel?.type === 'DM' || channel?.type === 'GROUP_DM';
  const mentionsMe = message.mentionedUserIds.includes(selfId);

  const mentionsMyRole = channel?.guildId
    ? (() => {
        const member = state.members.get(`${channel.guildId}:${selfId}`);
        return member?.roleIds.some((id) => message.mentionedRoleIds.includes(id)) ?? false;
      })()
    : false;

  if (!isDm && !mentionsMe && !mentionsMyRole && !message.mentionsEveryone) return;

  // Nao incomoda com o que a pessoa esta olhando agora.
  if (state.selectedChannelId === message.channelId && document.hasFocus()) return;

  const author = state.users.get(message.authorId)?.displayName ?? 'Alguem';
  const where = isDm ? '' : ` em #${channel?.name ?? ''}`;

  const preview = toPlainText(message.content, {
    user: (id) => state.users.get(id)?.displayName,
    channel: (id) => state.channels.get(id)?.name ?? undefined,
    role: (id) => state.roles.get(id)?.name,
  });

  window.kiroshi?.notifications.show(
    `${author}${where}`,
    preview.slice(0, 160) || 'enviou um anexo',
  );
  window.kiroshi?.notifications.flash();
}

import { toPlainText, type Message } from '@kiroshi/shared';
import { useStore } from '../store/index.js';
import { deveNotificar } from '../lib/notificar.js';
import { lerPreferenciasDeNotificacao } from '../lib/preferenciasDeNotificacao.js';
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

    /*
      Sessao nova no meio de uma chamada — a API reiniciou, ou a retomada nao
      deu: o servidor precisa saber que ESTA sessao esta na voz.

      Sem isto, dois defeitos. Depois de um deploy da API (que apaga os estados
      de voz na subida), quem estava na chamada sumia da lista do canal, para
      todos, ate sair e entrar de novo. E quando a sessao era refeita sem
      reinicio, o estado ficava preso a sessao antiga: o "sai" da nova era
      ignorado pelo servidor, e a pessoa ficava no canal como fantasma.

      O token que o servidor devolve e ignorado aqui mesmo (ja conectado neste
      canal, ver voice/entrada.ts): a chamada nao cai nem reconecta.
    */
    const v = voice.getState();
    if (v.connected && v.channelId && !v.saindo) {
      gateway.updateVoiceState({
        guildId: v.guildId,
        channelId: v.channelId,
        selfMute: v.selfMuted,
        selfDeaf: v.selfDeafened,
        selfVideo: v.cameraOn,
        selfStream: v.screenSharing,
      });
    }

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

    // A moderacao sobre mim vale na hora, no microfone e no som.
    if (state.userId === store().user?.id && state.channelId) {
      voice.aplicarModeracao({ silenciado: state.serverMute, ensurdecido: state.serverDeaf });
    }

    // Este aviso sobre a propria pessoa so chega quando um moderador
    // desconectou: a saida por vontade propria nao volta como eco, justamente
    // para nao derrubar a chamada seguinte quando alguem sai e entra rapido.
    const selfId = store().user?.id;
    if (state.userId === selfId && !state.channelId) {
      void voice.leaveByRemote(null, state.leaveReason);
    }
  });

  // Ajustes de notificacao mudados em outro aparelho valem aqui na hora.
  gateway.on('USER_GUILD_SETTINGS_UPDATE', (ajuste) => store().setGuildSettings(ajuste));
  gateway.on('USER_CHANNEL_SETTINGS_UPDATE', (ajuste) => store().setChannelSettings(ajuste));

  // Chamada em DM: quem esta sendo chamado, e quando ela acaba.
  gateway.on('CALL_CREATE', (call) => store().setCall(call));
  gateway.on('CALL_UPDATE', (call) => store().setCall(call));
  gateway.on('CALL_DELETE', ({ channelId }) => store().removeCall(channelId));

  gateway.on('VOICE_SERVER_UPDATE', (payload) => {
    void voice.connect(payload);
  });

  /*
    A voz caiu sozinha e o app desistiu dela: o servidor e avisado, e a
    propria pessoa sai da propria lista. Sem isto ela seguia no canal para
    todos, como fantasma, enquanto o app ficasse aberto. Se o servidor ja
    tinha tirado (moderacao), o aviso nao faz nada: ele so vale para a sessao
    dona do estado de voz.
  */
  voice.aoCairSemQuerer = ({ guildId }) => {
    const v = voice.getState();
    gateway.updateVoiceState({ guildId, channelId: null, selfMute: v.selfMuted, selfDeaf: v.selfDeafened });
    const eu = store().user?.id;
    if (eu) store().removeVoiceState(eu);
  };

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

/*
  A mesma mensagem pode chegar duas vezes: a DM vem pelo aviso da pessoa e pelo
  do canal (defeito conhecido do servidor, 03-servidor.md). Guardar as ultimas
  avisadas evita notificacao dupla.
*/
const avisadas: string[] = [];

/**
 * Notificacao do Windows quando a mensagem merece, pela regra testada em
 * lib/notificar.ts: nivel do servidor e do canal (todas, mencoes, nada),
 * silencio com prazo, Nao perturbe. O clique abre a conversa.
 */
function notifyIfNeeded(message: Message): void {
  const state = useStore.getState();
  const selfId = state.user?.id;
  if (!selfId || avisadas.includes(message.id)) return;

  const channel = state.channels.get(message.channelId);
  const guildId = channel?.guildId ?? null;
  const preferencias = lerPreferenciasDeNotificacao();
  const notificar = deveNotificar({
    mensagem: message,
    euSou: selfId,
    canal: channel ? { guildId } : undefined,
    meusCargos: guildId ? (state.members.get(`${guildId}:${selfId}`)?.roleIds ?? []) : [],
    ajusteDoServidor: guildId ? state.notificacoesDoServidor.get(guildId) : undefined,
    ajusteDoCanal: state.notificacoesDoCanal.get(message.channelId),
    meuStatus: state.presences.get(selfId)?.status ?? 'ONLINE',
    olhandoAConversa: state.selectedChannelId === message.channelId && document.hasFocus(),
    notificacoesLigadas: preferencias.windows,
    agora: Date.now(),
  });
  if (!notificar) return;

  avisadas.push(message.id);
  if (avisadas.length > 200) avisadas.shift();

  const isDm = !guildId;
  const author = state.users.get(message.authorId)?.displayName ?? message.author.displayName ?? 'Alguem';
  const where = isDm ? '' : ` em #${channel?.name ?? ''}`;

  const preview = toPlainText(message.content, {
    user: (id) => state.users.get(id)?.displayName,
    channel: (id) => state.channels.get(id)?.name ?? undefined,
    role: (id) => state.roles.get(id)?.name,
  });

  // O endereco da conversa: o clique na notificacao abre ali (interface nova).
  const alvo = guildId ? `#/s/${guildId}/${message.channelId}` : `#/dm/${message.channelId}`;
  window.kiroshi?.notifications.show(`${author}${where}`, preview.slice(0, 160) || 'enviou um anexo', false, alvo);
  if (preferencias.piscar) window.kiroshi?.notifications.flash();
}

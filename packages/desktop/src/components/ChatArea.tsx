import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { compareIds } from '@kiroshi/shared';
import { api } from '../api/client.js';
import { useStore, selectors, useTypingIn } from '../store/index.js';
import { corteDeNaoLidas, quantasNaoLidas } from '../lib/naoLidas.js';
import { useAnunciarMensagens } from '../hooks/useAnunciarMensagens.js';
import { MessageItem } from './MessageItem.js';
import { Composer } from './Composer.js';
import { Chevron, Hash, Megaphone, Pin, Search, Speaker, Users } from './Icons.js';
import { PinsModal } from './modals/PinsModal.js';
import { SearchModal } from './modals/SearchModal.js';

interface Props {
  channelId: string | null;
  showMembers?: boolean;
  onToggleMembers?: () => void;
  /**
   * Modo coluna estreita, ao lado do palco de video.
   *
   * E a conversa do proprio canal de voz, no lugar onde ficava a lista de
   * membros. Nesse modo o cabecalho encolhe e o botao de membros sai: quem
   * esta na chamada ja aparece no palco, com nome, camera e anel de quem
   * fala, e repetir a lista ao lado seria a mesma informacao duas vezes.
   */
  lateral?: boolean;
}

export function ChatArea({ channelId, showMembers, onToggleMembers, lateral = false }: Props) {
  const channel = useStore((s) => (channelId ? s.channels.get(channelId) : null));
  const messages = useStore((s) => (channelId ? selectors.messagesOf(s, channelId) : null));
  const users = useStore((s) => s.users);
  const typing = useTypingIn(channelId);
  const selfId = useStore((s) => s.user?.id);
  // Os marcadores de leitura vivos, que avancam conforme a leitura acontece.
  const readStates = useStore((s) => s.readStates);

  const setMessages = useStore((s) => s.setMessages);
  const prependMessages = useStore((s) => s.prependMessages);
  const setMessagesLoading = useStore((s) => s.setMessagesLoading);
  const markChannelRead = useStore((s) => s.markChannelRead);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  /** Verdadeiro quando a pessoa esta olhando o fim da conversa. */
  const atBottomRef = useRef(true);

  /*
    O mesmo dado tambem em estado, porque o botao de voltar ao fim precisa
    aparecer e sumir — e uma `ref` nao redesenha nada. A `ref` continua
    existindo: ela e lida dentro de efeitos que rodam antes do proximo render,
    e ali o valor do estado ainda seria o anterior.
  */
  const [noFim, setNoFim] = useState(true);

  /*
    O marcador de leitura CONGELADO na entrada do canal.

    O aplicativo marca o canal como lido cerca de um segundo depois de abrir.
    Se o divisor seguisse o marcador vivo, ele apareceria e sumiria antes de
    ter servido para alguma coisa — que e o mesmo que nao existir.

    Derivar durante o render, com `ref`, em vez de um efeito: com efeito, o
    primeiro render do canal novo sairia com o marcador do canal anterior, e
    o divisor piscaria no lugar errado antes de se corrigir.

    E so congela DEPOIS de as mensagens carregarem. Congelar no primeiro
    render parece equivalente e nao e: ao abrir o aplicativo, este componente
    monta antes de o gateway entregar os estados de leitura, e ali
    `readStates` ainda esta vazio. O marcador virava nulo, o divisor ia para o
    topo e a conversa inteira era anunciada como nao lida — medido com 52
    mensagens, todas ja lidas. Mensagem carregada e o sinal de que a sessao ja
    esta completa; e o mesmo pedido que depende dela.
  */
  const marcador = useRef<{ canal: string | null; id: string | null }>({
    canal: null,
    id: null,
  });
  const listaPronta = Boolean(messages?.loaded);
  if (channelId && listaPronta && marcador.current.canal !== channelId) {
    marcador.current = {
      canal: channelId,
      id: useStore.getState().readStates.get(channelId)?.lastReadMessageId ?? null,
    };
  }
  // Canal trocado e lista ainda chegando: o marcador antigo nao vale mais, e
  // um marcador de outro canal poria o divisor em lugar nenhum.
  const marcadorValido = marcador.current.canal === channelId;

  /**
   * Carrega o historico ao abrir um canal pela primeira vez.
   *
   * O efeito depende so de channelId, de proposito. Se `messages` estivesse
   * nas dependencias, marcar "carregando" mudaria o estado, o efeito rodaria
   * de novo, a limpeza do anterior cancelaria a busca em andamento e a lista
   * ficaria presa no indicador de carregamento para sempre. O estado atual e
   * lido de forma imperativa, que e o certo para um efeito de disparo unico.
   */
  useEffect(() => {
    if (!channelId) return;

    const current = useStore.getState().messages.get(channelId);
    if (current?.loaded || current?.loading) return;

    let cancelled = false;
    setMessagesLoading(channelId, true);

    api
      .get<Message[]>(`/channels/${channelId}/messages?limit=50`)
      .then((items) => {
        if (cancelled) return;
        setMessages(channelId, items, items.length === 50);
      })
      .catch(() => {
        if (cancelled) return;
        setMessages(channelId, [], false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, setMessages, setMessagesLoading]);

  // Rola para o fim quando chega mensagem nova, mas so se a pessoa ja estava
  // no fim: quem subiu para ler algo antigo nao deve ser puxado de volta.
  const lastMessageId = messages?.items[messages.items.length - 1]?.id;
  useEffect(() => {
    if (!atBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lastMessageId, channelId]);

  /*
    Marca como lido quando a conversa esta visivel e no fim.

    `noFim` esta nas dependencias, e isso nao e detalhe. Antes o efeito so
    rodava ao trocar de canal ou ao chegar mensagem nova: quem subia para ler
    o acumulado e descia de volta nao marcava nada como lido, e o aviso de nao
    lidas ficava na tela ate alguem falar de novo. Era invisivel enquanto nao
    havia contador; com o botao dizendo "58 mensagens nao lidas" logo depois
    de a pessoa ter lido as 58, virou mentira na cara dela.

    `document.hasFocus()` continua mandando: janela em segundo plano nao
    significa que alguem leu.
  */
  useEffect(() => {
    if (!channelId || !lastMessageId || !atBottomRef.current) return;
    if (!document.hasFocus()) return;

    const readState = useStore.getState().readStates.get(channelId);
    if (readState?.lastReadMessageId === lastMessageId) return;

    const timer = setTimeout(() => {
      markChannelRead(channelId, lastMessageId);
      void api
        .post(`/channels/${channelId}/ack`, { messageId: lastMessageId })
        .catch(() => undefined);
    }, 700);

    return () => clearTimeout(timer);
  }, [channelId, lastMessageId, markChannelRead, noFim]);

  /*
    Diz em voz alta o que chega, para quem nao esta olhando a tela.

    Fica aqui e nao no `MainScreen` porque depende de QUAL canal esta aberto:
    anunciar mensagem de canal fechado seria ler a conversa inteira do
    servidor para alguem que nao pediu.
  */
  useAnunciarMensagens(channelId, messages?.items, selfId ?? null, (userId) =>
    selectors.displayNameOf(useStore.getState(), userId, channel?.guildId ?? null),
  );

  async function loadOlder(): Promise<void> {
    if (!channelId || !messages || messages.loading || !messages.hasMore) return;
    const oldest = messages.items[0];
    if (!oldest) return;

    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;

    setMessagesLoading(channelId, true);
    try {
      const older = await api.get<Message[]>(
        `/channels/${channelId}/messages?limit=50&before=${oldest.id}`,
      );
      prependMessages(channelId, older, older.length === 50);

      // Mantem a posicao visual: sem isto a lista pula ao inserir no topo.
      requestAnimationFrame(() => {
        if (!element) return;
        element.scrollTop = element.scrollHeight - previousHeight;
      });
    } catch {
      setMessagesLoading(channelId, false);
    }
  }

  function onScroll(): void {
    const element = scrollRef.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const chegou = distanceFromBottom < 80;
    atBottomRef.current = chegou;
    // So redesenha quando cruza a fronteira: `onScroll` dispara dezenas de
    // vezes por segundo, e um `setState` por evento faria a lista inteira
    // renderizar durante a rolagem.
    setNoFim((atual) => (atual === chegou ? atual : chegou));

    if (element.scrollTop < 240) void loadOlder();
  }

  /** Leva ao fim da conversa, que e onde o marcador de leitura avanca. */
  function irParaOFim(): void {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    atBottomRef.current = true;
    setNoFim(true);
  }

  /** Leva ao divisor, que e onde a pessoa parou de ler. */
  function irParaAsNaoLidas(): void {
    const alvo = scrollRef.current?.querySelector('.divisor-nao-lidas');
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else irParaOFim();
  }

  // Onde entra o divisor de nao lidas. A regra mora em `lib/naoLidas.ts`,
  // que e pura: os casos dificeis dela — canal nunca aberto, historico pela
  // metade, so as minhas mensagens sendo novas — sao testaveis sem montar
  // isto aqui nem precisar de duas contas.
  const corte = useMemo(
    () =>
      marcadorValido
        ? corteDeNaoLidas({
            mensagens: messages?.items ?? [],
            ultimaLida: marcador.current.id,
            euSou: selfId ?? null,
            historicoCompleto: Boolean(messages?.loaded && !messages.hasMore),
          })
        : null,
    [messages?.items, messages?.loaded, messages?.hasMore, selfId, channelId, marcadorValido],
  );

  const naoLidas = quantasNaoLidas(messages?.items ?? [], corte, selfId ?? null);

  /*
    O divisor e o BOTAO respondem a perguntas diferentes, e por isso contam
    de pontos diferentes.

    O divisor e historico: mostra onde a pessoa parou da ULTIMA VEZ, e fica
    congelado enquanto o canal esta aberto. Se ele acompanhasse a leitura,
    sumiria um segundo depois de aparecer.

    O botao e uma acao AGORA, e por isso conta do marcador vivo. Medido com as
    duas contagens iguais: a pessoa entrava, lia tudo, subia para reler algo, e
    o botao anunciava "62 mensagens nao lidas" — as 62 que ela tinha acabado de
    ler. Quatro tinham chegado depois; as outras 58 ja estavam lidas.
  */
  const marcadorVivo = channelId
    ? (readStates.get(channelId)?.lastReadMessageId ?? null)
    : null;

  const naoLidasAgora = useMemo(() => {
    const itens = messages?.items ?? [];
    return quantasNaoLidas(
      itens,
      corteDeNaoLidas({
        mensagens: itens,
        ultimaLida: marcadorVivo,
        euSou: selfId ?? null,
        historicoCompleto: Boolean(messages?.loaded && !messages.hasMore),
      }),
      selfId ?? null,
    );
  }, [messages?.items, messages?.loaded, messages?.hasMore, marcadorVivo, selfId]);

  const novidadeAbaixo = naoLidasAgora > 0;

  // Agrupa mensagens seguidas do mesmo autor em um intervalo curto.
  const grouped = useMemo(() => {
    const items = messages?.items ?? [];
    return items.map((message, index) => {
      const previous = items[index - 1];
      const sameAuthor = previous?.authorId === message.authorId;
      const closeInTime =
        previous &&
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
          7 * 60 * 1000;
      const isReply = Boolean(message.reference);

      // A primeira depois do divisor nunca e agrupada: agrupada ela perde o
      // nome e o avatar, e o divisor passaria a separar duas linhas que
      // parecem a mesma fala partida ao meio.
      const abreOBloco = index === corte;

      return {
        message,
        grouped: Boolean(sameAuthor && closeInTime && !isReply) && !abreOBloco,
        divisor: abreOBloco,
      };
    });
  }, [messages?.items, corte]);

  if (!channel) {
    return (
      <div className="chat">
        <div className="empty">
          <div>
            <h3>Nenhuma conversa aberta</h3>
            <p>Escolha um canal na barra lateral para comecar.</p>
          </div>
        </div>
      </div>
    );
  }

  const isVoice = channel.type === 'GUILD_VOICE';
  const Icon = channel.type === 'GUILD_ANNOUNCEMENT' ? Megaphone : isVoice ? Speaker : Hash;

  const typingNames = typing
    .filter((entry) => entry.userId !== selfId)
    .map((entry) => users.get(entry.userId)?.displayName)
    .filter((name): name is string => Boolean(name));

  const channelLabel =
    channel.type === 'DM'
      ? (users.get(channel.recipientIds.find((id) => id !== selfId) ?? '')?.displayName ??
        'Conversa')
      : (channel.name ?? 'Conversa');

  return (
    <div className={lateral ? 'chat chat-lateral' : 'chat'}>
      <header className="chat-head">
        {/*
          Na coluna estreita nao ha titulo aqui.

          Quem da o titulo e a borda e o `ContextPanel` que envolve esta
          coluna, e ele ja escreve "Conversa da chamada" no proprio cabecalho.
          Repetir era o que acontecia na primeira montagem: dois titulos
          identicos, um debaixo do outro, gastando duas faixas de altura da
          conversa. Sobram as acoes, que o painel nao tem como fornecer — o
          estado dos dialogos de busca e de fixadas mora aqui dentro.
        */}
        {!lateral && channel.guildId && <Icon size={20} className="channel-icon" />}
        {!lateral && <span className="chat-title">{channelLabel}</span>}
        {channel.topic && !lateral && <span className="chat-topic">{channel.topic}</span>}

        <div className="chat-actions">
          <button
            className="act"
            onClick={() => setShowPins(true)}
            title="Mensagens fixadas"
            aria-label="Mensagens fixadas"
          >
            <Pin size={18} />
          </button>
          <button
            className="act"
            onClick={() => setShowSearch(true)}
            title="Buscar"
            aria-label="Buscar"
          >
            <Search size={18} />
          </button>
          {/* O botao de membros nao existe na coluna estreita: ali nao ha
              lista de membros para mostrar nem esconder. */}
          {channel.guildId && !lateral && onToggleMembers && (
            <button
              className={`act ${showMembers ? 'active' : ''}`}
              onClick={onToggleMembers}
              title="Lista de membros"
              aria-label="Lista de membros"
            >
              <Users size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {messages?.loading && messages.items.length === 0 && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        )}

        {!messages?.hasMore && messages?.loaded && (
          <div className="messages-intro">
            <h2>{channel.guildId ? `Bem-vindo a #${channel.name}` : channelLabel}</h2>
            <p>
              {channel.guildId
                ? 'Este e o comeco deste canal.'
                : 'Este e o comeco da conversa de voces.'}
            </p>
          </div>
        )}

        {messages?.loading && messages.items.length > 0 && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 12 }}>
            <div className="spinner" />
          </div>
        )}

        {grouped.map(({ message, grouped: isGrouped, divisor }) => (
          <Fragment key={message.id}>
            {/*
              O divisor leva TEXTO, e nao so uma linha vermelha.

              Uma linha sozinha no meio da conversa e um enfeite ambiguo: pode
              ser separador de dia, de assunto, ou defeito de desenho. O rotulo
              diz o que ela e, e o numero diz quanto falta ler.
            */}
            {divisor && (
              <div className="divisor-nao-lidas" role="separator">
                <span className="divisor-rotulo">
                  {naoLidas === 1 ? '1 mensagem nao lida' : `${naoLidas} mensagens nao lidas`}
                </span>
              </div>
            )}
            <MessageItem
              message={message}
              grouped={isGrouped}
              guildId={channel.guildId}
              onReply={() => setReplyTo(message)}
            />
          </Fragment>
        ))}
      </div>

      {/*
        O atalho de volta ao fim, que so existe quando se saiu dele.

        Dois rotulos, e a diferenca importa: "Novas mensagens" leva ao ponto
        em que a pessoa parou de ler, "Ir para o fim" leva ao presente. Um
        botao so, que sempre desce tudo, faria quem subiu para reler algo
        perder o lugar sem aviso.
      */}
      {!noFim && (
        <button
          className={`voltar-ao-fim ${novidadeAbaixo ? 'com-novidade' : ''}`}
          onClick={novidadeAbaixo ? irParaAsNaoLidas : irParaOFim}
        >
          <span>
            {novidadeAbaixo
              ? naoLidasAgora === 1
                ? '1 mensagem nao lida'
                : `${naoLidasAgora} mensagens nao lidas`
              : 'Ir para o fim'}
          </span>
          <Chevron size={14} />
        </button>
      )}

      <div className="composer-wrap">
        <Composer
          channelId={channel.id}
          channelName={channelLabel}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={() => {
            setReplyTo(null);
            atBottomRef.current = true;
          }}
        />

        {typingNames.length > 0 && (
          <div className="typing">
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
            <span>{describeTyping(typingNames)}</span>
          </div>
        )}
      </div>

      {showPins && <PinsModal channelId={channel.id} onClose={() => setShowPins(false)} />}
      {showSearch && (
        <SearchModal
          channelId={channel.id}
          guildId={channel.guildId}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

function describeTyping(names: string[]): string {
  if (names.length === 1) return `${names[0]} esta digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estao digitando...`;
  if (names.length === 3) return `${names[0]}, ${names[1]} e ${names[2]} estao digitando...`;
  return 'Varias pessoas estao digitando...';
}

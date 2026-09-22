import { useState } from 'react';
import type { Attachment, Message } from '@kiroshi/shared';
import { api, ApiRequestError } from '../api/client.js';
import { useStore, selectors } from '../store/index.js';
import { Avatar } from './Avatar.js';
import { MessageContent } from './MessageContent.js';
import { diaDaMensagem } from '../lib/tempo.js';
import { Download, Edit, File, Pin, Reply, Smile, Trash } from './Icons.js';
import { EmojiPicker } from './EmojiPicker.js';
import { Lightbox } from './ui/Lightbox.js';

interface Props {
  message: Message;
  grouped: boolean;
  guildId: string | null;
  onReply: () => void;
}

export function MessageItem({ message, grouped, guildId, onReply }: Props) {
  const state = useStore();
  const selfId = useStore((s) => s.user?.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [fixando, setFixando] = useState(false);
  const [avisoDeFixar, setAvisoDeFixar] = useState<string | null>(null);
  const updateMessage = useStore((s) => s.updateMessage);

  const isAuthor = message.authorId === selfId;
  const name = selectors.displayNameOf(state, message.authorId, guildId);
  const color = selectors.colorOf(state, message.authorId, guildId);

  const mentionsMe = Boolean(
    selfId &&
    (message.mentionedUserIds.includes(selfId) ||
      message.mentionsEveryone ||
      (guildId &&
        state.members
          .get(`${guildId}:${selfId}`)
          ?.roleIds.some((id) => message.mentionedRoleIds.includes(id)))),
  );

  async function saveEdit(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      return;
    }
    await api
      .patch(`/channels/${message.channelId}/messages/${message.id}`, { content: trimmed })
      .catch(() => undefined);
    setEditing(false);
  }

  async function remove(): Promise<void> {
    await api
      .delete(`/channels/${message.channelId}/messages/${message.id}`)
      .catch(() => undefined);
  }

  async function toggleReaction(emoji: string, mine: boolean): Promise<void> {
    const path = `/channels/${message.channelId}/messages/${message.id}/reactions`;
    if (mine) {
      await api.delete(`${path}?emoji=${encodeURIComponent(emoji)}`).catch(() => undefined);
    } else {
      await api.put(path, { emoji }).catch(() => undefined);
    }
  }

  /**
   * Fixa ou desafixa, e mostra o resultado.
   *
   * A versao anterior fazia `.catch(() => undefined)` e nada mais. O servidor
   * fixava de verdade, mas o cliente nunca ficava sabendo: nao ha evento que
   * diga "esta mensagem agora esta fixada", so um aviso de que a lista do
   * canal mudou. Sem indicacao na tela e sem erro visivel, clicar em fixar era
   * indistinguivel de um botao morto.
   *
   * Por isso o estado local e atualizado aqui mesmo, e a falha aparece.
   */
  async function alternarFixado(): Promise<void> {
    const alvo = !message.pinned;
    setFixando(true);
    setAvisoDeFixar(null);
    try {
      const rota = `/channels/${message.channelId}/pins/${message.id}`;
      if (alvo) await api.put(rota);
      else await api.delete(rota);
      updateMessage({ ...message, pinned: alvo });
    } catch (err) {
      setAvisoDeFixar(
        err instanceof ApiRequestError
          ? err.message
          : `Nao consegui ${alvo ? 'fixar' : 'desafixar'} a mensagem.`,
      );
      setTimeout(() => setAvisoDeFixar(null), 6000);
    } finally {
      setFixando(false);
    }
  }

  return (
    <>
      <div
        className={[
          'msg',
          grouped ? 'grouped' : 'first',
          mentionsMe ? 'mentioned' : '',
          message.pinned ? 'pinned' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/*
          A calha e um CARIMBO DE HORA, nao um lugar para o avatar.

          Antes era o desenho de rede social: avatar grande a esquerda, nome em
          negrito por cima do texto, hora escondida ate passar o mouse. Custava
          36px de largura em toda mensagem e escondia a unica informacao da
          calha que serve para navegar — quando a coisa foi dita.

          Agora a hora fica sempre visivel em monoespacada, e a mensagem le
          como transcricao de transmissao: da para varrer a coluna da esquerda
          procurando um momento, que e o que se faz quando alguem pergunta "o
          que rolou de manha". Numa sequencia da mesma pessoa a hora continua
          ali, so mais apagada, porque saber que passaram vinte minutos entre
          duas linhas do mesmo sujeito e informacao.

          O rosto nao sumiu do aplicativo: ele continua na lista de presenca, no
          cartao de perfil, no palco da chamada e, pequeno, na etiqueta do autor
          aqui embaixo. O que sumiu foi a coluna dele.
        */}
        <div className="msg-gutter">
          {/*
            `time` com `dateTime`, e nao um `span` decorativo.

            A primeira versao disto levava `aria-hidden`, por reflexo de que
            calha e enfeite. Estava errado: numa mensagem agrupada o carimbo e
            a UNICA pista de quando aquilo foi dito, e escondendo-o o leitor de
            tela ficaria pior do que estava antes — no desenho antigo a hora ao
            menos vivia no cabecalho de cada bloco.

            O elemento certo carrega o carimbo legivel por maquina no atributo,
            enquanto a tela mostra so hora e minuto.
          */}
          <time className="msg-carimbo" dateTime={message.createdAt}>
            {shortTime(message.createdAt)}
          </time>
        </div>

        <div className="msg-body">
          {message.referencedMessage && (
            <div className="msg-reply">
              <Avatar
                url={message.referencedMessage.author.avatarUrl}
                name={message.referencedMessage.author.displayName}
                size={16}
              />
              <span className="msg-reply-author">
                {selectors.displayNameOf(state, message.referencedMessage.authorId, guildId)}
              </span>
              <span className="msg-reply-preview">
                {message.referencedMessage.content || 'clique para ver o anexo'}
              </span>
            </div>
          )}

          {/* A marca aparece mesmo em mensagem agrupada, que nao tem cabecalho:
              senao uma mensagem fixada no meio de uma sequencia ficaria sem
              nenhum sinal. */}
          {message.pinned && (
            <div className="msg-pinned">
              <Pin size={11} />
              <span>Fixada</span>
            </div>
          )}

          {!grouped && (
            <div className="msg-head">
              {/*
                O avatar virou uma ficha pequena ao lado do nome, em vez de uma
                coluna propria. Reconhecer quem falou continua possivel de
                relance, e o custo cai de 36px de largura em toda mensagem para
                18px em uma linha a cada bloco.
              */}
              <Avatar
                url={state.users.get(message.authorId)?.avatarUrl}
                name={name}
                size={18}
                className="msg-ficha"
              />
              <span className="msg-author" style={color ? { color } : undefined}>
                {name}
              </span>
              {/*
                A hora cheia nao volta aqui: a calha ja carrega o horario. Duas
                copias do mesmo dado na mesma linha e ruido, e foi por isso que
                a hora antiga so aparecia ao passar o mouse — ela disputava com
                o nome. Agora quem quiser a data completa tem o `title`.
              */}
              <span className="msg-time" title={fullTime(message.createdAt)}>
                {diaDaMensagem(message.createdAt)}
              </span>
            </div>
          )}

          {avisoDeFixar && <div className="msg-aviso">{avisoDeFixar}</div>}

          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === 'Escape') {
                    setDraft(message.content);
                    setEditing(false);
                  }
                }}
                autoFocus
                rows={Math.min(8, draft.split('\n').length)}
                style={{ background: 'var(--raised)', resize: 'vertical' }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
                Enter para salvar, Esc para cancelar
              </div>
            </div>
          ) : (
            <>
              <MessageContent content={message.content} guildId={guildId} />
              {message.editedAt && <span className="msg-edited"> (editada)</span>}
            </>
          )}

          {message.attachments.length > 0 && (
            <div className="attachments">
              {message.attachments.map((attachment) => (
                <AttachmentView
                  key={attachment.id}
                  attachment={attachment}
                  onOpen={() => setLightbox(attachment)}
                />
              ))}
            </div>
          )}

          {message.embeds.map((embed, index) => (
            <a
              key={index}
              className="embed"
              href={embed.url ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
              style={embed.color ? { borderLeftColor: embed.color } : undefined}
            >
              <div className="embed-body">
                {embed.siteName && <div className="embed-site">{embed.siteName}</div>}
                {embed.title && <div className="embed-title">{embed.title}</div>}
                {embed.description && <div className="embed-desc">{embed.description}</div>}
                {embed.type === 'image' && embed.imageUrl && (
                  <img className="embed-image" src={embed.imageUrl} alt="" loading="lazy" />
                )}
              </div>
              {embed.type !== 'image' && embed.thumbnailUrl && (
                <img className="embed-thumb" src={embed.thumbnailUrl} alt="" loading="lazy" />
              )}
            </a>
          ))}

          {message.reactions.length > 0 && (
            <div className="reactions">
              {message.reactions.map((reaction) => {
                const key = reaction.emojiId ? `custom:${reaction.emojiId}` : reaction.emoji;
                const customUrl = reaction.emojiId
                  ? [...state.guilds.values()]
                      .flatMap((g) => g.emojis)
                      .find((e) => e.id === reaction.emojiId)?.url
                  : null;

                return (
                  <button
                    key={key}
                    className={`reaction ${reaction.me ? 'mine' : ''}`}
                    onClick={() =>
                      reaction.emoji && void toggleReaction(reaction.emoji, reaction.me)
                    }
                    title={reaction.userIds
                      .map((id) => selectors.displayNameOf(state, id, guildId))
                      .join(', ')}
                  >
                    {customUrl ? (
                      <img src={customUrl} alt={reaction.emojiName ?? ''} />
                    ) : (
                      <span>{reaction.emoji}</span>
                    )}
                    <span>{reaction.count}</span>
                  </button>
                );
              })}
              <button
                className="reaction reaction-add"
                onClick={() => setPickingEmoji(true)}
                title="Adicionar reacao"
                aria-label="Adicionar reacao"
              >
                <Smile size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="msg-actions">
          <button
            className="msg-action"
            onClick={() => setPickingEmoji(true)}
            title="Reagir"
            aria-label="Reagir"
          >
            <Smile size={16} />
          </button>
          <button className="msg-action" onClick={onReply} title="Responder" aria-label="Responder">
            <Reply size={16} />
          </button>
          {isAuthor && (
            <button
              className="msg-action"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              title="Editar"
              aria-label="Editar"
            >
              <Edit size={16} />
            </button>
          )}
          <button
            className={`msg-action ${message.pinned ? 'on' : ''}`}
            onClick={() => void alternarFixado()}
            disabled={fixando}
            title={message.pinned ? 'Desafixar' : 'Fixar'}
            aria-label={message.pinned ? 'Desafixar' : 'Fixar'}
          >
            <Pin size={16} />
          </button>
          {isAuthor && (
            <button
              className="msg-action danger"
              onClick={() => void remove()}
              title="Apagar"
              aria-label="Apagar"
            >
              <Trash size={16} />
            </button>
          )}
        </div>

        {pickingEmoji && (
          <EmojiPicker
            guildId={guildId}
            onPick={(emoji) => {
              setPickingEmoji(false);
              void toggleReaction(emoji, false);
            }}
            onClose={() => setPickingEmoji(false)}
          />
        )}
      </div>

      {lightbox && (
        <Lightbox url={lightbox.url} nome={lightbox.filename} aoFechar={() => setLightbox(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function AttachmentView({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const type = attachment.contentType ?? '';

  if (type.startsWith('image/')) {
    return (
      <img
        className="att-image"
        src={attachment.url}
        alt={attachment.filename}
        loading="lazy"
        width={attachment.width ?? undefined}
        height={attachment.height ?? undefined}
        onClick={onOpen}
        style={
          attachment.placeholder
            ? { backgroundImage: `url(${attachment.placeholder})`, backgroundSize: 'cover' }
            : undefined
        }
      />
    );
  }

  if (type.startsWith('video/')) {
    return <video className="att-video" src={attachment.url} controls preload="metadata" />;
  }

  if (type.startsWith('audio/')) {
    return <audio src={attachment.url} controls preload="metadata" style={{ maxWidth: 420 }} />;
  }

  return (
    <div className="att-file">
      <File size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <a className="att-name" href={attachment.url} target="_blank" rel="noreferrer noopener">
          {attachment.filename}
        </a>
        <div className="att-size">{formatBytes(attachment.size)}</div>
      </div>
      <a
        className="act"
        href={attachment.url}
        download={attachment.filename}
        title="Baixar"
        aria-label="Baixar"
      >
        <Download size={18} />
      </a>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fullTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `hoje as ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `ontem as ${time}`;

  return `${date.toLocaleDateString('pt-BR')} ${time}`;
}

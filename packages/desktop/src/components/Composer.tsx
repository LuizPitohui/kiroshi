import { useEffect, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { LIMITS, generateId } from '@kiroshi/shared';
import { api, ApiRequestError } from '../api/client.js';
import { gateway } from '../api/gateway.js';
import { useStore, selectors } from '../store/index.js';
import { aplicarEnvio, deveEnviar, type ModoDeEnvio } from '../lib/leitura.js';
import { Close, Paperclip, Smile } from './Icons.js';
import { EmojiPicker } from './EmojiPicker.js';

interface Props {
  channelId: string;
  channelName: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSent: () => void;
}

interface PendingAttachment {
  localId: string;
  file: File;
  previewUrl: string | null;
  progress: number;
  uploadedId: string | null;
  error: string | null;
}

export function Composer({ channelId, channelName, replyTo, onCancelReply, onSent }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickingEmoji, setPickingEmoji] = useState(false);

  /*
    O que a tecla Enter faz aqui.

    Fica em estado, e nao lido direto do armazenamento na hora da tecla, por
    causa do aviso: mudar a preferencia nos ajustes precisa valer no campo que
    ja esta aberto. Sem isso a pessoa trocava a opcao, voltava, testava no
    mesmo canal e concluia que nao funcionava.
  */
  const [modoDeEnvio, setModoDeEnvio] = useState<ModoDeEnvio>(aplicarEnvio.ler);

  useEffect(() => {
    const aoMudar = (e: Event): void => {
      setModoDeEnvio((e as CustomEvent<ModoDeEnvio>).detail);
    };
    window.addEventListener('kiroshi:envio', aoMudar);
    return () => window.removeEventListener('kiroshi:envio', aoMudar);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);

  const store = useStore();
  const addMessage = useStore((s) => s.addMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const selfUser = useStore((s) => s.user);

  // Rascunho por canal: trocar de canal e voltar nao pode perder o que a
  // pessoa escreveu.
  useEffect(() => {
    setText(sessionStorage.getItem(`kiroshi.draft.${channelId}`) ?? '');
    setAttachments([]);
    setError(null);
  }, [channelId]);

  useEffect(() => {
    if (text) sessionStorage.setItem(`kiroshi.draft.${channelId}`, text);
    else sessionStorage.removeItem(`kiroshi.draft.${channelId}`);
  }, [text, channelId]);

  // A altura acompanha o conteudo ate um limite.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 340)}px`;
  }, [text]);

  // Abrir o canal ja deixa o cursor pronto para escrever.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [channelId, replyTo]);

  function signalTyping(): void {
    const now = Date.now();
    if (now - lastTypingRef.current < 4000) return;
    lastTypingRef.current = now;
    gateway.sendTyping(channelId);
  }

  function addFiles(files: FileList | File[]): void {
    const incoming = [...files];
    const room = LIMITS.attachmentsPerMessage - attachments.length;

    if (incoming.length > room) {
      setError(`No maximo ${LIMITS.attachmentsPerMessage} arquivos por mensagem.`);
    }

    for (const file of incoming.slice(0, Math.max(0, room))) {
      if (file.size > LIMITS.attachmentBytes) {
        setError(`${file.name} passa de ${LIMITS.attachmentBytes / 1024 / 1024} MB.`);
        continue;
      }

      const pending: PendingAttachment = {
        localId: generateId(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        progress: 0,
        uploadedId: null,
        error: null,
      };

      setAttachments((current) => [...current, pending]);

      // O envio comeca na hora: quando a pessoa apertar Enter, o arquivo ja
      // esta no servidor e a mensagem sai instantaneamente.
      void api
        .upload(file, (fraction) => {
          setAttachments((current) =>
            current.map((a) => (a.localId === pending.localId ? { ...a, progress: fraction } : a)),
          );
        })
        .then((stored) => {
          setAttachments((current) =>
            current.map((a) =>
              a.localId === pending.localId ? { ...a, uploadedId: stored.id, progress: 1 } : a,
            ),
          );
        })
        .catch((err: unknown) => {
          const message =
            err instanceof ApiRequestError ? err.message : 'Falha ao enviar o arquivo.';
          setAttachments((current) =>
            current.map((a) => (a.localId === pending.localId ? { ...a, error: message } : a)),
          );
        });
    }
  }

  function removeAttachment(localId: string): void {
    setAttachments((current) => {
      const target = current.find((a) => a.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((a) => a.localId !== localId);
    });
  }

  async function send(): Promise<void> {
    const content = text.trim();
    const ready = attachments.filter((a) => a.uploadedId).map((a) => a.uploadedId!);

    if (!content && ready.length === 0) return;
    if (attachments.some((a) => !a.uploadedId && !a.error)) {
      setError('Espere os arquivos terminarem de enviar.');
      return;
    }

    const nonce = generateId();

    /*
      Mensagem otimista: aparece na hora e some quando a de verdade chega, pelo
      nonce.

      O id e um snowflake de verdade, nao `temp-<nonce>`. O prefixo parecia
      inofensivo e quebrava a conversa inteira: a lista e ordenada comparando
      ids como numero, e um id com letras estourava na comparacao. A excecao
      subia por `addMessage` e abortava o envio antes da requisicao sair —
      sem mensagem, sem erro, sem pista. Num canal vazio nao havia com quem
      comparar, entao a primeira mensagem passava e todas as seguintes
      falhavam em silencio.

      Gerado agora, o snowflake tambem ordena no lugar certo: depois de tudo
      que ja existe.
    */
    const idOtimista = generateId();
    if (selfUser) {
      addMessage({
        id: idOtimista,
        channelId,
        guildId: store.channels.get(channelId)?.guildId ?? null,
        authorId: selfUser.id,
        author: selfUser,
        content,
        type: replyTo ? 'REPLY' : 'DEFAULT',
        attachments: [],
        embeds: [],
        reactions: [],
        mentionedUserIds: [],
        mentionedRoleIds: [],
        mentionsEveryone: false,
        reference: replyTo
          ? { messageId: replyTo.id, channelId, guildId: replyTo.guildId }
          : null,
        referencedMessage: replyTo,
        pinned: false,
        editedAt: null,
        createdAt: new Date().toISOString(),
        nonce,
      });
    }

    setText('');
    setAttachments([]);
    setError(null);
    onSent();

    try {
      await api.post(`/channels/${channelId}/messages`, {
        content,
        ...(ready.length > 0 ? { attachmentIds: ready } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        nonce,
      });
    } catch (err) {
      // O envio falhou: tira a mensagem otimista e devolve o texto para a
      // pessoa, senao ela perderia o que escreveu.
      deleteMessage(channelId, idOtimista);
      setText(content);
      setError(
        err instanceof ApiRequestError ? err.message : 'Nao consegui enviar. Tente de novo.',
      );
    }
  }

  /**
   * Chama o envio sem deixar falha nenhuma escapar.
   *
   * O `send` roda a partir de um `onKeyDown`, que nao espera promessa: o
   * `void` na chamada descartava qualquer erro lancado fora do try interno.
   * Foi assim que uma excecao na montagem da mensagem virou "aperto Enter e
   * nao acontece nada" — o pior tipo de defeito, porque nao deixa rastro nem
   * para quem usa nem para quem mantem.
   */
  function enviarComSeguranca(): void {
    void send().catch((err: unknown) => {
      console.error('falha inesperada ao enviar', err);
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Algo deu errado ao enviar. O texto continua aqui; tente de novo.',
      );
    });
  }

  const replyAuthor = replyTo
    ? selectors.displayNameOf(store, replyTo.authorId, replyTo.guildId)
    : null;

  return (
    <>
      {replyTo && (
        <div className="composer-reply">
          <span>
            Respondendo a <strong style={{ color: 'var(--text-dim)' }}>{replyAuthor}</strong>
          </span>
          <button
            className="act"
            style={{ width: 24, height: 24, marginLeft: 'auto' }}
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
          >
            <Close size={14} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="composer-atts">
          {attachments.map((attachment) => (
            <div className="composer-att" key={attachment.localId}>
              {attachment.previewUrl ? (
                <img src={attachment.previewUrl} alt="" />
              ) : (
                <span style={{ padding: 6, wordBreak: 'break-all' }}>{attachment.file.name}</span>
              )}
              <button
                className="composer-att-x"
                onClick={() => removeAttachment(attachment.localId)}
                aria-label="Remover anexo"
              >
                <Close size={12} />
              </button>
              {!attachment.uploadedId && !attachment.error && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.55)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                  }}
                >
                  {Math.round(attachment.progress * 100)}%
                </div>
              )}
              {attachment.error && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(237,66,69,0.7)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    padding: 4,
                  }}
                >
                  falhou
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--red)',
            padding: '6px 16px',
            background: 'var(--raised)',
          }}
        >
          {error}
        </div>
      )}

      <div
        className={`composer ${replyTo || attachments.length > 0 ? 'with-reply' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
      >
        <button
          className="composer-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <Paperclip size={20} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/*
          O sinal de entrada, logo a esquerda de onde se escreve.

          Nao e enfeite de terminal. A conversa acima virou log — coluna de
          horario, regua vertical, autor em etiqueta — e o compositor continuava
          uma caixa flutuante com borda dos quatro lados, o desenho de campo de
          formulario. Duas linguagens na mesma tela, e a de baixo dizendo
          "aqui comeca outra coisa" bem no lugar onde a pessoa continua a mesma
          conversa.

          Com o sinal e a regra em cima, a caixa vira a ULTIMA LINHA do log: o
          lugar de onde sai a proxima. O olho desce da ultima mensagem para o
          ponto de escrita sem atravessar uma borda no meio.
        */}
        <span className="composer-sinal" aria-hidden="true">
          ▸
        </span>

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          placeholder={`Conversar em ${channelName}`}
          maxLength={LIMITS.messageContent.max}
          onChange={(e) => {
            setText(e.target.value);
            signalTyping();
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            // A regra mora em `lib/leitura.ts`, que e pura. E a regra que
            // decide se uma mensagem sai ou nao: errar nela manda texto pela
            // metade ou faz a tecla nao fazer nada, e os dois defeitos sao
            // caros de descobrir usando.
            if (deveEnviar(e, modoDeEnvio)) {
              e.preventDefault();
              enviarComSeguranca();
              return;
            }
            if (e.key === 'Escape' && replyTo) onCancelReply();
          }}
        />

        <button
          className="composer-btn"
          onClick={() => setPickingEmoji((v) => !v)}
          title="Emoji"
          aria-label="Emoji"
        >
          <Smile size={20} />
        </button>

        {pickingEmoji && (
          <EmojiPicker
            guildId={store.channels.get(channelId)?.guildId ?? null}
            onPick={(emoji) => {
              setText((current) => current + emoji);
              setPickingEmoji(false);
              textareaRef.current?.focus();
            }}
            onClose={() => setPickingEmoji(false)}
          />
        )}
      </div>
    </>
  );
}

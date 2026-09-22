import { Fragment, useState, type ReactNode } from 'react';
import { isOnlyEmojis } from '@kiroshi/shared';
import { useStore } from '../store/index.js';

/**
 * Renderizador de markdown das mensagens.
 *
 * E um subconjunto proposital: negrito, italico, riscado, sublinhado, codigo,
 * bloco de codigo, citacao, spoiler, mencoes, emojis customizados e links.
 * Nada de HTML cru — o texto e sempre tratado como texto, e a arvore e montada
 * com elementos React, entao nao existe caminho para injecao.
 */

interface Props {
  content: string;
  guildId: string | null;
  /** Ids mencionados, para destacar quando for o proprio usuario. */
  className?: string;
}

const CUSTOM_EMOJI = /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,20})>/;
const USER_MENTION = /<@(\d{1,20})>/;
const ROLE_MENTION = /<@&(\d{1,20})>/;
const CHANNEL_MENTION = /<#(\d{1,20})>/;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/;

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`spoiler ${revealed ? 'revealed' : ''}`}
      onClick={() => setRevealed(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setRevealed(true);
      }}
    >
      {children}
    </span>
  );
}

/**
 * Formatacao inline, aplicada em ordem de precedencia. Cada nivel quebra o
 * texto e chama o proximo nos pedacos, o que permite aninhar negrito dentro
 * de citacao, link dentro de negrito, e assim por diante.
 */
function renderInline(text: string, guildId: string | null, key = 0): ReactNode[] {
  const nodes: ReactNode[] = [];

  // Codigo inline vem primeiro: nada dentro dele deve ser interpretado.
  const codeSplit = text.split(/(`[^`\n]+`)/g);

  codeSplit.forEach((chunk, chunkIndex) => {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
      nodes.push(<code key={`c${key}-${chunkIndex}`}>{chunk.slice(1, -1)}</code>);
      return;
    }
    nodes.push(...renderFormatting(chunk, guildId, `${key}-${chunkIndex}`));
  });

  return nodes;
}

function renderFormatting(text: string, guildId: string | null, key: string): ReactNode[] {
  const patterns: { regex: RegExp; render: (inner: string, k: string) => ReactNode }[] = [
    { regex: /\|\|([\s\S]+?)\|\|/, render: (inner, k) => <Spoiler key={k}>{renderInline(inner, guildId)}</Spoiler> },
    { regex: /\*\*\*([\s\S]+?)\*\*\*/, render: (inner, k) => <strong key={k}><em>{renderInline(inner, guildId)}</em></strong> },
    { regex: /\*\*([\s\S]+?)\*\*/, render: (inner, k) => <strong key={k}>{renderInline(inner, guildId)}</strong> },
    { regex: /__([\s\S]+?)__/, render: (inner, k) => <u key={k}>{renderInline(inner, guildId)}</u> },
    { regex: /~~([\s\S]+?)~~/, render: (inner, k) => <s key={k}>{renderInline(inner, guildId)}</s> },
    { regex: /\*([^*\n]+?)\*/, render: (inner, k) => <em key={k}>{renderInline(inner, guildId)}</em> },
    { regex: /_([^_\n]+?)_/, render: (inner, k) => <em key={k}>{renderInline(inner, guildId)}</em> },
  ];

  for (const { regex, render } of patterns) {
    const match = regex.exec(text);
    if (!match) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);

    return [
      ...renderFormatting(before, guildId, `${key}b`),
      render(match[1] ?? '', `${key}m`),
      ...renderFormatting(after, guildId, `${key}a`),
    ];
  }

  return renderEntities(text, guildId, key);
}

/** Mencoes, emojis customizados e links: as folhas da arvore. */
function renderEntities(text: string, guildId: string | null, key: string): ReactNode[] {
  if (!text) return [];

  const state = useStore.getState();

  const combined = new RegExp(
    [
      CUSTOM_EMOJI.source,
      USER_MENTION.source,
      ROLE_MENTION.source,
      CHANNEL_MENTION.source,
      URL_PATTERN.source,
    ].join('|'),
    'g',
  );

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const nodeKey = `${key}e${index++}`;

    const token = match[0];

    // Emoji customizado: <:nome:id> ou <a:nome:id>
    const emojiMatch = CUSTOM_EMOJI.exec(token);
    if (emojiMatch) {
      const [, , name, id] = emojiMatch;
      const emoji = guildId
        ? state.guilds.get(guildId)?.emojis.find((e) => e.id === id)
        : undefined;
      const url =
        emoji?.url ??
        [...state.guilds.values()].flatMap((g) => g.emojis).find((e) => e.id === id)?.url;

      nodes.push(
        url ? (
          <img key={nodeKey} className="custom-emoji" src={url} alt={`:${name}:`} title={`:${name}:`} />
        ) : (
          <span key={nodeKey}>{`:${name}:`}</span>
        ),
      );
      continue;
    }

    const userMatch = USER_MENTION.exec(token);
    if (userMatch) {
      const id = userMatch[1]!;
      const name = state.users.get(id)?.displayName ?? 'desconhecido';
      nodes.push(
        <span key={nodeKey} className="mention">
          @{guildId ? (state.members.get(`${guildId}:${id}`)?.nickname ?? name) : name}
        </span>,
      );
      continue;
    }

    const roleMatch = ROLE_MENTION.exec(token);
    if (roleMatch) {
      const role = state.roles.get(roleMatch[1]!);
      nodes.push(
        <span
          key={nodeKey}
          className="mention"
          style={role?.color ? { color: role.color, background: `${role.color}22` } : undefined}
        >
          @{role?.name ?? 'cargo'}
        </span>,
      );
      continue;
    }

    const channelMatch = CHANNEL_MENTION.exec(token);
    if (channelMatch) {
      const id = channelMatch[1]!;
      const channel = state.channels.get(id);
      nodes.push(
        /*
          Botao, e nao um `span` com `onClick`.

          Uma mencao de canal LEVA a algum lugar: e navegacao. Como `span` ela
          nao entrava na ordem de tabulacao, entao quem le a conversa sem
          mouse via o "#geral" destacado em azul e nao tinha como segui-lo —
          o destaque prometia uma acao que nao existia para aquela pessoa.
        */
        <button
          key={nodeKey}
          type="button"
          className="mention"
          onClick={() => channel && state.selectChannel(id)}
          disabled={!channel}
        >
          #{channel?.name ?? 'canal'}
        </button>,
      );
      continue;
    }

    // Sobra: e um link.
    nodes.push(
      <a key={nodeKey} href={token} target="_blank" rel="noreferrer noopener">
        {token}
      </a>,
    );
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MessageContent({ content, guildId, className = '' }: Props) {
  if (!content) return null;

  const onlyEmoji = isOnlyEmojis(content);

  // Blocos de codigo sao tratados antes de tudo, inclusive das quebras de linha.
  const blocks = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`msg-text ${onlyEmoji ? 'big-emoji' : ''} ${className}`}>
      {blocks.map((block, blockIndex) => {
        if (block.startsWith('```') && block.endsWith('```') && block.length > 5) {
          const inner = block.slice(3, -3);
          // A primeira linha pode ser o nome da linguagem.
          const newline = inner.indexOf('\n');
          const firstLine = newline === -1 ? '' : inner.slice(0, newline);
          const isLanguage = /^[a-zA-Z0-9+#-]{1,20}$/.test(firstLine.trim());
          const code = isLanguage ? inner.slice(newline + 1) : inner;

          return (
            <pre key={blockIndex}>
              <code>{code.replace(/\n$/, '')}</code>
            </pre>
          );
        }

        // Citacao vale por linha.
        return (
          <Fragment key={blockIndex}>
            {block.split('\n').map((line, lineIndex, lines) => {
              const quoted = line.startsWith('> ');
              const body = quoted ? line.slice(2) : line;

              return (
                <Fragment key={lineIndex}>
                  {quoted ? (
                    <blockquote>{renderInline(body, guildId, lineIndex)}</blockquote>
                  ) : (
                    renderInline(body, guildId, lineIndex)
                  )}
                  {lineIndex < lines.length - 1 && !quoted && '\n'}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

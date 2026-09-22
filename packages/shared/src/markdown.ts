/**
 * Utilitarios de texto usados pelas duas pontas: o servidor precisa extrair
 * mencoes para gravar no banco e disparar notificacao, o cliente precisa das
 * mesmas regras para renderizar. Manter em um lugar so evita divergencia.
 */

import type { Snowflake } from './types.js';

/** <@123> menciona usuario, <@&123> menciona cargo, <#123> linka canal. */
const USER_MENTION_RE = /<@(\d{1,20})>/g;
const ROLE_MENTION_RE = /<@&(\d{1,20})>/g;
const CHANNEL_MENTION_RE = /<#(\d{1,20})>/g;
/** <:nome:123> e <a:nome:123> para emoji customizado animado. */
const CUSTOM_EMOJI_RE = /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,20})>/g;

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

export interface ParsedMentions {
  userIds: Snowflake[];
  roleIds: Snowflake[];
  channelIds: Snowflake[];
  everyone: boolean;
  here: boolean;
}

/**
 * Remove blocos de codigo antes de procurar mencoes: `@everyone` dentro de
 * um bloco de codigo e texto, nao notificacao.
 */
function stripCode(content: string): string {
  return content.replace(CODE_BLOCK_RE, ' ').replace(INLINE_CODE_RE, ' ');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseMentions(content: string): ParsedMentions {
  const scannable = stripCode(content);

  const userIds: string[] = [];
  const roleIds: string[] = [];
  const channelIds: string[] = [];

  for (const m of scannable.matchAll(USER_MENTION_RE)) if (m[1]) userIds.push(m[1]);
  for (const m of scannable.matchAll(ROLE_MENTION_RE)) if (m[1]) roleIds.push(m[1]);
  for (const m of scannable.matchAll(CHANNEL_MENTION_RE)) if (m[1]) channelIds.push(m[1]);

  return {
    userIds: unique(userIds),
    roleIds: unique(roleIds),
    channelIds: unique(channelIds),
    everyone: /(^|\s)@everyone(\s|$)/.test(scannable),
    here: /(^|\s)@here(\s|$)/.test(scannable),
  };
}

export interface ParsedCustomEmoji {
  name: string;
  id: Snowflake;
  animated: boolean;
}

export function parseCustomEmojis(content: string): ParsedCustomEmoji[] {
  const out: ParsedCustomEmoji[] = [];
  const seen = new Set<string>();
  for (const m of stripCode(content).matchAll(CUSTOM_EMOJI_RE)) {
    const id = m[3];
    const name = m[2];
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, animated: m[1] === 'a' });
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** URLs fora de blocos de codigo, para gerar os cartoes de link. */
export function extractUrls(content: string, limit = 5): string[] {
  const found = stripCode(content).match(URL_RE) ?? [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
  return unique(cleaned).slice(0, limit);
}

export function formatUserMention(id: Snowflake): string {
  return `<@${id}>`;
}

export function formatRoleMention(id: Snowflake): string {
  return `<@&${id}>`;
}

export function formatChannelMention(id: Snowflake): string {
  return `<#${id}>`;
}

export function formatCustomEmoji(name: string, id: Snowflake, animated = false): string {
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

/**
 * Conteudo visivel, sem a sintaxe de mencao. Usado em previews de notificacao
 * e na lista de canais, onde `<@123>` nao diz nada ao leitor.
 */
export function toPlainText(
  content: string,
  resolve: {
    user?: (id: Snowflake) => string | undefined;
    role?: (id: Snowflake) => string | undefined;
    channel?: (id: Snowflake) => string | undefined;
  } = {},
): string {
  return content
    .replace(USER_MENTION_RE, (_, id: string) => `@${resolve.user?.(id) ?? 'desconhecido'}`)
    .replace(ROLE_MENTION_RE, (_, id: string) => `@${resolve.role?.(id) ?? 'cargo'}`)
    .replace(CHANNEL_MENTION_RE, (_, id: string) => `#${resolve.channel?.(id) ?? 'canal'}`)
    .replace(CUSTOM_EMOJI_RE, (_, _a: string, name: string) => `:${name}:`)
    .replace(/\|\|(.+?)\|\|/g, 'spoiler')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .trim();
}

/** Escapa a sintaxe de markdown, para inserir texto literal do usuario. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>])/g, '\\$1');
}

/**
 * Verdadeiro quando a mensagem so tem emojis customizados e espaco. O cliente
 * renderiza esses emojis maiores, como o Discord faz.
 */
export function isOnlyEmojis(content: string): boolean {
  const withoutCustom = content.replace(CUSTOM_EMOJI_RE, '').trim();
  if (withoutCustom.length === 0) return content.trim().length > 0;
  // Faixas de emoji unicode mais comuns, mais seletores de variacao e ZWJ.
  return /^[\s‍️\u{1f000}-\u{1faff}\u{2600}-\u{27bf}\u{1f1e6}-\u{1f1ff}]+$/u.test(
    content.trim(),
  );
}

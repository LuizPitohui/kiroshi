import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { extractUrls, type Embed } from '@kiroshi/shared';
import { logger } from '../logger.js';

/**
 * Cartoes de pre-visualizacao de link.
 *
 * Buscar uma URL que o usuario escreveu e um vetor de SSRF: alguem posta
 * http://192.168.100.21:5432 e o servidor sonda a rede interna por ele. Por
 * isso resolvemos o DNS antes e recusamos qualquer endereco privado, de
 * loopback ou de link-local, inclusive apos redirecionamento.
 */

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local e metadados de nuvem
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservado
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('fe80')) return true; // link-local
  // IPv4 mapeado em IPv6 volta para a checagem de IPv4.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

async function isSafeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // Endereco literal: checa direto.
  const literal = isIP(host);
  if (literal === 4) return isPrivateIPv4(host) ? null : url;
  if (literal === 6) return isPrivateIPv6(host) ? null : url;

  // Nome: resolve e checa todos os enderecos retornados.
  try {
    const records = await lookup(host, { all: true });
    if (records.length === 0) return null;
    for (const record of records) {
      const blocked =
        record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address);
      if (blocked) return null;
    }
    return url;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Le uma meta tag por property ou name, nas duas ordens de atributo. */
function readMeta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`,
      'i',
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

function readTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return match?.[1] ? decodeEntities(match[1].trim()) : null;
}

async function fetchMetadata(rawUrl: string): Promise<Embed | null> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await isSafeUrl(current);
    if (!url) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        // Seguimos os redirecionamentos a mao para revalidar cada destino.
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'KiroshiBot/1.0 (+link preview)',
          accept: 'text/html,application/xhtml+xml',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        current = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.startsWith('image/')) {
        return {
          type: 'image',
          url: url.toString(),
          title: null,
          description: null,
          color: null,
          siteName: url.hostname,
          thumbnailUrl: null,
          imageUrl: url.toString(),
          videoUrl: null,
          authorName: null,
          authorUrl: null,
        };
      }

      if (!contentType.includes('html')) return null;

      // Le so o inicio do documento: as meta tags ficam no head.
      const reader = response.body?.getReader();
      if (!reader) return null;

      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
      await reader.cancel().catch(() => undefined);

      const html = Buffer.concat(chunks).toString('utf8');

      const title = readMeta(html, 'og:title') ?? readMeta(html, 'twitter:title') ?? readTitle(html);
      const description =
        readMeta(html, 'og:description') ??
        readMeta(html, 'twitter:description') ??
        readMeta(html, 'description');
      const image = readMeta(html, 'og:image') ?? readMeta(html, 'twitter:image');

      if (!title && !description && !image) return null;

      const absolute = (value: string | null): string | null => {
        if (!value) return null;
        try {
          return new URL(value, url).toString();
        } catch {
          return null;
        }
      };

      return {
        type: 'link',
        url: url.toString(),
        title: title?.slice(0, 256) ?? null,
        description: description?.slice(0, 500) ?? null,
        color: readMeta(html, 'theme-color'),
        siteName: readMeta(html, 'og:site_name') ?? url.hostname,
        thumbnailUrl: absolute(image),
        imageUrl: absolute(image),
        videoUrl: absolute(readMeta(html, 'og:video:secure_url') ?? readMeta(html, 'og:video')),
        authorName: readMeta(html, 'article:author') ?? null,
        authorUrl: null,
      };
    } catch (error) {
      logger.debug({ error, url: current }, 'falha ao montar preview do link');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/**
 * Monta ate 3 cartoes para os links da mensagem. Falha em um link nao derruba
 * o envio: a mensagem vale mais que o preview.
 */
export async function buildEmbeds(content: string): Promise<Embed[]> {
  const urls = extractUrls(content, 3);
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(urls.map((url) => fetchMetadata(url)));

  return results
    .filter(
      (r): r is PromiseFulfilledResult<Embed> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value);
}

export const __testing = { isSafeUrl, readMeta, readTitle, decodeEntities };

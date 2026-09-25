import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { extractUrls, type Embed } from '@kiroshi/shared';
import { enderecoPublico } from '../lib/enderecos.js';
import { logger } from '../logger.js';

/**
 * Cartoes de pre-visualizacao de link.
 *
 * Buscar uma URL que o usuario escreveu e um vetor de SSRF: alguem posta
 * http://192.168.100.21:5432 e o servidor sonda a rede interna por ele. Por
 * isso cada destino e resolvido e conferido antes (`enderecoPublico`, que le
 * tambem o IPv4 escondido dentro de um IPv6), inclusive a cada
 * redirecionamento — e a conexao vai para o endereco conferido, nao para
 * uma segunda resposta do DNS.
 */

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

interface EnderecoResolvido {
  address: string;
  family: number;
}

interface Destino {
  url: URL;
  /** Os enderecos ja conferidos. A conexao so pode ir para um destes. */
  enderecos: EnderecoResolvido[];
}

/**
 * Resolve e confere um destino. Null quando nao pode ser buscado.
 *
 * Um endereco interno entre os que o DNS devolveu basta para recusar o nome
 * inteiro: o sistema poderia escolher justo ele na hora de conectar.
 */
async function resolverDestino(raw: string): Promise<Destino | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^\[|\]$/g, '');

  const literal = isIP(host);
  if (literal) {
    return enderecoPublico(host) ? { url, enderecos: [{ address: host, family: literal }] } : null;
  }

  try {
    const registros = await lookup(host, { all: true, verbatim: true });
    if (registros.length === 0) return null;
    if (registros.some((r) => !enderecoPublico(r.address))) return null;
    return { url, enderecos: registros };
  } catch {
    return null;
  }
}

/**
 * `lookup` que responde com os enderecos ja conferidos, sem perguntar ao DNS.
 *
 * E o que fecha a janela entre conferir e conectar. Com o `fetch`, o DNS era
 * consultado de novo na hora da conexao, e um nome que respondesse um
 * endereco publico na conferencia e um interno logo depois passava.
 */
function lookupFixo(enderecos: EnderecoResolvido[]): LookupFunction {
  return (_hostname, opcoes, callback) => {
    if (opcoes?.all) {
      callback(null, enderecos);
      return;
    }
    const primeiro = enderecos[0]!;
    callback(null, primeiro.address, primeiro.family);
  };
}

/** Abre o GET para um destino ja conferido. */
function abrir(destino: Destino, sinal: AbortSignal): Promise<http.IncomingMessage> {
  const modulo = destino.url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const pedido = modulo.request(
      destino.url,
      {
        method: 'GET',
        headers: {
          'user-agent': 'KiroshiBot/1.0 (+link preview)',
          accept: 'text/html,application/xhtml+xml',
        },
        lookup: lookupFixo(destino.enderecos),
        // Conexao nova a cada busca: um socket reaproveitado de outro pedido
        // nao passou por esta conferencia.
        agent: false,
        signal: sinal,
      },
      resolve,
    );
    pedido.on('error', reject);
    pedido.end();
  });
}

/** Le so o comeco do corpo: as meta tags ficam no head. */
async function lerInicio(resposta: http.IncomingMessage): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of resposta) {
    const buffer = pedaco as Buffer;
    pedacos.push(buffer);
    total += buffer.length;
    if (total >= MAX_BYTES) break;
  }
  resposta.destroy();
  return Buffer.concat(pedacos);
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
    const destino = await resolverDestino(current);
    if (!destino) return null;
    const { url } = destino;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await abrir(destino, controller.signal);
      const status = response.statusCode ?? 0;

      // Redirecionamento seguido a mao, para conferir cada destino de novo.
      if (status >= 300 && status < 400) {
        response.destroy();
        const location = response.headers.location;
        if (!location) return null;
        current = new URL(location, url).toString();
        continue;
      }

      if (status < 200 || status >= 300) {
        response.destroy();
        return null;
      }

      const contentType = response.headers['content-type'] ?? '';

      if (contentType.startsWith('image/')) {
        response.destroy();
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

      if (!contentType.includes('html')) {
        response.destroy();
        return null;
      }

      const html = (await lerInicio(response)).toString('utf8');

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

export const __testing = { resolverDestino, lookupFixo, readMeta, readTitle, decodeEntities };

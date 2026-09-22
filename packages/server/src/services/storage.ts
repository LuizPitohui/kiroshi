import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  BLOCKED_ATTACHMENT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  LIMITS,
  generateId,
} from '@kiroshi/shared';
import { config } from '../config.js';
import { ApiError, badRequest } from '../errors.js';
import { logger } from '../logger.js';
import { prisma } from '../db.js';

/**
 * Armazenamento de anexos em disco local.
 *
 * Para 10 pessoas, um diretorio no servidor e mais simples e mais barato que
 * S3/MinIO, e o backup e um rsync. Os arquivos ficam espalhados em subpastas
 * de dois caracteres para nao criar um diretorio com dezenas de milhares de
 * entradas, o que deixa o ext4 lento.
 *
 * O nome no disco nunca vem do usuario: geramos a chave. Assim nao existe
 * travessia de caminho, nem colisao, nem nome que o sistema de arquivos recuse.
 */

function extensionOf(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

function assertAllowedFilename(filename: string): void {
  const ext = extensionOf(filename);
  if (ext && (BLOCKED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ApiError(
      'UNSUPPORTED_MEDIA_TYPE',
      `Arquivos .${ext} nao sao aceitos por seguranca.`,
    );
  }
}

/** Chave opaca no formato ab/cdef...ext. */
function buildStorageKey(extension: string): string {
  const raw = randomBytes(16).toString('hex');
  const prefix = raw.slice(0, 2);
  const suffix = extension ? `.${extension}` : '';
  return `${prefix}/${raw}${suffix}`;
}

function resolvePath(storageKey: string): string {
  const base = path.resolve(config.storageDir);
  const target = path.resolve(base, storageKey);
  // Cinto e suspensorio: mesmo gerando a chave, conferimos que ela nao sai
  // do diretorio de uploads.
  if (!target.startsWith(base + path.sep)) {
    throw badRequest('Caminho de arquivo invalido.');
  }
  return target;
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(path.resolve(config.storageDir), { recursive: true });
}

export interface StoredFile {
  id: string;
  storageKey: string;
  url: string;
  filename: string;
  size: number;
  contentType: string | null;
  width: number | null;
  height: number | null;
  placeholder: string | null;
}

/**
 * Grava o arquivo e, quando for imagem, extrai dimensoes e um placeholder
 * minusculo em base64 para o cliente reservar o espaco antes do download.
 */
export async function storeFile(args: {
  buffer: Buffer;
  filename: string;
  contentType: string | null;
  uploaderId: string;
  maxBytes?: number;
}): Promise<StoredFile> {
  const maxBytes = args.maxBytes ?? LIMITS.attachmentBytes;

  if (args.buffer.length === 0) throw badRequest('Arquivo vazio.');
  if (args.buffer.length > maxBytes) {
    throw new ApiError(
      'PAYLOAD_TOO_LARGE',
      `O limite e ${Math.floor(maxBytes / 1024 / 1024)} MB por arquivo.`,
    );
  }

  assertAllowedFilename(args.filename);

  const extension = extensionOf(args.filename);
  const storageKey = buildStorageKey(extension);
  const target = resolvePath(storageKey);

  await mkdir(path.dirname(target), { recursive: true });

  let width: number | null = null;
  let height: number | null = null;
  let placeholder: string | null = null;

  const isImage =
    args.contentType !== null &&
    (IMAGE_MIME_TYPES as readonly string[]).includes(args.contentType);

  if (isImage) {
    try {
      const image = sharp(args.buffer, { animated: false });
      const metadata = await image.metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;

      // Miniatura de 16px de largura serve de placeholder borrado.
      const tiny = await sharp(args.buffer)
        .resize(16, 16, { fit: 'inside' })
        .webp({ quality: 40 })
        .toBuffer();
      placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;
    } catch (error) {
      // Extensao de imagem com conteudo invalido: grava como arquivo comum.
      logger.debug({ error, filename: args.filename }, 'nao consegui ler metadados da imagem');
    }
  }

  await writeFile(target, args.buffer);

  const id = generateId();
  await prisma.attachment.create({
    data: {
      id,
      uploaderId: args.uploaderId,
      filename: args.filename.slice(0, 255),
      storageKey,
      size: args.buffer.length,
      contentType: args.contentType,
      width,
      height,
      placeholder,
    },
  });

  return {
    id,
    storageKey,
    url: `${config.publicBaseUrl}/attachments/${storageKey}`,
    filename: args.filename,
    size: args.buffer.length,
    contentType: args.contentType,
    width,
    height,
    placeholder,
  };
}

/**
 * Grava uma imagem de perfil, icone ou emoji: redimensiona, converte para webp
 * e devolve a URL. Nao cria linha em Attachment porque nao pertence a mensagem.
 */
export async function storeImage(args: {
  buffer: Buffer;
  maxSize: number;
  maxBytes: number;
  animated?: boolean;
}): Promise<{ url: string; storageKey: string; animated: boolean }> {
  if (args.buffer.length > args.maxBytes) {
    throw new ApiError(
      'PAYLOAD_TOO_LARGE',
      `A imagem passa de ${Math.floor(args.maxBytes / 1024)} KB.`,
    );
  }

  let pipeline: sharp.Sharp;
  let metadata: sharp.Metadata;
  try {
    pipeline = sharp(args.buffer, { animated: args.animated ?? true });
    metadata = await pipeline.metadata();
  } catch {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Isto nao parece ser uma imagem valida.');
  }

  const isAnimated = (metadata.pages ?? 1) > 1;

  const output = await pipeline
    .resize(args.maxSize, args.maxSize, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();

  const storageKey = buildStorageKey('webp');
  const target = resolvePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, output);

  return {
    url: `${config.publicBaseUrl}/attachments/${storageKey}`,
    storageKey,
    animated: isAnimated,
  };
}

/** Aceita data URL (`data:image/png;base64,...`) ou URL ja hospedada aqui. */
export async function resolveImageInput(
  input: string,
  options: { maxSize: number; maxBytes: number },
): Promise<{ url: string; animated: boolean }> {
  if (input.startsWith(config.publicBaseUrl)) {
    return { url: input, animated: input.endsWith('.gif') };
  }

  const match = input.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match?.[1] || !match[2]) {
    throw badRequest('Envie a imagem como data URL em base64.');
  }
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(match[1].toLowerCase())) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Use PNG, JPEG, GIF ou WebP.');
  }

  const buffer = Buffer.from(match[2], 'base64');
  const stored = await storeImage({ buffer, ...options });
  return { url: stored.url, animated: stored.animated };
}

export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolvePath(storageKey));
  } catch {
    // Ja nao existe: o resultado desejado ja vale.
  }
}

export function storagePathFor(storageKey: string): string {
  return resolvePath(storageKey);
}

/**
 * Remove uploads que nunca viraram mensagem. Alguem abre o seletor de arquivo,
 * envia e desiste: o arquivo ficaria no disco para sempre.
 */
export async function pruneOrphanAttachments(olderThanMs = 24 * 3600_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await prisma.attachment.findMany({
    where: { messageId: null, createdAt: { lt: cutoff } },
    select: { id: true, storageKey: true },
    take: 500,
  });

  for (const orphan of orphans) await deleteFile(orphan.storageKey);

  if (orphans.length > 0) {
    await prisma.attachment.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
    logger.info({ count: orphans.length }, 'anexos orfaos removidos');
  }
  return orphans.length;
}

/** Hash do conteudo, usado para deduplicar uploads identicos no futuro. */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

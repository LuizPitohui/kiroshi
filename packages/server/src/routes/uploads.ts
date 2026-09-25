import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LIMITS, RATE_LIMITS } from '@kiroshi/shared';
import { requireAuth } from '../auth/middleware.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { consume } from '../lib/ratelimit.js';
import { storeFile, storagePathFor } from '../services/storage.js';

/**
 * Upload em duas etapas: o cliente envia o arquivo, recebe um id, e depois
 * manda a mensagem citando esse id. Assim um upload lento nao segura a
 * digitacao, e uma mensagem que falha nao perde o anexo ja enviado.
 */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uploads', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    consume(`upload:${userId}`, RATE_LIMITS.uploadFile);

    const file = await request.file({
      limits: { fileSize: LIMITS.attachmentBytes, files: 1 },
    });
    if (!file) throw badRequest('Nenhum arquivo enviado.');

    const buffer = await file.toBuffer();

    // O multipart interrompe a leitura ao passar do limite; conferimos aqui
    // para devolver um erro claro em vez de gravar um arquivo truncado.
    if (file.file.truncated) {
      throw new ApiError(
        'PAYLOAD_TOO_LARGE',
        `O limite e ${Math.floor(LIMITS.attachmentBytes / 1024 / 1024)} MB por arquivo.`,
      );
    }

    const stored = await storeFile({
      buffer,
      filename: file.filename,
      // O tipo vem do cabecalho do cliente, que pode mandar o que quiser, e a
      // coluna aceita 128. Sem cortar aqui, um cabecalho longo derruba o envio
      // com erro de banco em vez de uma recusa clara.
      contentType: file.mimetype?.slice(0, 128) || null,
      uploaderId: userId,
    });

    return reply.status(201).send(stored);
  });

  /**
   * Servir os anexos. Nao exige token: a URL tem 128 bits de aleatoriedade e
   * funciona como capacidade. Exigir Authorization quebraria as tags <img>
   * do cliente e o preview do sistema operacional.
   */
  app.get('/attachments/*', async (request, reply) => {
    const wildcard = (request.params as Record<string, string>)['*'] ?? '';

    // A chave e gerada por nos e tem formato fixo; qualquer outra coisa some.
    if (!/^[0-9a-f]{2}\/[0-9a-f]{32}(\.[a-z0-9]{1,8})?$/.test(wildcard)) {
      throw notFound('Arquivo');
    }

    const filePath = storagePathFor(wildcard);

    let info;
    try {
      info = await stat(filePath);
    } catch {
      throw notFound('Arquivo');
    }
    if (!info.isFile()) throw notFound('Arquivo');

    const extension = path.extname(wildcard).slice(1).toLowerCase();
    const contentType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';

    return reply
      .header('content-type', contentType)
      .header('content-length', info.size)
      // O conteudo nunca muda: a chave e derivada de bytes aleatorios e o
      // arquivo nunca e sobrescrito.
      .header('cache-control', 'public, max-age=31536000, immutable')
      // Impede que um SVG ou HTML enviado como anexo execute script na origem.
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(filePath));
  });
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  // Sons antigos do soundboard foram gravados como .mpeg.
  mpeg: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
  zip: 'application/zip',
};

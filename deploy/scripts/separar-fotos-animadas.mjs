// Separa as fotos de perfil animadas de antes da 2.0.4 em PARADA + ANIMADA.
//
// Ate a 2.0.3, um GIF de perfil virava um WebP animado direto na `avatarUrl`
// e se mexia em toda tela, o tempo todo. Desde a 2.0.4 (pedido do dono em
// 2026-09-26) a `avatarUrl` e sempre parada (o primeiro quadro) e a animada
// fica em `avatarAnimatedUrl`, que o app mostra enquanto a pessoa fala. Este
// script converte quem subiu GIF antes: le o arquivo da `avatarUrl` e, se ele
// tiver mais de um quadro, grava as duas com o mesmo `storeAvatar` das fotos
// novas. Quem ja tem a animada separada, ou foto parada, fica como esta.
//
// Roda DENTRO do container da API (banco, disco dos anexos e sharp), DEPOIS do
// deploy da 2.0.4 (precisa da coluna nova e do `storeAvatar`):
//
//   ssh <host> 'docker exec -i -w /app kiroshi-api node --input-type=module -' < deploy/scripts/separar-fotos-animadas.mjs
//
// Assim so conta e diz o que faria. Para gravar, APLICAR=1:
//
//   ssh <host> 'docker exec -i -e APLICAR=1 -w /app kiroshi-api node --input-type=module -' < deploy/scripts/separar-fotos-animadas.mjs
//
// Nada e apagado: o arquivo animado antigo continua no disco, e quem esta com
// o app aberto numa versao antiga segue vendo a foto de antes ate reconectar.
// Imprime so contagens, nunca quem e quem.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const aplicar = process.env.APLICAR === '1';
// A raiz do app no container; RAIZ troca para testar fora dele (banco de desenvolvimento).
const raiz = process.env.RAIZ ?? '/app';
const modulo = (arquivo) => import(pathToFileURL(path.join(raiz, 'packages/server/dist', arquivo)).href);
const { prisma } = await modulo('db.js');
const { config } = await modulo('config.js');
const storage = await modulo('services/storage.js');
const { LIMITS } = await import('@kiroshi/shared');

if (typeof storage.storeAvatar !== 'function') {
  console.error('Esta API ainda nao tem o storeAvatar: rode depois do deploy da 2.0.4.');
  process.exit(2);
}

const prefixo = `${config.publicBaseUrl}/attachments/`;
const fotos = await prisma.$queryRaw`
  SELECT id, "avatarUrl" FROM "User"
  WHERE "avatarUrl" IS NOT NULL AND "avatarAnimatedUrl" IS NULL AND "disabledAt" IS NULL`;

const conta = { comFoto: fotos.length, deFora: 0, semArquivo: 0, parada: 0, animada: 0, convertida: 0, falhou: 0 };
for (const { id, avatarUrl } of fotos) {
  if (!avatarUrl.startsWith(prefixo)) {
    conta.deFora++;
    continue;
  }
  let bytes;
  try {
    bytes = await readFile(storage.storagePathFor(avatarUrl.slice(prefixo.length)));
  } catch {
    conta.semArquivo++;
    continue;
  }
  const quadros = (await sharp(bytes, { animated: true }).metadata().catch(() => ({}))).pages ?? 1;
  if (quadros <= 1) {
    conta.parada++;
    continue;
  }
  conta.animada++;
  if (!aplicar) continue;
  try {
    const foto = await storage.storeAvatar(bytes, LIMITS.imageBytes);
    // So troca se ninguem mexeu na foto enquanto o script rodava.
    const r = await prisma.user.updateMany({
      where: { id, avatarUrl, avatarAnimatedUrl: null },
      data: { avatarUrl: foto.url, avatarAnimatedUrl: foto.animatedUrl },
    });
    conta.convertida += r.count;
  } catch (erro) {
    conta.falhou++;
    console.error(`falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

console.log(JSON.stringify({ modo: aplicar ? 'APLICAR' : 'so contando', ...conta }));
await prisma.$disconnect();

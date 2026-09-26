// Copia do corpus com 1 s de silencio no comeco, para o microfone falso do
// Chromium: a gravacao comeca um pouco depois de o arquivo comecar a tocar, e
// sem a folga o inicio da fala se perderia. O alinhamento vem depois, pela
// correlacao com a fala limpa.
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gravarWav, lerWav } from './wav.mjs';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(join(AQUI, 'corpus-falso'), { recursive: true });
for (const f of readdirSync(join(AQUI, 'corpus'))) {
  const a = lerWav(join(AQUI, 'corpus', f)).amostras;
  const b = new Float32Array(a.length + 48000);
  b.set(a, 48000);
  gravarWav(join(AQUI, 'corpus-falso', f), b);
}
console.log('ok');

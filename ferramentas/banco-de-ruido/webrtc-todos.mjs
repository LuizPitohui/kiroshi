// Roda webrtc.cjs para cada arquivo do corpus, nos modos ns e cru, com 7 vagas.
// Cada vaga reusa a mesma pasta de dados. Um processo por captura.
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ELECTRON = join(AQUI, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const VAGAS = 7;
const fila = [];
for (const f of readdirSync(join(AQUI, 'corpus-falso')).filter((f) => f !== 'teste-curto.wav')) {
  fila.push([f, 'ns'], [f, 'cru']);
}
const total = fila.length;
let feitos = 0;

function rodar(vaga) {
  const item = fila.shift();
  if (!item) return Promise.resolve();
  const [arquivo, modo] = item;
  const dados = join(AQUI, 'dados', `vaga-${vaga}`);
  mkdirSync(dados, { recursive: true });
  return new Promise((ok) => {
    const p = spawn(ELECTRON, ['webrtc.cjs', `--user-data-dir=${dados}`, arquivo, modo], { cwd: AQUI });
    let linha = '';
    p.stdout.on('data', (d) => { linha += d; });
    const limite = setTimeout(() => p.kill(), 180_000);
    p.on('exit', () => {
      clearTimeout(limite);
      feitos++;
      const ok1 = linha.split('\n').find((l) => l.startsWith(`${modo} `));
      console.log(`[${feitos}/${total}] ${ok1 ?? `${modo} ${arquivo}: FALHOU`}`);
      ok();
    });
  }).then(() => rodar(vaga));
}

await Promise.all(Array.from({ length: VAGAS }, (_, i) => rodar(i)));
console.log('fim');

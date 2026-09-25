// Publica o Kiroshi Beta no canal dele, /baixar/beta: quem ja tem o Beta
// instalado recebe a versao nova sozinho, como o Kiroshi normal.
//
//   npm run dist:beta -w @kiroshi/desktop
//   node scripts/publicar-beta.mjs          (de packages/desktop)
//
// Pela rede local (pitohui@192.168.100.21), que sobe os ~95 MB em segundos.
// Confere em cinco lugares, e nao em um: arquivo em disco nao quer dizer
// arquivo servido (memoria kiroshi-publicar-sem-derrubar).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const HOST = process.env.KIROSHI_HOST ?? 'pitohui@192.168.100.21';
const PASTA = 'kiroshi/deploy/downloads/beta';
const PUBLICO = 'https://order.arasaka.fun/baixar/beta';
const SAIDA = 'release-beta';

const ssh = (comando) => execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 ${HOST} "${comando}"`).toString().trim();

const versaoDe = (nome) => /^Kiroshi-Beta-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/.exec(nome)?.slice(1).map(Number);

/** Mais nova primeiro. */
function porVersao(a, b) {
  const va = versaoDe(a);
  const vb = versaoDe(b);
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
  return 0;
}

const exe = readdirSync(SAIDA)
  .filter((n) => versaoDe(n))
  .sort(porVersao)[0];
if (!exe) throw new Error('Nenhum instalador do Beta em release-beta/. Rode npm run dist:beta antes.');
const versao = versaoDe(exe).join('.');

const yml = readFileSync(join(SAIDA, 'latest.yml'), 'utf8');
if (!yml.includes(`version: ${versao}`)) throw new Error(`latest.yml nao e da ${versao}: gere o Beta de novo.`);
statSync(join(SAIDA, `${exe}.blockmap`));

const sha512 = createHash('sha512').update(readFileSync(join(SAIDA, exe))).digest('hex');
console.log(`publicando ${exe} (${versao})`);

ssh(`mkdir -p ~/${PASTA}`);
// O latest.yml por ultimo: enquanto ele nao chega, ninguem procura o instalador novo pela metade.
execSync(`scp -q "${join(SAIDA, exe)}" "${join(SAIDA, exe)}.blockmap" ${HOST}:${PASTA}/`, { stdio: 'inherit' });
execSync(`scp -q "${join(SAIDA, 'latest.yml')}" ${HOST}:${PASTA}/latest.yml`, { stdio: 'inherit' });

// 1 e 2: o mesmo arquivo nos dois lados.
const remoto = ssh(`sha512sum ~/${PASTA}/${exe}`).split(/\s+/)[0];
if (remoto !== sha512) throw new Error('O instalador no servidor nao bate com o daqui.');
// 3: o latest.yml que ficou la.
if (!ssh(`cat ~/${PASTA}/latest.yml`).includes(`version: ${versao}`)) throw new Error('latest.yml no servidor nao e o novo.');
// 4: o latest.yml que o mundo le.
const servido = await (await fetch(`${PUBLICO}/latest.yml`, { cache: 'no-store' })).text();
if (!servido.includes(`version: ${versao}`)) throw new Error(`${PUBLICO}/latest.yml ainda nao mostra a ${versao}.`);
// 5: o instalador publico responde, com o tamanho certo.
const cabeca = await fetch(`${PUBLICO}/${exe}`, { method: 'HEAD' });
if (!cabeca.ok || Number(cabeca.headers.get('content-length')) !== statSync(join(SAIDA, exe)).size) {
  throw new Error(`${PUBLICO}/${exe} nao responde com o arquivo inteiro.`);
}

// Ficam as duas versoes mais novas (o blockmap da anterior serve ao diferencial).
const noServidor = ssh(`ls ~/${PASTA}`).split(/\s+/).filter((n) => versaoDe(n));
const velhos = noServidor.filter((n) => n !== exe).sort(porVersao).slice(1);
for (const velho of velhos) ssh(`rm -f ~/${PASTA}/${velho} ~/${PASTA}/${velho}.blockmap`);

console.log(`Kiroshi Beta ${versao} publicado em ${PUBLICO}${velhos.length ? ` (removidos: ${velhos.join(', ')})` : ''}`);

// Publica um instalador no canal dele: quem ja tem o app instalado recebe a
// versao nova sozinho.
//
//   node scripts/publicar.mjs normal   o Kiroshi de todo mundo (/baixar)
//   node scripts/publicar.mjs beta     o Kiroshi Beta, canal de teste (/baixar/beta)
//
// Antes: `npm run dist:win` (normal) ou `npm run dist:beta` (Beta).
//
// Pela rede local (pitohui@192.168.100.21), que sobe os ~95 MB em segundos.
// Confere em cinco lugares, e nao em um: arquivo em disco nao quer dizer
// arquivo servido (memoria kiroshi-publicar-sem-derrubar).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const CANAIS = {
  normal: {
    nome: 'Kiroshi',
    pasta: 'kiroshi/deploy/downloads',
    publico: 'https://order.arasaka.fun/baixar',
    saida: 'release',
    instalador: /^Kiroshi-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/,
  },
  beta: {
    nome: 'Kiroshi Beta',
    pasta: 'kiroshi/deploy/downloads/beta',
    publico: 'https://order.arasaka.fun/baixar/beta',
    saida: 'release-beta',
    instalador: /^Kiroshi-Beta-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/,
  },
};

const canal = CANAIS[process.argv[2]];
if (!canal) throw new Error('Diga o canal: node scripts/publicar.mjs normal | beta');

const HOST = process.env.KIROSHI_HOST ?? 'pitohui@192.168.100.21';
const ssh = (comando) => execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 ${HOST} "${comando}"`).toString().trim();

const versaoDe = (nome) => canal.instalador.exec(nome)?.slice(1).map(Number);

/** Mais nova primeiro. */
function porVersao(a, b) {
  const va = versaoDe(a);
  const vb = versaoDe(b);
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
  return 0;
}

const exe = readdirSync(canal.saida)
  .filter((n) => versaoDe(n))
  .sort(porVersao)[0];
if (!exe) throw new Error(`Nenhum instalador em ${canal.saida}/. Empacote antes.`);
const versao = versaoDe(exe).join('.');

const yml = readFileSync(join(canal.saida, 'latest.yml'), 'utf8');
if (!yml.includes(`version: ${versao}`)) throw new Error(`latest.yml nao e da ${versao}: empacote de novo.`);
statSync(join(canal.saida, `${exe}.blockmap`));

const sha512 = createHash('sha512').update(readFileSync(join(canal.saida, exe))).digest('hex');
console.log(`publicando ${exe} (${canal.nome} ${versao})`);

ssh(`mkdir -p ~/${canal.pasta}`);
// O latest.yml por ultimo: enquanto ele nao chega, ninguem procura o instalador novo pela metade.
execSync(`scp -q "${join(canal.saida, exe)}" "${join(canal.saida, exe)}.blockmap" ${HOST}:${canal.pasta}/`, { stdio: 'inherit' });
execSync(`scp -q "${join(canal.saida, 'latest.yml')}" ${HOST}:${canal.pasta}/latest.yml`, { stdio: 'inherit' });

// 1 e 2: o mesmo arquivo nos dois lados.
const remoto = ssh(`sha512sum ~/${canal.pasta}/${exe}`).split(/\s+/)[0];
if (remoto !== sha512) throw new Error('O instalador no servidor nao bate com o daqui.');
// 3: o latest.yml que ficou la.
if (!ssh(`cat ~/${canal.pasta}/latest.yml`).includes(`version: ${versao}`)) throw new Error('latest.yml no servidor nao e o novo.');
// 4: o latest.yml que o mundo le.
const servido = await (await fetch(`${canal.publico}/latest.yml`, { cache: 'no-store' })).text();
if (!servido.includes(`version: ${versao}`)) throw new Error(`${canal.publico}/latest.yml ainda nao mostra a ${versao}.`);
// 5: o instalador publico responde, com o tamanho certo.
const cabeca = await fetch(`${canal.publico}/${exe}`, { method: 'HEAD' });
if (!cabeca.ok || Number(cabeca.headers.get('content-length')) !== statSync(join(canal.saida, exe)).size) {
  throw new Error(`${canal.publico}/${exe} nao responde com o arquivo inteiro.`);
}

// Ficam as duas versoes mais novas (o blockmap da anterior serve ao diferencial,
// e a anterior fica a mao se precisar voltar). So o que casa com o instalador do
// canal: a pasta do normal tem a do Beta dentro, e ela nao e tocada.
const noServidor = ssh(`ls ~/${canal.pasta}`).split(/\s+/).filter((n) => versaoDe(n));
const velhos = noServidor.filter((n) => n !== exe).sort(porVersao).slice(1);
for (const velho of velhos) ssh(`rm -f ~/${canal.pasta}/${velho} ~/${canal.pasta}/${velho}.blockmap`);

console.log(`${canal.nome} ${versao} publicado em ${canal.publico}${velhos.length ? ` (removidos: ${velhos.join(', ')})` : ''}`);

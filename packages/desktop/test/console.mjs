/**
 * Le o console do app aberto.
 *
 * O Electron nao mostra o console do renderer em lugar nenhum quando roda sem
 * as ferramentas de desenvolvedor abertas; este script liga no protocolo de
 * depuracao e despeja o que houver, inclusive erros que aconteceram antes.
 *
 *   node packages/desktop/test/console.mjs [segundos]
 */

import WebSocket from 'ws';

const SEGUNDOS = Number(process.argv[2] ?? 10);

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('app nao esta aberto com depuracao na 9222');
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;

function send(method, params = {}) {
  socket.send(JSON.stringify({ id: nextId++, method, params }));
}

function textoDoArgumento(a) {
  if (a.value !== undefined) return String(a.value);
  if (a.description) return a.description;
  if (a.preview?.properties) {
    return a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ');
  }
  return a.type;
}

socket.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.method === 'Runtime.consoleAPICalled') {
    const nivel = m.params.type;
    if (!['error', 'warning', 'warn', 'log', 'info'].includes(nivel)) return;
    const texto = m.params.args.map(textoDoArgumento).join(' ');
    console.log(`  [${nivel}] ${texto.slice(0, 500)}`);
  }

  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    console.log(`  [excecao] ${(e.exception?.description ?? e.text).slice(0, 500)}`);
  }
});

await new Promise((resolve) => socket.once('open', resolve));
send('Runtime.enable');

console.log(`\nouvindo o console por ${SEGUNDOS}s...\n`);
await new Promise((r) => setTimeout(r, SEGUNDOS * 1000));

socket.close();
console.log('');

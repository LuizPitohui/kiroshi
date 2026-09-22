/**
 * Captura a janela do app empacotado.
 *
 * O Electron nao aparece para as ferramentas de navegador, mas expoe o mesmo
 * protocolo de depuracao do Chrome. Abrindo o app com
 * `--remote-debugging-port=9222` da para conectar nele e tirar a foto da
 * interface de verdade, do executavel que vai ser distribuido.
 *
 *   Order.exe --remote-debugging-port=9222
 *   node packages/desktop/test/screenshot.mjs [saida.png]
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const PORT = process.env.ORDER_DEBUG_PORT ?? '9222';
const OUTPUT = process.argv[2] ?? 'order-app.png';

const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');

if (!page) {
  console.error('Nenhuma pagina encontrada. O app esta aberto com --remote-debugging-port?');
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout em ${method}`));
    }, 20000);
  });
}

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

await new Promise((resolve) => socket.once('open', resolve));

// Espera a interface montar antes de fotografar.
await send('Runtime.enable');
const ready = await send('Runtime.evaluate', {
  expression: 'document.querySelector("#root")?.children.length ?? 0',
  returnByValue: true,
});

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUTPUT, Buffer.from(data, 'base64'));

const info = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    titulo: document.title,
    servidor: localStorage.getItem('kiroshi.baseUrl'),
    temLogin: !!document.querySelector('.auth-card'),
    temApp: !!document.querySelector('.app-body'),
    erro: document.querySelector('.auth-error')?.textContent ?? null
  })`,
  returnByValue: true,
});

console.log(`captura salva em ${OUTPUT}`);
console.log(`elementos na raiz: ${ready.result.value}`);
console.log(info.result.value);

socket.close();

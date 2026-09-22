/**
 * Mostra o HTML gerado de um trecho da interface.
 *
 * Util quando algo aparece errado na tela e nao da para saber se o problema e
 * o CSS ou a arvore que o React montou.
 *
 *   node packages/desktop/test/inspecionar-html.mjs "<seletor>" [quantos]
 */

import WebSocket from 'ws';

const SELETOR = process.argv[2] ?? '.msg-text';
const QUANTOS = Number(process.argv[3] ?? 3);

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('app nao esta aberto com depuracao na 9222');
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
    }, 30000);
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
await send('Runtime.enable');

const result = await send('Runtime.evaluate', {
  expression: `JSON.stringify(
    [...document.querySelectorAll(${JSON.stringify(SELETOR)})]
      .slice(-${QUANTOS})
      .map(e => ({ texto: e.textContent.slice(0, 80), html: e.innerHTML.slice(0, 400) })),
    null, 1
  )`,
  returnByValue: true,
});

console.log(result.result.value);
socket.close();

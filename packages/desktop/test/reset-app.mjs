/**
 * Limpa o estado local do app aberto, para simular uma instalacao nova.
 *
 * Util depois de dirigir o app em teste: o endereco do servidor e a sessao
 * ficam no localStorage e mascarariam o comportamento de quem instala pela
 * primeira vez.
 *
 *   Order.exe --remote-debugging-port=9222
 *   node packages/desktop/test/reset-app.mjs
 */

import WebSocket from 'ws';

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('app nao esta aberto com --remote-debugging-port=9222');
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
    }, 15000);
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

await send('Runtime.evaluate', {
  expression: 'localStorage.clear(); sessionStorage.clear(); true',
  returnByValue: true,
});

await send('Page.reload');
console.log('estado local limpo, app recarregado');

socket.close();

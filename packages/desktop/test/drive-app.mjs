/**
 * Dirige o app empacotado pelo protocolo de depuracao do Chrome.
 *
 * Serve para conferir que o executavel que vai ser distribuido funciona de
 * verdade, e nao so a versao de desenvolvimento no navegador. A diferenca
 * importa: o app empacotado roda com isolamento de contexto, carrega os
 * arquivos de dentro do asar e usa a ponte do preload.
 *
 *   Kiroshi.exe --remote-debugging-port=9222
 *   node packages/desktop/test/drive-app.mjs <url-do-servidor> <usuario> <senha>
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const SERVER = process.argv[2] ?? 'http://localhost:4000';
const USER = process.argv[3] ?? 'pitohui';
const PASS = process.argv[4] ?? 'ordem123456';
const SHOT = process.argv[5] ?? 'app.png';

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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'erro na avaliacao');
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

// Aponta o app para o servidor pedido e entra, sem passar pelo formulario.
await evaluate(`(async () => {
  localStorage.setItem('kiroshi.baseUrl', ${JSON.stringify(SERVER)});
  const res = await fetch(${JSON.stringify(SERVER)} + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} })
  });
  const data = await res.json();
  if (!data.accessToken) throw new Error('login falhou: ' + JSON.stringify(data).slice(0, 200));
  localStorage.setItem('kiroshi.session', JSON.stringify({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000
  }));
  return true;
})()`);

await send('Page.reload');
await new Promise((r) => setTimeout(r, 7000));

const estado = await evaluate(`(() => {
  const canais = [...document.querySelectorAll('.channel')].map(c => c.textContent.trim());
  return JSON.stringify({
    entrou: !!document.querySelector('.app-body'),
    servidores: [...document.querySelectorAll('.rail-slot[data-guild]')].length,
    canais,
    membros: [...document.querySelectorAll('.member')].map(m => m.innerText.split('\\n')[0]),
    mensagens: [...document.querySelectorAll('.msg-text')].length,
    pontePreload: typeof window.kiroshi?.screen?.sources === 'function'
  });
})()`);

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(data, 'base64'));

console.log(estado);
console.log(`captura em ${SHOT}`);
socket.close();

/**
 * Entra no canal de voz pela interface enquanto mostra o console do app.
 *
 * Junta as duas coisas de proposito: quando a conexao com o SFU falha, o
 * motivo aparece no console do renderer no exato instante da tentativa, e
 * observar depois nao serve — o app ja tentou de novo e sobrescreveu o estado.
 *
 *   node packages/desktop/test/voz-com-console.mjs
 */

import WebSocket from 'ws';

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
    }, 90000);
  });
}

function texto(a) {
  if (a.value !== undefined) return String(a.value);
  if (a.description) return a.description;
  if (a.preview?.properties) {
    return `{${a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ')}}`;
  }
  return a.type;
}

socket.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.method === 'Runtime.consoleAPICalled') {
    const nivel = m.params.type;
    if (nivel === 'debug') return;
    console.log(`   [${nivel}] ${m.params.args.map(texto).join(' ').slice(0, 400)}`);
    return;
  }

  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    console.log(`   [excecao] ${(e.exception?.description ?? e.text).slice(0, 400)}`);
    return;
  }

  const waiter = pending.get(m.id);
  if (!waiter) return;
  pending.delete(m.id);
  if (m.error) waiter.reject(new Error(m.error.message));
  else waiter.resolve(m.result);
});

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log('\n--- clicando no canal de voz, console ao vivo ---\n');

const resultado = await send('Runtime.evaluate', {
  expression: `(async () => {
    const canal = [...document.querySelectorAll('.channel')]
      .find(c => c.textContent.trim() === 'Geral' && c.querySelector('svg polygon'));
    if (!canal) return 'canal de voz nao encontrado';
    canal.click();

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (document.querySelector('.hud')) break;
    }

    const p = document.querySelector('.hud');
    return JSON.stringify({
      painelApareceu: !!p,
      texto: p ? p.innerText.replace(/\\n+/g, ' | ').slice(0, 200) : null
    });
  })()`,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});

console.log('\n--- RESULTADO ---');
console.log(
  resultado.exceptionDetails
    ? `ERRO: ${resultado.exceptionDetails.exception?.description?.slice(0, 300)}`
    : resultado.result.value,
);

socket.close();
console.log('');

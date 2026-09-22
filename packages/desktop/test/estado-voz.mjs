/**
 * Mostra o estado de voz como a interface o enxerga.
 *
 * Quando o botao indica que a transmissao esta ligada mas a grade de video
 * nao aparece, o desencontro esta entre o que o SFU publicou e o que o
 * controlador reporta. Este script mostra os dois lados lado a lado.
 *
 *   node packages/desktop/test/estado-voz.mjs
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
    }, 60000);
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

async function run(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    return `ERRO: ${result.exceptionDetails.exception?.description?.slice(0, 400)}`;
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log(
  await run(`(() => {
    // O modulo do controlador nao esta no escopo global; chegamos nele pelo
    // que a interface ja renderizou e pelo objeto que o Vite guarda.
    const painel = document.querySelector('.hud');
    const palco = document.querySelector('.stage');

    return JSON.stringify({
      interface: {
        painelDeVoz: !!painel,
        textoDoPainel: painel?.innerText.replace(/\\n+/g, ' | ').slice(0, 150) ?? null,
        palcoDeVideo: !!palco,
        quadrosDeVideo: document.querySelectorAll('.tile').length,
        elementosVideo: document.querySelectorAll('video').length,
        botoes: [...document.querySelectorAll('.hud-controls button')].map(b => ({
          rotulo: b.getAttribute('aria-label'),
          classes: b.className
        }))
      }
    }, null, 1);
  })()`),
);

console.log('\n--- O QUE O SFU REPORTA ---');
console.log(
  await run(`(async () => {
    // Reaproveita a sala que o teste anterior deixou aberta, se houver.
    const r = window.__room;
    if (!r) return 'sem sala de teste aberta (normal: a do app e interna)';
    const lp = r.localParticipant;
    return JSON.stringify({
      estado: r.state,
      publicacoes: [...lp.trackPublications.values()].map(p => ({
        fonte: p.source, tipo: p.kind, silenciada: p.isMuted, sid: p.trackSid
      }))
    }, null, 1);
  })()`),
);

socket.close();
console.log('');

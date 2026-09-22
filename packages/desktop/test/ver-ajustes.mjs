/**
 * Abre os ajustes de voz e fotografa, com o teste de microfone ligado.
 *
 *   node packages/desktop/test/ver-ajustes.mjs [saida.png]
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const SHOT = process.argv[2] ?? 'ajustes.png';

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
    return `ERRO: ${result.exceptionDetails.exception?.description?.slice(0, 300)}`;
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log(
  await run(`(async () => {
    // Abre ajustes
    const engrenagem = [...document.querySelectorAll('.user-panel .icon-button')]
      .find(b => b.getAttribute('aria-label') === 'Ajustes');
    if (!engrenagem) return 'botao de ajustes nao encontrado';
    engrenagem.click();
    await new Promise(r => setTimeout(r, 900));

    // Aba de voz
    const aba = [...document.querySelectorAll('.settings-item')]
      .find(b => b.textContent.includes('Voz e video'));
    if (!aba) return 'aba de voz nao encontrada';
    aba.click();
    await new Promise(r => setTimeout(r, 900));

    // Liga o teste de microfone
    const testar = [...document.querySelectorAll('.row button')]
      .find(b => b.textContent.trim() === 'Testar');
    if (testar) testar.click();
    await new Promise(r => setTimeout(r, 1500));

    // Liga o retorno de voz
    const retorno = [...document.querySelectorAll('.row .switch')]
      .find(b => b.getAttribute('aria-label') === 'Ouvir minha voz');
    if (retorno) retorno.click();
    await new Promise(r => setTimeout(r, 1200));

    return JSON.stringify({
      abriuAjustes: !!document.querySelector('.settings'),
      testeLigado: !!document.querySelector('.meter'),
      retornoDisponivel: !!retorno,
      avisoDeFone: [...document.querySelectorAll('.row-text div')]
        .some(d => d.textContent.includes('fone')),
      temDiagnostico: [...document.querySelectorAll('button')]
        .some(b => b.textContent.includes('Verificar conexao'))
    });
  })()`),
);

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(data, 'base64'));
console.log(`captura em ${SHOT}`);

socket.close();

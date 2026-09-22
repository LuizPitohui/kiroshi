/**
 * Reproduz e diagnostica a captura de tela e de camera no Electron.
 *
 * Esses dois caminhos nao existem no navegador comum: dependem do
 * desktopCapturer e do handler de getDisplayMedia no processo principal. Se
 * quebram, so quebram aqui, e o erro costuma ficar preso dentro de uma promise
 * que nunca resolve. Este script exercita cada etapa isoladamente para mostrar
 * onde para.
 *
 *   node packages/desktop/test/depurar-midia.mjs <servidor> <usuario> <senha>
 */

import WebSocket from 'ws';

const SERVER = process.argv[2] ?? 'https://order.arasaka.fun';
const USER = process.argv[3];
const PASS = process.argv[4];

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
    return { erro: result.exceptionDetails.exception?.description?.slice(0, 400) };
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log('\n--- PONTE DO PRELOAD ---');
console.log(
  await run(`JSON.stringify({
    existe: typeof window.kiroshi === 'object',
    listarFontes: typeof window.kiroshi?.screen?.sources === 'function',
    escolherFonte: typeof window.kiroshi?.screen?.select === 'function'
  })`),
);

console.log('\n--- DESKTOP CAPTURER (listar telas e janelas) ---');
console.log(
  await run(`(async () => {
    try {
      const inicio = performance.now();
      const fontes = await window.kiroshi.screen.sources();
      return JSON.stringify({
        ok: true,
        quantidade: fontes.length,
        ms: Math.round(performance.now() - inicio),
        telas: fontes.filter(f => f.kind === 'screen').length,
        janelas: fontes.filter(f => f.kind === 'window').length,
        primeira: fontes[0] ? { id: fontes[0].id, nome: fontes[0].name, temMiniatura: fontes[0].thumbnail.length > 100 } : null
      });
    } catch (e) { return JSON.stringify({ ok: false, erro: String(e) }); }
  })()`),
);

console.log('\n--- DISPOSITIVOS ---');
console.log(
  await run(`(async () => {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return JSON.stringify({
        microfones: d.filter(x => x.kind === 'audioinput').length,
        cameras: d.filter(x => x.kind === 'videoinput').length,
        saidas: d.filter(x => x.kind === 'audiooutput').length,
        nomesCamera: d.filter(x => x.kind === 'videoinput').map(x => x.label || '(sem rotulo)')
      });
    } catch (e) { return JSON.stringify({ erro: String(e) }); }
  })()`),
);

console.log('\n--- CAMERA (getUserMedia direto, com prazo de 8s) ---');
console.log(
  await run(`(async () => {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TRAVOU: sem resposta em 8s')), 8000))
      ]);
      const faixas = stream.getVideoTracks().map(t => ({ rotulo: t.label, estado: t.readyState }));
      stream.getTracks().forEach(t => t.stop());
      return JSON.stringify({ ok: true, faixas });
    } catch (e) { return JSON.stringify({ ok: false, erro: String(e).slice(0, 300) }); }
  })()`),
);

console.log('\n--- TELA (getDisplayMedia, com prazo de 10s) ---');
console.log(
  await run(`(async () => {
    try {
      const fontes = await window.kiroshi.screen.sources();
      const tela = fontes.find(f => f.kind === 'screen');
      if (!tela) return JSON.stringify({ ok: false, erro: 'nenhuma tela listada' });

      await window.kiroshi.screen.select(tela.id, false);

      const stream = await Promise.race([
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TRAVOU: getDisplayMedia sem resposta em 10s')), 10000))
      ]);
      const faixas = stream.getVideoTracks().map(t => ({
        rotulo: t.label, estado: t.readyState,
        largura: t.getSettings().width, altura: t.getSettings().height
      }));
      stream.getTracks().forEach(t => t.stop());
      return JSON.stringify({ ok: true, fonteEscolhida: tela.name, faixas });
    } catch (e) { return JSON.stringify({ ok: false, erro: String(e).slice(0, 300) }); }
  })()`),
);

socket.close();
console.log('');

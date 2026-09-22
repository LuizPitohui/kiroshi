/**
 * Verifica se as faixas de video realmente produzem quadros.
 *
 * Uma faixa pode existir e estar "live" sem nunca entregar imagem: e o que
 * acontece com camera virtual parada (celular como webcam desligado, OBS sem
 * cena ativa). O SFU espera o primeiro quadro para fechar a publicacao, entao
 * a chamada fica pendurada ate estourar o prazo — parece travamento, mas e
 * uma camera que nao esta mandando nada.
 *
 *   node packages/desktop/test/depurar-quadros.mjs
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
    }, 120000);
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
  await run(`(async () => {
    // Conta quadros de verdade desenhando a faixa em um video e usando o
    // callback de frame do proprio navegador.
    async function contarQuadros(stream, rotulo, ms = 4000) {
      const v = document.createElement('video');
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      document.body.appendChild(v);

      let quadros = 0;
      let parar = false;
      const tick = () => { if (!parar) { quadros++; v.requestVideoFrameCallback(tick); } };

      try { await v.play(); } catch {}
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick);

      await new Promise(r => setTimeout(r, ms));
      parar = true;

      const faixa = stream.getVideoTracks()[0];
      const cfg = faixa?.getSettings() ?? {};
      const resultado = {
        fonte: rotulo,
        rotuloFaixa: faixa?.label,
        estado: faixa?.readyState,
        silenciadaPelaFonte: faixa?.muted,
        resolucao: (cfg.width ?? '?') + 'x' + (cfg.height ?? '?'),
        fpsConfigurado: cfg.frameRate,
        quadrosEm4s: quadros,
        veredito: quadros > 0 ? 'ENTREGA IMAGEM' : 'NAO ENTREGA IMAGEM'
      };

      v.remove();
      stream.getTracks().forEach(t => t.stop());
      return resultado;
    }

    const saida = [];

    // 1) Cada camera disponivel
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    for (const cam of dispositivos.filter(d => d.kind === 'videoinput')) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId } } });
        saida.push(await contarQuadros(s, 'camera: ' + (cam.label || cam.deviceId.slice(0,8))));
      } catch (e) {
        saida.push({ fonte: 'camera: ' + cam.label, veredito: 'NAO ABRIU', erro: String(e).slice(0,120) });
      }
    }

    // 2) Compartilhamento de tela
    try {
      const fontes = await window.kiroshi.screen.sources();
      const tela = fontes.find(f => f.kind === 'screen');
      await window.kiroshi.screen.select(tela.id, false);
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      saida.push(await contarQuadros(s, 'tela: ' + tela.name));
    } catch (e) {
      saida.push({ fonte: 'tela', veredito: 'NAO ABRIU', erro: String(e).slice(0,150) });
    }

    return JSON.stringify(saida, null, 1);
  })()`),
);

socket.close();
console.log('');

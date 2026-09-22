/**
 * Mostra o que o ICE do publisher esta fazendo durante a publicacao.
 *
 * A publicacao funciona, mas sempre leva quase 14 segundos — um atraso fixo,
 * que so aparece quando algum par de candidatos esta sendo tentado ate
 * estourar o prazo. Este script acompanha a negociacao segundo a segundo e no
 * fim lista todos os pares, com o estado de cada um.
 *
 *   node packages/desktop/test/depurar-ice.mjs
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
    }, 180000);
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
    const sessao = JSON.parse(localStorage.getItem('kiroshi.session') || 'null');
    const base = localStorage.getItem('kiroshi.baseUrl') || 'http://localhost:4000';
    const token = sessao.accessToken;
    const lk = await import('/@fs/D:/Order/node_modules/livekit-client/dist/livekit-client.esm.mjs');

    const canal = await new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/gateway');
      const t = setTimeout(() => reject(new Error('sem READY')), 20000);
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.op === 10) ws.send(JSON.stringify({ op: 2, d: { token, properties: { os:'d', client:'d', version:'1' } } }));
        if (m.op === 0 && m.t === 'READY') {
          clearTimeout(t); ws.close();
          resolve(m.d.guilds.flatMap(g => g.channels).find(c => c.type === 'GUILD_VOICE'));
        }
      };
    });

    const voz = await fetch(base + '/api/v1/voice/join', {
      method: 'POST',
      headers: {'content-type':'application/json', authorization: 'Bearer ' + token},
      body: JSON.stringify({ channelId: canal.id })
    }).then(r => r.json());

    const room = new lk.Room();
    await room.connect(voz.url, voz.token, { autoSubscribe: true });

    const faixa = await lk.createLocalVideoTrack();

    // Acompanha o publisher enquanto a publicacao acontece.
    const linha = [];
    const t0 = performance.now();
    const rel = () => Math.round(performance.now() - t0);

    const relogio = setInterval(() => {
      const pc = room.engine?.pcManager?.publisher?._pc;
      if (pc) linha.push(rel() + 'ms ' + pc.connectionState + '/' + pc.iceConnectionState + '/' + pc.iceGatheringState);
    }, 500);

    let erro = null;
    try {
      await room.localParticipant.publishTrack(faixa, { source: lk.Track.Source.Camera });
    } catch (e) { erro = String(e).slice(0, 150); }

    clearInterval(relogio);
    const total = rel();

    // Lista todos os pares que o navegador tentou.
    const pc = room.engine?.pcManager?.publisher?._pc;
    let pares = [];
    if (pc) {
      const stats = await pc.getStats();
      const todos = [...stats.values()];
      pares = todos
        .filter(s => s.type === 'candidate-pair')
        .map(s => {
          const l = todos.find(c => c.id === s.localCandidateId);
          const r = todos.find(c => c.id === s.remoteCandidateId);
          return {
            estado: s.state,
            escolhido: !!s.nominated,
            local: (l?.candidateType || '?') + ' ' + (l?.address || '?'),
            remoto: (r?.candidateType || '?') + ' ' + (r?.address || '?') + ':' + (r?.port || '?'),
            proto: r?.protocol,
            enviados: s.requestsSent,
            respondidos: s.responsesReceived
          };
        });
    }

    faixa.stop();
    await room.disconnect();

    return JSON.stringify({ totalMs: total, erro, linhaDoTempo: linha, pares }, null, 1);
  })()`),
);

socket.close();
console.log('');

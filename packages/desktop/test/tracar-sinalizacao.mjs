/**
 * Traca a sinalizacao do SFU durante uma publicacao.
 *
 * A publicacao leva ~14 s embora a conexao esteja pronta em meio segundo e o
 * servidor confirme a faixa logo. Este script usa o proprio protocolo de
 * depuracao para registrar cada quadro WebSocket com carimbo de tempo, o que
 * mostra se o silencio esta na ida, na volta, ou fora da sinalizacao.
 *
 *   node packages/desktop/test/tracar-sinalizacao.mjs
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
const quadros = [];
let t0 = 0;

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

  // Eventos do dominio Network chegam sem id.
  if (!message.id && message.method) {
    if (
      message.method === 'Network.webSocketFrameSent' ||
      message.method === 'Network.webSocketFrameReceived'
    ) {
      const direcao = message.method.endsWith('Sent') ? 'envia ' : 'recebe';
      const payload = message.params?.response?.payloadData ?? '';
      quadros.push({
        ms: t0 ? Math.round(performance.now() - t0) : 0,
        direcao,
        bytes: payload.length,
      });
    }
    return;
  }

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
await send('Network.enable');

// Prepara a sala, sem publicar ainda.
console.log(
  await run(`(async () => {
    const sessao = JSON.parse(localStorage.getItem('kiroshi.session') || 'null');
    const base = localStorage.getItem('kiroshi.baseUrl') || 'http://localhost:4000';
    const token = sessao.accessToken;
    const lk = await import('/@fs/D:/Order/node_modules/livekit-client/dist/livekit-client.esm.mjs');
    window.__lk = lk;

    const canal = await new Promise((resolve) => {
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/gateway');
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.op === 10) ws.send(JSON.stringify({ op: 2, d: { token, properties: { os:'d', client:'d', version:'1' } } }));
        if (m.op === 0 && m.t === 'READY') { ws.close(); resolve(m.d.guilds.flatMap(g => g.channels).find(c => c.type === 'GUILD_VOICE')); }
      };
    });

    const voz = await fetch(base + '/api/v1/voice/join', {
      method: 'POST',
      headers: {'content-type':'application/json', authorization: 'Bearer ' + token},
      body: JSON.stringify({ channelId: canal.id })
    }).then(r => r.json());

    const room = new lk.Room();
    await room.connect(voz.url, voz.token, { autoSubscribe: true });
    window.__room = room;
    window.__faixa = await lk.createLocalVideoTrack();
    return 'sala pronta, faixa criada';
  })()`),
);

// A partir daqui so a publicacao.
t0 = performance.now();
quadros.length = 0;

const resultado = await run(`(async () => {
  const t = performance.now();
  const marcos = [];
  window.__room.on(window.__lk.RoomEvent.LocalTrackPublished, () => marcos.push('evento LocalTrackPublished @' + Math.round(performance.now() - t) + 'ms'));
  try {
    await window.__room.localParticipant.publishTrack(window.__faixa, { source: window.__lk.Track.Source.Camera });
    marcos.push('publishTrack resolveu @' + Math.round(performance.now() - t) + 'ms');
  } catch (e) {
    marcos.push('publishTrack falhou @' + Math.round(performance.now() - t) + 'ms: ' + String(e).slice(0,100));
  }
  return JSON.stringify(marcos);
})()`);

console.log('\n--- MARCOS DO CLIENTE ---');
console.log(resultado);

console.log('\n--- QUADROS DE SINALIZACAO (durante a publicacao) ---');
for (const q of quadros) console.log(`  ${String(q.ms).padStart(6)}ms  ${q.direcao}  ${q.bytes}b`);

// Onde ficou o maior silencio.
let maior = { inicio: 0, fim: 0, gap: 0 };
for (let i = 1; i < quadros.length; i++) {
  const gap = quadros[i].ms - quadros[i - 1].ms;
  if (gap > maior.gap) maior = { inicio: quadros[i - 1].ms, fim: quadros[i].ms, gap };
}
console.log(`\n  maior silencio: ${maior.gap}ms (de ${maior.inicio}ms a ${maior.fim}ms)`);

await run('window.__faixa?.stop(); window.__room?.disconnect(); true');
socket.close();
console.log('');

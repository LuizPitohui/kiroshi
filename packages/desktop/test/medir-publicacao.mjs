/**
 * Mede onde vao os segundos ao publicar uma faixa.
 *
 * Usa os eventos do proprio livekit-client, com carimbo de tempo, em vez de
 * inferir pelo estado da conexao. Compara audio e video para separar o que e
 * do caminho do publisher em geral do que e especifico de video.
 *
 *   node packages/desktop/test/medir-publicacao.mjs
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

    const canal = await new Promise((resolve) => {
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/gateway');
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.op === 10) ws.send(JSON.stringify({ op: 2, d: { token, properties: { os:'d', client:'d', version:'1' } } }));
        if (m.op === 0 && m.t === 'READY') {
          ws.close();
          resolve(m.d.guilds.flatMap(g => g.channels).find(c => c.type === 'GUILD_VOICE'));
        }
      };
    });

    async function medir(tipo) {
      const voz = await fetch(base + '/api/v1/voice/join', {
        method: 'POST',
        headers: {'content-type':'application/json', authorization: 'Bearer ' + token},
        body: JSON.stringify({ channelId: canal.id })
      }).then(r => r.json());

      const room = new lk.Room();
      const eventos = [];
      let t0 = performance.now();
      const marcar = (e) => eventos.push(e + ' @' + Math.round(performance.now() - t0) + 'ms');

      room.on(lk.RoomEvent.SignalConnected, () => marcar('sinalizacao'));
      room.on(lk.RoomEvent.Connected, () => marcar('sala conectada'));
      room.on(lk.RoomEvent.LocalTrackPublished, () => marcar('faixa confirmada'));

      await room.connect(voz.url, voz.token, { autoSubscribe: true });
      marcar('connect() retornou');

      const faixa = tipo === 'audio'
        ? await lk.createLocalAudioTrack()
        : await lk.createLocalVideoTrack();
      marcar('faixa criada');

      t0 = performance.now();
      let erro = null;
      try {
        await room.localParticipant.publishTrack(faixa, {
          source: tipo === 'audio' ? lk.Track.Source.Microphone : lk.Track.Source.Camera
        });
      } catch (e) { erro = String(e).slice(0, 120); }
      const msPublicacao = Math.round(performance.now() - t0);

      faixa.stop();
      await room.disconnect();
      await new Promise(r => setTimeout(r, 1200));

      return { tipo, msPublicacao, erro, eventos };
    }

    const audio = await medir('audio');
    const video = await medir('video');

    return JSON.stringify({ audio, video }, null, 1);
  })()`),
);

socket.close();
console.log('');

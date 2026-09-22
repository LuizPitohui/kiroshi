/**
 * Testa a publicacao de faixas de video em uma sala real do SFU.
 *
 * A captura em si ja foi verificada e funciona. O que este script isola e a
 * etapa seguinte: entregar a faixa ao SFU. Camera e tela compartilham esse
 * caminho, e quando as duas falham juntas o suspeito e ele.
 *
 *   node packages/desktop/test/depurar-publicacao.mjs <servidor> <usuario> <senha>
 */

import WebSocket from 'ws';

const SERVER = process.argv[2] ?? 'https://order.arasaka.fun';
const USER = process.argv[3] ?? '';
const PASS = process.argv[4] ?? '';

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
    return `ERRO: ${result.exceptionDetails.exception?.description?.slice(0, 500)}`;
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log('\n--- PREPARANDO SALA ---');
console.log(
  await run(`(async () => {
    const sessao = JSON.parse(localStorage.getItem('kiroshi.session') || 'null');
    if (!sessao) return 'sem sessao: faca login no app primeiro';

    const base = localStorage.getItem('kiroshi.baseUrl') || ${JSON.stringify(SERVER)};
    const resp = await fetch(base + '/api/v1/users/@me', {
      headers: { authorization: 'Bearer ' + sessao.accessToken }
    });
    if (!resp.ok) return 'sessao invalida (HTTP ' + resp.status + ')';

    // Acha o primeiro canal de voz que o usuario enxerga.
    const guildsResp = await fetch(base + '/api/v1/users/@me', {
      headers: { authorization: 'Bearer ' + sessao.accessToken }
    });
    window.__dbg = { base, token: sessao.accessToken };
    return JSON.stringify({ ok: true, base, usuario: (await resp.json()).username });
  })()`),
);

console.log('\n--- ENTRANDO NA SALA E PUBLICANDO ---');
console.log(
  await run(`(async () => {
    const { base, token } = window.__dbg;
    const registro = [];
    const marcar = (etapa, extra) => registro.push(etapa + (extra ? ': ' + extra : ''));

    try {
      // Descobre um canal de voz pelo gateway (o READY traz tudo).
      const canal = await new Promise((resolve, reject) => {
        const ws = new WebSocket(base.replace(/^http/, 'ws') + '/gateway');
        const t = setTimeout(() => reject(new Error('sem READY')), 20000);
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.op === 10) ws.send(JSON.stringify({ op: 2, d: { token, properties: { os:'d', client:'d', version:'1' } } }));
          if (m.op === 0 && m.t === 'READY') {
            clearTimeout(t);
            ws.close();
            const c = m.d.guilds.flatMap(g => g.channels).find(c => c.type === 'GUILD_VOICE');
            resolve(c);
          }
        };
        ws.onerror = () => { clearTimeout(t); reject(new Error('gateway falhou')); };
      });
      if (!canal) return JSON.stringify({ erro: 'nenhum canal de voz encontrado' });
      marcar('achou canal', canal.name);

      const voz = await fetch(base + '/api/v1/voice/join', {
        method: 'POST',
        headers: {'content-type':'application/json', authorization: 'Bearer ' + token},
        body: JSON.stringify({ channelId: canal.id })
      }).then(r => r.json());
      marcar('token de voz', voz.roomName);

      const lk = await import('/@fs/D:/Order/node_modules/livekit-client/dist/livekit-client.esm.mjs');
      const room = new lk.Room({ adaptiveStream: true, dynacast: true });
      await room.connect(voz.url, voz.token, { autoSubscribe: true });
      marcar('conectou no SFU', room.state);
      window.__room = room;
      window.__lk = lk;

      // 1) Camera, do jeito que o app faz
      let camera = 'nao testado';
      try {
        const faixa = await Promise.race([
          lk.createLocalVideoTrack({ resolution: { width: 1280, height: 720, frameRate: 30 } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TRAVOU ao criar faixa')), 10000))
        ]);
        marcar('criou faixa de camera');
        await Promise.race([
          room.localParticipant.publishTrack(faixa, { source: lk.Track.Source.Camera, simulcast: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TRAVOU ao publicar camera')), 15000))
        ]);
        camera = 'publicou';
        await room.localParticipant.unpublishTrack(faixa);
        faixa.stop();
      } catch (e) { camera = 'FALHOU: ' + String(e).slice(0, 200); }
      marcar('camera', camera);

      // 2) Tela, do jeito que o app faz (com as mesmas opcoes)
      let tela = 'nao testado';
      try {
        const fontes = await window.kiroshi.screen.sources();
        const alvo = fontes.find(f => f.kind === 'screen');
        await window.kiroshi.screen.select(alvo.id, false);
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, height: { ideal: 1080 } }, audio: false });
        marcar('capturou a tela');

        const mt = stream.getVideoTracks()[0];
        const faixa = new lk.LocalVideoTrack(mt);
        await Promise.race([
          room.localParticipant.publishTrack(faixa, {
            source: lk.Track.Source.ScreenShare,
            simulcast: true,
            videoEncoding: { maxBitrate: 3000000, maxFramerate: 30 },
            degradationPreference: 'maintain-resolution'
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TRAVOU ao publicar tela')), 15000))
        ]);
        tela = 'publicou';
        await room.localParticipant.unpublishTrack(faixa);
        faixa.stop();
      } catch (e) { tela = 'FALHOU: ' + String(e).slice(0, 250); }
      marcar('tela', tela);

      await room.disconnect();
      return JSON.stringify({ registro }, null, 1);
    } catch (e) {
      return JSON.stringify({ registro, erroFatal: String(e).slice(0, 300) }, null, 1);
    }
  })()`),
);

socket.close();
console.log('');

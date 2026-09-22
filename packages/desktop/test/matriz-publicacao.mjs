/**
 * Testa combinacoes de opcoes de publicacao para isolar qual delas trava.
 *
 * O servidor aceita a faixa mas o cliente reporta "negotiation timed out", o
 * que aponta para a conexao do publisher nao chegar em `connected`. Este
 * script publica a mesma faixa com opcoes diferentes, uma sala nova por
 * tentativa, e observa o estado da conexao em cada etapa.
 *
 *   node packages/desktop/test/matriz-publicacao.mjs
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

console.log('\nCada variacao usa uma conexao nova. Aguarde.\n');

console.log(
  await run(`(async () => {
    const sessao = JSON.parse(localStorage.getItem('kiroshi.session') || 'null');
    if (!sessao) return 'sem sessao no app';
    const base = localStorage.getItem('kiroshi.baseUrl') || 'http://localhost:4000';
    const token = sessao.accessToken;

    const lk = await import('/@fs/D:/Order/node_modules/livekit-client/dist/livekit-client.esm.mjs');

    // Canal de voz, descoberto uma vez so.
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
      ws.onerror = () => { clearTimeout(t); reject(new Error('gateway falhou')); };
    });

    const variacoes = [
      { nome: 'video simples, sem opcao nenhuma', opcoes: {} },
      { nome: 'so source: Camera',                opcoes: { source: lk.Track.Source.Camera } },
      { nome: 'source + simulcast',               opcoes: { source: lk.Track.Source.Camera, simulcast: true } },
      { nome: 'source, sem simulcast',            opcoes: { source: lk.Track.Source.Camera, simulcast: false } },
      { nome: 'como o app faz na tela',           opcoes: { source: lk.Track.Source.ScreenShare, simulcast: true, videoEncoding: { maxBitrate: 3000000, maxFramerate: 30 }, degradationPreference: 'maintain-resolution' } },
    ];

    const resultados = [];

    for (const v of variacoes) {
      let room = null;
      let faixa = null;
      try {
        const voz = await fetch(base + '/api/v1/voice/join', {
          method: 'POST',
          headers: {'content-type':'application/json', authorization: 'Bearer ' + token},
          body: JSON.stringify({ channelId: canal.id })
        }).then(r => r.json());

        room = new lk.Room({ adaptiveStream: true, dynacast: true });
        await room.connect(voz.url, voz.token, { autoSubscribe: true });

        // Acompanha o estado da conexao do publisher durante a publicacao.
        const estados = [];
        const pcPub = room.engine?.pcManager?.publisher?._pc;
        if (pcPub) {
          pcPub.addEventListener('connectionstatechange', () => estados.push('pc:' + pcPub.connectionState));
          pcPub.addEventListener('iceconnectionstatechange', () => estados.push('ice:' + pcPub.iceConnectionState));
        }

        faixa = await lk.createLocalVideoTrack({ resolution: { width: 1280, height: 720, frameRate: 30 } });

        const inicio = performance.now();
        await room.localParticipant.publishTrack(faixa, v.opcoes);
        const ms = Math.round(performance.now() - inicio);

        // Depois de publicar, ve se a conexao esta de pe.
        const pc2 = room.engine?.pcManager?.publisher?._pc;
        resultados.push({
          variacao: v.nome,
          resultado: 'PUBLICOU em ' + ms + 'ms',
          estadoFinal: pc2 ? pc2.connectionState + '/' + pc2.iceConnectionState : '?',
          transicoes: estados.slice(-6)
        });
      } catch (e) {
        const pc2 = room?.engine?.pcManager?.publisher?._pc;
        resultados.push({
          variacao: v.nome,
          resultado: 'FALHOU: ' + String(e).slice(0, 120),
          estadoFinal: pc2 ? pc2.connectionState + '/' + pc2.iceConnectionState : '?'
        });
      } finally {
        try { faixa?.stop(); } catch {}
        try { await room?.disconnect(); } catch {}
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    return JSON.stringify(resultados, null, 1);
  })()`),
);

socket.close();
console.log('');

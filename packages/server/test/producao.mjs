/**
 * Verifica o servidor de producao pelo endereco publico.
 *
 * O que HTTP respondendo 200 nao prova: que o WebSocket atravessa o tunel.
 * Sao caminhos diferentes no Cloudflare, e o gateway inteiro depende do
 * segundo. Este teste exercita os dois, alem do caminho de midia.
 *
 *   node packages/server/test/producao.mjs [https://servidor] [usuario] [senha]
 */

import WebSocket from 'ws';

const BASE = (process.argv[2] ?? 'https://order.arasaka.fun').replace(/\/+$/, '');
const USER = process.argv[3];
const PASS = process.argv[4];

let passed = 0;
let failed = 0;

function check(nome, ok, detalhe = '') {
  if (ok) {
    console.log(`  OK   ${nome}`);
    passed++;
  } else {
    console.log(`  FALHA ${nome} ${detalhe}`);
    failed++;
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { raw: texto.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

console.log(`\nServidor: ${BASE}\n`);

// ---------------------------------------------------------------------------
console.log('--- HTTP ---');

const info = await fetch(`${BASE}/api/info`, { signal: AbortSignal.timeout(15000) });
const infoBody = await info.json();
check('/api/info responde', info.status === 200);
check('e um servidor Kiroshi', infoBody.name === 'Kiroshi', infoBody.name);
check('voz esta ativa', infoBody.voiceEnabled === true);
check('cadastro fechado', infoBody.openRegistration === false);
check('sem redirecionamento do Access', !info.redirected, info.url);

const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(15000) });
const healthBody = await health.json();
check('/health responde', health.status === 200 && healthBody.status === 'ok');
check(
  'banco responde rapido',
  healthBody.dbLatencyMs < 200,
  `${healthBody.dbLatencyMs}ms`,
);

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
console.log('\n--- LINK DO INSTALADOR ---');

/*
  O link fixo pelo qual as pessoas baixam o app. Vale testar em producao
  porque ele depende de tres coisas que podem quebrar separadamente: o arquivo
  estar no servidor, a pasta estar montada no container, e o tunel aguentar
  uma resposta grande.
*/
const versao = await fetch(`${BASE}/baixar/versao`, { signal: AbortSignal.timeout(15000) })
  .then((r) => r.json())
  .catch(() => null);

check('o servidor sabe qual versao publica', typeof versao?.versao === 'string', versao?.versao ?? '');
check(
  'o instalador tem tamanho plausivel',
  Number(versao?.megabytes) > 50 && Number(versao?.megabytes) < 200,
  `${versao?.megabytes} MB`,
);

// Pede so o cabecalho: baixar 82 MB a cada teste seria desperdicio, e o que
// importa aqui e o caminho responder com o arquivo certo.
const cabecalho = await fetch(`${BASE}/baixar`, {
  method: 'HEAD',
  signal: AbortSignal.timeout(20000),
}).catch(() => null);

check('o link de download responde', cabecalho?.status === 200, `status ${cabecalho?.status ?? 'sem resposta'}`);
check(
  'vem como arquivo para baixar, nao como pagina',
  /attachment/.test(cabecalho?.headers.get('content-disposition') ?? ''),
  cabecalho?.headers.get('content-disposition') ?? '',
);
check(
  'o tamanho anunciado bate com o do arquivo',
  Number(cabecalho?.headers.get('content-length')) === Number(versao?.bytes),
  `${cabecalho?.headers.get('content-length')} vs ${versao?.bytes}`,
);
console.log('\n--- WEBSOCKET PELO TUNEL ---');

// O gateway e o que mais importa: sem WebSocket, nada em tempo real funciona.
const wsUrl = `${BASE.replace(/^http/, 'ws')}/gateway`;

const abriu = await new Promise((resolve) => {
  const socket = new WebSocket(wsUrl);
  const prazo = setTimeout(() => {
    socket.close();
    resolve({ ok: false, motivo: 'timeout em 15s' });
  }, 15000);

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    // HELLO e op 10; e a primeira coisa que o servidor manda.
    if (msg.op === 10) {
      clearTimeout(prazo);
      socket.close();
      resolve({ ok: true, intervalo: msg.d?.heartbeatInterval, versao: msg.d?.gatewayVersion });
    }
  });

  socket.on('error', (e) => {
    clearTimeout(prazo);
    resolve({ ok: false, motivo: String(e).slice(0, 150) });
  });
});

check('gateway aceita WebSocket', abriu.ok, abriu.motivo ?? '');
if (abriu.ok) {
  check('HELLO traz o intervalo de heartbeat', typeof abriu.intervalo === 'number');
  check('versao do protocolo confere', abriu.versao === 1);
}

// LiveKit tambem fala WebSocket, em outro hostname.
const vozUrl = BASE.replace('order.', 'voz.');
const vozHttp = await fetch(`${vozUrl}/`, { signal: AbortSignal.timeout(15000) })
  .then((r) => r.text())
  .catch((e) => String(e));
check('sinalizacao da voz responde', vozHttp.trim() === 'OK', vozHttp.slice(0, 80));

// ---------------------------------------------------------------------------
if (!USER || !PASS) {
  console.log('\n(sem usuario e senha: pulando os testes que exigem login)');
} else {
  console.log('\n--- SESSAO COMPLETA ---');

  const login = await api('POST', '/auth/login', { body: { login: USER, password: PASS } });
  check('login', login.status === 200, JSON.stringify(login.body).slice(0, 200));

  if (login.status === 200) {
    const token = login.body.accessToken;

    const ready = await new Promise((resolve) => {
      const socket = new WebSocket(wsUrl);
      const prazo = setTimeout(() => {
        socket.close();
        resolve(null);
      }, 25000);

      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.op === 10) {
          socket.send(
            JSON.stringify({
              op: 2,
              d: { token, properties: { os: 'test', client: 'producao', version: '1' } },
            }),
          );
        }
        if (msg.op === 0 && msg.t === 'READY') {
          clearTimeout(prazo);
          socket.close();
          resolve(msg.d);
        }
      });
      socket.on('error', () => {
        clearTimeout(prazo);
        resolve(null);
      });
    });

    check('READY chega pelo tunel', ready !== null);

    if (ready) {
      check('READY traz o usuario', ready.user?.username === USER.toLowerCase());
      console.log(
        `       servidores: ${ready.guilds.length}, conversas: ${ready.privateChannels.length}`,
      );

      const canalDeVoz = ready.guilds
        .flatMap((g) => g.channels)
        .find((c) => c.type === 'GUILD_VOICE');

      if (canalDeVoz) {
        const voz = await api('POST', '/voice/join', {
          token,
          body: { channelId: canalDeVoz.id },
        });
        check('emite token de voz', voz.status === 200, `status ${voz.status}`);
        check(
          'aponta para o SFU publico',
          typeof voz.body?.url === 'string' && voz.body.url.startsWith('wss://'),
          voz.body?.url,
        );
        await api('POST', '/voice/leave', { token });
      } else {
        console.log('       (sem canal de voz para testar)');
      }
    }
  }
}

console.log(`\n=========================================`);
console.log(`  ${passed} passaram, ${failed} falharam`);
console.log(`=========================================\n`);

process.exit(failed > 0 ? 1 : 0);

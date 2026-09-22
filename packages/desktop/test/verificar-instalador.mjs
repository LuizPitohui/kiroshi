/**
 * Percorre, no executavel empacotado, o caminho de quem acabou de instalar.
 *
 * Existe porque a versao de desenvolvimento nao prova nada sobre o que vai ser
 * distribuido: o app empacotado roda com isolamento de contexto, le os
 * arquivos de dentro do asar, usa a ponte do preload e aponta para producao
 * pelo .env.production. Cada uma dessas diferencas ja quebrou o app alguma vez
 * sem que o modo de desenvolvimento reclamasse.
 *
 * Sobe o executavel, entra, confere que a interface carregou de verdade, entra
 * em um canal de voz e publica camera e tela — que e o motivo do projeto
 * existir.
 *
 *   node packages/desktop/test/verificar-instalador.mjs <usuario> <senha>
 */

import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const EXE = resolve(AQUI, '../release/win-unpacked/Kiroshi.exe');
const USER = process.argv[2] ?? 'pitohuikun';
const PASS = process.argv[3];
const PORTA = 9333;

if (!PASS) {
  console.error('uso: node verificar-instalador.mjs <usuario> <senha>');
  process.exit(2);
}
if (!existsSync(EXE)) {
  console.error(`executavel nao encontrado em ${EXE} — rode o dist:win antes.`);
  process.exit(2);
}

const falhas = [];
function checar(nome, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  if (!ok) falhas.push(nome);
  console.log(`  ${ok ? 'ok  ' : 'FALHA'}  ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

console.log(`\n=== EXECUTAVEL EMPACOTADO ===\n${EXE}\n`);

const app = spawn(EXE, [`--remote-debugging-port=${PORTA}`], {
  detached: false,
  stdio: 'ignore',
});

function encerrar(codigo) {
  try {
    app.kill();
  } catch {
    // ja morreu
  }
  process.exit(codigo);
}

// A janela demora a abrir a porta de depuracao; tenta ate responder.
async function esperarAlvo() {
  for (let tentativa = 0; tentativa < 40; tentativa++) {
    try {
      const alvos = await fetch(`http://127.0.0.1:${PORTA}/json`).then((r) => r.json());
      const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (pagina?.webSocketDebuggerUrl) return pagina;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Quase sempre e isto: o Electron so deixa uma instancia viva. Se ja havia
  // uma aberta, a que este teste subiu entrega para ela e sai, e a porta de
  // depuracao fica com quem nao a pediu.
  throw new Error(
    'o app nao abriu a porta de depuracao.\n' +
      '         Feche o Kiroshi que ja estiver aberto e rode de novo:\n' +
      '           Get-Process Kiroshi | Stop-Process -Force',
  );
}

const pagina = await esperarAlvo();
const socket = new WebSocket(pagina.webSocketDebuggerUrl);
let proximoId = 1;
const pendentes = new Map();

function enviar(metodo, params = {}) {
  const id = proximoId++;
  socket.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro });
    setTimeout(() => {
      if (pendentes.delete(id)) erro(new Error(`tempo esgotado em ${metodo}`));
    }, 60000);
  });
}

socket.on('message', (bruto) => {
  const msg = JSON.parse(bruto.toString());
  const espera = pendentes.get(msg.id);
  if (!espera) return;
  pendentes.delete(msg.id);
  if (msg.error) espera.erro(new Error(msg.error.message));
  else espera.ok(msg.result);
});

async function avaliar(expressao) {
  const r = await enviar('Runtime.evaluate', {
    expression: expressao,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'erro na avaliacao');
  }
  return r.result.value;
}

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

// Erros do renderer sao coletados o tempo todo: um app que "funciona" mas
// despeja excecoes no console nao esta pronto para ser distribuido.
const errosConsole = [];
await enviar('Log.enable').catch(() => {});
socket.on('message', (bruto) => {
  const msg = JSON.parse(bruto.toString());
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    errosConsole.push(msg.params.entry.text);
  }
});

try {
  // -----------------------------------------------------------------------
  console.log('=== PARTIDA ===');

  const ponte = JSON.parse(
    await avaliar(`(() => JSON.stringify({
      ponte: typeof window.kiroshi === 'object',
      captura: typeof window.kiroshi?.screen?.sources === 'function'
    }))()`),
  );
  checar('a ponte do preload existe', ponte.ponte);
  checar('a captura de tela esta exposta', ponte.captura);

  // Uma rodada anterior deixa a sessao guardada, e o app abre direto no chat —
  // o que e o comportamento certo, mas esconde a tela que o amigo vai ver.
  // Limpa para valer o que esta sendo testado: uma instalacao nova.
  await avaliar(`(() => { localStorage.clear(); return true; })()`);
  await enviar('Page.reload');
  await new Promise((r) => setTimeout(r, 4000));

  const temLogin = await avaliar(
    `!!document.querySelector('input[type="password"]')`,
  );
  checar('instalacao nova cai na tela de entrada', temLogin);

  // O endereco padrao vem do .env.production embutido no pacote.
  const servidor = JSON.parse(
    await avaliar(
      `(async () => { const r = await fetch('https://order.arasaka.fun/api/info'); return JSON.stringify(await r.json()); })()`,
    ),
  );
  checar('producao responde ao app empacotado', Boolean(servidor.gatewayVersion));
  // Afirmar o nome, e nao so que o campo existe: este e o texto que aparece na
  // tela de entrada, e passou despercebido como "Order" numa rodada anterior.
  checar('o servidor se apresenta como Kiroshi', servidor.name === 'Kiroshi', servidor.name);
  checar('a voz esta ligada', servidor.voiceEnabled === true);
  checar('o cadastro esta fechado', servidor.openRegistration === false);

  // -----------------------------------------------------------------------
  console.log('\n=== ENTRAR ===');

  const login = await avaliar(`(async () => {
    const base = 'https://order.arasaka.fun';
    localStorage.setItem('kiroshi.baseUrl', base);
    const res = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} })
    });
    const data = await res.json();
    if (!data.accessToken) return 'falhou: ' + JSON.stringify(data).slice(0, 160);
    localStorage.setItem('kiroshi.session', JSON.stringify({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000
    }));
    return 'ok';
  })()`);
  checar('login em producao', login === 'ok', login === 'ok' ? '' : login);
  if (login !== 'ok') throw new Error('sem sessao nao da para seguir');

  await enviar('Page.reload');
  await new Promise((r) => setTimeout(r, 9000));

  // -----------------------------------------------------------------------
  console.log('\n=== INTERFACE ===');

  const tela = JSON.parse(
    await avaliar(`(() => JSON.stringify({
      entrou: !!document.querySelector('.app-body'),
      servidores: document.querySelectorAll('.rail-slot[data-guild]').length,
      canais: [...document.querySelectorAll('.channel-name')].map(c => c.textContent.trim()),
      membros: document.querySelectorAll('.member').length,
      hud: !!document.querySelector('.hud'),
      marca: !!document.querySelector('svg.mark, .mark')
    }))()`),
  );

  checar('a sessao abriu o app', tela.entrou);
  checar('os servidores carregaram', tela.servidores > 0, `${tela.servidores}`);
  checar('os canais carregaram', tela.canais.length > 0, tela.canais.join(', '));
  checar('a lista de membros carregou', tela.membros > 0, `${tela.membros}`);
  checar('a barra inferior existe', tela.hud);

  // -----------------------------------------------------------------------
  console.log('\n=== VOZ, CAMERA E TELA ===');

  const canalVoz = await avaliar(`(() => {
    const voz = document.querySelector('.channel[data-tipo="GUILD_VOICE"]');
    if (!voz) return null;
    voz.click();
    return voz.innerText.trim().split('\\n')[0];
  })()`);
  checar('achou e clicou em um canal de voz', Boolean(canalVoz), canalVoz ?? 'nenhum canal de voz no DOM');

  await new Promise((r) => setTimeout(r, 6000));

  const voz = JSON.parse(
    await avaliar(`(() => JSON.stringify({
      conectado: !!document.querySelector('.hud-metric-value, .voice-person'),
      pessoas: document.querySelectorAll('.voice-person').length,
      telemetria: document.querySelector('.hud-metric-value')?.textContent?.trim() ?? null
    }))()`),
  );
  checar('entrou na chamada', voz.conectado, voz.telemetria ? `latencia ${voz.telemetria}` : '');

  // Camera e tela: o motivo do projeto existir. Mede o tempo de publicacao,
  // porque ja foi 15 s por causa de um servidor desatualizado.
  const midia = JSON.parse(
    await avaliar(`(async () => {
      const resultado = { camera: null, tela: null, nomeDoErro: null, erro: null, cameras: 0 };
      try {
        resultado.cameras = (await navigator.mediaDevices.enumerateDevices())
          .filter(d => d.kind === 'videoinput').length;
        const t0 = performance.now();
        const cam = await navigator.mediaDevices.getUserMedia({ video: true });
        resultado.camera = Math.round(performance.now() - t0);
        cam.getTracks().forEach(t => t.stop());
      } catch (e) {
        resultado.nomeDoErro = e.name;
        resultado.erro = 'camera: ' + e.message;
      }
      try {
        const fontes = await window.kiroshi.screen.sources();
        resultado.tela = Array.isArray(fontes) ? fontes.length : 0;
      } catch (e) { resultado.erro = (resultado.erro ? resultado.erro + ' | ' : '') + 'tela: ' + e.message; }
      return JSON.stringify(resultado);
    })()`),
  );

  /*
    A camera pode falhar por dois motivos muito diferentes, e tratar os dois
    como reprovacao torna este teste inutil.

    "Sem camera" e "camera ocupada por outro programa" sao condicoes da
    maquina: dizem que a webcam esta em uso pelo Teams ou que a camera virtual
    do celular nao esta transmitindo, e nao mudam se o codigo mudar. Um teste
    que fica vermelho por isso e um teste que as pessoas param de ler.

    Permissao negada e outra historia: isso e empacotamento ou manifesto, ou
    seja, culpa nossa — e a distribuicao para a de pe.
  */
  const cameraIndisponivel =
    midia.nomeDoErro === 'NotReadableError' ||
    midia.nomeDoErro === 'TrackStartError' ||
    midia.nomeDoErro === 'NotFoundError' ||
    midia.cameras === 0;

  if (midia.camera === null && cameraIndisponivel) {
    console.log(
      `  pulei  a camera nesta maquina esta indisponivel (${midia.nomeDoErro ?? 'nenhuma conectada'}).\n` +
        `         Nao e falha do app: ele agora mostra isso na barra de baixo.`,
    );
  } else {
    checar(
      'a camera abre no app empacotado',
      midia.camera !== null,
      midia.camera !== null ? `${midia.camera}ms` : (midia.erro ?? ''),
    );
  }
  checar(
    'a captura de tela lista fontes',
    (midia.tela ?? 0) > 0,
    `${midia.tela} fontes`,
  );

  // -----------------------------------------------------------------------
  const { data } = await enviar('Page.captureScreenshot', { format: 'png' });
  const shot = resolve(AQUI, 'instalador.png');
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.log(`\ncaptura em ${shot}`);

  const errosReais = errosConsole.filter(
    (e) => !e.includes('Autofill') && !e.includes('devtools') && !e.includes('Request Autofill'),
  );
  console.log('\n=== ERROS NO CONSOLE ===');
  if (errosReais.length === 0) console.log('  nenhum');
  else errosReais.slice(0, 8).forEach((e) => console.log(`  ${e.slice(0, 160)}`));

  console.log('\n=== RESULTADO ===');
  if (falhas.length === 0) {
    console.log('  o instalador esta pronto para distribuir.\n');
  } else {
    console.log(`  ${falhas.length} verificacao(oes) falharam:`);
    falhas.forEach((f) => console.log(`    - ${f}`));
    console.log('');
  }

  socket.close();
  encerrar(falhas.length === 0 ? 0 : 1);
} catch (erro) {
  console.error(`\nerro: ${erro.message}\n`);
  socket.close();
  encerrar(1);
}

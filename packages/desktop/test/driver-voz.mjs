/**
 * Dirige o app pela interface: entra na voz, liga a camera e transmite a tela.
 *
 * Diferente dos testes que falam com a biblioteca direto, este clica nos
 * mesmos botoes que a pessoa clica. E o unico jeito de pegar problema que mora
 * entre a interface e o controlador, e nao dentro do SFU.
 *
 *   node packages/desktop/test/driver-voz.mjs [saida.png]
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const SHOT = process.argv[2] ?? 'voz.png';

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
    return `ERRO: ${result.exceptionDetails.exception?.description?.slice(0, 400)}`;
  }
  return result.result.value;
}

await new Promise((resolve) => socket.once('open', resolve));
await send('Runtime.enable');

console.log('\n--- ESTADO LIMPO ---');
console.log(
  await run(`(async () => {
    // Um teste anterior pode ter deixado transmissao ligada; sem zerar, o
    // proximo clique faz o oposto do esperado e o resultado nao diz nada.
    const desliga = (parte) => {
      const b = [...document.querySelectorAll('.hud-controls button')]
        .find(x => (x.getAttribute('aria-label') || '').includes(parte));
      if (b) { b.click(); return true; }
      return false;
    };
    const parou = [];
    if (desliga('Parar transmissao')) parou.push('transmissao');
    await new Promise(r => setTimeout(r, 800));
    if (desliga('Desligar camera')) parou.push('camera');
    await new Promise(r => setTimeout(r, 800));
    if (desliga('Sair da chamada')) parou.push('chamada');
    await new Promise(r => setTimeout(r, 1500));
    return JSON.stringify({ desligado: parou.length ? parou : 'ja estava limpo' });
  })()`),
);

console.log('\n--- ENTRANDO NO CANAL DE VOZ ---');
console.log(
  await run(`(async () => {
    const canal = [...document.querySelectorAll('.channel')]
      .find(c => c.textContent.trim() === 'Geral' && c.querySelector('svg polygon'));
    if (!canal) return 'canal de voz nao encontrado';
    canal.click();

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (document.querySelector('.hud')) break;
    }
    const p = document.querySelector('.hud');
    return JSON.stringify({
      conectou: !!p,
      painel: p?.innerText?.replace(/\\n+/g, ' | ').slice(0, 160) ?? null
    });
  })()`),
);

console.log('\n--- LIGANDO A CAMERA ---');
console.log(
  await run(`(async () => {
    const achar = () => [...document.querySelectorAll('.hud-controls button')]
      .find(b => (b.getAttribute('aria-label') || '').includes('camera'));

    // Camera e tela ficam desabilitadas ate a conexao com o SFU completar.
    // Clicar antes disso nao faz nada, e o teste acusaria uma falha que nao
    // existe; esperamos o botao ficar disponivel.
    let botao = achar();
    for (let i = 0; i < 40 && botao?.disabled !== false; i++) {
      await new Promise(r => setTimeout(r, 400));
      botao = achar();
    }
    if (!botao) return 'botao de camera nao encontrado';
    if (botao.disabled) return 'botao de camera continuou desabilitado: a conexao nao completou';

    const t = performance.now();
    botao.click();

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (document.querySelector('.tile video')) break;
    }
    return JSON.stringify({
      ms: Math.round(performance.now() - t),
      apareceuVideo: !!document.querySelector('.tile video'),
      quadros: [...document.querySelectorAll('.tile')].length,
      rotulos: [...document.querySelectorAll('.tile-label .name')].map(e => e.textContent)
    });
  })()`),
);

console.log('\n--- TRANSMITINDO A TELA ---');
console.log(
  await run(`(async () => {
    const botao = [...document.querySelectorAll('.hud-controls button')]
      .find(b => (b.getAttribute('aria-label') || '').includes('Compartilhar'));
    if (!botao) return 'botao de tela nao encontrado';
    botao.click();

    // Espera o seletor abrir e escolhe a primeira tela.
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (document.querySelector('.source-grid .source')) break;
    }
    const opcao = document.querySelector('.source-grid .source');
    if (!opcao) return 'seletor de tela nao abriu';
    opcao.click();

    const transmitir = [...document.querySelectorAll('.modal-foot button')]
      .find(b => b.textContent.includes('Transmitir'));
    if (!transmitir) return 'botao Transmitir nao encontrado';

    const t = performance.now();
    transmitir.click();

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (!document.querySelector('.backdrop')) break;
    }
    await new Promise(r => setTimeout(r, 2500));

    return JSON.stringify({
      ms: Math.round(performance.now() - t),
      seletorFechou: !document.querySelector('.backdrop'),
      aoVivo: !!document.querySelector('.tile-live'),
      quadros: [...document.querySelectorAll('.tile')].length,
      erro: document.querySelector('.field-error')?.textContent ?? null
    });
  })()`),
);

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(data, 'base64'));
console.log(`\ncaptura em ${SHOT}`);

socket.close();

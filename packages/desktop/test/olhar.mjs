/**
 * Olha o app aberto: estado da tela e, se pedirem, uma captura.
 *
 *   node packages/desktop/test/olhar.mjs [saida.png] [porta]
 *
 * A captura e opcional de proposito. `Page.captureScreenshot` pode ficar
 * pendurado quando a janela esta minimizada ou coberta — o compositor para de
 * produzir quadros e o CDP espera por um que nunca vem. Ler o DOM sempre
 * responde, entao o estado vem primeiro e a imagem depois, com prazo curto.
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const SHOT = process.argv[2] ?? null;
const PORTA = Number(process.argv[3] ?? 9222);

const alvos = await fetch(`http://127.0.0.1:${PORTA}/json`).then((r) => r.json());
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!pagina) {
  console.error(`nenhuma janela na porta ${PORTA}`);
  process.exit(1);
}

const socket = new WebSocket(pagina.webSocketDebuggerUrl);
let proximoId = 1;
const pendentes = new Map();

function enviar(metodo, params = {}, prazoMs = 20000) {
  const id = proximoId++;
  socket.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro });
    setTimeout(() => {
      if (pendentes.delete(id)) erro(new Error(`tempo esgotado em ${metodo}`));
    }, prazoMs);
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

const estado = await avaliar(`(() => {
  const txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  return JSON.stringify({
    entrou: !!document.querySelector('.app-body'),
    telaDeLogin: !!document.querySelector('input[type="password"]'),
    servidores: document.querySelectorAll('.rail-slot[data-guild]').length,
    canais: [...document.querySelectorAll('.channel-name')].map(c => c.textContent.trim()),
    palco: {
      existe: !!document.querySelector('.stage'),
      titulo: txt('.stage-title'),
      sub: txt('.stage-sub'),
      quadros: document.querySelectorAll('.tile').length,
      destacado: document.querySelectorAll('.tile.spot').length,
      miniaturas: document.querySelectorAll('.tile.mini').length,
      semCamera: document.querySelectorAll('.tile.faceless').length,
      telas: document.querySelectorAll('.tile-live').length,
      ferramentas: document.querySelectorAll('.tile-tool').length,
      cols: document.querySelector('.stage-floor')?.style.getPropertyValue('--cols') ?? null,
      rows: document.querySelector('.stage-floor')?.style.getPropertyValue('--rows') ?? null,
    },
    presenca: {
      existe: !!document.querySelector('.presence-col'),
      escondida: !!document.querySelector('.presence-col.hidden'),
    },
    hud: txt('.hud-metric-value'),
  }, null, 2);
})()`);

console.log(estado);

if (SHOT) {
  try {
    const { data } = await enviar('Page.captureScreenshot', { format: 'png' }, 12000);
    writeFileSync(SHOT, Buffer.from(data, 'base64'));
    console.log(`\ncaptura em ${SHOT}`);
  } catch (erro) {
    console.log(`\nsem captura: ${erro.message} (janela minimizada ou coberta?)`);
  }
}

socket.close();
process.exit(0);

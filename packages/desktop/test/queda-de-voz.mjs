/**
 * Cair da chamada tem que virar explicacao, nao silencio.
 *
 * Alguem tentou entrar na voz oito vezes seguidas sem nunca saber por que
 * caia: o aplicativo apenas o tirava do canal, sem uma palavra. Este teste
 * cobra as tres coisas que faltavam — avisar que esta reconectando, explicar
 * quando desiste, e nao inventar explicacao quando a saida foi voluntaria.
 *
 * Provoca a queda parando o servidor de midia de verdade. Derrubar a sala por
 * dentro exigiria expor objeto interno numa variavel global so para teste, e
 * ainda seria uma desconexao encenada; parar o SFU e literalmente o que
 * acontece quando a conexao morre.
 *
 *   node packages/desktop/test/queda-de-voz.mjs <host-ssh> [porta-de-depuracao]
 *
 * Espera o app aberto com depuracao e ja logado. O SFU fica fora do ar por
 * cerca de um minuto durante o teste — nao rode com gente em chamada.
 */

import WebSocket from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HOST = process.argv[2];
const PORTA = Number(process.argv[3] ?? 9222);

if (!HOST) {
  console.error('uso: node queda-de-voz.mjs <host-ssh> [porta]');
  console.error('exemplo: node queda-de-voz.mjs pitohui@192.168.100.21');
  process.exit(2);
}

async function noServidor(comando) {
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', HOST, `cd ~/kiroshi/deploy && ${comando}`],
    { timeout: 60000 },
  );
  return stdout.trim();
}

const alvos = await fetch(`http://127.0.0.1:${PORTA}/json`).then((r) => r.json());
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!pagina) {
  console.error(`nenhuma janela na porta ${PORTA}`);
  process.exit(1);
}

const socket = new WebSocket(pagina.webSocketDebuggerUrl);
let proximoId = 1;
const pendentes = new Map();

function enviar(metodo, params = {}, prazo = 45000) {
  const id = proximoId++;
  socket.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro });
    setTimeout(() => {
      if (pendentes.delete(id)) erro(new Error(`tempo esgotado em ${metodo}`));
    }, prazo);
  });
}

socket.on('message', (bruto) => {
  const m = JSON.parse(bruto.toString());
  const w = pendentes.get(m.id);
  if (!w) return;
  pendentes.delete(m.id);
  if (m.error) w.erro(new Error(m.error.message));
  else w.ok(m.result);
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

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

const HUD = `(() => {
  const h = document.querySelector('.hud');
  return h ? h.innerText.split(String.fromCharCode(10)).filter(Boolean).join(' | ') : null;
})()`;

const ENTRAR = `(async () => {
  const ate = async (c, p = 25000) => {
    const f = Date.now() + p;
    while (Date.now() < f) { if (c()) return true; await new Promise(r => setTimeout(r, 200)); }
    return false;
  };
  for (const sv of [...document.querySelectorAll('.rail-slot[data-guild]')]) {
    sv.click();
    await new Promise(r => setTimeout(r, 600));
    if (document.querySelector('.channel[data-tipo="GUILD_VOICE"]')) break;
  }
  const voz = document.querySelector('.channel[data-tipo="GUILD_VOICE"]');
  if (!voz) return JSON.stringify({ erro: 'nenhum canal de voz' });
  voz.click();
  await ate(() => document.querySelector('.stage'));
  await new Promise(r => setTimeout(r, 2500));
  return JSON.stringify({ palco: Boolean(document.querySelector('.stage')) });
})()`;

try {
  // -------------------------------------------------------------------------
  console.log('\n--- SAIR DE PROPOSITO NAO GERA EXPLICACAO ---');

  const e1 = JSON.parse(await avaliar(ENTRAR));
  check('entra no canal de voz', e1.palco === true, e1.erro ?? '');
  if (!e1.palco) throw new Error('sem chamada nao da para seguir');

  const saida = JSON.parse(
    await avaliar(`(async () => {
      const sair = [...document.querySelectorAll('.hud-controls button')]
        .find(b => /sair da chamada/i.test(b.getAttribute('aria-label') || ''));
      if (!sair) return JSON.stringify({ erro: 'botao de sair nao encontrado' });
      sair.click();
      await new Promise(r => setTimeout(r, 4000));
      return JSON.stringify({ palco: Boolean(document.querySelector('.stage')), hud: ${HUD} });
    })()`),
  );
  check('sair tira o palco', saida.palco === false, saida.erro ?? '');
  check(
    'sair nao inventa explicacao de queda',
    !/caiu|IPv6|instabilidade/i.test(saida.hud ?? ''),
    saida.hud ?? '',
  );

  // -------------------------------------------------------------------------
  console.log('\n--- RECONECTANDO APARECE ---');

  const e2 = JSON.parse(await avaliar(ENTRAR));
  check('entra de novo', e2.palco === true, e2.erro ?? '');

  await noServidor('docker compose stop livekit');

  /*
    Espera o aviso aparecer em vez de olhar num instante escolhido a dedo.

    O LiveKit leva um tempo variavel para concluir que perdeu a midia — as
    vezes dois segundos, as vezes vinte. Conferir num momento fixo fazia o
    teste acusar ausencia de um aviso que aparecia logo depois.

    A mesma espera ja coleta o desfecho final, porque um dos dois acontece:
    ou ele reconecta, ou desiste e explica.
  */
  let viuReconectando = false;
  let hudFinal = null;
  for (let i = 0; i < 40; i++) {
    await dormir(3000);
    hudFinal = await avaliar(HUD);
    if (/reconectando/i.test(hudFinal ?? '')) viuReconectando = true;
    if (/caiu|IPv6|instabilidade/i.test(hudFinal ?? '')) break;
  }

  check('a barra avisa que esta reconectando', viuReconectando, hudFinal ?? '');

  // -------------------------------------------------------------------------
  console.log('\n--- DESISTIR VIRA EXPLICACAO ---');

  check(
    'a queda explica o motivo',
    /caiu|IPv6|instabilidade/i.test(hudFinal ?? ''),
    hudFinal ?? 'nenhuma explicacao apareceu',
  );
  check(
    'a explicacao diz o que fazer',
    /diagnostico|avise|tente/i.test(hudFinal ?? ''),
    /diagnostico|avise|tente/i.test(hudFinal ?? '') ? '' : 'texto sem orientacao',
  );
} finally {
  // O SFU volta aconteca o que acontecer: um teste nao pode deixar o servidor
  // de midia parado porque falhou no meio.
  console.log('\n--- RESTAURANDO O SFU ---');
  const estado = await noServidor(
    'docker compose start livekit >/dev/null 2>&1; sleep 6; docker compose ps --format "{{.Name}} {{.Status}}"',
  ).catch((e) => `FALHOU: ${e.message}`);
  console.log(
    estado
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  check('o SFU volta no ar', /livekit.*Up/i.test(estado), '');
}

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

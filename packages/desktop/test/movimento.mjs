/**
 * Verifica a preferencia de movimento.
 *
 * O caso que motivou este teste: esta maquina tem os efeitos de animacao
 * desligados no Windows, e a consulta de midia estava suprimindo todas as
 * transicoes do aplicativo. O comportamento esta certo por padrao, mas quem
 * desligou as animacoes do sistema por causa de desempenho precisa poder
 * pedir movimento so aqui — e quem precisa de tela parada precisa poder
 * garantir isso mesmo que o sistema nao esteja configurado.
 *
 * Por isso as duas direcoes sao testadas, e nao so "o padrao funciona".
 *
 *   node packages/desktop/test/movimento.mjs [porta]
 */

import WebSocket from 'ws';

const PORTA = Number(process.argv[2] ?? 9222);

const alvos = await fetch(`http://127.0.0.1:${PORTA}/json`).then((r) => r.json());
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!pagina) {
  console.error(`nenhuma janela na porta ${PORTA}`);
  process.exit(1);
}

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
    }, 30000);
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

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

/** Mede um elemento que a camada de movimento deve alcancar. */
const MEDIR = `(() => {
  const alvo = document.querySelector('.channel') ?? document.querySelector('button');
  const c = getComputedStyle(alvo);
  return {
    propriedades: c.transitionProperty,
    duracao: c.transitionDuration,
    ms: Math.round(parseFloat(c.transitionDuration) * 1000),
    marca: document.documentElement.dataset.mov ?? '(sem marca)',
  };
})()`;

const sistema = JSON.parse(
  await avaliar(
    `JSON.stringify({ reduz: matchMedia('(prefers-reduced-motion: reduce)').matches })`,
  ),
);
console.log(`\nO sistema pede movimento reduzido: ${sistema.reduz ? 'sim' : 'nao'}`);

// ---------------------------------------------------------------------------
console.log('\n--- A CAMADA DE MOVIMENTO EXISTE ---');

const alcance = JSON.parse(
  await avaliar(`(() => {
    const alvos = ['.channel', '.member', '.server', '.tile', '.stage-act', '.btn'];
    const semTransicao = alvos.filter(sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const p = getComputedStyle(el).transitionProperty;
      return !p || p === 'all' || p === 'none';
    });
    const ausentes = alvos.filter(sel => !document.querySelector(sel));
    return JSON.stringify({ semTransicao, ausentes });
  })()`),
);
check(
  'os elementos interativos declaram o que transiciona',
  alcance.semTransicao.length === 0,
  alcance.semTransicao.length ? `faltou em: ${alcance.semTransicao.join(', ')}` : '',
);

// ---------------------------------------------------------------------------
console.log('\n--- FORCAR MOVIMENTO COMPLETO ---');

const completo = JSON.parse(
  await avaliar(`(() => {
    document.documentElement.dataset.mov = 'completo';
    return JSON.stringify(${MEDIR});
  })()`),
);
check('a marca chega ao documento', completo.marca === 'completo');
check(
  'as transicoes voltam a ter duracao real',
  completo.ms >= 80,
  `${completo.ms}ms (${completo.duracao})`,
);

// ---------------------------------------------------------------------------
console.log('\n--- FORCAR SEM MOVIMENTO ---');

const reduzido = JSON.parse(
  await avaliar(`(() => {
    document.documentElement.dataset.mov = 'reduzido';
    return JSON.stringify(${MEDIR});
  })()`),
);
check('a marca chega ao documento', reduzido.marca === 'reduzido');
check(
  'nada se move, mesmo com o sistema permitindo',
  reduzido.ms <= 1,
  `${reduzido.ms}ms (${reduzido.duracao})`,
);

// ---------------------------------------------------------------------------
console.log('\n--- SEGUIR O SISTEMA ---');

const seguindo = JSON.parse(
  await avaliar(`(() => {
    delete document.documentElement.dataset.mov;
    return JSON.stringify(${MEDIR});
  })()`),
);
check('sem escolha, nao ha marca no documento', seguindo.marca === '(sem marca)');
check(
  sistema.reduz
    ? 'com o sistema pedindo silencio, a interface nao se move'
    : 'com o sistema permitindo, a interface se move',
  sistema.reduz ? seguindo.ms <= 1 : seguindo.ms >= 80,
  `${seguindo.ms}ms`,
);

// ---------------------------------------------------------------------------
console.log('\n--- A ESCOLHA SOBREVIVE AO RECARREGAR ---');

await avaliar(`localStorage.setItem('kiroshi.movimento', 'completo')`);
await enviar('Page.reload');
await new Promise((r) => setTimeout(r, 6000));

const depois = JSON.parse(await avaliar(`JSON.stringify(${MEDIR})`));
check('a marca e reaplicada ao abrir', depois.marca === 'completo', depois.marca);
check('e o movimento volta junto', depois.ms >= 80, `${depois.ms}ms`);

// Devolve ao padrao, para nao deixar a maquina configurada pelo teste.
await avaliar(`(() => {
  localStorage.removeItem('kiroshi.movimento');
  delete document.documentElement.dataset.mov;
  return true;
})()`);

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

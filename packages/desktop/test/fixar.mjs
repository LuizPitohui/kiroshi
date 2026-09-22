/**
 * Fixar mensagem, pelo caminho de quem tem permissao.
 *
 * O teste de conversa cobre o caso sem permissao — que agora mostra o erro em
 * vez de nao fazer nada. Falta o caso que interessa a quem manda no servidor:
 * fixar de verdade, ver a marca, e desafixar.
 *
 * Para isso a conta de teste cria o proprio servidor, onde ela e dona. Pedir
 * permissao emprestada no servidor de outra pessoa seria mais fragil e sujaria
 * um lugar que nao e do teste.
 *
 *   node packages/desktop/test/fixar.mjs <servidor> <usuario> <senha> [porta]
 *
 * Espera o app aberto com depuracao e ja logado com essa mesma conta.
 */

import WebSocket from 'ws';

const BASE = (process.argv[2] ?? 'https://order.arasaka.fun').replace(/\/+$/, '');
const USUARIO = process.argv[3];
const SENHA = process.argv[4];
const PORTA = Number(process.argv[5] ?? 9222);

if (!USUARIO || !SENHA) {
  console.error('uso: node fixar.mjs <servidor> <usuario> <senha> [porta]');
  process.exit(2);
}

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

// ---------------------------------------------------------------------------
// Monta o cenario pela API: e mais estavel que navegar por menus, e o que
// esta sendo testado e a tela de mensagem, nao a de criar servidor.
// ---------------------------------------------------------------------------

async function api(metodo, caminho, { token, body } = {}) {
  const res = await fetch(`${BASE}/api/v1${caminho}`, {
    method: metodo,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
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

const login = await api('POST', '/auth/login', { body: { login: USUARIO, password: SENHA } });
if (!login.body?.accessToken) {
  console.error('login falhou:', JSON.stringify(login.body).slice(0, 200));
  process.exit(1);
}
const token = login.body.accessToken;

console.log('\n--- PREPARANDO UM SERVIDOR DA PROPRIA CONTA ---');

const nome = `Fixar ${Date.now().toString(36).slice(-5)}`;
const servidor = await api('POST', '/guilds', { token, body: { name: nome } });
check('cria o servidor de teste', servidor.status === 201, `status ${servidor.status}`);
if (servidor.status !== 201) process.exit(1);

const guildId = servidor.body.id;
const canal = servidor.body.channels.find((c) => c.type === 'GUILD_TEXT');
check('o servidor vem com canal de texto', Boolean(canal));

const msg = await api('POST', `/channels/${canal.id}/messages`, {
  token,
  body: { content: 'mensagem para fixar' },
});
check('manda a mensagem que sera fixada', msg.status === 201, `status ${msg.status}`);

// ---------------------------------------------------------------------------
// Agora pela interface.
// ---------------------------------------------------------------------------

const alvos = await fetch(`http://127.0.0.1:${PORTA}/json`).then((r) => r.json());
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!pagina) {
  console.error(`nenhuma janela na porta ${PORTA}`);
  process.exit(1);
}

const socket = new WebSocket(pagina.webSocketDebuggerUrl);
let proximoId = 1;
const pendentes = new Map();

function enviar(metodo, params = {}, prazo = 60000) {
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

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

console.log('\n--- ABRIR O SERVIDOR NOVO ---');

const abriu = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 15000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) { if (cond()) return true; await new Promise(r => setTimeout(r, 150)); }
      return false;
    };

    // O servidor acabou de nascer e chega pelo gateway; espera aparecer.
    const achou = await ate(() => document.querySelector('.rail-slot[data-guild="${guildId}"]'));
    if (!achou) return JSON.stringify({ erro: 'o servidor novo nao apareceu na barra' });

    document.querySelector('.rail-slot[data-guild="${guildId}"]').click();
    await ate(() => document.querySelector('.channel[data-tipo="GUILD_TEXT"]'));
    document.querySelector('.channel[data-tipo="GUILD_TEXT"]').click();
    await ate(() => document.querySelectorAll('.msg').length > 0);
    await new Promise(r => setTimeout(r, 700));

    return JSON.stringify({ mensagens: document.querySelectorAll('.msg').length });
  })()`),
);
check('abre o servidor e o canal', (abriu.mensagens ?? 0) > 0, abriu.erro ?? `${abriu.mensagens} mensagem(ns)`);
if (!abriu.mensagens) {
  socket.close();
  process.exit(1);
}

console.log('\n--- FIXAR ---');

const fixou = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 8000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) { if (cond()) return true; await new Promise(r => setTimeout(r, 100)); }
      return false;
    };

    const msg = [...document.querySelectorAll('.msg')].pop();
    msg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    msg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const botao = [...msg.querySelectorAll('.msg-action')]
      .find(b => /^fixar$/i.test(b.getAttribute('aria-label') || ''));
    if (!botao) return JSON.stringify({
      erro: 'botao de fixar nao encontrado',
      acoes: [...msg.querySelectorAll('.msg-action')].map(b => b.getAttribute('aria-label')),
    });

    botao.click();
    let aviso = null;
    await ate(() => {
      const t = msg.querySelector('.msg-aviso')?.textContent;
      if (t) { aviso = t; return true; }
      return msg.classList.contains('pinned');
    });

    return JSON.stringify({
      aviso,
      marcou: msg.classList.contains('pinned'),
      selo: msg.querySelector('.msg-pinned')?.textContent?.trim() ?? null,
      rotulo: [...msg.querySelectorAll('.msg-action')]
        .find(b => /fixar/i.test(b.getAttribute('aria-label') || ''))?.getAttribute('aria-label'),
    });
  })()`),
);

check('clicar em fixar marca a mensagem', fixou.marcou === true, fixou.erro ?? fixou.aviso ?? '');
check('a mensagem ganha o selo "Fixada"', /fixada/i.test(fixou.selo ?? ''), fixou.selo ?? 'sem selo');
check('o botao vira "Desafixar"', /desafixar/i.test(fixou.rotulo ?? ''), fixou.rotulo ?? '');

console.log('\n--- APARECE NA LISTA DE FIXADAS ---');

const naLista = await api('GET', `/channels/${canal.id}/pins`, { token });
check(
  'o servidor devolve a mensagem entre as fixadas',
  Array.isArray(naLista.body) && naLista.body.length === 1,
  `${Array.isArray(naLista.body) ? naLista.body.length : '?'} fixada(s)`,
);

console.log('\n--- DESAFIXAR ---');

const desfez = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 8000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) { if (cond()) return true; await new Promise(r => setTimeout(r, 100)); }
      return false;
    };
    const msg = [...document.querySelectorAll('.msg')].pop();
    msg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const botao = [...msg.querySelectorAll('.msg-action')]
      .find(b => /desafixar/i.test(b.getAttribute('aria-label') || ''));
    if (!botao) return JSON.stringify({ erro: 'botao de desafixar nao encontrado' });
    botao.click();
    const saiu = await ate(() => !msg.classList.contains('pinned'));
    return JSON.stringify({ saiu, selo: Boolean(msg.querySelector('.msg-pinned')) });
  })()`),
);
check('desafixar tira a marca', desfez.saiu === true, desfez.erro ?? '');
check('o selo some junto', desfez.selo === false);

const vazia = await api('GET', `/channels/${canal.id}/pins`, { token });
check(
  'o servidor esvazia a lista de fixadas',
  Array.isArray(vazia.body) && vazia.body.length === 0,
  `${Array.isArray(vazia.body) ? vazia.body.length : '?'} fixada(s)`,
);

// ---------------------------------------------------------------------------
console.log('\n--- LIMPAR ---');

const apagou = await api('DELETE', `/guilds/${guildId}`, { token });
check('apaga o servidor de teste', apagou.status === 200, `status ${apagou.status}`);

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

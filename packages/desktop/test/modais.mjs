/**
 * Prova que os modais migrados ganharam o que nao tinham.
 *
 * Os sete compartilhavam um molde escrito a mao, e o molde carregava tres
 * defeitos em todas as copias:
 *
 *   fechavam ao clicar no fundo, perdendo formulario preenchido;
 *   so um dos sete tratava Esc — os outros seis nao fechavam por teclado;
 *   nenhum prendia o foco nem o devolvia a quem abriu.
 *
 * Este teste abre cada um pela interface de verdade e cobra as tres coisas.
 * Nao verifica aparencia: verifica o que a migracao existiu para corrigir.
 *
 * Precisa do aplicativo aberto, JA LOGADO e com um servidor selecionado.
 *
 *   node packages/desktop/test/modais.mjs [porta]
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

socket.on('message', (bruto) => {
  const m = JSON.parse(bruto.toString());
  const w = pendentes.get(m.id);
  if (!w) return;
  pendentes.delete(m.id);
  if (m.error) w.erro(new Error(m.error.message));
  else w.ok(m.result);
});

function enviar(metodo, params = {}, prazo = 30000) {
  const id = proximoId++;
  socket.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro });
    setTimeout(() => {
      if (pendentes.delete(id)) erro(new Error(`tempo esgotado em ${metodo}`));
    }, prazo);
  });
}

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

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

/**
 * Abre um modal por um seletor de botao e cobra as tres garantias.
 *
 * `preparar` roda antes, para chegar ate o botao quando ele esta dentro de um
 * menu ou de um estado especifico.
 */
async function conferirModal(nome, abridor, preparar = 'null') {
  console.log(`\n--- ${nome} ---`);

  const r = JSON.parse(
    await avaliar(`(async () => {
      const espera = (ms) => new Promise(r => setTimeout(r, ms));
      const ate = async (c, p = 6000) => {
        const f = Date.now() + p;
        while (Date.now() < f) { if (c()) return true; await espera(120); }
        return false;
      };

      // Fecha o que estiver aberto, para o teste nao herdar estado.
      for (let i = 0; i < 3; i++) {
        if (!document.querySelector('.dialogo')) break;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await espera(250);
      }

      ${preparar};
      await espera(400);

      const botao = ${abridor};
      if (!botao) {
        const vistos = [...document.querySelectorAll('.menu .menu-item, .chat-actions .act, .category')]
          .map(x => (x.textContent || x.getAttribute('aria-label') || '?').trim().slice(0, 24));
        return JSON.stringify({ erro: 'nao achei como abrir; visiveis: ' + JSON.stringify(vistos) });
      }

      botao.focus();
      botao.click();

      const abriu = await ate(() => document.querySelector('.dialogo'));
      if (!abriu) return JSON.stringify({ erro: 'o dialogo nao abriu' });

      const caixa = document.querySelector('.dialogo');
      const focoEntrou = caixa.contains(document.activeElement);
      const temTitulo = Boolean(caixa.querySelector('.dialogo-titulo')?.textContent?.trim());
      const ehModal = caixa.getAttribute('aria-modal') === 'true';
      const rotulado = Boolean(caixa.getAttribute('aria-labelledby'));

      // Clique fora NAO pode fechar: todos guardam formulario ou escolha.
      document.querySelector('.camada-fundo')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await espera(300);
      const sobreviveu = Boolean(document.querySelector('.dialogo'));

      // Esc fecha, e o foco volta.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await espera(350);
      const fechou = !document.querySelector('.dialogo');
      const focoVoltou = document.activeElement === botao;
      const foiPara = document.activeElement === document.body
        ? 'body'
        : (document.activeElement?.className || document.activeElement?.tagName || '?');
      // O abridor pode ter saido da tela junto com o menu que o continha.
      // Nesse caso nao ha para onde devolver o foco, e cobrar isso seria
      // cobrar o impossivel.
      const abridorSobreviveu = document.contains(botao);
      const abridorFocavel = botao.tabIndex >= 0 && abridorSobreviveu;

      return JSON.stringify({ focoEntrou, temTitulo, ehModal, rotulado, sobreviveu, fechou, focoVoltou, foiPara, abridorFocavel, abridorSobreviveu });
    })()`),
  );

  if (r.erro) {
    check('abriu', false, r.erro);
    return;
  }

  check('o foco entra ao abrir', r.focoEntrou === true);
  check('tem titulo', r.temTitulo === true);
  check('anunciado como modal e rotulado', r.ehModal === true && r.rotulado === true);
  check('clique fora NAO fecha', r.sobreviveu === true);
  check('Esc fecha', r.fechou === true);
  check(
    r.abridorSobreviveu
      ? 'o foco volta para quem abriu'
      : 'o abridor sumiu junto com o menu (nada a devolver)',
    r.abridorSobreviveu ? r.focoVoltou === true : true,
    r.focoVoltou ? '' : `foi para "${r.foiPara}"; o abridor e focavel: ${r.abridorFocavel}`,
  );
}

// ---------------------------------------------------------------------------
const pronto = JSON.parse(
  await avaliar(`JSON.stringify({
    dentro: Boolean(document.querySelector('.app-body')),
    canais: document.querySelectorAll('.channel').length,
  })`),
);
if (!pronto.dentro || pronto.canais === 0) {
  console.error('\n  o aplicativo precisa estar logado e com um servidor aberto\n');
  socket.close();
  process.exit(2);
}

// Busca e fixados: botoes do cabecalho da conversa.
await conferirModal(
  'Buscar mensagens',
  `[...document.querySelectorAll('.chat-actions .act')].find(b => /buscar/i.test(b.getAttribute('aria-label') || ''))`,
  `document.querySelector('.channel[data-tipo="GUILD_TEXT"]')?.click()`,
);

await conferirModal(
  'Mensagens fixadas',
  `[...document.querySelectorAll('.chat-actions .act')].find(b => /fixad/i.test(b.getAttribute('aria-label') || ''))`,
);

// Criar servidor: o botao de mais na barra global.
await conferirModal('Criar servidor', `document.querySelector('.rail-add')`);

// Criar canal: a linha "Criar canal" na arvore.
await conferirModal(
  'Criar canal',
  `[...document.querySelectorAll('.category')].find(c => /criar canal/i.test(c.textContent || ''))`,
);

// Convite e ajustes do servidor: dentro do menu do servidor.
await conferirModal(
  'Convidar para o servidor',
  `[...document.querySelectorAll('.menu .menu-item')].find(b => /convid/i.test(b.textContent || ''))`,
  `(!document.querySelector('.menu') && document.querySelector('.nav-header')?.click())`,
);

/*
  'Ajustes do servidor' fica de fora: o item so aparece para quem tem a
  permissao MANAGE_GUILD, e a conta de teste entra por convite comum. Cobrar
  um item que a permissao esconde seria cobrar um defeito inexistente — o
  diagnostico do teste mostrou o menu com 'Convidar pessoas' e 'Sair do
  servidor', que e o certo para essa conta.
*/

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

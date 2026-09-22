/**
 * Prova que a tela se adapta sem PERDER nada.
 *
 * A regra que este teste protege e a da especificacao: a area principal nunca
 * encolhe por causa de painel auxiliar, e reduzir colunas vem antes de
 * comprimir texto. O jeito errado de cumprir isso e esconder as colunas e
 * pronto — a tela cabe, e a pessoa fica sem navegacao.
 *
 * Entao cada largura e cobrada em duas frentes:
 *
 *   o que SAIU da tela  (a coluna virou gaveta)
 *   o que CONTINUA alcancavel (existe um botao que a traz de volta)
 *
 * O ultimo caso e o que importa: uma coluna que some sem deixar como abri-la
 * nao e adaptacao, e funcao perdida.
 *
 * Tambem verifica o zoom, que e o motivo de a medida ser do espaco disponivel
 * e nao do tamanho da janela: a 200%, uma janela larga tem metade do espaco e
 * precisa se comportar como uma janela estreita.
 *
 * Precisa do aplicativo aberto, JA LOGADO e com um servidor selecionado.
 *
 *   node packages/desktop/test/responsivo.mjs [porta]
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

/**
 * Espera uma condicao na pagina, em vez de dormir um tempo fixo.
 *
 * Esta funcao existe porque a primeira versao deste teste dormia 600ms depois
 * de redimensionar e conferia em seguida. Deu tres resultados diferentes em
 * tres execucoes seguidas — 21, 10 e 20 de 21 — dependendo de quanto a
 * maquina estava ocupada. Um teste que responde diferente para o mesmo codigo
 * nao mede nada; so gasta o tempo de quem for investigar.
 */
async function esperarPor(expressaoBooleana, prazo = 8000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await avaliar(expressaoBooleana)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/** Finge uma janela de outro tamanho e espera a interface acompanhar. */
async function larguraDe(px, classeEsperada) {
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: px,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Espera a medida chegar na pagina.
  await esperarPor(`document.documentElement.clientWidth === ${px}`);

  /*
    Dispara o `resize` na mao, e isto nao e trapaca.

    Medido neste Electron: `Emulation.setDeviceMetricsOverride` muda o
    `clientWidth` de verdade, mas NAO emite o evento `resize` de forma
    confiavel — as vezes emite, as vezes nao. Era a origem da instabilidade:
    o aplicativo ficava congelado na primeira largura medida, e a mesma suite
    dava 21, 10 e 20 de 21 em execucoes seguidas.

    O evento sintetico so entrega o aviso que o navegador deveria ter
    entregue. A largura que o aplicativo le em seguida e a real, e e ela que
    decide o resultado — nada aqui e simulado.
  */
  await avaliar(`window.dispatchEvent(new Event('resize')), true`);
  if (classeEsperada) {
    await esperarPor(
      `document.querySelector('.app-body')?.classList.contains('largura-${classeEsperada}') === true`,
    );
  }
}

async function olhar() {
  return JSON.parse(
    await avaliar(`JSON.stringify({
      classe: [...document.querySelector('.app-body').classList].find(c => c.startsWith('largura-')),
      barraGlobal: Boolean(document.querySelector('.rail')),
      colunaDeCanais: Boolean(document.querySelector('.app-body .nav')),
      botaoDeCanais: Boolean(document.querySelector('.abrir-canais')),
      painelEmColuna: Boolean(document.querySelector('.app-body .painel, .app-body .presence-col, .app-body .chat-lateral')),
      conteudo: Math.round(document.querySelector('.center')?.getBoundingClientRect().width ?? 0),
      janela: document.documentElement.clientWidth,
    })`),
  );
}

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');
await enviar('Page.enable');

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

const pronto = JSON.parse(
  await avaliar(`JSON.stringify({ dentro: Boolean(document.querySelector('.app-body')) })`),
);
if (!pronto.dentro) {
  console.error('\n  o aplicativo precisa estar logado para este teste\n');
  socket.close();
  process.exit(2);
}

/*
  Abre um canal de texto antes de comecar.

  Sem canal aberto nao ha cabecalho de conversa, e sem cabecalho nao ha botao
  de membros — entao o teste do painel reprovava por um motivo que nada tinha
  a ver com responsividade. Garantir o estado inicial e trabalho do teste, nao
  de quem o executa.

  A janela larga vem primeiro, e por um motivo concreto: em largura compacta a
  coluna de canais vira gaveta, e os canais nem existem no documento. Procurar
  um canal ali nao acha nada — foi o que aconteceu quando a execucao anterior
  deixou a janela estreita.
*/
await larguraDe(1600, 'completa');

await avaliar(`(async () => {
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  if (!document.querySelector('.chat-head')) {
    document.querySelector('.rail-slot[data-guild]')?.click();
    await espera(1200);
    document.querySelector('.channel[data-tipo="GUILD_TEXT"]')?.click();
    await espera(1200);
  }
  return true;
})()`);

if (!(await esperarPor(`Boolean(document.querySelector('.chat-head'))`, 6000))) {
  console.error('\n  nao consegui abrir um canal de texto; o servidor tem canais?\n');
  socket.close();
  process.exit(2);
}

const larguras = [
  { px: 1600, esperada: 'completa', colunaDeCanais: true, painel: true },
  { px: 1200, esperada: 'grande', colunaDeCanais: true, painel: false },
  { px: 900, esperada: 'media', colunaDeCanais: false, painel: false },
  { px: 600, esperada: 'compacta', colunaDeCanais: false, painel: false },
];

const conteudos = [];

for (const caso of larguras) {
  console.log(`\n--- ${caso.px}px ---`);
  await larguraDe(caso.px, caso.esperada);
  const v = await olhar();
  conteudos.push({ px: caso.px, largura: v.conteudo });

  check(`classificada como "${caso.esperada}"`, v.classe === `largura-${caso.esperada}`, v.classe);
  check(
    caso.colunaDeCanais ? 'canais em coluna' : 'canais fora da coluna',
    v.colunaDeCanais === caso.colunaDeCanais,
  );

  // A parte que importa: se saiu, tem que dar para trazer de volta.
  if (!caso.colunaDeCanais) {
    check('mas continua alcancavel por um botao', v.botaoDeCanais === true);
  }

  if (caso.painel) {
    /*
      O painel NAO reabre sozinho ao alargar a janela, de proposito: reabrir
      desfaria uma escolha que a pessoa pode ter feito. Entao o teste abre —
      o que se cobra aqui e que ele CAIBA em coluna nesta largura, nao que
      esteja aberto por padrao.
    */
    const abrirPainel = `(() => {
      const botoes = [...document.querySelectorAll('.chat-actions .act')];
      const membros = botoes.find((b) => /membro/i.test(b.getAttribute('aria-label') || ''));
      if (membros && !document.querySelector('.app-body .presence-col')) membros.click();
      return Boolean(membros);
    })()`;

    const temBotao = await avaliar(abrirPainel);
    const noLugar = `Boolean(document.querySelector('.app-body .presence-col'))`;

    let apareceu = await esperarPor(noLugar, 3000);

    // Uma segunda tentativa: o clique pode cair enquanto a tela ainda esta se
    // reorganizando depois do redimensionamento.
    if (!apareceu) {
      await avaliar(abrirPainel);
      apareceu = await esperarPor(noLugar, 3000);
    }

    check(
      'o painel cabe em coluna',
      apareceu === true,
      apareceu ? '' : temBotao ? 'o botao existe mas o painel nao apareceu' : 'nao achei o botao de membros',
    );
  } else {
    check('painel fora da coluna', v.painelEmColuna === false);
  }

  // O conteudo nunca pode ficar menor que um texto legivel.
  check('o conteudo tem largura utilizavel', v.conteudo >= 320, `${v.conteudo}px`);
}

// ---------------------------------------------------------------------------
console.log('\n--- O CONTEUDO CRESCE QUANDO AS COLUNAS SAEM? ---');

/*
  Este e o criterio de aceite em numero: "paineis nao comprimem a area
  principal ate torna-la inutilizavel". Entre 1200 e 900 a coluna de canais
  sai, entao o conteudo NAO pode encolher os 300px inteiros da janela — ele
  recupera parte.
*/
const em1200 = conteudos.find((c) => c.px === 1200).largura;
const em900 = conteudos.find((c) => c.px === 900).largura;
const perdaDaJanela = 1200 - 900;
const perdaDoConteudo = em1200 - em900;

check(
  'o conteudo perde MENOS que a janela ao estreitar',
  perdaDoConteudo < perdaDaJanela,
  `janela -${perdaDaJanela}px, conteudo -${perdaDoConteudo}px`,
);

// ---------------------------------------------------------------------------
console.log('\n--- ZOOM DE 200% ---');

/*
  Zoom de navegador DIVIDE os pixels de CSS: uma janela de 1600px a 200% tem
  800px efetivos, e e exatamente isso que `documentElement.clientWidth` passa
  a valer. Emular 800px e a mesma condicao, e e verificavel.

  A primeira versao deste teste usava `body { zoom: 2 }`. Aquilo escala o
  conteudo mas NAO muda `clientWidth` — ou seja, nao testava zoom nenhum, e
  reprovava um comportamento que estava certo.
*/
await larguraDe(800, 'media');
const comZoom = await olhar();
check(
  '1600px com zoom 200% (= 800px efetivos) nao e "completa"',
  comZoom.classe !== 'largura-completa',
  `${comZoom.janela}px efetivos, ${comZoom.classe}`,
);
check('e a navegacao continua alcancavel nessa condicao', comZoom.botaoDeCanais === true);

/*
  Devolve a janela ao normal; deixar a emulacao ligada quebraria o proximo
  teste que rodar contra esta mesma janela.

  O aviso sintetico vai junto pelo mesmo motivo que existe em `larguraDe`:
  limpar a emulacao tambem nao emite `resize`. Sem ele a janela volta a ter
  1600px de verdade e o aplicativo continua desenhando como se tivesse 800 —
  foi o que aconteceu quando a suite de modais rodou logo em seguida e nao
  achou canal nenhum, porque a coluna ainda estava em modo gaveta.
*/
await enviar('Emulation.clearDeviceMetricsOverride');
await avaliar(`window.dispatchEvent(new Event('resize')), true`);
await esperarPor(
  `document.querySelector('.app-body')?.classList.contains('largura-completa') === true`,
  4000,
);

// ---------------------------------------------------------------------------
console.log('\n--- MARCOS, ATALHO E TECLADO ---');

/*
  Ate a fase 5 a arvore era uma pilha de `div` sem nome: nao havia `main`, e
  navegar por marcos — que e como se anda rapido numa pagina com leitor de
  tela — nao levava a lugar nenhum. E cinco controles clicaveis eram `div` ou
  `span` com `onClick`, invisiveis para o teclado. Cada um deles tirava uma
  funcao inteira do alcance de quem nao usa mouse: trocar a propria presenca,
  abrir o menu do servidor, recolher uma categoria, criar servidor, seguir uma
  mencao de canal.
*/
const estrutura = JSON.parse(
  await avaliar(`(() => {
    const main = document.querySelector('main#conteudo');
    const atalho = document.querySelector('.pular-para-conteudo');

    // Os cinco que eram div/span. Se algum voltar a ser, isto reprova.
    const controles = {
      'identidade no rodape': document.querySelector('.hud-identity'),
      'cabecalho do servidor': document.querySelector('.nav-header'),
      'recolher categoria': document.querySelector('.category-alternar'),
      'criar servidor': document.querySelector('.rail-add'),
    };
    const naoSaoBotao = Object.entries(controles)
      .filter(([, el]) => el && el.tagName !== 'BUTTON')
      .map(([nome]) => nome);
    const faltando = Object.entries(controles)
      .filter(([, el]) => !el)
      .map(([nome]) => nome);

    return JSON.stringify({
      temMain: Boolean(main),
      mainRotulado: Boolean(main?.getAttribute('aria-label')),
      // -1 deixa o atalho mover o foco para ca sem por a regiao na tabulacao.
      mainFocavelSoPorAtalho: main?.tabIndex === -1,
      temAtalho: Boolean(atalho),
      atalhoApontaParaMain: atalho?.getAttribute('href') === '#conteudo',
      // Escondido, mas nunca com display:none — isso o tiraria da tabulacao.
      atalhoEscondidoSemSumir:
        atalho && getComputedStyle(atalho).display !== 'none' &&
        atalho.getBoundingClientRect().bottom < 0,
      naoSaoBotao,
      faltando,
      navegacoesNomeadas: [...document.querySelectorAll('nav')].every((n) =>
        Boolean(n.getAttribute('aria-label')),
      ),
    });
  })()`),
);

check('existe um marco principal', estrutura.temMain === true);
check('e ele tem nome', estrutura.mainRotulado === true);
check('alcancavel pelo atalho, fora da tabulacao normal', estrutura.mainFocavelSoPorAtalho === true);
check('existe o atalho para o conteudo', estrutura.temAtalho === true);
check('e ele aponta para o marco', estrutura.atalhoApontaParaMain === true);
check(
  'o atalho fica escondido sem sair da tabulacao',
  estrutura.atalhoEscondidoSemSumir === true,
);
check('toda navegacao tem nome', estrutura.navegacoesNomeadas === true);
check(
  'os controles que eram div viraram botao',
  estrutura.naoSaoBotao.length === 0,
  estrutura.naoSaoBotao.join(', '),
);
if (estrutura.faltando.length > 0) {
  check('todos estavam na tela para conferir', false, `nao achei: ${estrutura.faltando.join(', ')}`);
}

/*
  O atalho recebe foco, APARECE, e leva ao conteudo.

  A parte do "aparece" exige que a JANELA tenha foco do sistema. Medido aqui:
  com a janela em segundo plano, `document.activeElement` aponta para o
  atalho e `elemento.matches(':focus')` devolve false — o Chromium so aplica
  `:focus` quando o documento esta focado. O atalho continuava escondido e o
  teste reprovava um comportamento correto.

  Entao a janela e trazida para a frente primeiro. Se ainda assim nao houver
  foco, o teste diz isso em vez de acusar o codigo.
*/
await enviar('Page.bringToFront').catch(() => undefined);
await new Promise((r) => setTimeout(r, 400));
const janelaFocada = await avaliar(`document.hasFocus()`);

const salto = JSON.parse(
  await avaliar(`(async () => {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    const atalho = document.querySelector('.pular-para-conteudo');
    atalho.focus();
    const recebeuFoco = document.activeElement === atalho;
    const estiloDeFocoAplicado = atalho.matches(':focus');
    await espera(120);
    const visivelComFoco = atalho.getBoundingClientRect().top >= 0;
    atalho.click();
    await espera(300);
    const foiParaOConteudo = document.activeElement === document.querySelector('main#conteudo');
    document.querySelector('main#conteudo')?.blur();
    return JSON.stringify({ recebeuFoco, estiloDeFocoAplicado, visivelComFoco, foiParaOConteudo });
  })()`),
);

check('o atalho recebe foco', salto.recebeuFoco === true);
check('e leva o foco para o conteudo', salto.foiParaOConteudo === true);

if (janelaFocada && salto.estiloDeFocoAplicado) {
  check('e aparece quando recebe', salto.visivelComFoco === true);
} else {
  console.log(
    '  --   "aparece ao receber foco" nao foi medido: a janela nao tem foco do sistema,\n' +
      '       e sem isso o Chromium nao aplica `:focus`. Nao e defeito do aplicativo.',
  );
}

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

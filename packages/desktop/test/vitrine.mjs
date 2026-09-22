/**
 * Prova que os componentes compartilhados funcionam, um por um.
 *
 * Nao e um teste de aparencia: e a verificacao de que cada peca faz o que a
 * documentacao dela promete, principalmente nas partes que nao se veem.
 *
 * O que se verifica aqui e exatamente o que se esquece ao escrever um
 * componente a mao e o que motivou extrair cada um:
 *
 *   o dialogo prende o foco e devolve para quem o abriu;
 *   Esc fecha so a camada do topo;
 *   o campo liga rotulo, erro e contador por id;
 *   a chave e um checkbox de verdade, que o teclado alterna;
 *   cada tipo de aviso tem um icone proprio, nao so uma cor;
 *   o balao se reposiciona quando nao cabe embaixo da ancora.
 *
 * Roda contra a vitrine, que monta os componentes fora do aplicativo. Precisa
 * do aplicativo aberto com a porta de depuracao e da vitrine na tela.
 *
 *   node packages/desktop/test/vitrine.mjs [porta]
 *
 * IMPORTANTE ao abrir o aplicativo para estes testes:
 *
 *   npx electron out/main/index.js --remote-debugging-port=9222 \
 *     --disable-backgrounding-occluded-windows
 *
 * Sem essa flag, o Electron marca a pagina como oculta assim que outra janela
 * cobre a dele — e uma pagina oculta para de calcular layout. Toda medida de
 * tamanho congela no ultimo valor conhecido, e o teste reprova com numeros
 * que parecem defeito de codigo. Medido: escrever `width: 400px` direto no
 * elemento e medir em seguida ainda devolvia a largura antiga. `IsIconic` do
 * Windows dizia que a janela NAO estava minimizada, e `Page.bringToFront` nao
 * resolvia; so a flag resolve.
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

/**
 * Espera uma condicao na pagina, em vez de dormir um tempo fixo.
 *
 * Nao e preciosismo. Medido nesta suite: com a janela em segundo plano o
 * Chromium limita os temporizadores a cerca de um por segundo, e o React adia
 * atualizacoes que nao vieram de gesto humano. Um `setTimeout(200)` dentro da
 * pagina devolvia o controle ANTES de o React ter desenhado, e a medicao
 * seguinte lia a largura antiga — o painel tinha 368px guardados e o teste
 * media 320px, reprovando um comportamento que estava certo.
 *
 * Esperando do lado do Node, a espera nao passa pelo acelerador do navegador.
 */
async function esperarPor(expressaoBooleana, prazo = 15000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await avaliar(expressaoBooleana)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/**
 * Recusa medir geometria em uma janela que nao esta desenhando.
 *
 * Com a janela minimizada ou totalmente coberta, o Chromium para de calcular
 * layout: `getBoundingClientRect` devolve o ultimo valor conhecido e
 * `requestAnimationFrame` nunca dispara. Medido aqui — escrever
 * `width: 400px` direto no elemento e medir em seguida ainda devolvia a
 * largura antiga.
 *
 * Isso reprovava quatro verificacoes do painel com numeros que pareciam
 * defeito de codigo: "guardado 368, real 320". Um teste que reprova por causa
 * do estado da janela custa mais caro do que um que nao roda, porque manda
 * alguem procurar um defeito que nao existe.
 */
async function exigirJanelaDesenhando() {
  const oculta = await avaliar(`document.visibilityState === 'hidden'`);
  if (!oculta) return;

  // Uma segunda chance: trazer para a frente costuma bastar quando ela so
  // perdeu o foco.
  await enviar('Page.bringToFront').catch(() => undefined);
  await new Promise((r) => setTimeout(r, 600));

  if (await avaliar(`document.visibilityState === 'hidden'`)) {
    console.error(
      '\n  a janela do aplicativo esta oculta ou minimizada.\n' +
        '  sem ela desenhando, nenhuma medida de tamanho vale nada.\n' +
        '  restaure a janela e rode de novo.\n',
    );
    socket.close();
    process.exit(2);
  }
}

let passou = 0;
let falhou = 0;
function check(nome, ok, detalhe = '') {
  if (ok) passou++;
  else falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- A VITRINE ESTA ABERTA? ---');

await exigirJanelaDesenhando();

/*
  Recarrega antes de comecar.

  Sem isto a suite herda o estado da execucao anterior, e ha verificacao que
  so faz sentido em pagina nova — "as regioes de anuncio nascem vazias" passou
  na primeira execucao e reprovou nas duas seguintes, porque o texto da
  anterior ainda estava la. Um teste que depende da ordem em que foi rodado
  nao mede o aplicativo; mede a propria historia.
*/
const jaNaVitrine = await avaliar(`location.search.includes('vitrine')`);
if (jaNaVitrine) {
  await enviar('Page.reload');
  await esperarPor(`Boolean(document.querySelector('.vitrine'))`, 20000);
  // Um instante a mais para os efeitos assentarem antes da primeira leitura.
  await new Promise((r) => setTimeout(r, 400));
}

const pronto = JSON.parse(
  await avaliar(`JSON.stringify({ vitrine: Boolean(document.querySelector('.vitrine')) })`),
);
check('a vitrine esta na tela', pronto.vitrine === true, pronto.vitrine ? '' : 'abra a vitrine antes');
if (!pronto.vitrine) {
  socket.close();
  process.exit(2);
}

/*
  As regioes de anuncio existem VAZIAS ao carregar.

  Esta leitura tem que ser a primeira da suite, antes de qualquer coisa
  anunciar. A primeira versao media isso no fim, junto com os outros testes de
  anuncio, e passava so na primeira execucao: da segunda em diante as regioes
  ainda tinham o texto da anterior, e o teste reprovava a si mesmo.

  O que se cobra aqui e o requisito que mais se erra em `aria-live`: uma
  regiao criada JUNTO com o texto nao e anunciada, porque o leitor de tela so
  observa regioes que ja existiam quando o conteudo mudou.
*/
const regioesAoCarregar = JSON.parse(
  await avaliar(`(() => {
    const educada = document.querySelector('[role="status"][aria-live="polite"]');
    const urgente = document.querySelector('[role="alert"][aria-live="assertive"]');
    return JSON.stringify({
      existem: Boolean(educada && urgente),
      vazias: (educada?.textContent ?? 'x').trim() === '' && (urgente?.textContent ?? 'x').trim() === '',
    });
  })()`),
);

check('as duas regioes de anuncio existem', regioesAoCarregar.existem === true);
check(
  'e nascem vazias, antes de qualquer anuncio',
  regioesAoCarregar.vazias === true,
  regioesAoCarregar.vazias ? '' : 'recarregue a vitrine: sobrou texto da execucao anterior',
);

// ---------------------------------------------------------------------------
console.log('\n--- DIALOGO: FOCO E TECLADO ---');

const dialogo = JSON.parse(
  await avaliar(`(async () => {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));

    const abrir = document.querySelector('[data-vitrine="abrir-dialogo"]');
    abrir.focus();
    abrir.click();
    await espera(350);

    const caixa = document.querySelector('.dialogo');
    const focoEntrou = Boolean(caixa && caixa.contains(document.activeElement));

    // Tab no ultimo elemento tem que voltar para o primeiro, e nao escapar.
    const focaveis = [...caixa.querySelectorAll('button, input, textarea, a[href]')];
    focaveis[focaveis.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await espera(120);
    const circulou = caixa.contains(document.activeElement);

    // Clique fora NAO pode fechar um dialogo: ele guarda formulario.
    document.querySelector('.camada-fundo').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true })
    );
    await espera(250);
    const sobreviveuAoCliqueFora = Boolean(document.querySelector('.dialogo'));

    // Esc fecha.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await espera(300);
    const fechou = !document.querySelector('.dialogo');
    const focoVoltou = document.activeElement === abrir;

    return JSON.stringify({ focoEntrou, circulou, sobreviveuAoCliqueFora, fechou, focoVoltou });
  })()`),
);

check('o foco entra no dialogo ao abrir', dialogo.focoEntrou === true);
check('Tab circula dentro e nao escapa', dialogo.circulou === true);
check('clique fora NAO fecha (guarda formulario)', dialogo.sobreviveuAoCliqueFora === true);
check('Esc fecha', dialogo.fechou === true);
check('o foco volta para quem abriu', dialogo.focoVoltou === true);

// ---------------------------------------------------------------------------
console.log('\n--- CAMPO: ROTULO, ERRO E CONTADOR ---');

const campo = JSON.parse(
  await avaliar(`(async () => {
    const entrada = document.querySelector('[data-vitrine="campo-erro"] input');
    const rotulo = document.querySelector('[data-vitrine="campo-erro"] label');
    const descrito = entrada.getAttribute('aria-describedby');
    const erro = descrito ? document.getElementById(descrito.split(' ')[0]) : null;

    /*
      O botao ALTERNA, entao o teste nao pode depender do estado inicial.

      A primeira versao exigia 'password' antes e 'text' depois. Passava uma
      vez e reprovava na seguinte, porque a rodada anterior tinha deixado a
      senha visivel. O que importa e que o clique TROQUE, e que o resultado
      volte ao ponto de partida no segundo clique — assim o teste tambem nao
      deixa sujeira para a proxima execucao.
    */
    const senha = document.querySelector('[data-vitrine="campo-senha"] input');
    const olho = document.querySelector('[data-vitrine="campo-senha"] .campo-olho');
    const espera = () => new Promise(r => setTimeout(r, 150));

    const tipoAntes = senha.type;
    olho.click();
    await espera();
    const tipoDepois = senha.type;

    olho.click();
    await espera();
    const voltou = senha.type === tipoAntes;

    return JSON.stringify({
      rotuloLigado: rotulo.getAttribute('for') === entrada.id && entrada.id.length > 0,
      marcadoInvalido: entrada.getAttribute('aria-invalid') === 'true',
      erroLigado: Boolean(erro) && erro.textContent.length > 0,
      erroAnunciado: erro?.getAttribute('role') === 'alert',
      senhaAlterna: tipoDepois !== tipoAntes && ['text','password'].includes(tipoDepois),
      senhaVolta: voltou,
    });
  })()`),
);

check('rotulo ligado ao campo por id', campo.rotuloLigado === true);
check('campo marcado como invalido', campo.marcadoInvalido === true);
check('erro ligado por aria-describedby', campo.erroLigado === true);
check('erro anunciado ao leitor de tela', campo.erroAnunciado === true);
check('mostrar senha alterna o tipo do campo', campo.senhaAlterna === true);
check('e volta ao clicar de novo', campo.senhaVolta === true);

// ---------------------------------------------------------------------------
console.log('\n--- CHAVE: E UM CHECKBOX DE VERDADE ---');

const chave = JSON.parse(
  await avaliar(`(() => {
    const entrada = document.querySelector('[data-vitrine="chave"] input');
    const rotulo = document.querySelector('[data-vitrine="chave"] label');
    const antes = entrada.checked;
    entrada.click();
    return JSON.stringify({
      ehCheckbox: entrada.type === 'checkbox',
      alcancavel: entrada.tabIndex >= 0 && getComputedStyle(entrada).display !== 'none',
      rotuloLigado: rotulo.getAttribute('for') === entrada.id,
      alternou: entrada.checked !== antes,
      temDescricao: Boolean(entrada.getAttribute('aria-describedby')),
    });
  })()`),
);

check('e um checkbox, nao um div clicavel', chave.ehCheckbox === true);
check('alcancavel por teclado', chave.alcancavel === true);
check('rotulo ligado', chave.rotuloLigado === true);
check('alterna', chave.alternou === true);
check('descricao ligada por aria-describedby', chave.temDescricao === true);

// ---------------------------------------------------------------------------
console.log('\n--- AVISOS: FORMA, NAO SO COR ---');

const avisos = JSON.parse(
  await avaliar(`(() => {
    const tipos = ['info', 'sucesso', 'aviso', 'erro'];
    const formas = tipos.map(t => {
      const el = document.querySelector('.aviso-' + t + ' .aviso-icone');
      // O desenho do icone identifica o tipo. Se dois tipos tiverem o mesmo
      // desenho, quem nao distingue cor nao distingue os avisos.
      return el ? el.innerHTML.replace(/\\s+/g, '') : null;
    });
    const unicas = new Set(formas.filter(Boolean));
    const erro = document.querySelector('.aviso-erro');
    return JSON.stringify({
      todosPresentes: formas.every(Boolean),
      formasDistintas: unicas.size === formas.filter(Boolean).length,
      erroInterrompe: erro?.getAttribute('role') === 'alert',
      temPrefixoOculto: Boolean(erro?.querySelector('.visualmente-oculto')),
    });
  })()`),
);

check('os quatro tipos de aviso aparecem', avisos.todosPresentes === true);
check('cada tipo tem um icone DIFERENTE', avisos.formasDistintas === true);
check('erro interrompe o leitor de tela', avisos.erroInterrompe === true);
check('o tipo e dito por extenso, alem da cor', avisos.temPrefixoOculto === true);

// ---------------------------------------------------------------------------
console.log('\n--- BALAO: SE REPOSICIONA PARA CABER ---');

const balao = JSON.parse(
  await avaliar(`(async () => {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    const abrir = document.querySelector('[data-vitrine="abrir-menu-embaixo"]');
    const caixaDaAncora = abrir.getBoundingClientRect();
    abrir.click();
    await espera(350);

    const b = document.querySelector('.balao');
    if (!b) return JSON.stringify({ erro: 'o balao nao abriu' });
    const caixa = b.getBoundingClientRect();

    const dentroDaTela =
      caixa.top >= 0 &&
      caixa.left >= 0 &&
      caixa.right <= window.innerWidth + 1 &&
      caixa.bottom <= window.innerHeight + 1;

    // A ancora esta colada embaixo; o balao tem que ter virado para cima.
    const virouParaCima = caixa.bottom <= caixaDaAncora.top + 1;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await espera(250);

    return JSON.stringify({ dentroDaTela, virouParaCima, fechou: !document.querySelector('.balao') });
  })()`),
);

check('o balao cabe inteiro na tela', balao.dentroDaTela === true, balao.erro ?? '');
check('vira para cima quando nao cabe embaixo', balao.virouParaCima === true);
check('Esc fecha o balao', balao.fechou === true);

// ---------------------------------------------------------------------------
console.log('\n--- CARTAO DE PARTICIPANTE: ESTADO POR FORMA, NAO SO POR COR ---');

/*
  O cartao existia sem ninguem usando, enquanto o palco mantinha uma copia
  propria. As duas ja tinham divergido. Estes testes cobram o que a versao
  unica precisa ter das duas: o icone de mudo, que so a compartilhada tinha, e
  o destaque anunciado no rotulo, que so a do palco tinha.
*/
const cartoes = JSON.parse(
  await avaliar(`(() => {
    const tiles = [...document.querySelectorAll('[data-vitrine="tiles"] .tile')];
    const [falando, mudo, tela] = tiles;
    return JSON.stringify({
      quantos: tiles.length,
      falandoTemAnel: falando.classList.contains('speaking'),
      falandoNoRotulo: /falando/i.test(falando.getAttribute('aria-label') || ''),
      mudoTemIcone: Boolean(mudo.querySelector('.tile-mudo')),
      mudoNoRotulo: /microfone desligado/i.test(mudo.getAttribute('aria-label') || ''),
      telaTemSelo: (tela.querySelector('.tile-live')?.textContent || '').trim() === 'AO VIVO',
      telaTemAviso: Boolean(tela.querySelector('.tile-warn')),
      focavel: tiles.every(t => t.tabIndex >= 0 && t.getAttribute('role') === 'button'),
      destaqueNoRotulo: /clique para destacar/i.test(falando.getAttribute('aria-label') || ''),
    });
  })()`),
);

check('os tres cartoes existem', cartoes.quantos === 3, `${cartoes.quantos}`);
check('quem fala ganha o anel optico', cartoes.falandoTemAnel === true);
check('e "falando" tambem vai no rotulo', cartoes.falandoNoRotulo === true);
check('mudo tem ICONE, nao so cor', cartoes.mudoTemIcone === true);
check('e "microfone desligado" vai no rotulo', cartoes.mudoNoRotulo === true);
check('transmissao tem o selo AO VIVO', cartoes.telaTemSelo === true);
check('o aviso de conexao fica no cartao da pessoa', cartoes.telaTemAviso === true);
check('cartao clicavel e alcancavel por teclado', cartoes.focavel === true);
check('o rotulo diz que da para destacar', cartoes.destaqueNoRotulo === true);

// ---------------------------------------------------------------------------
console.log('\n--- PALCO: CADA MODO TRATA OS QUADROS DE UM JEITO ---');

/*
  A escolha do modo e testada como funcao pura em `voice/palco.test.ts`. O que
  aquele teste NAO alcanca e o CSS: nada la impede os quatro modos de
  renderizarem identicos. Aqui se mede o tamanho real dos quadros.

  O caso que motivou isto e o de duas pessoas — o mais comum neste grupo. Ele
  caia em "grade" e recebia quadros do tamanho de uma grade de nove, com
  metade do palco vazia embaixo.
*/
const palco = JSON.parse(
  await avaliar(`(() => {
    const medir = (modo) => {
      const caixa = document.querySelector('[data-vitrine="palco-' + modo + '"]');
      const piso = caixa.querySelector('.stage-floor');
      const tiles = [...caixa.querySelectorAll('.tile')];
      const p = piso.getBoundingClientRect();
      const t = tiles[0].getBoundingClientRect();
      return {
        quadros: tiles.length,
        pisoL: Math.round(p.width), pisoA: Math.round(p.height),
        tileL: Math.round(t.width), tileA: Math.round(t.height),
        classe: piso.className,
      };
    };
    return JSON.stringify({
      solo: medir('solo'), dupla: medir('dupla'),
      grade: medir('grade'), faixa: medir('faixa'),
    });
  })()`),
);

check(
  'cada modo leva a propria classe',
  ['solo', 'dupla', 'grade', 'faixa'].every((m) => palco[m].classe.includes(`palco-${m}`)),
);

check(
  'solo usa o palco inteiro',
  palco.solo.tileL > palco.solo.pisoL * 0.9,
  `${palco.solo.tileL}px de ${palco.solo.pisoL}px`,
);

check(
  'dupla mantem a altura cheia',
  palco.dupla.tileA > palco.dupla.pisoA * 0.85,
  `${palco.dupla.tileA}px de ${palco.dupla.pisoA}px`,
);

check(
  'dupla da quadros MAIORES que a grade',
  palco.dupla.tileL > palco.grade.tileL * 1.5,
  `dupla ${palco.dupla.tileL}px, grade ${palco.grade.tileL}px`,
);

check(
  'grade quebra em linhas',
  palco.grade.tileA < palco.grade.pisoA * 0.6,
  `${palco.grade.tileA}px de ${palco.grade.pisoA}px`,
);

check('faixa nao estica os rostos', palco.faixa.tileA <= 110, `${palco.faixa.tileA}px`);

// ---------------------------------------------------------------------------
console.log('\n--- CONVITE PARA ASSISTIR UMA TRANSMISSAO ---');

/*
  Assistir e escolha, e o convite e como ela e oferecida.

  O que se cobra aqui e principalmente uma AUSENCIA: nao pode haver `<video>`
  no convite. Um elemento de video na tela faz o LiveKit considerar a faixa em
  uso e voltar a baixa-la — e a economia de banda, que e metade do motivo
  desta funcao existir, sumiria sem nenhum sinal visivel na tela.
*/
const convite = JSON.parse(
  await avaliar(`(() => {
    const [grande, mini] = [...document.querySelectorAll('[data-vitrine="convite"] .tile')];
    const botao = grande.querySelector('.convite-transmissao .btn');
    const estiloIcone = getComputedStyle(mini.querySelector('.convite-icone'));
    const estiloTitulo = getComputedStyle(mini.querySelector('.convite-titulo'));
    return JSON.stringify({
      semVideo: document.querySelectorAll('[data-vitrine="convite"] video').length,
      dizQuemTransmite: grande.querySelector('.convite-titulo')?.textContent ?? null,
      temSeloAoVivo: Boolean(grande.querySelector('.tile-live')),
      botao: botao?.textContent?.trim() ?? null,
      botaoEhBotao: botao?.tagName === 'BUTTON',
      // Na fita o quadro tem 148px: sobra so o botao.
      miniEsconde: estiloIcone.display === 'none' && estiloTitulo.display === 'none',
      miniMantemBotao: Boolean(mini.querySelector('.convite-transmissao .btn')),
    });
  })()`),
);

check(
  'o convite NAO tem elemento de video',
  convite.semVideo === 0,
  `${convite.semVideo} encontrados`,
);
check('diz quem esta transmitindo', /transmitindo/i.test(convite.dizQuemTransmite ?? ''));
check('mantem o selo AO VIVO', convite.temSeloAoVivo === true);
check(
  'a acao e um botao de verdade, alcancavel por teclado',
  convite.botaoEhBotao === true && /assistir/i.test(convite.botao ?? ''),
  convite.botao ?? '',
);
check('na fita, icone e frase saem', convite.miniEsconde === true);
check('mas o botao fica', convite.miniMantemBotao === true);

// ---------------------------------------------------------------------------
console.log('\n--- A TRANSMISSAO CABE NO QUADRO ---');

/*
  O video nao pode ser maior que o quadro que o contem.

  Este e o teste que faltava quando a transmissao aparecia cortada em cima e
  embaixo para cinco pessoas. `object-fit: contain` estava certo e nao
  resolvia: ele decide como a imagem cabe DENTRO do elemento, e o elemento e
  que passava do quadro. O quadro e um grid com `place-items: center`, o filho
  nao estica, e `height: 100%` contra altura indefinida virava `auto` — o
  video assumia a propria proporcao e o `overflow: hidden` comia o resto.

  Medido na epoca: elemento de 1552x873 dentro de um quadro de 1554x551.

  As outras secoes do palco usam `div`, e `div` nao tem proporcao propria:
  por isso nenhuma delas pegava este defeito, e por isso esta usa video real.
*/
const encaixe = JSON.parse(
  await avaliar(`(() => {
    const caixa = document.querySelector('[data-vitrine="encaixe-do-video"]');
    const quadro = caixa.querySelector('.tile');
    const video = quadro.querySelector('video');
    const cq = quadro.getBoundingClientRect();
    const cv = video.getBoundingClientRect();
    return JSON.stringify({
      fonte: video.videoWidth + 'x' + video.videoHeight,
      alturaQuadro: Math.round(cq.height),
      alturaVideo: Math.round(cv.height),
      larguraQuadro: Math.round(cq.width),
      larguraVideo: Math.round(cv.width),
      cabeEmAltura: cv.height <= cq.height + 1,
      cabeEmLargura: cv.width <= cq.width + 1,
      fit: getComputedStyle(video).objectFit,
    });
  })()`),
);

check('o video de prova tem proporcao de verdade', encaixe.fonte === '1920x1080', encaixe.fonte);
check(
  'o video nao passa da altura do quadro',
  encaixe.cabeEmAltura === true,
  `video ${encaixe.alturaVideo}px em quadro de ${encaixe.alturaQuadro}px`,
);
check(
  'nem da largura',
  encaixe.cabeEmLargura === true,
  `video ${encaixe.larguraVideo}px em quadro de ${encaixe.larguraQuadro}px`,
);
check('e a imagem cabe inteira, sem cortar', encaixe.fit === 'contain', encaixe.fit);

// ---------------------------------------------------------------------------
console.log('\n--- ZERAR O VOLUME DE ALGUEM SILENCIA MESMO ---');

/*
  A cadeia de saida tem que sair do FLUXO, nao do elemento.

  Isto chegou aos usuarios: a primeira versao usava
  `createMediaElementSource`, que NAO funciona com elemento alimentado por
  `srcObject` — que e como o LiveKit entrega audio remoto. Medido: o grafo
  recebia nivel ZERO enquanto o elemento seguia tocando por fora, em volume
  fixo. Para quem usava, o volume parou de responder e zerar alguem continuava
  deixando a pessoa audivel.

  Um teste que so mede ganho em senoide nao pega isso: o defeito esta em COMO
  o audio entra no grafo. Por isso aqui se monta um elemento com `srcObject`
  de verdade, igual ao do LiveKit.
*/
const silencio = JSON.parse(
  await avaliar(`(async () => {
    const ger = new AudioContext();
    const osc = ger.createOscillator();
    osc.frequency.value = 440;
    const sd = ger.createMediaStreamDestination();
    osc.connect(sd);
    osc.start();

    const el = document.createElement('audio');
    el.srcObject = sd.stream;
    el.autoplay = true;
    document.body.appendChild(el);
    await el.play().catch(() => {});

    const ctx = new AudioContext();
    // O caminho que NAO funciona com srcObject, para registro.
    let peloElemento = null;
    try {
      const an0 = ctx.createAnalyser();
      ctx.createMediaElementSource(el).connect(an0);
      await new Promise((r) => setTimeout(r, 400));
      const b0 = new Float32Array(an0.fftSize);
      an0.getFloatTimeDomainData(b0);
      let s0 = 0;
      for (let i = 0; i < b0.length; i++) s0 += b0[i] * b0[i];
      peloElemento = Math.sqrt(s0 / b0.length);
    } catch { peloElemento = -1; }

    const origem = ctx.createMediaStreamSource(sd.stream);
    const ganho = ctx.createGain();
    const an = ctx.createAnalyser();
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    origem.connect(ganho); ganho.connect(an); an.connect(mudo); mudo.connect(ctx.destination);
    el.muted = true;

    async function nivel(g) {
      ganho.gain.value = g;
      await new Promise((r) => setTimeout(r, 400));
      const buf = new Float32Array(an.fftSize);
      let soma = 0, n = 0;
      for (let k = 0; k < 10; k++) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { soma += buf[i] * buf[i]; n++; }
        await new Promise((r) => setTimeout(r, 20));
      }
      return Math.sqrt(soma / n);
    }

    const out = {
      peloElemento,
      zerado: await nivel(0),
      cheio: await nivel(1),
      elementoSilenciado: el.muted,
    };
    el.remove(); osc.stop(); await ger.close(); await ctx.close();
    return JSON.stringify(out);
  })()`),
);

check(
  'pelo fluxo, o audio chega ao grafo',
  silencio.cheio > 0.1,
  `nivel ${silencio.cheio.toFixed(3)}`,
);
check(
  'e zerar o ganho silencia de verdade',
  silencio.zerado === 0,
  `nivel ${silencio.zerado}`,
);
check(
  'o elemento e silenciado, para nao tocar em dobro',
  silencio.elementoSilenciado === true,
);

/*
  O registro do defeito: pelo ELEMENTO, com srcObject, o grafo recebe zero.
  Se um dia isto passar a entregar sinal, o navegador mudou e vale reavaliar.
*/
check(
  'e pelo elemento, com srcObject, nao chega nada — era este o defeito',
  silencio.peloElemento === 0,
  `nivel ${silencio.peloElemento}`,
);

// ---------------------------------------------------------------------------
console.log('\n--- A LIMPEZA DE RUIDO PODE RODAR ---');

/*
  As precondicoes do RNNoise, que quebram em silencio.

  O modelo e WebAssembly rodando dentro de um AudioWorklet. A CSP do app tem
  `script-src 'self'`, que por padrao PROIBE compilar WebAssembly — foi
  preciso acrescentar `'wasm-unsafe-eval'`, que libera WASM sem liberar
  `eval()` de JavaScript.

  Se alguem apertar a CSP de novo sem saber disso, a limpeza para de
  funcionar sem erro nenhum na tela: o microfone continua publicando, so que
  sujo. Esta verificacao existe para isso doer aqui, e nao na chamada.
*/
const limpeza = JSON.parse(
  await avaliar(`(async () => {
    const out = { worklet: typeof AudioWorkletNode === "function" };
    try {
      await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
      out.wasm = true;
    } catch (e) { out.wasm = false; out.motivo = String(e.message).slice(0, 80); }
    try { eval("1+1"); out.evalBarrado = false; } catch { out.evalBarrado = true; }
    return JSON.stringify(out);
  })()`),
);

check('o AudioWorklet existe', limpeza.worklet === true);
check(
  'a CSP permite compilar WebAssembly',
  limpeza.wasm === true,
  limpeza.motivo ?? '',
);

/*
  E a outra metade: liberar WASM nao pode ter liberado `eval()`.

  `unsafe-eval` resolveria o WASM e abriria junto `eval()` e `new Function()`,
  que e a porta classica de execucao de codigo injetado. Se este teste passar
  a reprovar, alguem trocou a diretiva estreita pela larga.
*/
check('e eval() de JavaScript continua barrado', limpeza.evalBarrado === true);

// ---------------------------------------------------------------------------
console.log('\n--- O VOLUME PASSA DE 100% DE VERDADE ---');

/*
  O cartao da pessoa deixa levar o volume a 200%. Isto verifica que os 200%
  EXISTEM.

  Nao e hipotese: a primeira versao usava `HTMLAudioElement.volume`, que a
  especificacao limita a 1 — atribuir 1.5 lanca `IndexSizeError`. O codigo
  fazia `Math.min(1, ...)`, o que evitava a excecao e escondia o defeito: o
  deslizante andava, mostrava "150%", e o som continuava em 100%. Ninguem
  percebe um controle que mente em silencio.

  Mede a MESMA cadeia de `voice/saida.ts` num contexto offline. Web Audio
  existe aqui porque a vitrine roda no renderer de verdade, nao em Node.
*/
const ganho = JSON.parse(
  await avaliar(`(async () => {
    async function pico(ganhoValor, comLimitador, entrada) {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const base = ctx.createGain();
      base.gain.value = entrada;
      const g = ctx.createGain();
      g.gain.value = ganhoValor;
      let ultimo = g;
      if (comLimitador) {
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
        lim.attack.value = 0.003; lim.release.value = 0.25;
        // A compensacao vem ANTES do limitador, como na cadeia de verdade:
        // ganho depois do limitador anularia o limitador.
        const comp = ctx.createGain(); comp.gain.value = 1.4;
        g.connect(comp); comp.connect(lim); ultimo = lim;
      }
      osc.connect(base); base.connect(g); ultimo.connect(ctx.destination);
      osc.start(0); osc.stop(1);
      const d = (await ctx.startRendering()).getChannelData(0);
      let maior = 0, estourados = 0;
      for (let i = 8820; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > maior) maior = v;
        if (v >= 0.999) estourados++;
      }
      return { pico: maior, estourados };
    }
    return JSON.stringify({
      cem: (await pico(1, false, 0.3)).pico,
      cemECinquenta: (await pico(1.5, false, 0.3)).pico,
      duzentos: (await pico(2, false, 0.3)).pico,
      altoSemLimitador: await pico(2, false, 0.8),
      altoComLimitador: await pico(2, true, 0.8),
    });
  })()`),
);

check(
  '150% soa mais alto que 100%',
  ganho.cemECinquenta > ganho.cem * 1.4,
  `${ganho.cem.toFixed(2)} -> ${ganho.cemECinquenta.toFixed(2)}`,
);
check(
  'e 200% mais alto ainda',
  ganho.duzentos > ganho.cemECinquenta * 1.2,
  `${ganho.cemECinquenta.toFixed(2)} -> ${ganho.duzentos.toFixed(2)}`,
);

/*
  A outra metade: so tirar o teto trocaria "baixo demais" por "distorcido".
  Voz ja alta empurrada a 200% chega a 1.6, e tudo acima de 1 vira estalo.
*/
check(
  'sem limitador, voz alta a 200% estouraria',
  ganho.altoSemLimitador.estourados > 1000,
  `${ganho.altoSemLimitador.estourados} amostras`,
);
check(
  'com o limitador, nenhuma amostra estoura',
  ganho.altoComLimitador.estourados === 0 && ganho.altoComLimitador.pico < 1,
  `pico ${ganho.altoComLimitador.pico.toFixed(2)}, ${ganho.altoComLimitador.estourados} estouradas`,
);

// ---------------------------------------------------------------------------
console.log('\n--- CARTAO DA PESSOA: DOIS VOLUMES SEPARADOS ---');

/*
  Os dois volumes existem separados porque resolvem coisas diferentes: quem
  transmite um jogo manda o som do jogo alto pelo mesmo canal em que fala. Com
  um controle so, abaixar a trilha sonora significava parar de ouvir o amigo.

  E o controlador guardava volume por pessoa desde sempre, sem nenhuma tela
  que o expusesse — o cartao e a primeira.
*/
const cartaoPessoa = JSON.parse(
  await avaliar(`(() => {
    const caixa = document.querySelector('[data-vitrine="cartao-pessoa"]');
    const controles = [...caixa.querySelectorAll('.cartao-volume')];
    const entradas = controles.map((c) => c.querySelector('input[type="range"]'));
    return JSON.stringify({
      quantos: controles.length,
      rotulos: entradas.map((e) => e.getAttribute('aria-label')),
      // Um deslizante sem texto de valor e lido como um numero solto.
      temTextoDeValor: entradas.every((e) => Boolean(e.getAttribute('aria-valuetext'))),
      // O range nativo ja traz teclado e arrasto; um desenhado a mao
      // costuma reconstruir so o arrasto.
      saoNativos: entradas.every((e) => e.tagName === 'INPUT' && e.type === 'range'),
      // Passa de 100%: microfone fraco e comum e mandar "chega mais perto do
      // microfone" toda vez nao e solucao.
      vaiAlemDeCem: entradas.every((e) => Number(e.max) > 100),
      temPerfil: Boolean(caixa.querySelector('.cartao-perfil')),
      acaoDeAmizade: caixa.querySelector('.cartao-pessoa-acoes .btn')?.textContent?.trim() ?? null,
      // A largura do numero e fixa para o deslizante nao pular no arrasto.
      larguraDoValorFixa: new Set(
        [...caixa.querySelectorAll('.cartao-volume-valor')].map((v) =>
          Math.round(v.getBoundingClientRect().width),
        ),
      ).size === 1,
    });
  })()`),
);

check('o cartao traz o perfil da pessoa', cartaoPessoa.temPerfil === true);
check(
  'ha DOIS controles de volume, nao um',
  cartaoPessoa.quantos === 2,
  `${cartaoPessoa.quantos}`,
);
check(
  'um e a voz, o outro e a transmissao',
  /voz/i.test(cartaoPessoa.rotulos[0] ?? '') && /transmissao/i.test(cartaoPessoa.rotulos[1] ?? ''),
  cartaoPessoa.rotulos.join(' | '),
);
check('sao deslizantes nativos, com teclado', cartaoPessoa.saoNativos === true);
check('o valor e dito por extenso ao leitor de tela', cartaoPessoa.temTextoDeValor === true);
check('da para passar de 100%', cartaoPessoa.vaiAlemDeCem === true);
check('o numero tem largura fixa', cartaoPessoa.larguraDoValorFixa === true);
check(
  'e ha a acao de amizade',
  /adicionar amigo/i.test(cartaoPessoa.acaoDeAmizade ?? ''),
  cartaoPessoa.acaoDeAmizade ?? '',
);

// ---------------------------------------------------------------------------
console.log('\n--- CONTROLES DA CHAMADA ---');

const controles = JSON.parse(
  await avaliar(`(() => {
    const botoes = [...document.querySelectorAll('[data-vitrine="controles-de-chamada"] .act')];
    const caixas = botoes.map(b => b.getBoundingClientRect());
    let sobrepoe = false;
    for (let i = 1; i < caixas.length; i++) {
      if (caixas[i].left < caixas[i - 1].right - 1) sobrepoe = true;
    }
    return JSON.stringify({
      quantos: botoes.length,
      temRotulo: botoes.every(b => Boolean(b.querySelector('.act-rotulo')?.textContent?.trim())),
      temEstado: botoes.every(b => b.hasAttribute('aria-pressed')),
      desabilitados: botoes.filter(b => b.disabled).length,
      sobrepoe,
      larguras: caixas.map(c => Math.round(c.width)),
    });
  })()`),
);

check(
  'os quatro controles aparecem fora da chamada',
  controles.quantos === 4,
  `${controles.quantos}`,
);
check('cada um tem rotulo em texto, nao so icone', controles.temRotulo === true);
check('o estado ligado/desligado chega ao leitor de tela', controles.temEstado === true);
check(
  'camera e tela ficam desabilitadas fora da chamada',
  controles.desabilitados === 2,
  `${controles.desabilitados} desabilitados`,
);
/*
  Este e o defeito que a primeira montagem teve, e por isso ele vira teste:
  `.act` e um botao quadrado de 34px no CSS global, e sem soltar a largura os
  rotulos sairam por cima uns dos outros.
*/
check(
  'os botoes nao se sobrepoem',
  controles.sobrepoe === false,
  `larguras: ${controles.larguras.join(', ')}`,
);

// ---------------------------------------------------------------------------
console.log('\n--- PAINEL LATERAL: LARGURA AJUSTAVEL E LEMBRADA ---');

/** Largura do painel na tela, ou 0 quando ele nao esta aberto. */
const larguraDoPainel = `Math.round(document.querySelector('.painel')?.getBoundingClientRect().width ?? 0)`;

/** Fecha o painel se estiver aberto, para o teste nao herdar estado. */
await avaliar(
  `(() => {
    localStorage.removeItem('kiroshi.painel.vitrine');
    if (document.querySelector('.painel')) {
      document.querySelector('[data-vitrine="abrir-painel"]').click();
    }
    return true;
  })()`,
);
await esperarPor(`!document.querySelector('.painel')`);

await avaliar(`document.querySelector('[data-vitrine="abrir-painel"]').click(), true`);
const abriu = await esperarPor(`Boolean(document.querySelector('.painel'))`);

if (!abriu) {
  check('o painel abre', false, 'nao apareceu depois do clique');
} else {
  const estrutura = JSON.parse(
    await avaliar(`JSON.stringify({
      temTitulo: Boolean(document.querySelector('.painel-titulo')?.textContent?.trim()),
      temFechar: Boolean(document.querySelector('.painel-fechar')),
      papelDaAlca: document.querySelector('.painel-alca')?.getAttribute('role'),
    })`),
  );

  check('o painel abre com titulo e botao de fechar', estrutura.temTitulo && estrutura.temFechar);
  check('a alca e anunciada como separador', estrutura.papelDaAlca === 'separator');

  const antes = await avaliar(larguraDoPainel);

  // Teclado, e nao arrasto: um painel que so se ajusta com mouse esta fechado
  // para quem nao usa mouse.
  const focou = await avaliar(`(() => {
    const alca = document.querySelector('.painel-alca');
    alca.focus();
    return document.activeElement === alca;
  })()`);
  check('a alca e alcancavel por teclado', focou === true);

  // Tres passos de 16px. Cada um espera o anterior chegar na tela: sem isso o
  // segundo evento chega antes de o React aplicar o primeiro, e os tres
  // somam um passo so.
  let esperado = antes;
  for (let i = 0; i < 3; i++) {
    esperado += 16;
    await avaliar(
      `document.querySelector('.painel-alca').dispatchEvent(
         new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
       ), true`,
    );
    await esperarPor(`${larguraDoPainel} === ${esperado}`);
  }

  const depois = await avaliar(larguraDoPainel);
  const guardado = Number(await avaliar(`localStorage.getItem('kiroshi.painel.vitrine')`));
  const anunciado = Number(
    await avaliar(`document.querySelector('.painel-alca').getAttribute('aria-valuenow')`),
  );

  check('a seta esquerda alarga o painel', depois > antes, `${antes}px -> ${depois}px`);
  check('a largura atual e anunciada', anunciado === depois, `anunciado ${anunciado}, real ${depois}`);
  check('a largura fica guardada', guardado === depois, `guardado ${guardado}, real ${depois}`);

  // Fecha e reabre: a largura tem que voltar como estava.
  await avaliar(`document.querySelector('[data-vitrine="abrir-painel"]').click(), true`);
  await esperarPor(`!document.querySelector('.painel')`);
  await avaliar(`document.querySelector('[data-vitrine="abrir-painel"]').click(), true`);
  await esperarPor(`${larguraDoPainel} > 0`);

  const reaberto = await avaliar(larguraDoPainel);
  check('e volta assim ao reabrir', reaberto === depois, `${reaberto}px vs ${depois}px`);
}

// ---------------------------------------------------------------------------
console.log('\n--- CARTAO DE PERFIL ---');

/*
  O cartao existe para responder "como vai ficar" antes de salvar. Os dois
  casos aqui sao os que quebram primeiro: o cartao sem bio, onde a divisoria
  nao deve aparecer, e a bio de varias linhas, onde as quebras precisam
  sobreviver — sem isso, tres linhas curtas viram um paragrafo so e a previa
  mente sobre o resultado.
*/
const perfis = JSON.parse(
  await avaliar(`(() => {
    const [comBio, semBio] = [...document.querySelectorAll('[data-vitrine="cartoes"] .cartao-perfil')];
    const bio = comBio.querySelector('.cartao-bio');
    return JSON.stringify({
      quantos: document.querySelectorAll('[data-vitrine="cartoes"] .cartao-perfil').length,
      rotulado: comBio.getAttribute('aria-label'),
      nome: comBio.querySelector('.cartao-exibicao')?.textContent,
      usuario: comBio.querySelector('.cartao-usuario')?.textContent,
      temPronomes: Boolean(comBio.querySelector('.cartao-pronomes')),
      preservaQuebras: bio ? getComputedStyle(bio).whiteSpace : null,
      bioTemDuasLinhas: bio ? bio.getClientRects().length >= 1 && bio.textContent.includes('\\n') : false,
      semBioNaoTemDivisoria: !semBio.querySelector('.cartao-bio'),
      avatarSobreAFaixa:
        comBio.querySelector('.cartao-avatar')?.getBoundingClientRect().top <
        comBio.querySelector('.cartao-faixa')?.getBoundingClientRect().bottom,
    });
  })()`),
);

check('os dois perfis existem', perfis.quantos === 2, `${perfis.quantos}`);
check('o cartao e rotulado para leitor de tela', /perfil de/i.test(perfis.rotulado ?? ''));
check('mostra nome e @usuario', Boolean(perfis.nome) && /@/.test(perfis.usuario ?? ''));
check('pronomes aparecem junto do @usuario', perfis.temPronomes === true);
check(
  'a bio preserva as quebras de linha',
  perfis.preservaQuebras === 'pre-wrap',
  perfis.preservaQuebras ?? 'sem bio',
);
check('e as quebras chegam mesmo ao texto', perfis.bioTemDuasLinhas === true);
check('sem bio, nao ha divisoria sobrando', perfis.semBioNaoTemDivisoria === true);
check('o avatar monta sobre a faixa', perfis.avatarSobreAFaixa === true);

// ---------------------------------------------------------------------------
console.log('\n--- BARRA DE ALTERACOES NAO SALVAS ---');

const barra = JSON.parse(
  await avaliar(`(() => {
    const pendente = document.querySelector('[data-vitrine="barra-pendente"] .barra-nao-salvo');
    const comErro = document.querySelector('[data-vitrine="barra-erro"] .barra-nao-salvo');
    const botoes = [...pendente.querySelectorAll('button')].map(b => b.textContent.trim());
    const caixas = [...comErro.querySelectorAll('button')].map(b => b.getBoundingClientRect());
    const limite = comErro.getBoundingClientRect();
    return JSON.stringify({
      papel: pendente.getAttribute('role'),
      anuncio: pendente.getAttribute('aria-live'),
      botoes,
      temIcone: Boolean(pendente.querySelector('.barra-icone')),
      textoNormal: pendente.querySelector('.barra-texto')?.textContent,
      textoDeErro: comErro.querySelector('.barra-texto')?.textContent,
      classeDeErro: comErro.classList.contains('com-erro'),
      // O texto longo do erro nao pode empurrar os botoes para fora da barra.
      botoesCabem: caixas.every(c => c.right <= limite.right + 1 && c.left >= limite.left - 1),
    });
  })()`),
);

check('anuncia-se sozinha ao aparecer', barra.papel === 'alert' && barra.anuncio === 'assertive');
check('tem icone alem da cor', barra.temIcone === true);
check(
  'oferece descartar E salvar, nessa ordem',
  barra.botoes[0] === 'Descartar' && barra.botoes[1] === 'Salvar',
  barra.botoes.join(' | '),
);
check('no estado normal diz o que esta pendente', /nao salvas/i.test(barra.textoNormal ?? ''));
check(
  'com erro, troca o texto pela mensagem do servidor',
  barra.classeDeErro === true && barra.textoDeErro !== barra.textoNormal,
  barra.textoDeErro?.slice(0, 40),
);
check('e um erro longo nao expulsa os botoes', barra.botoesCabem === true);

// ---------------------------------------------------------------------------
console.log('\n--- ANUNCIOS: O QUE O APLICATIVO DIZ EM VOZ ALTA ---');

/*
  Ate a fase 5 o Kiroshi inteiro nao tinha uma unica regiao `aria-live`.
  Mensagem nova, alguem entrando na chamada, a conexao caindo: nada disso
  existia para quem usa leitor de tela.

  O teste cobra as tres coisas que quebram sem ninguem notar, porque nada
  delas aparece na tela.
*/
const anuncios = JSON.parse(
  await avaliar(`(async () => {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    const educada = document.querySelector('[role="status"][aria-live="polite"]');
    const urgente = document.querySelector('[role="alert"][aria-live="assertive"]');

    if (!educada || !urgente) return JSON.stringify({ erro: 'faltam regioes' });

    // O valor da urgente ANTES: o teste roda mais de uma vez contra a mesma
    // pagina, entao "vazia" nao serve de referencia — o que importa e que o
    // anuncio educado nao a altere.
    const urgenteAntes = urgente.textContent;

    const estiloEducada = getComputedStyle(educada);
    const escondidaSemSumir =
      estiloEducada.display !== 'none' &&
      estiloEducada.visibility !== 'hidden' &&
      Math.round(educada.getBoundingClientRect().width) <= 1;

    document.querySelector('[data-vitrine="anunciar-normal"]').click();
    await espera(400);
    const educadaDepois = educada.textContent;
    const urgenteIntacta = urgente.textContent === urgenteAntes;

    // O MESMO anuncio de novo: o conteudo tem que mudar, senao o leitor de
    // tela nao fala a segunda vez.
    document.querySelector('[data-vitrine="anunciar-normal"]').click();
    await espera(400);
    const educadaOutraVez = educada.textContent;

    document.querySelector('[data-vitrine="anunciar-urgente"]').click();
    await espera(400);

    return JSON.stringify({
      escondidaSemSumir,
      atomicaEducada: educada.getAttribute('aria-atomic'),
      atomicaUrgente: urgente.getAttribute('aria-atomic'),
      textoEducada: educadaDepois.replace(/\\u200b/g, ''),
      urgenteIntacta,
      repetidoMudaConteudo: educadaDepois !== educadaOutraVez,
      repetidoMesmoTexto:
        educadaDepois.replace(/\\u200b/g, '') === educadaOutraVez.replace(/\\u200b/g, ''),
      textoUrgente: urgente.textContent.replace(/\\u200b/g, ''),
    });
  })()`),
);

if (anuncios.erro) {
  check('as duas regioes existem', false, anuncios.erro);
} else {
  check(
    'escondidas da tela sem sair da arvore de acessibilidade',
    anuncios.escondidaSemSumir === true,
  );
  check(
    'lidas por inteiro a cada mudanca',
    anuncios.atomicaEducada === 'true' && anuncios.atomicaUrgente === 'true',
  );
  check(
    'o anuncio normal cai na regiao educada',
    /entrou na chamada/i.test(anuncios.textoEducada),
    anuncios.textoEducada,
  );
  check('e nao vaza para a urgente', anuncios.urgenteIntacta === true);
  check('o urgente cai na regiao que interrompe', /chamada caiu/i.test(anuncios.textoUrgente));
  /*
    O par de verificacoes que descreve o truque: o texto falado e o mesmo, o
    conteudo do no e diferente. Sem a segunda, um aviso repetido passaria em
    silencio.
  */
  check('anuncio repetido muda o conteudo do no', anuncios.repetidoMudaConteudo === true);
  check('mas o texto falado continua o mesmo', anuncios.repetidoMesmoTexto === true);
}

// ---------------------------------------------------------------------------
console.log('\n--- MARCOS E ATALHO DE TECLADO ---');

/*
  A vitrine nao monta o `AppShell`, entao o marco `main` e o atalho sao
  cobrados na suite de layout. Aqui fica o que a vitrine alcanca: nenhum
  controle clicavel pode estar fora do alcance do teclado.
*/
const teclado = JSON.parse(
  await avaliar(`(() => {
    const foraDoAlcance = [];
    for (const el of document.querySelectorAll('.vitrine *')) {
      const clicavel =
        el.className &&
        typeof el.className === 'string' &&
        /^(tab|channel|category|mention|menu-item)$/.test(el.className.split(' ')[0]);
      if (!clicavel) continue;
      const alcancavel =
        el.tagName === 'BUTTON' || el.tagName === 'A' || el.tabIndex >= 0;
      if (!alcancavel) foraDoAlcance.push(el.className + ' <' + el.tagName.toLowerCase() + '>');
    }
    return JSON.stringify({ foraDoAlcance });
  })()`),
);

check(
  'nenhum controle da vitrine fora do alcance do teclado',
  teclado.foraDoAlcance.length === 0,
  teclado.foraDoAlcance.join(', '),
);

// ---------------------------------------------------------------------------
/*
  O SISTEMA VISUAL CHEGOU MESMO NA TELA?

  Esta secao existe porque CSS falha em silencio. Uma regra que perde em
  especificidade, um arquivo que entra na ordem errada, uma fonte declarada e
  nao empacotada — nada disso levanta erro, quebra a compilacao ou aparece no
  typecheck. A tela so fica um pouco diferente do que se escreveu, e ninguem
  nota ate alguem reclamar.

  Ja aconteceu nesta base: `componentes.css` carrega DEPOIS de `global.css`,
  entao um bloco novo escrito no fim do `global.css` perdia para qualquer
  regra que `componentes.css` tivesse para a mesma classe. As camadas —
  dialogo, menu, avatar — estavam escritas e nao apareciam.

  O que se verifica aqui nao e gosto. E a diferenca entre o que o arquivo diz
  e o que o navegador calculou.
*/
console.log(String.fromCharCode(10) + '--- SISTEMA VISUAL: A REGRA VENCEU? ---');

const visual = JSON.parse(
  await avaliar(`(async () => {
    await document.fonts.load('700 26px Rajdhani');
    await document.fonts.ready;

    const palco = document.createElement('div');
    palco.style.cssText = 'position:fixed;left:-9999px;top:0';
    palco.innerHTML =
      '<h2 class="settings-title">Audio</h2>' +
      '<label class="field-label">Microfone</label>' +
      '<div class="empty"><h3>Sem mensagens</h3></div>' +
      '<button class="btn btn-primary">Salvar</button>' +
      '<button class="btn">Cancelar</button>' +
      '<div class="category"><span>Geral</span></div>' +
      '<div class="category category-acao"><span>Criar canal</span></div>' +
      '<div class="dialogo"><h2 class="dialogo-titulo">Confirmar</h2></div>' +
      '<div class="avatar"></div>' +
      '<div class="menu"></div>' +
      '<div class="aviso"></div>' +
      '<div class="cartao-pessoa"></div>' +
      '<button class="btn btn-danger">Sair</button>' +
      '<span class="channel-badge">3</span>';
    document.body.appendChild(palco);

    const s = (sel, pseudo) => {
      const el = palco.querySelector(sel);
      if (!el) return null;
      const c = getComputedStyle(el, pseudo || null);
      return {
        fonte: c.fontFamily.split(',')[0].replace(/['"]/g, ''),
        tamanho: parseFloat(c.fontSize),
        espaco: parseFloat(c.letterSpacing) || 0,
        caixa: c.textTransform,
        conteudo: c.content,
        raio: c.borderRadius,
        recorte: c.clipPath,
        cor: c.color,
        fundo: c.backgroundColor,
      };
    };

    const largura = (ff) => {
      const c = document.createElement('canvas').getContext('2d');
      c.font = '700 26px ' + ff;
      return c.measureText('NENHUMA MENSAGEM AINDA').width;
    };

    const r = {
      tituloAjuste: s('.settings-title'),
      tituloAjusteMarca: s('.settings-title', '::before'),
      rotuloCampo: s('.field-label'),
      telaVazia: s('.empty h3'),
      botaoPrimario: s('.btn-primary'),
      botaoComum: s('.btn:not(.btn-primary)'),
      categoria: s('.category:not(.category-acao) span'),
      categoriaMarca: s('.category:not(.category-acao) span', '::before'),
      categoriaAcaoMarca: s('.category-acao span', '::before'),
      dialogo: s('.dialogo'),
      dialogoTitulo: s('.dialogo-titulo'),
      avatar: s('.avatar'),
      menu: s('.menu'),
      aviso: s('.aviso'),
      cartaoPessoa: s('.cartao-pessoa'),
      botaoPerigo: s('.btn-danger'),
      seloNaoLidas: s('.channel-badge'),
      rajdhaniPronta: document.fonts.check('700 26px Rajdhani'),
      larguraRajdhani: largura('Rajdhani'),
      larguraInter: largura('Inter'),
      larguraSubstituta: largura('sans-serif'),
    };
    palco.remove();
    return JSON.stringify(r);
  })()`),
);

/*
  A fonte de placa foi EMPACOTADA, nao so declarada.

  `getComputedStyle` devolve o nome que esta no CSS mesmo quando o arquivo nao
  existe — ele reporta a intencao, nao o resultado. Quem responde de verdade e
  a medida: a Rajdhani e condensada, entao a mesma frase nos mesmos 26px tem
  que sair visivelmente mais estreita que na Inter. Se o arquivo faltasse, o
  navegador cairia na substituta do sistema e as duas larguras se encostariam.

  Medido ao empacotar: 303px contra 388px da Inter e 383px da substituta.
  Os 10% de folga cobrem variacao de versao da fonte.
*/
check('a fonte de placa esta empacotada, nao so declarada', visual.rajdhaniPronta);
check(
  'e ela e mesmo condensada, nao a substituta do sistema',
  visual.larguraRajdhani < visual.larguraSubstituta * 0.9,
  Math.round(visual.larguraRajdhani) +
    'px vs ' +
    Math.round(visual.larguraSubstituta) +
    'px na substituta',
);
check(
  'a tela vazia usa a fonte de placa',
  visual.telaVazia.fonte === 'Rajdhani' && visual.telaVazia.caixa === 'uppercase',
  visual.telaVazia.fonte + ' ' + visual.telaVazia.tamanho + 'px',
);
/*
  Titulo grande vai com espacamento NEGATIVO — e o sinal trocado e justamente
  o tipo de coisa que se perde numa refatoracao sem ninguem perceber.
*/
check(
  'e o titulo grande fecha as letras, em vez de abrir',
  visual.telaVazia.espaco < 0,
  visual.telaVazia.espaco.toFixed(2) + 'px',
);

/*
  As tres vozes continuam separadas.

  O risco aqui nao e uma delas sumir: e todas convergirem. Se botao comum e
  botao de confirmar acabarem na mesma fonte e na mesma caixa, a hierarquia de
  que o sistema inteiro depende desaparece sem quebrar nada.
*/
check(
  'o botao que comete fala como comando',
  visual.botaoPrimario.fonte === 'JetBrains Mono' && visual.botaoPrimario.caixa === 'uppercase',
  visual.botaoPrimario.fonte,
);
check(
  'e o botao que desiste continua em voz normal',
  visual.botaoComum.fonte === 'Inter' && visual.botaoComum.caixa !== 'uppercase',
  visual.botaoComum.fonte + ' ' + visual.botaoComum.caixa,
);
check(
  'rotulo de campo e leitura de instrumento',
  visual.rotuloCampo.fonte === 'JetBrains Mono' && visual.rotuloCampo.caixa === 'uppercase',
  visual.rotuloCampo.fonte,
);

/*
  A marca de secao aparece onde ha secao, e SO onde ha secao.

  A segunda metade importa tanto quanto a primeira. "Criar canal" mora na
  mesma classe `.category` e nao e uma secao: e uma acao. Marcar
  `// CRIAR CANAL` transformaria um botao em cabecalho e desfaria exatamente a
  distincao que a marca existe para criar.
*/
check(
  'a secao de ajustes se anuncia com a marca',
  visual.tituloAjusteMarca.conteudo.includes('//'),
  visual.tituloAjusteMarca.conteudo,
);
check(
  'a categoria de canais tambem',
  visual.categoriaMarca.conteudo.includes('//'),
  visual.categoriaMarca.conteudo,
);
check(
  'mas a acao na mesma classe NAO leva marca',
  !visual.categoriaAcaoMarca.conteudo.includes('//'),
  visual.categoriaAcaoMarca.conteudo,
);
check(
  'e a marca e larga o bastante para ler como rotulo',
  visual.tituloAjuste.espaco / visual.tituloAjuste.tamanho > 0.2,
  (visual.tituloAjuste.espaco / visual.tituloAjuste.tamanho).toFixed(3) + 'em',
);

/*
  As camadas venceram a ordem dos arquivos.

  Aqui esta o caso concreto, e ele foi MEDIDO desfazendo o conserto: com o
  bloco escrito no fim do `global.css`, `componentes.css` — que carrega depois
  — devolvia o canto arredondado ao dialogo e ao aviso, sem um erro, um aviso
  de compilacao ou uma linha no typecheck.

  So os DOIS primeiros checks abaixo reprovam nesse arranjo; foi verificado um
  por um, nao deduzido. Os outros tres passam dos dois jeitos, porque as
  classes deles nao tem raio proprio disputando em `componentes.css`. Ficam
  mesmo assim: guardam contra a regra ser apagada. So nao servem de prova de
  ordem, e vale saber qual check prova o que — um check que passaria quebrado
  da uma seguranca que ele nao tem.
*/
check(
  'o dialogo e uma placa chanfrada',
  visual.dialogo.recorte.includes('polygon') && visual.dialogo.raio === '0px',
  visual.dialogo.recorte.slice(0, 24),
);
check(
  'o aviso tambem perdeu o canto arredondado',
  visual.aviso.recorte.includes('polygon') && visual.aviso.raio === '0px',
  'raio ' + visual.aviso.raio,
);
check(
  'o cartao de pessoa e uma ficha, nao um cartao de visita',
  visual.cartaoPessoa.recorte.includes('polygon') && visual.cartaoPessoa.raio === '0px',
  'raio ' + visual.cartaoPessoa.raio,
);
check(
  'o titulo do dialogo le como comando de painel',
  visual.dialogoTitulo.fonte === 'JetBrains Mono' && visual.dialogoTitulo.caixa === 'uppercase',
  visual.dialogoTitulo.fonte,
);
check(
  'o menu tambem, em escala menor',
  visual.menu.recorte.includes('polygon'),
  visual.menu.recorte.slice(0, 24),
);
/*
  O avatar deixou de ser circulo. Nao e enfeite: o circulo joga fora os quatro
  cantos de toda foto, e le como rede social. Quadrado cortado le como
  credencial, que e a leitura certa num aplicativo chamado Kiroshi.
*/
check(
  'o avatar e credencial, nao bolinha',
  visual.avatar.raio === '0px' && visual.avatar.recorte.includes('polygon'),
  'raio ' + visual.avatar.raio,
);

/*
  O VERMELHO DE PREENCHIMENTO TEM QUE SER LEGIVEL POR BAIXO DO TEXTO.

  Este e o defeito que motivou separar `--red` de `--red-solido`, e ele durou
  meses sem ninguem notar: o vermelho foi escolhido para mensagem de erro, onde
  brilha sobre fundo escuro (6.63:1), e depois reaproveitado como FUNDO em treze
  lugares — botao de sair, selo de nao lidas, marcador de transmissao. Branco
  sobre aquele rosa da 2.79:1, bem abaixo do minimo de 4.5.

  Um tom claro e bom escrito e ruim por baixo; um escuro e o contrario. Nenhuma
  ferramenta avisa: nao ha erro de compilacao para "esta cor foi usada no papel
  errado", e na tela de quem escolheu ele parecia bom.

  O calculo aqui e a formula de contraste do WCAG, sobre os valores que o
  navegador REALMENTE computou — nao sobre os tokens. Se alguem trocar o token,
  apontar um componente novo para o vermelho errado ou mexer na opacidade, este
  check reprova com o numero na mao.
*/
function contraste(corA, corB) {
  const canal = (c) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const lum = (css) => {
    const [r, g, b] = css.match(/\d+(\.\d+)?/g).map(Number);
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  };
  const [claro, escuro] = [lum(corA), lum(corB)].sort((a, b) => b - a);
  return (claro + 0.05) / (escuro + 0.05);
}

const razaoBotao = contraste(visual.botaoPerigo.cor, visual.botaoPerigo.fundo);
check(
  'o botao de perigo tem texto legivel sobre o vermelho',
  razaoBotao >= 4.5,
  razaoBotao.toFixed(2) + ':1',
);

const razaoSelo = contraste(visual.seloNaoLidas.cor, visual.seloNaoLidas.fundo);
check(
  'e o selo de nao lidas tambem',
  razaoSelo >= 4.5,
  razaoSelo.toFixed(2) + ':1',
);

// ---------------------------------------------------------------------------
/*
  A CONVERSA E UM LOG, NAO UM MURAL DE REDE SOCIAL.

  Esta secao guarda a mudanca de ESTRUTURA — a que muda o que o aplicativo e,
  nao como ele esta pintado. O desenho antigo era o padrao copiado de todo
  aplicativo de conversa: avatar grande numa coluna a esquerda, nome em negrito
  como titulo da mensagem, hora escondida ate o mouse passar por cima.

  E facil voltar para la sem querer. Basta alguem "arrumar" a calha, ou uma
  refatoracao trazer de volta o avatar por parecer que faltava alguma coisa.
  Os checks abaixo olham para as propriedades que DEFINEM a estrutura: duas
  trilhas de grade com a primeira rigida, e uma regua vertical no corpo.
*/
console.log(String.fromCharCode(10) + '--- ESTRUTURA: A CONVERSA E UM LOG ---');

const log = JSON.parse(
  await avaliar(`(() => {
    const palco = document.createElement('div');
    palco.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px';
    palco.innerHTML =
      '<div class="msg first"><div class="msg-gutter"><time class="msg-carimbo">05:12</time></div><div class="msg-body"><div class="msg-head"><span class="msg-author">vartaque</span></div><div>ola</div></div></div>' +
      '<div class="msg grouped"><div class="msg-gutter"><time class="msg-carimbo">05:13</time></div><div class="msg-body"><div>de novo</div></div></div>' +
      '<div class="msg first mentioned"><div class="msg-gutter"><time class="msg-carimbo">05:14</time></div><div class="msg-body"><div>te citei</div></div></div>' +
      '<div class="msg first pinned"><div class="msg-gutter"><time class="msg-carimbo">05:15</time></div><div class="msg-body"><div class="msg-pinned">Fixada</div><div>fica ai</div></div></div>';
    document.body.appendChild(palco);

    const c = (sel) => {
      const el = palco.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        display: s.display,
        trilhas: s.gridTemplateColumns,
        bordaEsq: s.borderLeftWidth,
        corBordaEsq: s.borderLeftColor,
        fundo: s.backgroundColor,
        fundoImg: s.backgroundImage,
        sombra: s.boxShadow,
        fonte: s.fontFamily.split(',')[0].replace(/['"]/g, ''),
        caixa: s.textTransform,
        cor: s.color,
        justificar: s.justifyContent,
        largura: el.getBoundingClientRect().width,
      };
    };

    const r = {
      linha: c('.msg'),
      calha: c('.msg-gutter'),
      carimbo: c('.msg-carimbo'),
      corpo: c('.msg-body'),
      autor: c('.msg-author'),
      corpoMencao: c('.msg.mentioned .msg-body'),
      linhaFixada: c('.msg.pinned'),
      corpoFixado: c('.msg.pinned .msg-body'),
      // O avatar de 36px na calha era a assinatura do desenho antigo.
      temAvatarNaCalha: !!palco.querySelector('.msg-gutter .avatar, .msg-gutter img'),
    };
    palco.remove();
    return JSON.stringify(r);
  })()`),
);

/*
  Duas trilhas, e a primeira RIGIDA.

  A rigidez e o ponto. Se a coluna de horario acompanhar o conteudo, os
  carimbos deixam de se alinhar entre mensagens e a coluna deixa de ser uma
  coluna — vira um recuo irregular, e o beneficio inteiro (varrer a esquerda
  procurando um momento) desaparece.
*/
check('a mensagem e uma grade de duas trilhas', log.linha.display === 'grid', log.linha.display);
check(
  'e a coluna do horario tem largura fixa, nao elastica',
  /^\d+(\.\d+)?px \d/.test(log.linha.trilhas),
  log.linha.trilhas,
);

/*
  O avatar saiu da calha. Este check existe porque a volta dele e a forma mais
  provavel de a estrutura regredir: parece que "falta alguma coisa" ali.
*/
check('a calha nao tem avatar dentro', !log.temAvatarNaCalha);

check(
  'o horario esta em monoespacada, para alinhar em coluna',
  log.carimbo.fonte === 'JetBrains Mono',
  log.carimbo.fonte,
);
/*
  Encostado a direita para os dois-pontos de "05:12" e "11:07" ficarem um
  embaixo do outro. Centralizado, a coluna deixa de ler como regua.
*/
check(
  'e encostado a direita, onde os dois-pontos se alinham',
  log.calha.justificar === 'flex-end',
  log.calha.justificar,
);

/*
  A regua vertical e o que transforma duas colunas em transcricao. Sem ela sao
  duas colunas soltas.
*/
check(
  'o corpo tem a regua vertical que forma o eixo',
  parseFloat(log.corpo.bordaEsq) >= 1,
  log.corpo.bordaEsq,
);

/*
  MENCAO A MIM PRECISA TER MARCA.

  Antes NAO TINHA NENHUMA: o componente calculava `mentionsMe` — mencao direta,
  @everyone e mencao a cargo — punha a classe na mensagem, e nenhuma folha de
  estilo tinha regra para ela. O calculo rodava e o resultado ia para o nada, e
  quem rolava um canal movimentado procurando onde foi chamado nao tinha nada
  na tela apontando.
*/
check(
  'mencao a mim acende o eixo',
  log.corpoMencao.corBordaEsq !== log.corpo.corBordaEsq,
  log.corpoMencao.corBordaEsq,
);

/*
  A MENSAGEM FIXADA NAO LAVA A LINHA INTEIRA.

  A regra antiga pintava o fundo do bloco todo e punha uma barra na borda
  esquerda. Na estrutura de log a borda esquerda caiu na coluna de horario —
  longe do texto — e a lavagem cobriu o carimbo, deixando-o ilegivel. Foi visto
  na tela antes de ser consertado.
*/
check(
  'a fixada nao lava a linha inteira',
  log.linhaFixada.fundo === 'rgba(0, 0, 0, 0)' && log.linhaFixada.sombra === 'none',
  'fundo ' + log.linhaFixada.fundo,
);
check(
  'ela marca o eixo, como a mencao',
  log.corpoFixado.corBordaEsq !== log.corpo.corBordaEsq,
  log.corpoFixado.corBordaEsq,
);

/*
  O nome de quem falou virou ETIQUETA, nao titulo.

  Estava em 14px peso 600 — do tamanho do texto da mensagem e mais pesado que
  ele. Numa conversa o que importa e o que foi dito, nao quem disse; o nome
  precisa ser achavel, nao dominante.
*/
check(
  'o nome do autor le como etiqueta tecnica',
  log.autor.fonte === 'JetBrains Mono' && log.autor.caixa === 'uppercase',
  log.autor.fonte + ' ' + log.autor.caixa,
);

// ---------------------------------------------------------------------------
/*
  A FAIXA DE ESTADO NAO PODE INVENTAR NUMERO.

  Esta e a regra que justifica a faixa existir. Uma linha tecnica cheia de dado
  decorativo — uptime que ninguem contou, subnet que ninguem leu — fica bonita
  e ensina a pessoa a ignorar a faixa inteira. No dia em que a latencia estiver
  em 400ms, ela vai estar escrita num lugar que ninguem mais olha.

  A vitrine roda SEM CHAMADA — e essa e a parte que da para garantir. O elo com
  o servidor pode muito bem estar de pe: o login e persistente, entao abrir o
  aplicativo com uma sessao guardada conecta o gateway mesmo nesta tela. Medido
  aqui: a faixa mostrou ELO_OK enquanto latencia e voz estavam em traco, e isso
  esta CERTO — o elo existe, a chamada nao.

  Entao o que se cobra e o que nao pode existir: sem chamada, latencia e
  contagem de voz tem que sair em traco. Um zero seria pior — uma mentira
  precisa, "medi e deu zero", que ainda por cima leria como conexao perfeita.

  E o unico lugar onde da para cobrar isso do componente de verdade. Uma
  imitacao de marcacao passaria sempre, porque quem a escreve escreve os tracos
  na mao.
*/
console.log(String.fromCharCode(10) + '--- FAIXA DE ESTADO: SO O QUE E MEDIDO ---');

const faixa = JSON.parse(
  await avaliar(`(() => {
    const raiz = document.querySelector('[data-vitrine="faixa"] .faixa');
    if (!raiz) return JSON.stringify({ existe: false });

    const itens = [...raiz.querySelectorAll('.faixa-item')].map((el) => ({
      chave: el.querySelector('.faixa-chave')?.textContent?.trim() ?? '',
      valor: el.querySelector('.faixa-valor')?.textContent?.trim() ?? '',
    }));

    const elo = raiz.querySelector('.faixa-elo');
    const relogio = raiz.querySelector('.faixa-relogio');

    return JSON.stringify({
      existe: true,
      itens,
      eloTexto: elo?.textContent?.trim() ?? '',
      eloTemPonto: !!elo?.querySelector('.faixa-ponto'),
      eloTemTitulo: (elo?.getAttribute('title') ?? '').length > 8,
      relogio: relogio?.textContent?.trim() ?? '',
      vivo: raiz.getAttribute('aria-live'),
      papel: raiz.getAttribute('role'),
      altura: raiz.getBoundingClientRect().height,
    });
  })()`),
);

check('a faixa esta montada na vitrine', faixa.existe);

if (faixa.existe) {
  /*
    O check central. Em repouso, todo valor MEDIDO tem que ser traco.
    Um zero seria pior que o traco: uma mentira precisa — "medi e deu zero" —
    e zero milissegundos ainda leria como conexao perfeita.
  */
  const medidos = faixa.itens.filter((i) => i.chave === 'RTT' || i.chave === 'VOZ');
  check(
    'sem chamada, nenhum valor medido vira numero',
    medidos.length > 0 && medidos.every((i) => i.valor === '--'),
    medidos.map((i) => i.chave + '=' + i.valor).join(' '),
  );

  /*
    Cor sozinha nao comunica: daltonismo vermelho-verde e o caso mais comum, e
    este ponto distingue exatamente vermelho de verde. Por isso o estado
    tambem vem escrito ao lado, e com descricao em `title`.
  */
  check(
    'o estado do elo vem escrito, nao so colorido',
    faixa.eloTexto.length >= 5 && faixa.eloTemPonto,
    faixa.eloTexto,
  );
  check('e tem descricao em texto para quem passar o mouse', faixa.eloTemTitulo);

  check('o relogio esta correndo, com segundos', /^\d{2}:\d{2}:\d{2}$/.test(faixa.relogio), faixa.relogio);

  /*
    A faixa NAO pode ser uma regiao viva.

    O relogio muda a cada segundo. Com `aria-live` ligado, o leitor de tela
    falaria a hora sem parar e o aplicativo ficaria inutilizavel para quem
    depende dele. Quem precisa ser avisado de queda ja e servido pelos
    anuncios, que falam uma vez e param.
  */
  check(
    'mas nao anuncia sozinha, senao falaria a hora a cada segundo',
    faixa.vivo === 'off' && faixa.papel === 'status',
    'aria-live=' + faixa.vivo,
  );

  /*
    Altura contada: a faixa divide a janela com a conversa, que e o que a
    pessoa veio fazer. Passar disso e roubar espaco de leitura para mostrar
    cromo.
  */
  check('e ocupa pouca altura', faixa.altura > 0 && faixa.altura <= 26, Math.round(faixa.altura) + 'px');
}


console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

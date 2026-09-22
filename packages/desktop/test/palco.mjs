/**
 * Exercita o palco de video pela interface, como a pessoa usa.
 *
 * O que esta sendo verificado nao e "o video aparece" — isso os outros testes
 * ja fazem. E o comportamento da tela: todo mundo na chamada ganha um quadro,
 * clicar promove a principal, clicar de novo devolve para a grade, e o
 * elemento de video sobrevive a troca sem ser recriado. Esse ultimo ponto e o
 * que garante que a imagem nao pisque ao trocar de disposicao, e e invisivel
 * em qualquer teste que so olhe para o resultado final.
 *
 *   node packages/desktop/test/palco.mjs [porta]
 *
 * Espera o app ja logado e com depuracao aberta.
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

// ---------------------------------------------------------------------------
console.log('\n--- ENTRAR NA VOZ ---');

const entrada = JSON.parse(
  await avaliar(`(async () => {
    const voz = document.querySelector('.channel[data-tipo="GUILD_VOICE"]');
    if (!voz) return JSON.stringify({ erro: 'nenhum canal de voz no DOM' });
    voz.click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 400));
      const b = [...document.querySelectorAll('.hud-controls button')]
        .find(x => (x.getAttribute('aria-label') || '').includes('tela') ||
                   (x.getAttribute('aria-label') || '').includes('transmis'));
      if (b && !b.disabled) break;
    }
    return JSON.stringify({
      palco: !!document.querySelector('.stage'),
      quadros: document.querySelectorAll('.tile').length,
      semCamera: document.querySelectorAll('.tile.faceless').length,
      titulo: document.querySelector('.stage-title')?.textContent?.trim() ?? null,
    });
  })()`),
);

check('o palco aparece so de entrar na chamada', entrada.palco === true, entrada.erro ?? '');
check('quem esta sem camera tambem ganha quadro', entrada.semCamera >= 1, `${entrada.quadros} quadro(s)`);
check('sem transmissao o titulo nao diz "ao vivo"', entrada.titulo === 'Na chamada', entrada.titulo ?? '');

if (!entrada.palco) {
  console.log('\nsem palco nao da para seguir.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\n--- TRANSMITIR A TELA ---');

const transmissao = JSON.parse(
  await avaliar(`(async () => {
    const b = [...document.querySelectorAll('.hud-controls button')]
      .find(x => { const r = x.getAttribute('aria-label') || '';
                   return r.includes('tela') || r.includes('transmis'); });
    if (!b) return JSON.stringify({ erro: 'botao de tela nao encontrado' });
    b.click();

    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (document.querySelector('.source')) break;
    }
    const opcao = document.querySelector('.source');
    if (!opcao) return JSON.stringify({ erro: 'seletor de tela nao abriu' });
    opcao.click();

    const confirmar = [...document.querySelectorAll('.modal-foot button, .btn-primary')]
      .find(x => /transmit|compartilh/i.test(x.textContent || ''));
    if (confirmar) confirmar.click();

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (document.querySelector('.tile-live')) break;
    }
    await new Promise(r => setTimeout(r, 1200));

    return JSON.stringify({
      aoVivo: !!document.querySelector('.tile-live'),
      quadros: document.querySelectorAll('.tile').length,
      destacado: document.querySelectorAll('.tile.spot').length,
      miniaturas: document.querySelectorAll('.tile.mini').length,
      titulo: document.querySelector('.stage-title')?.textContent?.trim() ?? null,
    });
  })()`),
);

check('a transmissao comeca', transmissao.aoVivo === true, transmissao.erro ?? '');
check('a tela entra como quadro proprio', transmissao.quadros >= 2, `${transmissao.quadros} quadros`);
check('a transmissao vai para o destaque sozinha', transmissao.destacado === 1);
check('os outros viram miniatura', transmissao.miniaturas >= 1, `${transmissao.miniaturas}`);
check('o titulo passa a dizer "ao vivo"', transmissao.titulo === 'Ao vivo', transmissao.titulo ?? '');

// ---------------------------------------------------------------------------
console.log('\n--- DESTACAR E VOLTAR ---');

// A identidade do elemento de video e o ponto do teste: se ele for recriado ao
// trocar de disposicao, a faixa e reanexada e a imagem pisca.
const troca = JSON.parse(
  await avaliar(`(async () => {
    const antes = document.querySelector('.tile.spot video');
    if (!antes) return JSON.stringify({ erro: 'nada em destaque para tirar' });
    window.__palcoVideo = antes;

    document.querySelector('.tile.spot').click();
    await new Promise(r => setTimeout(r, 600));
    const naGrade = {
      destacado: document.querySelectorAll('.tile.spot').length,
      miniaturas: document.querySelectorAll('.tile.mini').length,
      mesmoElemento: document.querySelector('.tile video') === window.__palcoVideo,
    };

    // Promove de novo, agora pelo botao de destaque e nao pelo corpo do quadro.
    const alvo = [...document.querySelectorAll('.tile')].find(t => t.querySelector('video'));
    const botao = alvo?.querySelector('.tile-tool');
    botao?.click();
    await new Promise(r => setTimeout(r, 600));

    return JSON.stringify({
      naGrade,
      voltouAoDestaque: document.querySelectorAll('.tile.spot').length === 1,
      aindaMesmoElemento: document.querySelector('.tile.spot video') === window.__palcoVideo,
      ferramentasPorQuadro: document.querySelector('.tile')?.querySelectorAll('.tile-tool').length ?? 0,
    });
  })()`),
);

check('clicar no destaque devolve para a grade', troca.naGrade?.destacado === 0, troca.erro ?? '');
check('sem destaque nao sobra miniatura', troca.naGrade?.miniaturas === 0);
check(
  'o video nao e recriado ao sair do destaque',
  troca.naGrade?.mesmoElemento === true,
  troca.naGrade?.mesmoElemento ? '' : 'elemento trocado: a imagem piscaria',
);
check('o botao de destaque promove o quadro', troca.voltouAoDestaque === true);
check(
  'o video nao e recriado ao voltar ao destaque',
  troca.aindaMesmoElemento === true,
  troca.aindaMesmoElemento ? '' : 'elemento trocado: a imagem piscaria',
);
check('cada quadro tem destaque e tela cheia', troca.ferramentasPorQuadro === 2, `${troca.ferramentasPorQuadro} botao(oes)`);

// ---------------------------------------------------------------------------
console.log('\n--- TELA CHEIA ---');

const cheia = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 4000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    };

    const alvo = document.querySelector('.tile.spot') ?? document.querySelector('.tile');
    const botoes = alvo.querySelectorAll('.tile-tool');
    botoes[botoes.length - 1].click();

    const entrou = await ate(() => document.fullscreenElement === alvo);
    const classeEntrou = await ate(() => alvo.classList.contains('fullscreen'));

    // Sai por fora, como quem aperta Esc: e o caminho em que o app precisa
    // perceber sozinho que a tela cheia acabou.
    if (document.fullscreenElement) await document.exitFullscreen();
    const saiu = await ate(() => document.fullscreenElement === null);
    const classeSaiu = await ate(() => !alvo.classList.contains('fullscreen'));

    return JSON.stringify({ entrou, classeEntrou, saiu, classeSaiu });
  })()`),
);

check('o botao leva o quadro a tela cheia', cheia.entrou === true);
check('a classe acompanha a tela cheia', cheia.classeEntrou === true);
check('sair da tela cheia volta ao palco', cheia.saiu === true);
check('sair por fora tambem tira a classe', cheia.classeSaiu === true);

// ---------------------------------------------------------------------------
console.log('\n--- RECOLHER O PALCO ---');

const recolher = JSON.parse(
  await avaliar(`(async () => {
    // Espera a condicao em vez de dormir um tempo fixo. A altura passa por uma
    // transicao de 220ms; um sleep escolhido no olho ora mede antes do fim,
    // ora depois, e o teste comeca a falhar por conta propria.
    const ate = async (cond, prazo = 4000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    };
    const palco = () => document.querySelector('.stage');
    const altura = () => Math.round(palco().getBoundingClientRect().height);
    const acao = (re) => [...document.querySelectorAll('.stage-act')]
      .find(x => re.test(x.getAttribute('aria-label') || ''));

    const b = acao(/recolher/i);
    if (!b) return JSON.stringify({ erro: 'botao de recolher nao encontrado' });

    const antes = altura();
    b.click();
    const encolheu = await ate(() => altura() < antes);

    const volta = acao(/mostrar/i);
    if (!volta) return JSON.stringify({ erro: 'o botao nao virou "mostrar"', antes, depois: altura() });
    const depois = altura();
    volta.click();
    await ate(() => altura() === antes);

    return JSON.stringify({ antes, depois, encolheu, restaurou: altura() });
  })()`),
);

check(
  'recolher encolhe o palco',
  recolher.encolheu === true,
  recolher.erro ?? `${recolher.antes}px -> ${recolher.depois}px`,
);
check('a barra continua visivel ao recolher', recolher.depois >= 28, `${recolher.depois}px`);
check('mostrar devolve a altura', recolher.restaurou === recolher.antes, `${recolher.restaurou}px`);

// ---------------------------------------------------------------------------
console.log('\n--- O PALCO NAO ENGOLE A CONVERSA ---');

const espacoAntes = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 4000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    };

    const alturaPalco = () => Math.round(document.querySelector('.stage').getBoundingClientRect().height);
    const alturaChat = () => Math.round(document.querySelector('.chat')?.getBoundingClientRect().height ?? 0);
    const temCampo = () => {
      const c = document.querySelector('.composer, .composer-wrap');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return r.height > 0 && r.bottom <= window.innerHeight + 1;
    };

    const inicial = { palco: alturaPalco(), chat: alturaChat(), campo: temCampo() };

    // Grava uma altura absurda e recarrega. E o cenario real: a altura vem de
    // uma janela maior, ou a janela encolheu depois. Testar por arrasto
    // sintetico seria mais fragil — se o arrasto nao pegasse, o teste passaria
    // sem ter verificado nada.
    const exagero = window.innerHeight * 3;
    localStorage.setItem('kiroshi.stage.height', String(exagero));
    window.__palcoPedido = exagero;
    return JSON.stringify({ inicial, pedido: exagero, janela: window.innerHeight });
  })()`),
);

await enviar('Page.reload');
await new Promise((r) => setTimeout(r, 8000));

// Volta para a chamada e a transmissao depois do recarregamento.
const depoisDeRecarregar = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 20000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 150));
      }
      return false;
    };

    await ate(() => document.querySelector('.channel[data-tipo="GUILD_VOICE"]'));
    if (!document.querySelector('.stage')) {
      document.querySelector('.channel[data-tipo="GUILD_VOICE"]').click();
      await ate(() => document.querySelector('.stage'));
    }

    // Religa a transmissao antes de medir. Sem video o palco usa a altura
    // compacta e o teto nunca entra em jogo — o teste passaria sem ter
    // exercitado a regra que ele existe para proteger.
    const b = [...document.querySelectorAll('.hud-controls button')]
      .find(x => /tela|transmis/i.test(x.getAttribute('aria-label') || ''));
    await ate(() => {
      const atual = [...document.querySelectorAll('.hud-controls button')]
        .find(x => /tela|transmis/i.test(x.getAttribute('aria-label') || ''));
      return atual && !atual.disabled;
    });
    b?.click();
    await ate(() => document.querySelector('.source'), 8000);
    document.querySelector('.source')?.click();
    [...document.querySelectorAll('.modal-foot button, .btn-primary')]
      .find(x => /transmit|compartilh/i.test(x.textContent || ''))?.click();
    const transmitindo = await ate(() => document.querySelector('.tile-live'), 20000);
    await new Promise(r => setTimeout(r, 1200));

    const palco = document.querySelector('.stage');
    const chat = document.querySelector('.chat');
    const campo = document.querySelector('.composer, .composer-wrap');
    const r = campo?.getBoundingClientRect();

    return JSON.stringify({
      transmitindo,
      pedido: Number(localStorage.getItem('kiroshi.stage.height')),
      palco: Math.round(palco?.getBoundingClientRect().height ?? 0),
      chat: Math.round(chat?.getBoundingClientRect().height ?? 0),
      campoVisivel: Boolean(r && r.height > 0 && r.bottom <= window.innerHeight + 1),
      janela: window.innerHeight,
    });
  })()`),
);

const espaco = { inicial: espacoAntes.inicial, ...depoisDeRecarregar };

check(
  'uma altura guardada absurda e contida',
  espaco.transmitindo === true && espaco.palco > 0 && espaco.palco < espaco.janela,
  `pediram ${espaco.pedido}px, ficou ${espaco.palco}px em janela de ${espaco.janela}px`,
);
check('a conversa continua com espaco', espaco.chat >= 150, `${espaco.chat}px de conversa`);
check(
  'o campo de escrever continua alcancavel',
  espaco.campoVisivel === true,
  espaco.campoVisivel ? '' : 'o campo saiu da tela: nao daria para responder',
);

// ---------------------------------------------------------------------------
console.log('\n--- LIMPAR ---');

await avaliar(`(async () => {
  // O teste do teto gravou uma altura absurda; nao pode ficar para o usuario.
  localStorage.removeItem('kiroshi.stage.height');

  const parar = [...document.querySelectorAll('.hud-controls button')]
    .find(x => /parar transmis/i.test(x.getAttribute('aria-label') || ''));
  parar?.click();
  await new Promise(r => setTimeout(r, 800));
  const sair = [...document.querySelectorAll('.hud-controls button')]
    .find(x => /sair da chamada/i.test(x.getAttribute('aria-label') || ''));
  sair?.click();
  await new Promise(r => setTimeout(r, 800));
  return true;
})()`);

const limpo = await avaliar(`!document.querySelector('.stage')`);
check('sair da chamada tira o palco da tela', limpo === true);

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

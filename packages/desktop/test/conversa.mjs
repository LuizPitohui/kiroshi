/**
 * Exercita o compositor: mandar mensagem, mandar de novo, anexar, remover o
 * anexo e abrir o seletor de emoji.
 *
 * Este teste nasceu de um relato de uso real — "so da para mandar uma
 * mensagem, o X do anexo nao funciona, o emoji nao funciona". Nenhum teste
 * cobria a conversa pela interface, so pela API, e por isso um compositor que
 * trava depois do primeiro envio passava por todos eles.
 *
 *   node packages/desktop/test/conversa.mjs [porta]
 *
 * Espera o app aberto com depuracao e ja logado.
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
const errosConsole = [];

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
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    errosConsole.push(msg.params.entry.text);
  }
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
await enviar('Log.enable').catch(() => {});

/**
 * Digita no campo como uma pessoa digita.
 *
 * O React nao enxerga `elemento.value = x`: ele guarda o valor anterior e
 * ignora o evento por achar que nada mudou. O setter nativo do prototipo
 * contorna isso, que e o jeito padrao de dirigir um campo controlado.
 */
const DIGITAR = (texto) => `(async () => {
  const campo = document.querySelector('.composer textarea');
  if (!campo) return 'sem campo';
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(campo), 'value'
  ).set;
  setter.call(campo, ${JSON.stringify(texto)});
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  return campo.value;
})()`;

/*
  Envia e espera o campo esvaziar antes de devolver o controle.

  O `send` limpa o texto por estado do React, que nao aplica no mesmo instante.
  Com uma espera fixa, o teste as vezes digitava a mensagem seguinte antes da
  limpeza chegar, e a limpeza apagava o que tinha acabado de ser digitado — uma
  falha do teste que parecia defeito do aplicativo.
*/
const ENTER = `(async () => {
  const campo = document.querySelector('.composer textarea');
  campo.focus();
  campo.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
  }));
  const fim = Date.now() + 5000;
  while (Date.now() < fim) {
    await new Promise(r => setTimeout(r, 100));
    if (document.querySelector('.composer textarea').value === '') break;
  }
  await new Promise(r => setTimeout(r, 900));
  return document.querySelector('.composer textarea').value === '';
})()`;

const CONTAR = `document.querySelectorAll('.msg').length`;

// ---------------------------------------------------------------------------
console.log('\n--- ABRIR UM CANAL DE TEXTO ---');

const canal = JSON.parse(
  await avaliar(`(async () => {
    /*
      Escolhe um servidor antes de procurar canal.

      Sem isto o teste dependia de onde a janela tinha parado na ultima vez —
      e se aquele servidor nao existisse mais, ele falhava dizendo "nenhum
      canal de texto", que soa como defeito do aplicativo em vez de cenario
      mal preparado.
    */
    const servidores = [...document.querySelectorAll('.rail-slot[data-guild]')];
    for (const s of servidores) {
      s.click();
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (document.querySelector('.channel[data-tipo="GUILD_TEXT"]')) break;
      }
      if (document.querySelector('.channel[data-tipo="GUILD_TEXT"]')) break;
    }

    const alvo = document.querySelector('.channel[data-tipo="GUILD_TEXT"]');
    if (!alvo) return JSON.stringify({
      erro: 'nenhum canal de texto em nenhum dos ' + servidores.length + ' servidores',
    });
    alvo.click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (document.querySelector('.composer textarea')) break;
    }
    return JSON.stringify({
      campo: !!document.querySelector('.composer textarea'),
      mensagens: document.querySelectorAll('.msg').length,
    });
  })()`),
);
check('o campo de escrever aparece', canal.campo === true, canal.erro ?? '');
if (!canal.campo) process.exit(1);

// ---------------------------------------------------------------------------
console.log('\n--- PRIMEIRA MENSAGEM ---');

const marca = Date.now().toString(36).slice(-5);
const antes = Number(await avaliar(CONTAR));

await avaliar(DIGITAR(`primeira ${marca}`));
const limpouApos1 = await avaliar(ENTER);
const depoisDaPrimeira = Number(await avaliar(CONTAR));

check('a primeira mensagem aparece', depoisDaPrimeira > antes, `${antes} -> ${depoisDaPrimeira}`);
check('o campo fica vazio depois de enviar', limpouApos1 === true);

// ---------------------------------------------------------------------------
console.log('\n--- SEGUNDA MENSAGEM (o relato) ---');

await avaliar(DIGITAR(`segunda ${marca}`));
const digitou = await avaliar(`document.querySelector('.composer textarea').value`);
check('da para digitar de novo', digitou === `segunda ${marca}`, `campo: "${digitou}"`);

await avaliar(ENTER);
const depoisDaSegunda = Number(await avaliar(CONTAR));
check(
  'a segunda mensagem aparece',
  depoisDaSegunda > depoisDaPrimeira,
  `${depoisDaPrimeira} -> ${depoisDaSegunda}`,
);

const erroNaTela = await avaliar(
  `document.querySelector('.composer-wrap .field-error, .composer .field-error')?.textContent ?? null`,
);
check('nenhum erro na tela', erroNaTela === null, erroNaTela ?? '');

// ---------------------------------------------------------------------------
console.log('\n--- TERCEIRA, PARA TER CERTEZA ---');

await avaliar(DIGITAR(`terceira ${marca}`));
await avaliar(ENTER);
const depoisDaTerceira = Number(await avaliar(CONTAR));
check(
  'a terceira mensagem aparece',
  depoisDaTerceira > depoisDaSegunda,
  `${depoisDaSegunda} -> ${depoisDaTerceira}`,
);

// ---------------------------------------------------------------------------
console.log('\n--- SELETOR DE EMOJI ---');

const emoji = JSON.parse(
  await avaliar(`(async () => {
    const botao = [...document.querySelectorAll('.composer button, .composer-btn')]
      .find(b => /emoji|carinha/i.test((b.getAttribute('aria-label')||'') + (b.getAttribute('title')||'')));
    if (!botao) return JSON.stringify({ erro: 'botao de emoji nao encontrado' });

    // O botao alterna. Se o painel ficou aberto de outra rodada, clicar aqui
    // fecharia em vez de abrir, e o teste acusaria um defeito que nao existe.
    // Garante o estado inicial em vez de supor.
    if (document.querySelector('.composer .menu')) {
      botao.click();
      await new Promise(r => setTimeout(r, 400));
    }

    botao.click();
    await new Promise(r => setTimeout(r, 600));

    const painel = document.querySelector('.composer .menu');
    const abriu = Boolean(painel && painel.getBoundingClientRect().height > 0);

    let inseriu = null;
    if (abriu) {
      const primeiro = painel.querySelector('button');
      if (primeiro) {
        primeiro.click();
        await new Promise(r => setTimeout(r, 400));
        inseriu = document.querySelector('.composer textarea').value;
      }
    }
    return JSON.stringify({ abriu, inseriu });
  })()`),
);
check('o seletor de emoji abre', emoji.abriu === true, emoji.erro ?? '');
check(
  'clicar num emoji escreve no campo',
  typeof emoji.inseriu === 'string' && emoji.inseriu.length > 0,
  emoji.inseriu === null ? 'nao cheguei a clicar' : `campo: "${emoji.inseriu}"`,
);

// Limpa o campo para os proximos passos.
await avaliar(DIGITAR(''));
await avaliar(`document.body.click(); true`);

// ---------------------------------------------------------------------------
console.log('\n--- ANEXO E O BOTAO DE REMOVER ---');

const anexo = JSON.parse(
  await avaliar(`(async () => {
    const entrada = document.querySelector('.composer input[type="file"]');
    if (!entrada) return JSON.stringify({ erro: 'campo de arquivo nao encontrado' });

    // Monta um PNG de verdade e entrega ao input como o sistema entregaria.
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVQ4y2NkYPhfz0AEYBxVSF+FjIyM/xkYGBgYGBj+MzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAABK4gX9nrtTKwAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const arquivo = new File([bytes], 'teste.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(arquivo);
    entrada.files = dt.files;
    entrada.dispatchEvent(new Event('change', { bubbles: true }));

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (document.querySelector('.composer-att')) break;
    }
    const cartao = document.querySelector('.composer-att');
    if (!cartao) return JSON.stringify({ erro: 'o anexo nao apareceu no compositor' });

    // Espera o envio terminar (a sobreposicao de porcentagem some).
    let enviou = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 300));
      const erro = cartao.textContent.match(/falha|erro/i);
      if (erro) break;
      if (!cartao.textContent.match(/\\d+%/)) { enviou = true; break; }
    }

    const x = cartao.querySelector('.composer-att-x');
    const temX = Boolean(x);
    let removeu = null;
    if (x) {
      x.click();
      await new Promise(r => setTimeout(r, 500));
      removeu = !document.querySelector('.composer-att');
    }

    return JSON.stringify({
      apareceu: true,
      enviou,
      temX,
      removeu,
      texto: cartao.textContent.slice(0, 60),
    });
  })()`),
);

check('o anexo entra no compositor', anexo.apareceu === true, anexo.erro ?? '');
check('o arquivo termina de enviar', anexo.enviou === true, anexo.texto ?? '');
check('o botao de remover existe', anexo.temX === true);
check(
  'o botao de remover funciona',
  anexo.removeu === true,
  anexo.removeu === false ? 'clicou e o anexo continuou la' : '',
);

// ---------------------------------------------------------------------------
console.log('\n--- MENSAGEM COM IMAGEM ---');

const comImagem = JSON.parse(
  await avaliar(`(async () => {
    const entrada = document.querySelector('.composer input[type="file"]');
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPElEQVQ4y2NkYPhfz0AEYBxVSF+FjIyM/xkYGBgYGBj+MzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAABK4gX9nrtTKwAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'foto.png', { type: 'image/png' }));
    entrada.files = dt.files;
    entrada.dispatchEvent(new Event('change', { bubbles: true }));

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 300));
      const c = document.querySelector('.composer-att');
      if (c && !c.textContent.match(/\\d+%/)) break;
    }

    const antes = document.querySelectorAll('.msg').length;
    const campo = document.querySelector('.composer textarea');
    campo.focus();
    campo.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
    await new Promise(r => setTimeout(r, 2500));

    return JSON.stringify({
      antes,
      depois: document.querySelectorAll('.msg').length,
      aindaNoCompositor: Boolean(document.querySelector('.composer-att')),
      erro: document.querySelector('.composer .field-error')?.textContent ?? null,
    });
  })()`),
);
check(
  'manda mensagem so com imagem',
  comImagem.depois > comImagem.antes,
  comImagem.erro ?? `${comImagem.antes} -> ${comImagem.depois}`,
);
check('o anexo sai do compositor depois de enviar', comImagem.aindaNoCompositor === false);

// ---------------------------------------------------------------------------
const reais = errosConsole.filter((e) => !/Autofill|devtools/i.test(e));

// ---------------------------------------------------------------------------
console.log('\n--- BUSCA DE EMOJI ---');

const busca = JSON.parse(
  await avaliar(`(async () => {
    const abrir = [...document.querySelectorAll('.composer button, .composer-btn')]
      .find(b => /emoji/i.test((b.getAttribute('aria-label')||'') + (b.getAttribute('title')||'')));
    if (!abrir) return JSON.stringify({ erro: 'botao de emoji nao encontrado' });

    if (!document.querySelector('.composer .menu')) abrir.click();
    await new Promise(r => setTimeout(r, 500));

    const painel = document.querySelector('.composer .menu');
    if (!painel) return JSON.stringify({ erro: 'painel nao abriu' });

    const campo = painel.querySelector('input');
    if (!campo) return JSON.stringify({ erro: 'sem caixa de busca' });

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value').set;
    const procurar = async (termo) => {
      setter.call(campo, termo);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const botoes = [...painel.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
      return { termo, quantos: botoes.length, primeiros: botoes.slice(0, 6) };
    };

    const resultados = {};
    for (const t of ['risada', 'coracao', 'coração', 'FOGO', 'pizza', 'joia', 'xyzabc']) {
      resultados[t] = await procurar(t);
    }

    // Deixa o painel limpo e fecha.
    setter.call(campo, '');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    document.body.click();
    await new Promise(r => setTimeout(r, 300));

    return JSON.stringify(resultados);
  })()`),
);

check('busca "risada" acha algo', (busca.risada?.quantos ?? 0) > 0, busca.erro ?? (busca.risada?.primeiros ?? []).join(' '));
check('busca "coracao" acha algo', (busca.coracao?.quantos ?? 0) > 0, (busca.coracao?.primeiros ?? []).join(' '));
check('acento nao atrapalha', (busca['coração']?.quantos ?? 0) > 0, (busca['coração']?.primeiros ?? []).join(' '));
check('maiuscula nao atrapalha', (busca.FOGO?.quantos ?? 0) > 0, (busca.FOGO?.primeiros ?? []).join(' '));
check('busca "pizza" acha a pizza', (busca.pizza?.primeiros ?? []).includes('🍕'), (busca.pizza?.primeiros ?? []).join(' '));
check('busca "joia" acha o polegar', (busca.joia?.primeiros ?? []).includes('👍'), (busca.joia?.primeiros ?? []).join(' '));
check('termo sem sentido nao traz lixo', (busca.xyzabc?.quantos ?? 0) === 0, `${busca.xyzabc?.quantos} resultados`);

// ---------------------------------------------------------------------------
console.log('\n--- FIXAR MENSAGEM ---');

const fixar = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (cond, prazo = 6000) => {
      const fim = Date.now() + prazo;
      while (Date.now() < fim) { if (cond()) return true; await new Promise(r => setTimeout(r, 100)); }
      return false;
    };

    const msg = [...document.querySelectorAll('.msg')].pop();
    if (!msg) return JSON.stringify({ erro: 'nenhuma mensagem para fixar' });

    // As acoes so aparecem no hover; dispara o evento que a interface espera.
    msg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    msg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const botao = [...msg.querySelectorAll('.msg-action')]
      .find(b => /fixar/i.test(b.getAttribute('aria-label') || ''));
    if (!botao) return JSON.stringify({ erro: 'botao de fixar nao encontrado', acoes: [...msg.querySelectorAll('.msg-action')].map(b => b.getAttribute('aria-label')) });

    const rotuloAntes = botao.getAttribute('aria-label');
    botao.click();

    /*
      Espera o que vier primeiro: a marca de fixada ou o aviso de erro.

      Esperar so pela marca e depois olhar o aviso perde a mensagem, porque ela
      se apaga sozinha — o teste lia exatamente no instante em que o texto
      sumia e concluia que nada tinha acontecido.
    */
    let avisou = null;
    await ate(() => {
      const texto = msg.querySelector('.msg-aviso')?.textContent;
      if (texto) { avisou = texto; return true; }
      return msg.classList.contains('pinned');
    });

    const marcou = msg.classList.contains('pinned');
    const temSelo = Boolean(msg.querySelector('.msg-pinned'));
    const rotuloDepois = [...msg.querySelectorAll('.msg-action')]
      .find(b => /fixar/i.test(b.getAttribute('aria-label') || ''))?.getAttribute('aria-label');

    // Desfaz, para nao deixar mensagem fixada de teste.
    let desmarcou = null;
    if (marcou) {
      const b2 = [...msg.querySelectorAll('.msg-action')]
        .find(b => /desafixar/i.test(b.getAttribute('aria-label') || ''));
      b2?.click();
      desmarcou = await ate(() => !msg.classList.contains('pinned'));
    }

    return JSON.stringify({ rotuloAntes, marcou, temSelo, rotuloDepois, avisou, desmarcou });
  })()`),
);

if (fixar.erro) {
  check('fixar: achei a mensagem e o botao', false, fixar.erro + ' ' + JSON.stringify(fixar.acoes ?? ''));
} else if (fixar.avisou) {
  // Sem permissao o servidor recusa — e o ponto e que agora isso APARECE.
  check('sem permissao, o erro aparece na tela', typeof fixar.avisou === 'string' && fixar.avisou.length > 0, fixar.avisou);
} else {
  check('clicar em fixar marca a mensagem', fixar.marcou === true);
  check('a mensagem ganha o selo "Fixada"', fixar.temSelo === true);
  check('o botao vira "Desafixar"', /desafixar/i.test(fixar.rotuloDepois ?? ''), fixar.rotuloDepois ?? '');
  check('desafixar tira a marca', fixar.desmarcou === true);
}
console.log('\n--- ERROS NO CONSOLE ---');
if (reais.length === 0) console.log('  nenhum');
else reais.slice(0, 6).forEach((e) => console.log(`  ${e.slice(0, 200)}`));

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

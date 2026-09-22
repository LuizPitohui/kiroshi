/**
 * Mede se a imagem pisca durante uma chamada.
 *
 * O defeito que este teste tranca: `mediaVersion` era somado a cada amostra de
 * audio, cinco vezes por segundo, e estava nas dependencias do efeito que
 * anexa o video. Cada passagem desanexava e reanexava a faixa, e `detach` zera
 * o `srcObject` — preto, imagem, preto, imagem, continuamente, em camera e em
 * transmissao de tela.
 *
 * Contar quadros pretos seria dificil e lento. O sinal exato e outro: o
 * elemento `<video>` dispara `emptied` quando o `srcObject` e trocado ou
 * limpo. Em uma chamada estavel, isso deve acontecer ZERO vezes: ninguem
 * ligou nem desligou camera durante a medicao.
 *
 * O teste tambem observa `mediaVersion` pela interface, porque e a causa: se
 * ela andar sozinha com a sala parada, o defeito voltou mesmo que a guarda do
 * componente ainda esteja escondendo o sintoma.
 *
 * Precisa do aplicativo aberto, JA DENTRO de um canal de voz com alguem
 * transmitindo ou com camera ligada.
 *
 *   node packages/desktop/test/piscar.mjs [porta] [segundos]
 */

import WebSocket from 'ws';

const PORTA = Number(process.argv[2] ?? 9222);
const SEGUNDOS = Number(process.argv[3] ?? 12);

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

function enviar(metodo, params = {}, prazo = 120000) {
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

// ---------------------------------------------------------------------------
console.log('\n--- O PALCO ESTA COM VIDEO? ---');

const preparo = JSON.parse(
  await avaliar(`JSON.stringify({
    noPalco: Boolean(document.querySelector('.stage')),
    videos: document.querySelectorAll('.tile video').length,
  })`),
);

check('o aplicativo esta em um canal de voz', preparo.noPalco === true);
check(
  'ha pelo menos um video no palco',
  preparo.videos > 0,
  preparo.videos > 0 ? `${preparo.videos} video(s)` : 'ligue a camera ou uma transmissao antes',
);

if (falhou > 0) {
  console.log('\n  Sem video no palco nao da para medir piscar. Encerrando.\n');
  socket.close();
  process.exit(2);
}

// ---------------------------------------------------------------------------
console.log(`\n--- MEDINDO POR ${SEGUNDOS}s, SEM MEXER EM NADA ---`);

const medida = JSON.parse(
  await avaliar(`(async () => {
    const videos = [...document.querySelectorAll('.tile video')];

    /*
      `emptied` dispara quando o srcObject e trocado ou limpo. E o evento que
      corresponde exatamente ao quadro preto que a pessoa ve.
    */
    let vazios = 0;
    const ouvintes = videos.map((v) => {
      const h = () => { vazios++; };
      v.addEventListener('emptied', h);
      return () => v.removeEventListener('emptied', h);
    });

    // Tempo tocado por elemento: se a imagem some e volta, o relogio do video
    // trava, entao comparar inicio e fim mostra interrupcao real.
    const antes = videos.map((v) => v.currentTime);

    await new Promise((r) => setTimeout(r, ${SEGUNDOS * 1000}));

    for (const parar of ouvintes) parar();
    const depois = videos.map((v) => v.currentTime);

    return JSON.stringify({
      vazios,
      quantos: videos.length,
      // Quanto cada video avancou. Deve ser perto dos segundos medidos.
      avancos: depois.map((d, i) => Math.round((d - antes[i]) * 10) / 10),
      prontos: videos.filter((v) => v.readyState >= 2).length,
    });
  })()`),
);

console.log(`   ${medida.quantos} video(s), ${medida.prontos} com imagem`);
console.log(`   avanco de cada um: ${medida.avancos.join('s, ')}s`);

check(
  'nenhum video foi zerado durante a medicao',
  medida.vazios === 0,
  medida.vazios === 0 ? '' : `${medida.vazios} interrupcoes em ${SEGUNDOS}s — a imagem esta piscando`,
);

// Tolerancia larga de proposito: camada de qualidade mudando, ou uma rede
// ruim, atrasam o relogio sem que ninguem veja piscar. O que este teste
// persegue e a interrupcao, nao a fluidez.
const parado = medida.avancos.filter((a) => a < SEGUNDOS * 0.5);
check(
  'a imagem continuou andando em todos os quadros',
  parado.length === 0,
  parado.length === 0 ? '' : `${parado.length} quadro(s) praticamente parados`,
);

// ---------------------------------------------------------------------------
console.log('\n--- A CAUSA: A VERSAO DE MIDIA ESTA PARADA? ---');

const versao = JSON.parse(
  await avaliar(`(async () => {
    /*
      Nao ha como ler o estado do controlador de fora, entao a versao e medida
      pelo efeito dela: quantas vezes os elementos de video sao trocados. Um
      MutationObserver no atributo dos <video> pega remontagem; `emptied` acima
      ja pegou troca de fonte. Aqui fica a contagem de re-renderizacao do
      palco, que e o que a versao dispara.
    */
    const palco = document.querySelector('.stage');
    let mudancas = 0;
    const obs = new MutationObserver((lista) => { mudancas += lista.length; });
    obs.observe(palco, { childList: true, subtree: true, attributes: true });

    await new Promise((r) => setTimeout(r, 6000));
    obs.disconnect();
    return JSON.stringify({ mudancas });
  })()`),
);

/*
  Um palco parado ainda muda: o anel de quem fala acende e apaga, a latencia
  e reescrita a cada dois segundos. O que nao pode e a ordem de grandeza de
  cinco vezes por segundo em cada quadro, que era o sintoma.
*/
const LIMITE = 120;
check(
  'o palco nao esta sendo remontado continuamente',
  versao.mudancas < LIMITE,
  `${versao.mudancas} mutacoes em 6s (limite ${LIMITE})`,
);

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

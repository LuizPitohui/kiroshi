/**
 * Prova que a chamada fecha passando pelo relay.
 *
 * Existe porque quem nao tem IPv6 nao alcanca o servidor de midia direto — o
 * caso de um amigo dos Estados Unidos que tentou entrar oito vezes e nunca
 * conseguiu falar. O relay resolve isso, mas so serve se funcionar de ponta a
 * ponta, e "as credenciais chegaram" nao prova nada: elas ja chegaram uma vez
 * com formato que o codigo nao entendia.
 *
 * O teste forca o caminho pelo relay mesmo nesta maquina, que tem IPv6, e
 * cobra um candidato do tipo "relay" na conexao de verdade.
 *
 * Precisa de FORCE_TURN_RELAY=true no servidor durante a execucao.
 *
 * ATENCAO: hoje este teste FALHA neste servidor, e a falha e informacao, nao
 * defeito do teste. O SFU esta atras de CGNAT e anuncia um IPv4 privado
 * (192.168.100.21), entao o cliente pede ao TURN permissao para um endereco
 * que nunca sera a origem real dos pacotes. Medido: todos os pares de
 * candidatos ficam em "failed". Enquanto o servidor nao tiver IPv4 publico,
 * relay no lado do cliente nao fecha a chamada sozinho.
 *
 *   node packages/desktop/test/relay.mjs [porta]
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

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

// ---------------------------------------------------------------------------
console.log('\n--- O SERVIDOR MANDA O RELAY? ---');

const doServidor = JSON.parse(
  await avaliar(`(async () => {
    const base = localStorage.getItem('kiroshi.baseUrl');
    const sessao = JSON.parse(localStorage.getItem('kiroshi.session') || '{}');
    const canais = [...document.querySelectorAll('.channel[data-tipo="GUILD_VOICE"]')];
    if (canais.length === 0) {
      // Precisa abrir um servidor primeiro para os canais existirem.
      for (const s of [...document.querySelectorAll('.rail-slot[data-guild]')]) {
        s.click();
        await new Promise(r => setTimeout(r, 700));
        if (document.querySelector('.channel[data-tipo="GUILD_VOICE"]')) break;
      }
    }
    const voz = document.querySelector('.channel[data-tipo="GUILD_VOICE"]');
    if (!voz) return JSON.stringify({ erro: 'nenhum canal de voz' });

    // Descobre o id do canal pela ordem em que o app guarda; mais simples e
    // pedir ao proprio servidor entrando na voz, entao so inspecionamos o que
    // ele devolve na entrada.
    return JSON.stringify({ pronto: true });
  })()`),
);
check('o app esta logado e com canal de voz', doServidor.pronto === true, doServidor.erro ?? '');

// ---------------------------------------------------------------------------
console.log('\n--- ENTRAR NA VOZ COM RELAY FORCADO ---');

const chamada = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (c, p = 30000) => {
      const f = Date.now() + p;
      while (Date.now() < f) { if (c()) return true; await new Promise(r => setTimeout(r, 250)); }
      return false;
    };

    const voz = document.querySelector('.channel[data-tipo="GUILD_VOICE"]');
    voz.click();

    const entrou = await ate(() => document.querySelector('.stage'));
    if (!entrou) return JSON.stringify({ erro: 'nao entrou na chamada' });

    // Espera a latencia aparecer: e o sinal de que a midia fechou de verdade,
    // nao apenas de que a sinalizacao conectou.
    const temLatencia = await ate(() => {
      const v = document.querySelector('.hud-metric-value')?.textContent ?? '';
      return /\\d+\\s*ms/.test(v);
    }, 40000);

    return JSON.stringify({
      entrou,
      temLatencia,
      latencia: document.querySelector('.hud-metric-value')?.textContent?.trim() ?? null,
      aviso: document.querySelector('.hud')?.innerText?.split(String.fromCharCode(10))
        .find(l => /caiu|IPv6|instabilidade|nao consegui/i.test(l)) ?? null,
    });
  })()`),
);

check('entra no canal', chamada.entrou === true, chamada.erro ?? '');
check('a midia fecha e reporta latencia', chamada.temLatencia === true, chamada.latencia ?? 'sem latencia');
check('nenhum aviso de falha', chamada.aviso === null, chamada.aviso ?? '');

// ---------------------------------------------------------------------------
console.log('\n--- O CAMINHO E MESMO O RELAY? ---');

/*
  O caminho e lido pelo diagnostico do proprio aplicativo.

  Ele ja sabe atravessar o interno do LiveKit para chegar na RTCPeerConnection
  e ler o par de candidatos escolhido. Repetir essa travessia aqui seria
  duplicar a parte mais fragil do codigo — e, de quebra, isto verifica que o
  proprio diagnostico funciona, que e o que o usuario vai rodar quando algo
  der errado.
*/
const diagnostico = JSON.parse(
  await avaliar(`(async () => {
    const ate = async (c, p = 20000) => {
      const f = Date.now() + p;
      while (Date.now() < f) { if (c()) return true; await new Promise(r => setTimeout(r, 200)); }
      return false;
    };

    const abrir = [...document.querySelectorAll('.hud button, .hud [role="button"]')]
      .find(x => /ajuste|config/i.test((x.getAttribute('aria-label')||'') + (x.getAttribute('title')||'')));
    abrir?.click();
    await ate(() => document.querySelector('.settings'));

    const voz = [...document.querySelectorAll('.settings-item')].find(x => /voz e video/i.test(x.textContent||''));
    voz?.click();
    await new Promise(r => setTimeout(r, 800));

    const botao = [...document.querySelectorAll('.settings-content button')]
      .find(b => /verificar conexao/i.test(b.textContent||''));
    if (!botao) return JSON.stringify({ erro: 'botao de diagnostico nao encontrado' });
    botao.click();

    await ate(() => /conexao|caminho|retransmiss/i.test(document.querySelector('.settings-content')?.innerText||''), 25000);
    await new Promise(r => setTimeout(r, 1200));

    const texto = document.querySelector('.settings-content')?.innerText ?? '';
    const fechar = document.querySelector('.settings-close');
    fechar?.click();

    return JSON.stringify({ texto: texto.split(String.fromCharCode(10)).filter(Boolean).slice(-8).join(' | ') });
  })()`),
);

check(
  'o diagnostico diz que passou por retransmissao',
  /retransmiss/i.test(diagnostico.texto ?? ''),
  diagnostico.erro ?? (diagnostico.texto ?? '').slice(0, 200),
);

console.log(`\n=========================================`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log(`=========================================\n`);

socket.close();
process.exit(falhou > 0 ? 1 : 0);

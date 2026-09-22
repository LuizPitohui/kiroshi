/**
 * Os mesmos enderecos, mas com permissao de midia concedida.
 *
 * Existe por causa de uma armadilha que ja deu diagnostico errado: sem
 * permissao de midia o Chrome nao enumera as interfaces. Ele expoe so o
 * endereco da rota padrao, um por familia, e com o endereco real — nao com o
 * nome .local, que seria facil de notar. O resultado parece uma lista
 * completa e nao e, e foi assim que o aplicativo concluiu "a rede virtual
 * esta desligada" com a VPN conectada na bandeja.
 *
 * Aqui a coleta roda depois de pegar o microfone, que e o estado real durante
 * uma chamada. A diferenca entre as duas listas e a medida da armadilha.
 *
 *   node packages/desktop/test/enderecos-com-midia.mjs [porta]
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

function enviar(metodo, params = {}, prazo = 40000) {
  const id = proximoId++;
  socket.send(JSON.stringify({ id, method: metodo, params }));
  return new Promise((ok, erro) => {
    pendentes.set(id, { ok, erro });
    setTimeout(() => {
      if (pendentes.delete(id)) erro(new Error(`tempo esgotado em ${metodo}`));
    }, prazo);
  });
}

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

const resposta = await enviar('Runtime.evaluate', {
  expression: `(async () => {
    const coletar = async () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('sonda');
      await pc.setLocalDescription(await pc.createOffer());
      const achados = [];
      await new Promise((resolve) => {
        const prazo = setTimeout(resolve, 3000);
        pc.onicecandidate = (e) => {
          if (!e.candidate) { clearTimeout(prazo); resolve(); return; }
          achados.push(e.candidate.candidate.split(' ')[4]);
        };
      });
      pc.close();
      return achados;
    };

    const semPermissao = await coletar();

    let erroDeMidia = null;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      erroDeMidia = e.name + ': ' + e.message;
    }

    const comPermissao = stream ? await coletar() : [];
    if (stream) for (const t of stream.getTracks()) t.stop();

    return JSON.stringify({ semPermissao, comPermissao, erroDeMidia });
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (resposta.exceptionDetails) {
  console.error(resposta.exceptionDetails.exception?.description ?? 'erro na coleta');
  process.exit(1);
}

const { semPermissao, comPermissao, erroDeMidia } = JSON.parse(resposta.result.value);

const naVpn = (e) => {
  const p = String(e).split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return false;
  return Number(p[0]) === 100 && Number(p[1]) >= 64 && Number(p[1]) <= 127;
};

console.log('\n--- SEM PERMISSAO DE MIDIA ---');
for (const e of semPermissao) console.log(`   ${e}`);
console.log(`   (${semPermissao.length} enderecos, rede virtual: ${semPermissao.some(naVpn) ? 'SIM' : 'NAO'})`);

if (erroDeMidia) {
  console.log(`\n--- NAO CONSEGUI O MICROFONE ---\n   ${erroDeMidia}`);
} else {
  console.log('\n--- COM PERMISSAO DE MIDIA ---');
  for (const e of comPermissao) console.log(`   ${e}`);
  console.log(`   (${comPermissao.length} enderecos, rede virtual: ${comPermissao.some(naVpn) ? 'SIM' : 'NAO'})`);
}

let falhou = 0;
const check = (nome, ok, detalhe = '') => {
  if (!ok) falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
};

console.log('\n--- CONCLUSAO ---');
check('consegui o microfone', erroDeMidia === null, erroDeMidia ?? '');
check(
  'a chamada de verdade enxerga a rede virtual',
  comPermissao.some(naVpn),
  comPermissao.some(naVpn) ? '' : 'nem com permissao o endereco 100.64/10 aparece',
);
if (!semPermissao.some(naVpn) && comPermissao.some(naVpn)) {
  console.log('  INFO  a sonda sem permissao MENTE: e a fonte do diagnostico errado');
}

console.log('');
socket.close();
process.exit(falhou > 0 ? 1 : 0);

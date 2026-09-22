/**
 * Que enderecos o aplicativo enxerga nas interfaces desta maquina.
 *
 * Existe porque a escolha do caminho da midia acontece aqui, e nao no
 * servidor: o Chrome so tenta os enderecos que ele mesmo coleta. Se a
 * interface da rede virtual nao aparecer nesta lista, ligar a VPN nao adianta
 * nada — o aplicativo nunca vai mandar um pacote por ela, e a chamada cai com
 * a VPN conectada na bandeja, que foi exatamente o que aconteceu.
 *
 * O mesmo codigo que o aplicativo usa para decidir a mensagem de falha roda
 * aqui, entao isto tambem verifica se aquela mensagem esta dizendo a verdade.
 *
 * Precisa do aplicativo aberto com a porta de depuracao.
 *
 *   node packages/desktop/test/enderecos.mjs [porta]
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

await new Promise((r) => socket.once('open', r));
await enviar('Runtime.enable');

const resposta = await enviar('Runtime.evaluate', {
  expression: `(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('sonda');
    await pc.setLocalDescription(await pc.createOffer());

    const achados = [];
    await new Promise((resolve) => {
      // Espera a coleta acabar, nao o primeiro achado: o endereco da rede
      // virtual costuma chegar depois do da rede de casa.
      const prazo = setTimeout(resolve, 3000);
      pc.onicecandidate = (e) => {
        if (!e.candidate) { clearTimeout(prazo); resolve(); return; }
        const campos = e.candidate.candidate.split(' ');
        achados.push({ endereco: campos[4], tipo: campos[7], transporte: campos[2] });
      };
    });
    pc.close();
    return JSON.stringify(achados);
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (resposta.exceptionDetails) {
  console.error(resposta.exceptionDetails.exception?.description ?? 'erro na coleta');
  process.exit(1);
}

const achados = JSON.parse(resposta.result.value);

console.log('\n--- O QUE O CHROME ENXERGA NESTA MAQUINA ---\n');
for (const a of achados) {
  console.log(`   ${String(a.tipo).padEnd(6)} ${String(a.transporte).padEnd(4)} ${a.endereco}`);
}
console.log(`\n   ${achados.length} candidatos`);

// A faixa 100.64.0.0/10, que e a da rede virtual. Comparar por numero e nao
// por texto: 100.63.x e 100.128.x comecam com "100." e estao fora.
const naVpn = (e) => {
  const p = String(e).split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return false;
  return Number(p[0]) === 100 && Number(p[1]) >= 64 && Number(p[1]) <= 127;
};

const temVpn = achados.some((a) => naVpn(a.endereco));
const temIPv6 = achados.some((a) => String(a.endereco).includes(':'));
const temMdns = achados.some((a) => String(a.endereco).endsWith('.local'));

let falhou = 0;
const check = (nome, ok, detalhe = '') => {
  if (!ok) falhou++;
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
};

console.log('\n--- CAMINHOS ---');
check('o Chrome nao esconde os enderecos atras de mDNS', !temMdns,
  temMdns ? 'candidatos vieram como <uuid>.local; a deteccao de caminho nao funciona' : '');
check('a interface da rede virtual aparece', temVpn,
  temVpn ? '' : 'sem endereco 100.64/10: a VPN esta ligada mas o app nao a usa');
console.log(`  INFO  IPv6 nesta maquina: ${temIPv6 ? 'sim' : 'nao'}`);

console.log('');
socket.close();
process.exit(falhou > 0 ? 1 : 0);

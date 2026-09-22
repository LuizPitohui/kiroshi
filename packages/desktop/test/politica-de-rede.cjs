/**
 * Compara as politicas de rede do WebRTC lado a lado.
 *
 * Existe por causa de um defeito caro e invisivel: com
 * `default_public_and_private_interfaces`, o Chromium coleta so os enderecos
 * da interface por onde sai a rota padrao. A rede virtual fica de fora, e quem
 * depende dela — quem nao tem IPv6 — perde a voz sem nenhuma pista. O cliente
 * nunca manda um pacote por ali, entao nem o log do servidor registra
 * tentativa: o sintoma e "caiu" e nao ha onde procurar.
 *
 * O teste roda as duas politicas na mesma maquina, no mesmo minuto, e mostra a
 * diferenca. Sem VPN ligada ele avisa que nao deu para concluir nada, em vez
 * de passar em falso.
 *
 * Duas armadilhas que ja custaram execucoes as cegas, e por isso o arquivo e
 * assim:
 *
 *   CommonJS, nao ESM. Com entrada em modulo ESM o `app.whenReady()` do
 *   Electron nao resolve, e o processo fica parado sem dizer nada.
 *
 *   Saida em arquivo, nao no console. No Windows o Electron e um programa de
 *   janela e o stdout do processo principal nao chega ao terminal.
 *
 * Roda num Electron proprio, entao nao interfere no aplicativo aberto.
 *
 *   npx electron packages/desktop/test/politica-de-rede.cjs
 */

const { writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const SAIDA = process.env.KIROSHI_SAIDA_DO_TESTE ?? join(tmpdir(), 'kiroshi-politica-de-rede.txt');
const FIM = String.fromCharCode(10);
const linhas = [];
const despejar = () => writeFileSync(SAIDA, linhas.join(FIM) + FIM);
// Grava a cada linha: se algo travar, o arquivo ainda mostra ate onde chegou.
const log = (t = '') => {
  linhas.push(t);
  despejar();
};

/*
  A pagina precisa vir de um arquivo, nao de um `data:`.

  WebRTC so existe em contexto seguro, e `data:` tem origem opaca — ali
  `RTCPeerConnection` nem esta definido, e a sonda trava sem mensagem.
*/
const PAGINA = join(tmpdir(), 'kiroshi-sonda-de-rede.html');
writeFileSync(PAGINA, '<!doctype html><meta charset="utf-8"><title>sonda</title>');

/** Coleta os enderecos que o Chromium expoe sob uma politica. */
async function coletar(politica) {
  // Sem `backgroundThrottling: false` o Chromium estrangula os temporizadores
  // da janela escondida e a espera de 12 s vira minutos.
  const janela = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  janela.webContents.setWebRTCIPHandlingPolicy(politica);
  await janela.loadURL(pathToFileURL(PAGINA).href);

  const bruto = await janela.webContents.executeJavaScript(
    [
      '(async () => {',
      '  const pc = new RTCPeerConnection({ iceServers: [] });',
      '  pc.createDataChannel("sonda");',
      '  await pc.setLocalDescription(await pc.createOffer());',
      '  const achados = [];',
      '  await new Promise((resolve) => {',
      // Espera o FIM da coleta: o endereco da rede virtual costuma chegar
      // depois do da rede de casa, e cortar cedo daria o mesmo resultado que
      // o defeito que estamos medindo.
      '    const prazo = setTimeout(resolve, 12000);',
      '    pc.onicecandidate = (e) => {',
      '      if (!e.candidate) { clearTimeout(prazo); resolve(); return; }',
      '      const campos = e.candidate.candidate.split(" ");',
      '      const custo = /network-cost (\d+)/.exec(e.candidate.candidate);',
      '      achados.push({ endereco: campos[4], custo: custo ? Number(custo[1]) : null });',
      '    };',
      '  });',
      '  const completa = pc.iceGatheringState === "complete";',
      '  pc.close();',
      '  return JSON.stringify({ achados, completa });',
      '})()',
    ].join('\n'),
  );

  janela.destroy();
  return JSON.parse(bruto);
}

/** A faixa 100.64.0.0/10, comparada por numero: 100.63 e 100.128 estao fora. */
function naFaixaDaVpn(endereco) {
  const partes = String(endereco).split('.');
  if (partes.length !== 4) return false;
  if (partes.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  return Number(partes[0]) === 100 && Number(partes[1]) >= 64 && Number(partes[1]) <= 127;
}

function mostrar(titulo, r) {
  log('');
  log(`--- ${titulo} ---`);
  for (const a of r.achados) {
    log(`   ${String(a.endereco).padEnd(44)} custo=${a.custo ?? '-'}`);
  }
  log(`   ${r.achados.length} candidatos, coleta completa: ${r.completa}`);
}

function encerrar(codigo) {
  despejar();
  app.quit();
  process.exit(codigo);
}

// Destruir a janela da primeira politica deixa o Electron sem janela nenhuma,
// e por padrao isso encerra o programa — no meio do teste, com codigo 0, como
// se tivesse passado. Quem decide o fim aqui e `encerrar`.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  log('coletando...');

  const restrita = await coletar('default_public_and_private_interfaces');
  const completa = await coletar('default');

  linhas.length = 0;
  mostrar('POLITICA ANTIGA (so a rota padrao)', restrita);
  mostrar('POLITICA NOVA (todas as interfaces)', completa);

  const vpnNaAntiga = restrita.achados.some((a) => naFaixaDaVpn(a.endereco));
  const vpnNaNova = completa.achados.some((a) => naFaixaDaVpn(a.endereco));

  let falhou = 0;
  const check = (nome, ok, detalhe = '') => {
    if (!ok) falhou++;
    log(`  ${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? `  ${detalhe}` : ''}`);
  };

  log('');
  log('--- CONCLUSAO ---');

  if (!vpnNaNova) {
    // Sem VPN ligada nao ha o que comparar. Dizer "passou" aqui seria mentira.
    log('  AVISO  nenhuma interface de rede virtual nesta maquina agora.');
    log('         Ligue o Tailscale e rode de novo; assim o teste nao conclui nada.');
    encerrar(2);
    return;
  }

  check(
    'a politica antiga escondia a rede virtual',
    !vpnNaAntiga,
    vpnNaAntiga ? 'apareceu nas duas: a politica nao era a causa' : '',
  );
  check('a politica nova enxerga a rede virtual', vpnNaNova);
  check(
    'a politica nova ve mais interfaces que a antiga',
    completa.achados.length > restrita.achados.length,
    `${restrita.achados.length} -> ${completa.achados.length}`,
  );

  encerrar(falhou > 0 ? 1 : 0);
});

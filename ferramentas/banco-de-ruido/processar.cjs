// Bancada do F3: passa cada arquivo do corpus por cada motor de limpeza, fora
// do tempo real (OfflineAudioContext), e mede quanto do tempo real cada um gasta.
// Janela escondida; nada toca nas caixas.
//   electron processar.cjs [motor,motor,...]
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
// Os arquivos do DFN3 (dfn3/v3/pkg/df_bg.wasm e dfn3/v3/models/...): fora do git.
const MODELOS = process.env.MODELOS_DFN3 || path.join(AQUI, 'modelos');

// O pacote do DFN3 se declara modulo ES mas o dist/index.js e CommonJS: uma
// copia .cjs e o jeito de carregar pelo require da pagina.
const COLA = path.join(AQUI, 'node_modules', 'deepfilternet3-noise-filter', 'dist', 'index.js');
if (fs.existsSync(COLA) && !fs.existsSync(path.join(AQUI, 'dfn3.cjs'))) fs.copyFileSync(COLA, path.join(AQUI, 'dfn3.cjs'));

// Os arquivos do DeepFilterNet3 servidos por HTTP local: o pacote le com fetch.
function servirModelos() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const alvo = path.join(MODELOS, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!alvo.startsWith(MODELOS) || !fs.existsSync(alvo)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': alvo.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
      fs.createReadStream(alvo).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

app.whenReady().then(async () => {
  const servidor = await servirModelos();
  const porta = servidor.address().port;
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _n, msg) => console.log('[pagina]', msg));
  await win.loadFile(path.join(AQUI, 'processar.html'));
  const motores = (process.argv.find((a) => a.startsWith('--motores=')) || '').replace('--motores=', '');
  const soArquivos = (process.argv.find((x) => x.startsWith('--arquivos=')) || '').replace('--arquivos=', '');
  const r = await win.webContents.executeJavaScript(`rodar(${JSON.stringify({ porta, motores: motores ? motores.split(',') : null, arquivos: soArquivos ? soArquivos.split(',') : null })})`);
  if (!soArquivos) fs.writeFileSync(path.join(AQUI, 'tempos.json'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r.resumo, null, 1));
  servidor.close();
  app.quit();
});

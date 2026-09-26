// O supressor do navegador (WebRTC NS), o da 2.0.2, medido com o microfone
// FALSO do Chromium: ele toca um WAV como se fosse a captura, e o getUserMedia
// aplica o processamento de sempre. Um arquivo por processo (a chave vale para
// o processo inteiro). Grava a saida em saida/<modo>/<arquivo>.
//   electron webrtc.cjs <arquivo.wav> <modo: ns | cru>
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const [arquivo, modo] = process.argv.slice(-2);
const entrada = path.join(AQUI, 'corpus-falso', arquivo);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', `${entrada}%noloop`);

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, ok) => ok(true));
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  // Arquivo local, e nao data: — o getUserMedia so existe em contexto seguro.
  await win.loadFile(path.join(AQUI, 'vazia.html'));
  const segundos = fs.statSync(entrada).size / 96000 + 1.5;
  const r = await win.webContents.executeJavaScript(`(async () => {
    const ns = ${modo === 'ns'};
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: ns, echoCancellation: false, autoGainControl: false } });
    const faixa = stream.getAudioTracks()[0];
    const cfg = faixa.getSettings();
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.resume();
    const fonte = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mudo = ctx.createGain(); mudo.gain.value = 0;
    const partes = [];
    proc.onaudioprocess = (e) => partes.push(Array.from(e.inputBuffer.getChannelData(0)));
    fonte.connect(proc).connect(mudo).connect(ctx.destination);
    await new Promise((r) => setTimeout(r, ${Math.round(segundos * 1000)}));
    proc.disconnect(); faixa.stop();
    return { cfg: { noiseSuppression: cfg.noiseSuppression, echoCancellation: cfg.echoCancellation, autoGainControl: cfg.autoGainControl, sampleRate: cfg.sampleRate }, amostras: partes.flat() };
  })()`);
  const a = Float32Array.from(r.amostras);
  const pasta = path.join(AQUI, 'saida', `webrtc-${modo}`);
  fs.mkdirSync(pasta, { recursive: true });
  const dados = Buffer.alloc(a.length * 2);
  for (let i = 0; i < a.length; i++) dados.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a[i])) * 32767), i * 2);
  const c = Buffer.alloc(44);
  c.write('RIFF', 0); c.writeUInt32LE(36 + dados.length, 4); c.write('WAVE', 8); c.write('fmt ', 12);
  c.writeUInt32LE(16, 16); c.writeUInt16LE(1, 20); c.writeUInt16LE(1, 22); c.writeUInt32LE(48000, 24);
  c.writeUInt32LE(96000, 28); c.writeUInt16LE(2, 32); c.writeUInt16LE(16, 34); c.write('data', 36); c.writeUInt32LE(dados.length, 40);
  fs.writeFileSync(path.join(pasta, arquivo), Buffer.concat([c, dados]));
  console.log(`${modo} ${arquivo}: ${(a.length / 48000).toFixed(1)} s, ${JSON.stringify(r.cfg)}`);
  app.quit();
});

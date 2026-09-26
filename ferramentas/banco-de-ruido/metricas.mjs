// Metricas objetivas da rodada do F3, sem dependencias.
//
//   latencia   atraso do motor, por correlacao cruzada da fala limpa processada
//   SI-SDR     fidelidade a fala limpa (dB, maior e melhor), na mistura
//   STOI       inteligibilidade objetiva (0 a 1), na mistura (Taal et al., 2011)
//   reducao    quanto o motor abaixa o ruido SOZINHO (dB)
//   dano       SI-SDR da fala limpa passada pelo motor: o quanto ele estraga voz sem ruido
//   dist. esp. distancia espectral (dB) entre fala limpa e processada, so nos trechos de fala
//
//   node metricas.mjs [motor,motor...]
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerWav } from './wav.mjs';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TAXA = 48000;

// ---------------------------------------------------------------- FFT (radix 2)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Atraso (em amostras) de `y` em relacao a `x`, entre 0 e `max`, por correlacao via FFT. */
function atraso(x, y, max) {
  const trecho = Math.min(x.length, y.length, TAXA * 20);
  let n = 1;
  while (n < trecho + max) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  for (let i = 0; i < trecho; i++) { ar[i] = x[i]; br[i] = y[i]; }
  fft(ar, ai); fft(br, bi);
  // correlacao = IFFT(conj(X) * Y)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ar[i] * bi[i] - ai[i] * br[i];
    ar[i] = r; ai[i] = -im; // conjugado para usar a FFT direta como inversa
  }
  fft(ar, ai);
  let melhor = 0, valor = -Infinity;
  for (let k = 0; k <= max; k++) if (ar[k] > valor) { valor = ar[k]; melhor = k; }
  return melhor;
}

const alinhar = (y, d, n) => { const r = new Float32Array(n); for (let i = 0; i < n; i++) r[i] = y[i + d] ?? 0; return r; };

function siSdr(ref, est) {
  let rr = 0, re = 0;
  for (let i = 0; i < ref.length; i++) { rr += ref[i] * ref[i]; re += ref[i] * est[i]; }
  const a = re / rr;
  let s = 0, e = 0;
  for (let i = 0; i < ref.length; i++) { const t = a * ref[i]; s += t * t; e += (est[i] - t) ** 2; }
  return 10 * Math.log10(s / e);
}

const energia = (a) => a.reduce((s, v) => s + v * v, 0);

/** Quadros de 20 ms com fala na referencia (acima de -40 dB do pico). */
function quadrosDeFala(ref) {
  const q = Math.round(TAXA * 0.02), en = [];
  for (let i = 0; i + q <= ref.length; i += q) { let s = 0; for (let k = i; k < i + q; k++) s += ref[k] * ref[k]; en.push(s); }
  const pico = Math.max(...en);
  return en.map((v, j) => (v > pico * 1e-4 ? j * q : -1)).filter((v) => v >= 0);
}

/** Distancia espectral media (dB) entre referencia e estimativa nos quadros de fala. */
function distanciaEspectral(ref, est, quadros) {
  const n = 1024, q = Math.round(TAXA * 0.02);
  const jan = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  let soma = 0, conta = 0;
  for (const ini of quadros) {
    if (ini + n > ref.length) continue;
    const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
    for (let i = 0; i < n; i++) { ar[i] = ref[ini + i] * jan[i]; br[i] = est[ini + i] * jan[i]; }
    fft(ar, ai); fft(br, bi);
    let s = 0, usados = 0, pico = 0;
    const kMax = Math.floor((16000 / TAXA) * n);
    for (let k = 1; k < kMax; k++) pico = Math.max(pico, ar[k] * ar[k] + ai[k] * ai[k]);
    for (let k = 1; k < kMax; k++) {
      const pa = ar[k] * ar[k] + ai[k] * ai[k], pb = br[k] * br[k] + bi[k] * bi[k] + 1e-12;
      if (pa < pico * 1e-4) continue; // so faixas com energia: ate 40 dB abaixo do pico do quadro
      s += (10 * Math.log10(pa / pb)) ** 2; usados++;
    }
    if (usados) { soma += Math.sqrt(s / usados); conta++; }
    if (conta > 800) break;
  }
  void q;
  return soma / Math.max(1, conta);
}

// ---------------------------------------------------------------- STOI
/** Reamostragem por sinc janelado (passa-baixa em 0,45 da taxa de saida). */
function reamostrar(x, de, para) {
  const r = de / para, n = Math.floor(x.length / r), L = 48, fc = (0.45 * para) / de;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r, c = Math.floor(p);
    let s = 0;
    for (let k = c - L; k <= c + L; k++) {
      if (k < 0 || k >= x.length) continue;
      const t = p - k, w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (L + 1));
      s += x[k] * (t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)) * w;
    }
    y[i] = s;
  }
  return y;
}

function stoi(limpo, processado) {
  const FS = 10000, N_FRAME = 256, NFFT = 512, N_SEG = 30, BETA = -15, FAIXA = 40;
  let x = reamostrar(limpo, TAXA, FS), y = reamostrar(processado, TAXA, FS);
  const jan = Float64Array.from({ length: N_FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (N_FRAME + 1)));
  // tira os quadros silenciosos (mais de 40 dB abaixo do quadro mais forte da referencia)
  const passo = N_FRAME / 2, en = [];
  for (let i = 0; i + N_FRAME <= x.length; i += passo) { let s = 0; for (let k = 0; k < N_FRAME; k++) s += (x[i + k] * jan[k]) ** 2; en.push(10 * Math.log10(s + 1e-20)); }
  const max = Math.max(...en);
  const manter = en.map((v, j) => (v > max - FAIXA ? j : -1)).filter((j) => j >= 0);
  const reconstruir = (s) => { const o = new Float32Array((manter.length + 1) * passo); manter.forEach((j, m) => { for (let k = 0; k < N_FRAME; k++) o[m * passo + k] += s[j * passo + k] * jan[k]; }); return o; };
  x = reconstruir(x); y = reconstruir(y);
  // bandas de 1/3 de oitava: 15, a partir de 150 Hz
  const f = Array.from({ length: NFFT / 2 + 1 }, (_, k) => (k * FS) / NFFT);
  const bandas = [];
  for (let b = 0; b < 15; b++) {
    const cf = 150 * 2 ** (b / 3), lo = cf * 2 ** (-1 / 6), hi = cf * 2 ** (1 / 6);
    const kLo = f.reduce((m, v, k) => (Math.abs(v - lo) < Math.abs(f[m] - lo) ? k : m), 0);
    const kHi = f.reduce((m, v, k) => (Math.abs(v - hi) < Math.abs(f[m] - hi) ? k : m), 0);
    bandas.push([kLo, kHi]);
  }
  const envoltoria = (s) => {
    const quadros = [];
    for (let i = 0; i + N_FRAME <= s.length; i += passo) {
      const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
      for (let k = 0; k < N_FRAME; k++) re[k] = s[i + k] * jan[k];
      fft(re, im);
      quadros.push(bandas.map(([a, b]) => { let e = 0; for (let k = a; k < b; k++) e += re[k] * re[k] + im[k] * im[k]; return Math.sqrt(e); }));
    }
    return quadros;
  };
  const X = envoltoria(x), Y = envoltoria(y);
  const c = 10 ** (-BETA / 20);
  let soma = 0, conta = 0;
  for (let m = N_SEG; m <= X.length; m++) {
    for (let j = 0; j < 15; j++) {
      const xs = [], ys = [];
      for (let t = m - N_SEG; t < m; t++) { xs.push(X[t][j]); ys.push(Y[t][j]); }
      const nx = Math.sqrt(xs.reduce((s, v) => s + v * v, 0)), ny = Math.sqrt(ys.reduce((s, v) => s + v * v, 0)) || 1e-20;
      const yn = ys.map((v, i) => Math.min(v * (nx / ny), xs[i] * (1 + c)));
      const mx = xs.reduce((s, v) => s + v, 0) / N_SEG, my = yn.reduce((s, v) => s + v, 0) / N_SEG;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < N_SEG; i++) { const a = xs[i] - mx, b = yn[i] - my; num += a * b; dx += a * a; dy += b * b; }
      soma += num / (Math.sqrt(dx * dy) + 1e-20); conta++;
    }
  }
  return soma / conta;
}

// ---------------------------------------------------------------- execucao
const corpus = (f) => lerWav(join(AQUI, 'corpus', f)).amostras;
const saida = (m, f) => lerWav(join(AQUI, 'saida', m, f)).amostras;
const limpo = corpus('limpo.wav');
const N = limpo.length;
const falaQuadros = quadrosDeFala(limpo);
const casos = readdirSync(join(AQUI, 'corpus')).filter((f) => f.startsWith('mistura-')).map((f) => f.slice('mistura-'.length, -4));
const escolhidos = process.argv[2] ? process.argv[2].split(',') : readdirSync(join(AQUI, 'saida'));
const resultado = { referencia: {}, motores: {} };

// Referencia: a mistura sem motor nenhum.
for (const caso of casos) {
  const mix = corpus(`mistura-${caso}.wav`);
  resultado.referencia[caso] = { siSdr: +siSdr(limpo, mix).toFixed(2), stoi: +stoi(limpo, mix).toFixed(3) };
}

for (const motor of escolhidos) {
  if (!existsSync(join(AQUI, 'saida', motor, 'limpo.wav'))) continue;
  const outLimpo = saida(motor, 'limpo.wav');
  // O microfone falso do WebRTC tem 1 s de silencio na frente e a gravacao comeca solta.
  const d = atraso(limpo, outLimpo, Math.round(TAXA * (motor.startsWith('webrtc') ? 2 : 0.25)));
  const limpoAlinhado = alinhar(outLimpo, d, N);
  const r = {
    latenciaMs: +((d / TAXA) * 1000).toFixed(1),
    dano: +siSdr(limpo, limpoAlinhado).toFixed(2),
    stoiLimpo: +stoi(limpo, limpoAlinhado).toFixed(3),
    distEspectralDb: +distanciaEspectral(limpo, limpoAlinhado, falaQuadros).toFixed(2),
    nivelDaFalaDb: +(10 * Math.log10(energia(limpoAlinhado) / energia(limpo))).toFixed(2),
    casos: {},
  };
  // Cada captura do WebRTC e um processo proprio, com atraso de inicio proprio:
  // alinha arquivo por arquivo contra a entrada correspondente. Os outros
  // motores tem atraso fixo, o medido na fala limpa.
  const porArquivo = motor.startsWith('webrtc');
  const alinharArquivo = (entrada, arquivo) => {
    const bruta = saida(motor, arquivo);
    return alinhar(bruta, porArquivo ? atraso(entrada, bruta, Math.round(TAXA * 2)) : d, N);
  };
  for (const caso of casos) {
    const ruido = corpus(`ruido-${caso}.wav`);
    const outRuido = alinharArquivo(ruido, `ruido-${caso}.wav`);
    const outMix = alinharArquivo(corpus(`mistura-${caso}.wav`), `mistura-${caso}.wav`);
    const s = siSdr(limpo, outMix);
    r.casos[caso] = {
      reducaoDb: +(10 * Math.log10(energia(ruido) / Math.max(1e-20, energia(outRuido)))).toFixed(1),
      siSdr: +s.toFixed(2),
      ganhoSiSdr: +(s - resultado.referencia[caso].siSdr).toFixed(2),
      stoi: +stoi(limpo, outMix).toFixed(3),
    };
  }
  resultado.motores[motor] = r;
  console.log(motor.padEnd(12), 'lat', String(r.latenciaMs).padStart(6), 'ms | stoi da fala limpa', String(r.stoiLimpo).padStart(6), '| dist', String(r.distEspectralDb).padStart(5), 'dB | nivel', String(r.nivelDaFalaDb).padStart(6), 'dB');
}
writeFileSync(join(AQUI, 'metricas.json'), JSON.stringify(resultado, null, 2));
console.log('gravado metricas.json');

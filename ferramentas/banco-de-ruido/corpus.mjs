// Corpus da rodada 1 do F3, sem download: fala sintetica do Windows + ruidos
// sinteticos (teclado mecanico, mouse, ventilador) + conversa ao fundo.
// Saida em corpus/: limpo, cada ruido sozinho e as misturas em SNR fixo.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gravarWav, lerWav, rms, rmsAtivo } from './wav.mjs';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SAIDA = join(AQUI, 'corpus');
mkdirSync(SAIDA, { recursive: true });
const TAXA = 48000;

// Gerador deterministico: o corpus sai igual em toda execucao.
let semente = 20260925;
const aleatorio = () => ((semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const entre = (a, b) => a + (b - a) * aleatorio();
const gauss = () => Math.sqrt(-2 * Math.log(aleatorio() + 1e-12)) * Math.cos(2 * Math.PI * aleatorio());

const fala = lerWav(join(AQUI, 'fala-maria.wav'));
if (fala.taxa !== TAXA) throw new Error('a fala tem que estar a 48 kHz');
const N = fala.amostras.length;
const limpo = Float32Array.from(fala.amostras);
const nivelFala = rmsAtivo(limpo);
const FALA = 0.05; // fala ativa a -26 dBFS: o nivel tipico de microfone, com folga
for (let i = 0; i < N; i++) limpo[i] *= FALA / nivelFala;

/** Passa-faixa de 2 polos (biquad RBJ) aplicado num trecho. */
function passaFaixa(x, f0, q) {
  const w = (2 * Math.PI * f0) / TAXA, al = Math.sin(w) / (2 * q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Um estalo: rajada de ruido filtrada com decaimento exponencial. */
function estalo(f0, q, tauMs, durMs) {
  const n = Math.round((durMs / 1000) * TAXA);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = gauss() * Math.exp(-i / ((tauMs / 1000) * TAXA));
  return passaFaixa(r, f0, q);
}

/** Ressonancia amortecida (o "corpo" da tecla batendo no fundo). */
function ressonancia(f, tauMs, durMs) {
  const n = Math.round((durMs / 1000) * TAXA);
  const r = new Float32Array(n);
  const fase = entre(0, 2 * Math.PI);
  for (let i = 0; i < n; i++) r[i] = Math.sin((2 * Math.PI * f * i) / TAXA + fase) * Math.exp(-i / ((tauMs / 1000) * TAXA));
  return r;
}

function somar(destino, som, inicio, ganho) {
  const pico = Math.max(...som.map(Math.abs)) || 1;
  for (let i = 0; i < som.length && inicio + i < destino.length; i++) destino[inicio + i] += (som[i] / pico) * ganho;
}

// Teclado mecanico: rajadas de 3 a 10 teclas, pausas de 0,4 a 2 s. Cada tecla
// tem o estalo do acionamento, o corpo batendo e o estalo mais fraco da volta.
function teclado() {
  const s = new Float32Array(N);
  let t = entre(0.2, 0.8);
  while (t < N / TAXA - 0.3) {
    const teclas = Math.floor(entre(3, 11));
    for (let k = 0; k < teclas && t < N / TAXA - 0.3; k++) {
      const i = Math.round(t * TAXA);
      const forca = entre(0.55, 1);
      somar(s, estalo(entre(2200, 5200), 1.6, entre(3, 6), 25), i, forca);
      somar(s, ressonancia(entre(280, 650), entre(8, 16), 60), i + Math.round(entre(1, 4) * TAXA / 1000), forca * 0.45);
      somar(s, estalo(entre(3000, 6500), 2, entre(2, 4), 20), i + Math.round(entre(60, 115) * TAXA / 1000), forca * entre(0.3, 0.5));
      t += Math.max(0.07, Math.min(0.3, 0.14 + gauss() * 0.04));
    }
    t += entre(0.4, 2);
  }
  return s;
}

// Mouse: cliques esparsos, mais agudos e curtos que o teclado.
function mouse() {
  const s = new Float32Array(N);
  let t = entre(0.3, 1);
  while (t < N / TAXA - 0.2) {
    const i = Math.round(t * TAXA);
    somar(s, estalo(entre(4000, 7000), 2.5, 1.5, 12), i, entre(0.6, 1));
    somar(s, estalo(entre(4500, 7500), 2.5, 1.2, 10), i + Math.round(entre(70, 110) * TAXA / 1000), entre(0.3, 0.5));
    t += entre(0.5, 3);
  }
  return s;
}

// Ventilador: ruido rosa (filtro de Paul Kellet) + zumbido fraco de 120 Hz.
function ventilador() {
  const s = new Float32Array(N);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < N; i++) {
    const w = gauss() * 0.1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    s[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362 + 0.02 * Math.sin((2 * Math.PI * 120 * i) / TAXA);
    b6 = w * 0.115926;
  }
  return s;
}

// Conversa ao fundo: outra voz, abafada (passa-baixa em 3,5 kHz), em loop.
function conversa() {
  const z = lerWav(join(AQUI, 'conversa-zira.wav')).amostras;
  const s = new Float32Array(N);
  for (let i = 0; i < N; i++) s[i] = z[i % z.length];
  let y = 0;
  const a = Math.exp((-2 * Math.PI * 3500) / TAXA);
  for (let i = 0; i < N; i++) { y = (1 - a) * s[i] + a * y; s[i] = y; }
  return s;
}

const ruidos = { teclado: teclado(), mouse: mouse(), ventilador: ventilador(), conversa: conversa() };
ruidos['teclado+ventilador'] = ruidos.teclado.map((v, i) => v + ruidos.ventilador[i] * 0.5);

/**
 * Ajusta o ruido para ficar `snr` dB abaixo da fala ativa, os dois medidos so
 * nos trechos ativos: ruido esparso (tecla, clique) medido pela media geral
 * sairia com picos gigantes.
 */
function noNivel(ruido, snr) {
  const alvo = FALA / 10 ** (snr / 20);
  const g = alvo / rmsAtivo(ruido);
  return ruido.map((v) => v * g);
}

gravarWav(join(SAIDA, 'limpo.wav'), limpo);
const lista = [{ nome: 'limpo', snr: null }];
for (const [nome, ruido] of Object.entries(ruidos)) {
  for (const snr of [15, 5]) {
    const r = noNivel(ruido, snr);
    const mistura = limpo.map((v, i) => v + r[i]);
    gravarWav(join(SAIDA, `ruido-${nome}-${snr}dB.wav`), r);
    gravarWav(join(SAIDA, `mistura-${nome}-${snr}dB.wav`), mistura);
    lista.push({ nome, snr });
  }
}
console.log(`${lista.length} casos, ${(N / TAXA).toFixed(1)} s cada; fala ativa a ${(20 * Math.log10(rmsAtivo(limpo))).toFixed(1)} dBFS`);

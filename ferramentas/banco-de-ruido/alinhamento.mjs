// A correlacao de metricas.mjs, para os trechos da escuta.
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
export default function atraso(x, y, max) {
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


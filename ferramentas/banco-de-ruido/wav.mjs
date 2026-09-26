// WAV mono: leitura (PCM 16 bits ou float 32) e escrita (PCM 16 bits).
import { readFileSync, writeFileSync } from 'node:fs';

export function lerWav(caminho) {
  const b = readFileSync(caminho);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`nao e WAV: ${caminho}`);
  let pos = 12, fmt = null, dados = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('latin1', pos, pos + 4);
    const tam = b.readUInt32LE(pos + 4);
    const corpo = pos + 8;
    if (id === 'fmt ') fmt = { formato: b.readUInt16LE(corpo), canais: b.readUInt16LE(corpo + 2), taxa: b.readUInt32LE(corpo + 4), bits: b.readUInt16LE(corpo + 14) };
    if (id === 'data') dados = b.subarray(corpo, corpo + tam);
    pos = corpo + tam + (tam % 2);
  }
  if (!fmt || !dados) throw new Error(`WAV incompleto: ${caminho}`);
  const n = Math.floor(dados.length / (fmt.bits / 8) / fmt.canais);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let soma = 0;
    for (let c = 0; c < fmt.canais; c++) {
      const k = (i * fmt.canais + c) * (fmt.bits / 8);
      soma += fmt.formato === 3 ? dados.readFloatLE(k) : dados.readInt16LE(k) / 32768;
    }
    saida[i] = soma / fmt.canais;
  }
  return { taxa: fmt.taxa, amostras: saida };
}

export function gravarWav(caminho, amostras, taxa = 48000) {
  const dados = Buffer.alloc(amostras.length * 2);
  for (let i = 0; i < amostras.length; i++) {
    const v = Math.max(-1, Math.min(1, amostras[i]));
    dados.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + dados.length, 4); cab.write('WAVE', 8);
  cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(taxa, 24); cab.writeUInt32LE(taxa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
  cab.write('data', 36); cab.writeUInt32LE(dados.length, 40);
  writeFileSync(caminho, Buffer.concat([cab, dados]));
}

export const rms = (a, ini = 0, fim = a.length) => {
  let s = 0;
  for (let i = ini; i < fim; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, fim - ini));
};

/** Valor eficaz so dos trechos com fala (quadros de 20 ms acima de -40 dB do pico). */
export function rmsAtivo(a, taxa = 48000) {
  const q = Math.round(taxa * 0.02);
  const niveis = [];
  for (let i = 0; i + q <= a.length; i += q) niveis.push(rms(a, i, i + q));
  const pico = Math.max(...niveis);
  const ativos = niveis.filter((v) => v > pico * 0.01);
  return Math.sqrt(ativos.reduce((s, v) => s + v * v, 0) / Math.max(1, ativos.length));
}

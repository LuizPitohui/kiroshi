// Recorta os trechos da pagina de escuta: 8 s de cada caso em cada motor, ja
// alinhados (mesma janela de tempo em todos), a 48 kHz, WAV 16 bits.
//   node trechos.mjs <pasta de saida>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gravarWav, lerWav, rms } from './wav.mjs';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DESTINO = process.argv[2];
const TAXA = 48000;
const INICIO = 2.0, DURACAO = 8.0;
const m = JSON.parse((await import('node:fs')).readFileSync(join(AQUI, 'metricas.json'), 'utf8'));

const motores = [
  ['original', 'Sem limpeza', null],
  ['webrtc-ns', 'Navegador (a da 2.0.2)', 'webrtc-ns'],
  ['rnnoise', 'RNNoise 0.1', 'rnnoise'],
  ['gtcrn', 'GTCRN (16 kHz)', 'gtcrn'],
  ['dfn3-100', 'DeepFilterNet3 sem limite (o da 2.0.1)', 'dfn3-100'],
  ['dfn3-20', 'DeepFilterNet3 com limite de 20 dB', 'dfn3-20'],
];
const casos = [
  ['limpo.wav', 'Fala sem ruído: o que o motor faz com a voz'],
  ['mistura-teclado-5dB.wav', 'Fala com teclado mecânico alto'],
  ['mistura-teclado+ventilador-5dB.wav', 'Fala com teclado e ventilador'],
];

const ini = Math.round(INICIO * TAXA), n = Math.round(DURACAO * TAXA);
mkdirSync(DESTINO, { recursive: true });
const lista = [];
for (const [arquivo, tituloDoCaso] of casos) {
  const entrada = lerWav(join(AQUI, 'corpus', arquivo)).amostras;
  for (const [id, nome, pasta] of motores) {
    let a = entrada;
    if (pasta) {
      const bruta = lerWav(join(AQUI, 'saida', pasta, arquivo)).amostras;
      // atraso: fixo por motor, exceto o navegador (um processo por arquivo)
      let d = Math.round(((m.motores[pasta]?.latenciaMs ?? 0) / 1000) * TAXA);
      if (pasta.startsWith('webrtc')) {
        // mesma correlacao da metrica, num trecho de 20 s
        const { default: mod } = await import('./alinhamento.mjs');
        d = mod(entrada, bruta, Math.round(TAXA * 2));
      }
      a = bruta.subarray(d);
    }
    const trecho = a.slice(ini, ini + n);
    // entrada e saida do mesmo motor no mesmo volume de escuta: normaliza pelo nivel da ORIGINAL
    const g = 0.1 / Math.max(1e-6, rms(entrada.subarray(ini, ini + n)));
    for (let i = 0; i < trecho.length; i++) trecho[i] *= g;
    const nomeArquivo = `${arquivo.replace('.wav', '')}__${id}.wav`;
    gravarWav(join(DESTINO, nomeArquivo), trecho);
    lista.push({ caso: tituloDoCaso, motor: nome, arquivo: nomeArquivo });
  }
}
writeFileSync(join(DESTINO, 'lista.json'), JSON.stringify(lista, null, 2));
console.log(lista.length, 'trechos em', DESTINO);

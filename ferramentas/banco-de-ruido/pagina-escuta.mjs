// Gera a pagina de escuta da rodada 1 a partir de escuta/lista.json e metricas.json.
//   node pagina-escuta.mjs <pasta da pagina>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PASTA = process.argv[2];
const lista = JSON.parse(readFileSync(join(PASTA, 'audio', 'lista.json'), 'utf8'));
const m = JSON.parse(readFileSync(join(AQUI, 'metricas.json'), 'utf8'));
const tempos = JSON.parse(readFileSync(join(AQUI, 'tempos-resumo.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pasta = { 'Sem limpeza': null, 'Navegador (a da 2.0.2)': 'webrtc-ns', 'RNNoise 0.1': 'rnnoise', 'GTCRN (16 kHz)': 'gtcrn', 'DeepFilterNet3 sem limite (o da 2.0.1)': 'dfn3-100', 'DeepFilterNet3 com limite de 20 dB': 'dfn3-20' };

// Um numero curto por motor e caso, so o que ajuda a ouvir.
function nota(motor, arquivo) {
  const id = pasta[motor];
  if (!id) return '';
  const r = m.motores[id];
  if (!r) return '';
  if (arquivo.startsWith('limpo')) return `fala preservada ${fmt(r.stoiLimpo, 3)} STOI`;
  // os arquivos da escuta trocam o + por - (URL); as metricas usam o nome do corpus
  const caso = arquivo.replace('mistura-', '').replace('.wav', '').split('__')[0].replace('teclado-ventilador', 'teclado+ventilador');
  const c = r.casos[caso];
  return c ? `ruído ${c.reducaoDb >= 0 ? '−' : '+'}${fmt(Math.abs(c.reducaoDb), 1)} dB` : '';
}
const fmt = (v, casas) => Number(v).toFixed(casas).replace('.', ',');

const grupos = [];
for (const t of lista) {
  let g = grupos.find((x) => x.caso === t.caso);
  if (!g) grupos.push((g = { caso: t.caso, itens: [] }));
  g.itens.push(t);
}

const ordemTabela = ['webrtc-ns', 'speex', 'rnnoise', 'gtcrn', 'dfn3-100', 'dfn3-30', 'dfn3-20', 'dfn3-12'];
const nomes = { 'webrtc-ns': 'Navegador (2.0.2)', speex: 'Speex', rnnoise: 'RNNoise 0.1', gtcrn: 'GTCRN', 'dfn3-100': 'DFN3 sem limite', 'dfn3-30': 'DFN3 30 dB', 'dfn3-20': 'DFN3 20 dB', 'dfn3-12': 'DFN3 12 dB' };
const linhas = ordemTabela.filter((k) => m.motores[k]).map((k) => {
  const r = m.motores[k];
  const rt = tempos[k] != null ? `${fmt(tempos[k] * 100, 1)}%` : 'no Chromium';
  return `<tr><th scope="row">${esc(nomes[k])}</th><td>${fmt(r.casos['teclado-5dB'].reducaoDb, 1)}</td><td>${fmt(r.casos['mouse-5dB'].reducaoDb, 1)}</td><td>${fmt(r.casos['ventilador-5dB'].reducaoDb, 1)}</td><td>${fmt(r.stoiLimpo, 3)}</td><td>${k.startsWith('webrtc') ? '—' : fmt(r.latenciaMs, 0) + ' ms'}</td><td>${rt}</td></tr>`;
}).join('\n');

const blocos = grupos.map((g, i) => `
  <section class="caso" aria-labelledby="c${i}">
    <h2 id="c${i}">${esc(g.caso)}</h2>
    <ol class="faixas">
      ${g.itens.map((t) => `<li class="faixa${pasta[t.motor] ? '' : ' faixa--ref'}">
        <div class="rotulo"><span class="motor">${esc(t.motor)}</span><span class="dado">${esc(nota(t.motor, t.arquivo))}</span></div>
        <audio controls preload="none" src="audio/${esc(t.arquivo)}"></audio>
      </li>`).join('\n      ')}
    </ol>
  </section>`).join('\n');

const html = `<title>Escuta da limpeza de ruído</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Rajdhani:wght@600;700&display=swap">
<style>
  :root {
    color-scheme: dark;
    --fundo: #0b0b0e;
    --painel: #0f0f12;
    --borda: #27272a;
    --borda-2: #3f3f46;
    --texto: #f4f4f5;
    --texto-2: #a1a1aa;
    --texto-3: #71717a;
    --acento: #dc2626;
    --acento-2: #ef4444;
    --acento-tenue: rgba(220, 38, 38, 0.1);
    --texto-fonte: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
    --display: 'Rajdhani', 'Bahnschrift', system-ui, sans-serif;
  }
  body { background: var(--fundo); color: var(--texto); font: 15px/1.6 var(--texto-fonte); }
  .pagina { max-width: 880px; margin: 0 auto; padding-inline: 16px; padding-block: 40px 64px; display: grid; gap: 40px; }
  header { display: grid; gap: 12px; }
  .selo { font: 500 11px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--acento-2); }
  h1 { font: 700 clamp(30px, 6vw, 44px)/1.05 var(--display); letter-spacing: .01em; margin: 0; text-wrap: balance; }
  h2 { font: 600 22px/1.2 var(--display); margin: 0; text-wrap: balance; }
  p { margin: 0; max-width: 65ch; color: var(--texto-2); }
  p strong { color: var(--texto); font-weight: 600; }
  .aviso { border-left: 2px solid var(--acento); background: var(--acento-tenue); padding: 12px 14px; display: grid; gap: 6px; }
  .aviso p { color: var(--texto); }
  .caso { display: grid; gap: 14px; }
  .faixas { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .faixa { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 320px); align-items: center; gap: 12px; padding: 10px 12px; background: var(--painel); border: 1px solid var(--borda); }
  .faixa--ref { border-color: var(--borda-2); }
  .faixa.tocando { border-color: var(--acento); box-shadow: 0 0 0 1px var(--acento); }
  .rotulo { display: grid; gap: 2px; min-width: 0; }
  .motor { font-weight: 500; }
  .dado { font: 400 12px/1.4 var(--mono); color: var(--texto-3); font-variant-numeric: tabular-nums; }
  audio { width: 100%; height: 36px; }
  .tabela { overflow-x: auto; border: 1px solid var(--borda); }
  table { border-collapse: collapse; width: 100%; font: 400 13px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--borda); white-space: nowrap; }
  thead th { font: 500 11px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--texto-2); background: var(--painel); }
  tbody th, thead th:first-child { text-align: left; }
  tbody th { font-weight: 500; color: var(--texto); }
  tbody tr:last-child > * { border-bottom: 0; }
  .legenda { font-size: 13px; }
  a { color: var(--acento-2); }
  :focus-visible { outline: 2px solid var(--acento-2); outline-offset: 2px; }
  @media (max-width: 560px) { .faixa { grid-template-columns: 1fr; } }
</style>
<div class="pagina">
  <header>
    <span class="selo">Kiroshi · F3 · rodada 1</span>
    <h1>Escuta da limpeza de ruído</h1>
    <p>A limpeza por IA saiu do Kiroshi na 2.0.2 para ser refeita do zero. Antes de escolher a nova, ouça como cada motor trata a mesma fala. Use fone, no mesmo volume, e compare dentro de cada bloco.</p>
    <div class="aviso">
      <p><strong>A fala e os ruídos desta rodada são sintéticos.</strong> A voz é a Maria do Windows e o teclado foi gerado por programa, porque nada foi baixado ainda. Serve para ouvir a diferença entre os motores, não para decidir. A decisão vem da rodada 2, com fala e teclado de verdade.</p>
    </div>
  </header>
${blocos}
  <section class="caso" aria-labelledby="numeros">
    <h2 id="numeros">Os números da rodada</h2>
    <p class="legenda">Redução: quanto o motor abaixa cada ruído sozinho, em dB (maior é melhor). Fala preservada: STOI da fala limpa depois do motor (1 = intacta). Processador: fração do tempo real num núcleo desta máquina.</p>
    <div class="tabela">
      <table>
        <thead><tr><th scope="col">Motor</th><th scope="col">Teclado</th><th scope="col">Mouse</th><th scope="col">Ventilador</th><th scope="col">Fala preservada</th><th scope="col">Latência</th><th scope="col">Processador</th></tr></thead>
        <tbody>
${linhas}
        </tbody>
      </table>
    </div>
  </section>
</div>
<script>
  // Um trecho por vez: dar play num pausa os outros.
  const audios = [...document.querySelectorAll('audio')];
  for (const a of audios) {
    a.addEventListener('play', () => {
      for (const b of audios) if (b !== a) b.pause();
      for (const li of document.querySelectorAll('.faixa')) li.classList.toggle('tocando', li.contains(a));
    });
    a.addEventListener('pause', () => a.closest('.faixa')?.classList.remove('tocando'));
  }
</script>
`;
writeFileSync(join(PASTA, 'escuta.html'), html);
console.log('pagina gerada');

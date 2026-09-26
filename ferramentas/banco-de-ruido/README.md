# Bancada de ruido (F3)

Mede os candidatos a supressao de ruido do Kiroshi com o mesmo material e as
mesmas metricas. O estudo e o plano estao em
[docs/conhecimento/11-supressao-de-ruido.md](../../docs/conhecimento/11-supressao-de-ruido.md).

Fica fora dos workspaces do monorepo: nada daqui entra no app. Audio, modelos e
resultados ficam fora do git (ver `.gitignore`).

## Rodar

No Windows, a partir desta pasta, com as dependencias da raiz ja instaladas
(o Electron e a biblioteca do portao vem de `../../node_modules`):

1. `npm install` aqui — traz o pacote do DeepFilterNet3 1.3.0, que o app nao
   usa mais.
2. Os arquivos do DFN3 em `modelos/dfn3/v3/pkg/df_bg.wasm` e
   `modelos/dfn3/v3/models/DeepFilterNet3_onnx.tar.gz` (ou outra pasta em
   `MODELOS_DFN3`). As origens e os hashes estao no `manifesto.json` que o app
   tinha ate a 2.0.1 (`git show 0d630a3^:packages/desktop/resources/modelos/manifesto.json`).
3. Fala sintetica: `powershell -File tts.ps1` (vozes Maria e Zira do Windows).
4. Corpus: `node corpus.mjs` (ruidos sinteticos e misturas em `corpus/`) e
   `node corpus-falso.mjs` (a copia com 1 s de silencio para o microfone falso).
5. Motores em AudioWorklet: `electron processar.cjs --motores=<motor>` — um
   motor por processo (ver "Armadilhas"). Motores: `bruto`, `speex`, `rnnoise`,
   `gtcrn`, `dfn3-100`, `dfn3-30`, `dfn3-20`, `dfn3-12`.
6. Supressor do navegador: `node webrtc-todos.mjs` (tempo real, 7 capturas por vez).
7. Metricas: `node metricas.mjs` (grava `metricas.json`).
8. Pagina de escuta: `node trechos.mjs <pasta>/audio` e
   `node pagina-escuta.mjs <pasta>`.

## Armadilhas

- A renderizacao offline e muito mais rapida que o tempo real e os motores sobem
  o WASM de forma assincrona: sem esperar, sai mudo ou sem tratamento. A
  bancada suspende a renderizacao ate eles ficarem prontos.
- Depois de ~40 instancias do DFN3 no mesmo processo, as seguintes repassam o
  som caladas. Por isso um motor por processo, e toda saida igual a entrada e
  marcada como erro.
- O microfone falso so existe em contexto seguro: a pagina e um arquivo local,
  nunca `data:`.
- Cada captura do navegador e um processo com atraso proprio: as metricas
  alinham arquivo por arquivo.

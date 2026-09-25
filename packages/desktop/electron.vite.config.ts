import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// A versao vem de um lugar so. Escrita a mao no codigo, ela desencontra do
// instalador na primeira vez que alguem esquece de atualizar as duas — e ai os
// registros do servidor passam a mentir sobre qual build cada pessoa usa.
const pacote = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
// O Beta sai com versao propria (scripts/dist-beta.mjs); o normal, a do package.json.
const version = process.env.KIROSHI_VERSAO ?? pacote.version;

/*
  Duas escolhas separadas (desde a 2.0.0, quando a interface nova virou a de
  todo mundo):

  - QUAL APP: `KIROSHI_CANAL=beta` compila o Kiroshi Beta (outra identidade no
    Windows, outro canal de atualizacao); sem nada, o Kiroshi normal.
  - QUAL INTERFACE: a nova, sempre; `VITE_INTERFACE=antiga` so para uma versao
    de emergencia com a 1.x, enquanto o codigo dela ainda existir.

  Antes as duas eram uma so ("interface nova" queria dizer "Beta"), e nao dava
  para o Kiroshi normal sair com a interface nova.
*/
const canalBeta = process.env.KIROSHI_CANAL === 'beta';
const interfaceNova = process.env.VITE_INTERFACE !== 'antiga';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // O Beta e outro app para o Windows: outra identidade nas notificacoes e
    // na bandeja, para nao se misturar com o Kiroshi normal.
    define: {
      __APP_ID__: JSON.stringify(canalBeta ? 'fun.arasaka.kiroshi.beta' : 'fun.arasaka.kiroshi'),
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    // O root da interface e src/, mas o .env fica na raiz do pacote, junto do
    // package.json. Sem isto o Vite procuraria em src/ e nao acharia.
    envDir: __dirname,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // O pacote compartilhado entra como fonte para o Vite compilar junto,
        // evitando um passo de build separado durante o desenvolvimento.
        '@kiroshi/shared': resolve(__dirname, '../shared/src/index.ts'),
      },
    },
    define: {
      __VERSAO__: JSON.stringify(version),
      // Ver src/vite-env.d.ts: qual das duas interfaces entra neste build.
      __INTERFACE_NOVA__: JSON.stringify(interfaceNova),
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } },
      /*
        Worklets NUNCA viram `data:`.

        O Vite embute como `data:` todo arquivo abaixo de 4 KB importado com
        `?url`. O worklet do portao de voz tem 1 KB e caia nessa regra — e a
        politica de seguranca (index.html) nao aceita script `data:`. O
        `addModule` falhava so no build de producao, o portao nao montava, e a
        cascata de limpeza descartava o modelo junto. Em desenvolvimento os
        arquivos sao servidos por URL e o problema nao aparece.
      */
      assetsInlineLimit: (arquivo) => (/worklet/i.test(arquivo) ? false : undefined),
    },
  },
});

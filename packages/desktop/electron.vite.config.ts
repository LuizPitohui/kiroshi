import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// A versao vem de um lugar so. Escrita a mao no codigo, ela desencontra do
// instalador na primeira vez que alguem esquece de atualizar as duas — e ai os
// registros do servidor passam a mentir sobre qual build cada pessoa usa.
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
    define: { __VERSAO__: JSON.stringify(version) },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } },
    },
  },
});

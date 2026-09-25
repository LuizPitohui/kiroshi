import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Configuracao para abrir a interface em um navegador comum.
 *
 * Nao substitui o app: serve para inspecionar layout e fluxo de tela sem
 * empacotar o Electron. Os recursos que dependem do sistema ficam desligados
 * pelo fallback em src/lib/bridge.ts.
 */
export default defineConfig({
  root: resolve(__dirname, 'src'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@kiroshi/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  // Mesma injecao do build do Electron: sem ela, abrir a interface no
  // navegador estoura em __VERSAO__ na hora de conectar ao gateway.
  define: {
    __VERSAO__: JSON.stringify(
      (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string })
        .version,
    ),
    // A interface nova e a de sempre desde a 2.0.0; a 1.x so com VITE_INTERFACE=antiga.
    __INTERFACE_NOVA__: JSON.stringify(process.env.VITE_INTERFACE !== 'antiga'),
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
  },
});

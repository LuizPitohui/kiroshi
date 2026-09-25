/**
 * A interface 1.x — a que todo mundo usa hoje.
 *
 * Mora aqui, e nao no `main.tsx`, para ser carregada so quando o build nao
 * pede a interface nova. Assim os estilos globais dela (global.css,
 * componentes.css) nunca encostam na nova, e o Kiroshi Beta nao leva nada
 * disto. O conteudo e o mesmo que o `main.tsx` fazia, na mesma ordem.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { aplicarMovimento } from './lib/movimento.js';
import { aplicarDensidade } from './lib/leitura.js';
import './styles/global.css';
import './styles/componentes.css';

export function iniciar(container: HTMLElement): void {
  aplicarMovimento.instalar();
  // Antes do primeiro render: a densidade muda a altura de cada mensagem, e
  // aplicar depois faria a conversa inteira saltar assim que a tela aparece.
  aplicarDensidade.instalar();

  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

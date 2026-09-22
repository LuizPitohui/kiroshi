import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installBridge } from './lib/bridge.js';
import { aplicarMovimento } from './lib/movimento.js';
import { aplicarDensidade } from './lib/leitura.js';
import './styles/global.css';
import './styles/componentes.css';
import type { KiroshiApi } from '../electron/preload.js';

declare global {
  interface Window {
    kiroshi: KiroshiApi;
  }
}

// Precisa vir antes do primeiro render: componentes chamam window.kiroshi no efeito.
installBridge();
aplicarMovimento.instalar();
// Tambem antes do primeiro render: a densidade muda a altura de cada mensagem,
// e aplicar depois faria a conversa inteira saltar assim que a tela aparece.
aplicarDensidade.instalar();

const container = document.getElementById('root');
if (!container) throw new Error('elemento #root nao encontrado');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

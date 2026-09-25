/**
 * Entrada da interface nova.
 *
 * Tema, movimento e densidade sao aplicados ANTES do primeiro render: aplicar
 * num efeito faria a janela piscar no tema errado ou a conversa saltar.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { aplicarMovimento } from '../lib/movimento.js';
import { aplicarDensidade } from '../lib/leitura.js';
import { aplicarTema } from './tema.js';
import { Raiz } from './Raiz.js';
import '../design/index.css';

export function iniciar(container: HTMLElement): void {
  aplicarTema.instalar();
  aplicarMovimento.instalar();
  aplicarDensidade.instalar();

  createRoot(container).render(
    <React.StrictMode>
      <Raiz />
    </React.StrictMode>,
  );
}

/**
 * Entrada da interface nova (fatia 1 em construcao).
 *
 * Tema, movimento e densidade sao aplicados ANTES do primeiro render: aplicar
 * num efeito faria a janela piscar no tema errado ou a conversa saltar.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { aplicarMovimento } from '../lib/movimento.js';
import { aplicarDensidade } from '../lib/leitura.js';
import { aplicarTema } from './tema.js';
import '../design/tokens.css';
import '../design/assinatura.css';

function EmConstrucao(): React.JSX.Element {
  return (
    <main
      className="k-grade"
      style={{
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--k-void)',
        color: 'var(--k-texto)',
        fontFamily: 'var(--k-fonte-mono)',
      }}
    >
      <p>
        <span className="k-rotulo">Kiroshi</span> interface nova em construcao
      </p>
    </main>
  );
}

export function iniciar(container: HTMLElement): void {
  aplicarTema.instalar();
  aplicarMovimento.instalar();
  aplicarDensidade.instalar();

  createRoot(container).render(
    <React.StrictMode>
      <EmConstrucao />
    </React.StrictMode>,
  );
}

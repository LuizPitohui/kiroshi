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
import { voice } from '../voice/controller.js';
import { aplicarTema } from './tema.js';
import { Raiz } from './Raiz.js';
import '../design/index.css';

export function iniciar(container: HTMLElement): void {
  aplicarTema.instalar();
  aplicarMovimento.instalar();
  aplicarDensidade.instalar();
  /*
    A interface nova escolhe as camadas de video (voice/recepcao.ts): quem
    assiste uma transmissao nunca recebe menos que 720p por causa do tamanho
    do quadro, e o que ninguem ve e pausado no servidor. A 1.x continua com a
    adaptacao automatica do LiveKit.
  */
  voice.configurarRecepcao({ manual: true });
  /*
    Diagnostico de campo: com `kiroshi.depurar = 1` no armazenamento, o motor
    de voz fica em `window.__kiroshi` para o console (camadas, pausas, faixas).
    Desligado, nada fica exposto.
  */
  try {
    if (localStorage.getItem('kiroshi.depurar') === '1') (window as unknown as { __kiroshi: unknown }).__kiroshi = { voice };
  } catch {
    // sem armazenamento: sem diagnostico
  }

  createRoot(container).render(
    <React.StrictMode>
      <Raiz />
    </React.StrictMode>,
  );
}

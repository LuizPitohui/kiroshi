import { installBridge } from './lib/bridge.js';
import type { KiroshiApi } from '../electron/preload.js';

declare global {
  interface Window {
    kiroshi: KiroshiApi;
  }
}

// Precisa vir antes do primeiro render: componentes chamam window.kiroshi no efeito.
installBridge();

const container = document.getElementById('root');
if (!container) throw new Error('elemento #root nao encontrado');

/*
  A interface nova e a de todo mundo desde a 2.0.0
  (docs/conhecimento/10-front-end-novo.md, secao 7): no Kiroshi e no Beta.

  A 1.x continua no codigo como reserva — um build com VITE_INTERFACE=antiga
  a carrega, para uma versao de emergencia; em desenvolvimento, `?antiga` no
  endereco tambem. A condicao vira constante na compilacao, entao o ramo que
  nao vale some do pacote.
*/
const interfaceNova =
  __INTERFACE_NOVA__ && !(import.meta.env.DEV && new URLSearchParams(location.search).has('antiga'));

if (interfaceNova) {
  void import('./app/iniciar.js').then((m) => m.iniciar(container));
} else {
  void import('./legado.js').then((m) => m.iniciar(container));
}

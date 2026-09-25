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
  Duas interfaces convivem ate a nova cobrir o uso diario
  (docs/conhecimento/10-front-end-novo.md, secao 7).

  O instalador de todo mundo carrega a atual. O Kiroshi Beta, compilado com
  VITE_INTERFACE=nova, carrega a nova. Em desenvolvimento, `?nova` no endereco
  tambem abre a nova. A condicao vira constante na compilacao, entao o ramo
  que nao vale some do pacote.
*/
const interfaceNova =
  __INTERFACE_NOVA__ || (import.meta.env.DEV && new URLSearchParams(location.search).has('nova'));

if (interfaceNova) {
  void import('./app/iniciar.js').then((m) => m.iniciar(container));
} else {
  void import('./legado.js').then((m) => m.iniciar(container));
}

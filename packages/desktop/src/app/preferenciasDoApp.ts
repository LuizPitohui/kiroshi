import { create } from 'zustand';
import type { PreferenciasDoApp } from '../../electron/preload.js';

/*
  As preferencias do processo principal (electron/preferencias.ts) vistas
  pela interface: a pagina Windows muda, a barra de titulo diz o que o X faz.
*/

interface Estado {
  preferencias: PreferenciasDoApp | null;
  carregar: () => Promise<void>;
  gravar: (patch: Partial<PreferenciasDoApp>) => Promise<void>;
}

export const usePreferenciasDoApp = create<Estado>((set) => ({
  preferencias: null,
  carregar: async () => {
    const preferencias = await window.kiroshi?.preferencias?.ler();
    if (preferencias) set({ preferencias });
  },
  gravar: async (patch) => {
    const preferencias = await window.kiroshi?.preferencias?.gravar(patch);
    if (preferencias) set({ preferencias });
  },
}));

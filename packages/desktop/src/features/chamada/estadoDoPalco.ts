import { create } from 'zustand';
import type { Preferencia } from '../../voice/recepcao.js';

/**
 * O que a pessoa escolheu no palco, fora do componente: sobrevive a troca de
 * tela. Sair do canal de voz para ler outro canal e voltar mantem o destaque
 * e a qualidade escolhida — e o mini palco mostra o mesmo destaque.
 */
interface EstadoDoPalco {
  /** Quadro posto em destaque pela pessoa (`userId:tipo`), ou null. */
  destaque: string | null;
  /** Qualidade escolhida para a transmissao de cada pessoa. */
  preferencias: Record<string, Preferencia>;
  /**
   * A pessoa fechou a miniatura flutuante. Vale ate ela voltar para a tela da
   * chamada: a proxima saida mostra a miniatura de novo.
   */
  miniFechada: boolean;
  destacar: (chave: string | null) => void;
  preferir: (userId: string, preferencia: Preferencia) => void;
  fecharMini: () => void;
  reabrirMini: () => void;
  /** Chamada nova, escolhas novas. */
  limpar: () => void;
}

export const useEstadoDoPalco = create<EstadoDoPalco>((set) => ({
  destaque: null,
  preferencias: {},
  miniFechada: false,
  destacar: (destaque) => set({ destaque }),
  preferir: (userId, preferencia) => set((s) => ({ preferencias: { ...s.preferencias, [userId]: preferencia } })),
  fecharMini: () => set({ miniFechada: true }),
  reabrirMini: () => set({ miniFechada: false }),
  limpar: () => set({ destaque: null, preferencias: {}, miniFechada: false }),
}));

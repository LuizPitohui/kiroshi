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
  destacar: (chave: string | null) => void;
  preferir: (userId: string, preferencia: Preferencia) => void;
  /** Chamada nova, escolhas novas. */
  limpar: () => void;
}

export const useEstadoDoPalco = create<EstadoDoPalco>((set) => ({
  destaque: null,
  preferencias: {},
  destacar: (destaque) => set({ destaque }),
  preferir: (userId, preferencia) => set((s) => ({ preferencias: { ...s.preferencias, [userId]: preferencia } })),
  limpar: () => set({ destaque: null, preferencias: {} }),
}));

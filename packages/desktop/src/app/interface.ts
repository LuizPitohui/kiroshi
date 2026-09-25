import { create } from 'zustand';

/**
 * Estado so da interface, fora do store de dados: o que esta aberto, o que
 * esta recolhido. Pequeno de proposito, e cada escolha que vale entre sessoes
 * fica guardada.
 */

const CHAVE_DOS_MEMBROS = 'kiroshi.membros';

function lerMembros(): boolean {
  try {
    return localStorage.getItem(CHAVE_DOS_MEMBROS) !== 'nao';
  } catch {
    return true;
  }
}

interface EstadoDaInterface {
  /** O painel de membros ao lado da conversa, na janela larga. Guardado. */
  membros: boolean;
  /**
   * O mesmo painel como gaveta, na janela estreita. Nao e guardado: gaveta
   * aberta por cima da conversa nao deve reaparecer sozinha na proxima vez.
   */
  gavetaDeMembros: boolean;
  /** O botao de membros: na janela larga liga o painel, na estreita a gaveta. */
  alternarMembros: (telaLarga: boolean) => void;
  fecharGaveta: () => void;
}

export const useInterface = create<EstadoDaInterface>((set, get) => ({
  membros: lerMembros(),
  gavetaDeMembros: false,
  alternarMembros: (telaLarga) => {
    if (!telaLarga) {
      set({ gavetaDeMembros: !get().gavetaDeMembros });
      return;
    }
    const membros = !get().membros;
    try {
      localStorage.setItem(CHAVE_DOS_MEMBROS, membros ? 'sim' : 'nao');
    } catch {
      // sem armazenamento: vale ate fechar
    }
    set({ membros });
  },
  fecharGaveta: () => set({ gavetaDeMembros: false }),
}));

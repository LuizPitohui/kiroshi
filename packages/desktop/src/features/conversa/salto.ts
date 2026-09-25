import { create } from 'zustand';

/**
 * Pedido de "ir ate esta mensagem", que pode atravessar a troca de canal.
 *
 * A busca, as fixadas e a resposta citada pedem aqui; a lista do canal certo
 * atende quando o historico dela estiver carregado. Um pedido de cada vez: o
 * mais novo substitui o anterior.
 */
interface Salto {
  canalId: string;
  mensagemId: string;
  /** Muda a cada pedido, para o mesmo alvo pedido duas vezes valer duas vezes. */
  vez: number;
}

interface EstadoDoSalto {
  pendente: Salto | null;
  pedir: (canalId: string, mensagemId: string) => void;
  atendido: (vez: number) => void;
}

let vez = 0;

export const useSalto = create<EstadoDoSalto>((set, get) => ({
  pendente: null,
  pedir: (canalId, mensagemId) => set({ pendente: { canalId, mensagemId, vez: ++vez } }),
  atendido: (v) => {
    if (get().pendente?.vez === v) set({ pendente: null });
  },
}));

export const pedirSalto = (canalId: string, mensagemId: string) => useSalto.getState().pedir(canalId, mensagemId);

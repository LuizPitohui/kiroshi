import { create } from 'zustand';
import type { AtualizacaoEstado } from '../../electron/preload.js';

/*
  A versao nova do app vista pela interface (pedido do dono em 2026-09-26:
  "faz um aviso que tem nova atualizacao e botao para reiniciar; atualmente
  esta escondido" — so aparecia em Configuracoes > Sobre).

  O processo principal procura a cada 10 minutos e baixa sozinho; aqui so se
  mostra quando esta PRONTA e se oferece o reinicio. Quem esta numa chamada
  pode pedir para reiniciar quando sair dela: reiniciar no meio derruba a
  chamada (foi assim que o Sid sumia e voltava em 2026-09-26).
*/

interface Estado {
  atualizacao: AtualizacaoEstado | null;
  /** A pessoa disse "depois": o aviso sai de cima, fica o selo na barra de titulo. */
  dispensada: boolean;
  /** Reinicia sozinho assim que a pessoa sair da chamada. */
  aoSairDaChamada: boolean;
  dispensar: () => void;
  mostrar: () => void;
  reiniciarAoSairDaChamada: (sim: boolean) => void;
}

export const useAtualizacao = create<Estado>((set) => ({
  atualizacao: null,
  dispensada: false,
  aoSairDaChamada: false,
  dispensar: () => set({ dispensada: true }),
  mostrar: () => set({ dispensada: false }),
  reiniciarAoSairDaChamada: (sim) => set({ aoSairDaChamada: sim, dispensada: sim }),
}));

let ouvindo = false;

/** Liga o estado ao processo principal, uma vez so. */
export function ouvirAtualizacao(): void {
  if (ouvindo || !window.kiroshi?.atualizacao) return;
  ouvindo = true;
  // Pergunta o estado ao abrir: a versao pode ter ficado pronta com a janela
  // escondida na bandeja, e o aviso daquele momento se perdeu.
  void window.kiroshi.atualizacao.estado().then((atualizacao) => useAtualizacao.setState({ atualizacao }));
  window.kiroshi.atualizacao.aoMudar((atualizacao) => useAtualizacao.setState({ atualizacao }));
}

/** Versao nova baixada, esperando so o reinicio. */
export function prontaParaReiniciar(a: AtualizacaoEstado | null): boolean {
  return a?.fase === 'pronta';
}

/**
 * Hora de reiniciar sozinho: a pessoa pediu "quando eu sair da chamada", a
 * versao esta pronta, e ela ja nao esta nem entrando em chamada nenhuma.
 */
export function deveReiniciarAgora(pronta: boolean, aoSairDaChamada: boolean, emChamada: boolean): boolean {
  return pronta && aoSairDaChamada && !emChamada;
}

import { createContext, useContext } from 'react';
import type { FonteDeVideo } from './videos.js';
import type { ParticipanteParaQuadro } from './quadros.js';

/**
 * De onde o palco tira quem esta na chamada e os videos.
 *
 * Na chamada de verdade, do motor de voz (`fonteAoVivo.ts`); na vitrine, de
 * participantes e videos sinteticos. E o que deixa provar o palco inteiro —
 * disposicoes, destaque, o video trocando de lugar sem ser recriado — sem
 * servidor de midia nem camera.
 *
 * Os metodos `usar*` sao ganchos do React: chamados sempre, na mesma ordem.
 */
export interface EstadoDaPessoa {
  falando: boolean;
  mudo: boolean;
  surdo: boolean;
  /** Silenciado ou ensurdecido pela moderacao (e nao por escolha propria). */
  pelaModeracao: boolean;
  sinal: 'excellent' | 'good' | 'poor' | 'unknown';
}

export interface FonteDaChamada {
  usarParticipantes(): { participantes: readonly ParticipanteParaQuadro[]; assistindoEu: readonly string[] };
  usarPessoa(userId: string): EstadoDaPessoa;
  /** Sobe quando as faixas mudam: e a hora de buscar o video de novo. */
  usarVersaoDeMidia(): number;
  videoDe(userId: string, fonte: 'camera' | 'tela'): FonteDeVideo | null;
  assistir(userId: string): void;
  pararDeAssistir(userId: string): void;
  /** So a chamada de verdade tem estatisticas do WebRTC para medir. */
  mede: boolean;
}

export const ContextoDaChamada = createContext<FonteDaChamada | null>(null);

export function useFonteDaChamada(): FonteDaChamada {
  const fonte = useContext(ContextoDaChamada);
  if (!fonte) throw new Error('palco fora de uma fonte de chamada');
  return fonte;
}

import { useSyncExternalStore } from 'react';
import { voice, type VoiceParticipant, type VoiceState } from '../voice/controller.js';

/**
 * O estado da voz vive fora do React, no controlador, porque ele precisa
 * continuar funcionando enquanto a interface remonta. useSyncExternalStore e
 * a ponte correta: o React reassina sozinho e nao perde atualizacoes.
 */
export function useVoiceState(): VoiceState {
  return useSyncExternalStore(
    (onChange) => voice.subscribe(onChange),
    () => voice.getState(),
  );
}

/** Participante especifico, para componentes que so olham uma pessoa. */
export function useVoiceParticipant(userId: string): VoiceParticipant | undefined {
  const state = useVoiceState();
  return state.participants.find((p) => p.userId === userId);
}

export function useIsSpeaking(userId: string): boolean {
  return useVoiceParticipant(userId)?.speaking ?? false;
}

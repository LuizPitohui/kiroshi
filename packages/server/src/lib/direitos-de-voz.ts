import { TrackSource } from 'livekit-server-sdk';
import { has, Permission } from '@kiroshi/shared';

export interface Moderacao {
  silenciado: boolean;
  ensurdecido: boolean;
}

/**
 * O que a pessoa pode publicar na sala: o cargo decide, a moderacao tira.
 *
 * Silenciado ou ensurdecido pela moderacao, o microfone sai da lista. Antes o
 * silencio era so um "mute" na faixa que ja estava no ar: sair e entrar de novo
 * trazia um token com microfone, e a moderacao escapava sozinha (03-servidor).
 * Ensurdecer tambem cala, como no Discord: quem nao ouve nao fala sem saber.
 *
 * Pura, para a regra que entra em TODO token de voz ser testada sem SFU.
 */
export function fontesPermitidas(permissions: bigint, moderacao: Moderacao): TrackSource[] {
  const fontes: TrackSource[] = [];
  if (has(permissions, Permission.SPEAK) && !moderacao.silenciado && !moderacao.ensurdecido) {
    fontes.push(TrackSource.MICROPHONE);
  }
  if (has(permissions, Permission.STREAM)) {
    fontes.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  return fontes;
}

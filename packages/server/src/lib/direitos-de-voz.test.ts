import { describe, expect, it } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';
import { Permission } from '@kiroshi/shared';
import { fontesPermitidas } from './direitos-de-voz.js';

const livre = { silenciado: false, ensurdecido: false };
const tudo = Permission.SPEAK | Permission.STREAM;

describe('fontesPermitidas', () => {
  it('quem fala e transmite publica tudo', () => {
    expect(fontesPermitidas(tudo, livre)).toEqual([
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
  });

  it('silenciado pela moderacao perde so o microfone', () => {
    expect(fontesPermitidas(tudo, { silenciado: true, ensurdecido: false })).not.toContain(TrackSource.MICROPHONE);
    expect(fontesPermitidas(tudo, { silenciado: true, ensurdecido: false })).toContain(TrackSource.SCREEN_SHARE);
  });

  it('ensurdecido tambem nao fala', () => {
    expect(fontesPermitidas(tudo, { silenciado: false, ensurdecido: true })).not.toContain(TrackSource.MICROPHONE);
  });

  it('sem SPEAK entra so para ouvir; sem STREAM, sem camera nem tela', () => {
    expect(fontesPermitidas(Permission.STREAM, livre)).not.toContain(TrackSource.MICROPHONE);
    expect(fontesPermitidas(Permission.SPEAK, livre)).toEqual([TrackSource.MICROPHONE]);
    expect(fontesPermitidas(0n, livre)).toEqual([]);
  });

  it('administrador fala mesmo sem os bits (has respeita ADMINISTRATOR)', () => {
    expect(fontesPermitidas(Permission.ADMINISTRATOR, livre)).toContain(TrackSource.MICROPHONE);
  });
});

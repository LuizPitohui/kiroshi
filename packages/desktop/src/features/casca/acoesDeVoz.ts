import { gateway } from '../../api/gateway.js';
import { useStore } from '../../store/index.js';
import { voice } from '../../voice/controller.js';
import { avisar } from '../../design/primitivos/index.js';

/*
  Entrar, sair, mutar e ensurdecer — num lugar so.

  Na interface 1.x cada tela repetia a sequencia (NavColumn, VoiceChannelView,
  CallStatus, CallControls), e uma das copias esquecia de avisar o gateway ao
  mutar: os outros continuavam vendo o microfone aberto na lista do canal.
  Aqui toda mudanca de estado da voz sai para o servidor na mesma hora.
*/

/**
 * O estado da propria voz, inteiro, para o servidor.
 *
 * Camera e tela vao junto. Antes iam so microfone e fone: o servidor gravava
 * camera e tela como desligadas a cada mute, e ninguem via na lista quem
 * estava com camera ou ao vivo — nas duas interfaces.
 */
export function avisarServidor(): void {
  const v = voice.getState();
  // Saindo, o servidor ja sabe: qualquer aviso agora poria a pessoa de volta no canal.
  if (!v.channelId || v.saindo) return;
  gateway.updateVoiceState({
    guildId: v.guildId,
    channelId: v.channelId,
    selfMute: v.selfMuted,
    selfDeaf: v.selfDeafened,
    selfVideo: v.cameraOn,
    selfStream: v.screenSharing,
  });
}

/** Conecta ao SFU e depois anuncia a entrada (os outros veem quem entrou). */
export async function entrarNaVoz(canalId: string, guildId: string | null): Promise<void> {
  try {
    await voice.joinChannel(canalId, guildId);
    avisarServidor();
  } catch (erro) {
    avisar.erro('Não consegui entrar na chamada', erro instanceof Error ? erro.message : undefined);
  }
}

/**
 * O servidor e avisado antes: a saida aparece para os outros mesmo que o SFU
 * demore.
 *
 * E a propria pessoa sai da propria lista na hora. O servidor nao devolve o
 * aviso de saida a quem saiu (um aviso atrasado derrubaria a chamada nova de
 * quem sai e entra rapido), entao sem esta linha a pessoa seguia no canal, na
 * propria tela, como fantasma — "ao vivo", se estava transmitindo — ate o app
 * reconectar. Visto pelo dono em 2026-09-26.
 */
export function sairDaVoz(): void {
  const v = voice.getState();
  gateway.updateVoiceState({ guildId: v.guildId, channelId: null, selfMute: v.selfMuted, selfDeaf: v.selfDeafened });
  const eu = useStore.getState().user?.id;
  if (eu) useStore.getState().removeVoiceState(eu);
  void voice.leave();
}

export async function alternarMicrofone(): Promise<void> {
  await voice.setMuted(!voice.getState().selfMuted);
  avisarServidor();
}

export async function alternarFone(): Promise<void> {
  await voice.setDeafened(!voice.getState().selfDeafened);
  avisarServidor();
}

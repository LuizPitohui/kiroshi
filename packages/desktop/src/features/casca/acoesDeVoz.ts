import { gateway } from '../../api/gateway.js';
import { voice } from '../../voice/controller.js';
import { avisar } from '../../design/primitivos/index.js';

/*
  Entrar, sair, mutar e ensurdecer — num lugar so.

  Na interface 1.x cada tela repetia a sequencia (NavColumn, VoiceChannelView,
  CallStatus, CallControls), e uma das copias esquecia de avisar o gateway ao
  mutar: os outros continuavam vendo o microfone aberto na lista do canal.
  Aqui toda mudanca de estado da voz sai para o servidor na mesma hora.
*/

function avisarServidor(): void {
  const v = voice.getState();
  if (!v.channelId) return;
  gateway.updateVoiceState({
    guildId: v.guildId,
    channelId: v.channelId,
    selfMute: v.selfMuted,
    selfDeaf: v.selfDeafened,
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

/** O servidor e avisado antes: a saida aparece para os outros mesmo que o SFU demore. */
export function sairDaVoz(): void {
  const v = voice.getState();
  gateway.updateVoiceState({ guildId: v.guildId, channelId: null, selfMute: v.selfMuted, selfDeaf: v.selfDeafened });
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

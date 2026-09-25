import { useStore } from '../../store/index.js';
import { voice, type VoiceState } from '../../voice/controller.js';
import { useVoz } from '../casca/useVoz.js';
import { rasoIgual } from '../casca/organizar.js';
import type { EstadoDaPessoa, FonteDaChamada } from './fonte.js';
import type { ParticipanteParaQuadro } from './quadros.js';

/*
  A fonte da chamada de verdade.

  O motor emite a cada 200 ms (niveis de audio). A lista de participantes aqui
  so muda quando a ESTRUTURA muda (quem entrou, quem ligou camera, quem
  assiste o que): o palco nao redesenha cinco vezes por segundo. Quem fala e
  lido por quadro, em `usarPessoa`, e so aquele quadro acorda.
*/

function estrutura(v: VoiceState): ParticipanteParaQuadro[] {
  return v.participants.map((p) => ({
    userId: p.userId,
    isLocal: p.isLocal,
    hasVideo: p.hasVideo,
    hasScreenShare: p.hasScreenShare,
    assistindo: p.assistindo,
  }));
}

function mesmaEstrutura(a: ParticipanteParaQuadro[], b: ParticipanteParaQuadro[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.userId === y.userId &&
      x.isLocal === y.isLocal &&
      x.hasVideo === y.hasVideo &&
      x.hasScreenShare === y.hasScreenShare &&
      x.assistindo.join(',') === y.assistindo.join(',')
    );
  });
}

export const fonteAoVivo: FonteDaChamada = {
  usarParticipantes() {
    const participantes = useVoz(estrutura, mesmaEstrutura);
    const assistindoEu = useVoz((v) => v.assistindo, rasoIgual);
    return { participantes, assistindoEu };
  },

  usarPessoa(userId: string): EstadoDaPessoa {
    const falando = useVoz((v) => v.participants.find((p) => p.userId === userId)?.speaking ?? false);
    const micFechado = useVoz((v) => v.participants.find((p) => p.userId === userId)?.muted ?? false);
    const sinal = useVoz((v) => v.participants.find((p) => p.userId === userId)?.connectionQuality ?? 'unknown');
    // Surdo e a moderacao so o servidor sabe: vem do estado de voz do gateway.
    const selfDeaf = useStore((s) => s.voiceStates.get(userId)?.selfDeaf ?? false);
    const serverDeaf = useStore((s) => s.voiceStates.get(userId)?.serverDeaf ?? false);
    const serverMute = useStore((s) => s.voiceStates.get(userId)?.serverMute ?? false);
    return {
      falando,
      mudo: micFechado || serverMute,
      surdo: selfDeaf || serverDeaf,
      pelaModeracao: serverMute || serverDeaf,
      sinal,
    };
  },

  usarVersaoDeMidia() {
    return useVoz((v) => v.mediaVersion);
  },

  videoDe(userId, fonte) {
    return voice.getVideoTrack(userId, fonte === 'tela' ? 'screen' : 'camera');
  },

  assistir(userId) {
    void voice.assistirTransmissao(userId);
  },

  pararDeAssistir(userId) {
    void voice.pararDeAssistir(userId);
  },

  mede: true,
};

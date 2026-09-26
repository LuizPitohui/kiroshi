import { Track, type AudioProcessorOptions } from 'livekit-client';
import {
  limiarDoPortao,
  motorDaLimpeza,
  type AjustesDeLimpeza,
  type MotorDeLimpeza,
} from './limpeza.js';
import { ApenasPortao, portaoDisponivel, type ProcessadorDeLimpeza } from './ruido.js';

/**
 * Monta a entrada do microfone depois de aberto: o portao, quando ha.
 *
 * Usada em DOIS lugares, e isso e o ponto: a chamada (controller.ts) e o
 * teste de microfone das configuracoes. Um teste que nao mostra o que os
 * outros ouvem nao testa nada.
 *
 * A supressao de ruido, desde que a limpeza por modelo saiu (2.0.2, backlog
 * F3), e toda do navegador: vai pedida NA CAPTURA (`restricoesDoNavegador`),
 * antes de esta funcao rodar. Por isso uma falha aqui nao deixa o microfone
 * cru — no maximo sem portao. Antes era o contrario: a captura desligava o
 * supressor do navegador para dar lugar ao modelo, e um modelo que nao pegava
 * deixava o som sem limpeza nenhuma.
 */

export interface LimpezaMontada {
  motor: MotorDeLimpeza;
  processador: ProcessadorDeLimpeza | null;
  portao: boolean;
  /** O que deu errado ao montar, para a tela de diagnostico. */
  falhas: string[];
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Pluga a cadeia do portao na faixa aberta.
 *
 * `aplicar` e quem pluga o processador de fato: na chamada, `setProcessor` do
 * LiveKit; no teste, `init` direto. Assim a cadeia nao conhece LiveKit.
 *
 * A cadeia entra tambem no apertar para falar, com o portao aberto: trocar de
 * modo no meio da chamada liga o portao ao vivo, sem reabrir o microfone.
 */
export async function aplicarLimpeza(
  ajustes: AjustesDeLimpeza,
  aplicar: (processador: ProcessadorDeLimpeza) => Promise<void>,
): Promise<LimpezaMontada> {
  const motor = motorDaLimpeza(ajustes);
  const limiar = limiarDoPortao(ajustes);

  if (!portaoDisponivel()) {
    return {
      motor,
      processador: null,
      portao: false,
      falhas: limiar === null ? [] : ['portao: este aparelho nao tem AudioWorklet'],
    };
  }

  const processador = new ApenasPortao({ limiarDoPortaoDb: limiar }, motor);
  try {
    await aplicar(processador);
    return { motor, processador, portao: limiar !== null, falhas: [] };
  } catch (erro) {
    await processador.destroy().catch(() => undefined);
    return { motor, processador: null, portao: false, falhas: [`portao: ${mensagemDe(erro)}`] };
  }
}

/**
 * `aplicar` para uma faixa fora do LiveKit (o teste de microfone).
 *
 * Nossos processadores so leem `track` das opcoes; o resto do tipo e do
 * LiveKit, que aqui nao participa.
 */
export function aplicarEmFaixaAvulsa(
  faixa: MediaStreamTrack,
): (processador: ProcessadorDeLimpeza) => Promise<void> {
  return (processador) =>
    processador.init({ kind: Track.Kind.Audio, track: faixa } as AudioProcessorOptions);
}

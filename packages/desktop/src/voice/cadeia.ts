import { Track, type AudioProcessorOptions } from 'livekit-client';
import {
  intensidadeValida,
  limiarDoPortao,
  modelosATentar,
  motorSemModelo,
  restricoesDoNavegador,
  type AjustesDeLimpeza,
  type Disponibilidade,
  type MotorDeLimpeza,
  type MotorDeModelo,
  type RestricoesDoNavegador,
} from './limpeza.js';
import {
  ApenasPortao,
  LimpezaGtcrn,
  limpezaDisponivel,
  portaoDisponivel,
  type OpcoesDoProcessador,
  type ProcessadorDeLimpeza,
} from './ruido.js';
import { LimpezaDeepFilter, verificarDeepFilter } from './ruido-dfn3.js';

/**
 * A cascata da limpeza de ruido: decide o motor, monta, e cai para o proximo
 * quando algo falha.
 *
 *   DeepFilterNet3  ->  GTCRN  ->  navegador (ou nenhum)
 *
 * Usada em DOIS lugares, e isso e o ponto: a chamada (controller.ts) e o
 * teste de microfone das configuracoes. Antes, o teste abria o microfone
 * direto e o que a pessoa ouvia no "Ouvir minha voz" nao passava por modelo
 * nenhum. Um teste que nao mostra o que os outros ouvem nao testa nada.
 *
 * O fluxo tem duas etapas porque a captura fica no meio delas:
 *
 *   1. planejarLimpeza   descobre quais modelos rodam aqui. Precisa vir
 *                        ANTES de abrir o microfone: se ha modelo, o
 *                        supressor do navegador tem que ser pedido desligado.
 *
 *   2. aplicarLimpeza    tenta montar cada modelo, em ordem, na faixa ja
 *                        aberta. Se nenhum pegar, avisa quem chamou para
 *                        reabrir o microfone COM o supressor do navegador —
 *                        nunca deixa a faixa crua por engano.
 */

export interface PlanoDeLimpeza {
  modelos: MotorDeModelo[];
  /** O que pedir ao navegador na captura, ja considerando o plano. */
  restricoes: RestricoesDoNavegador;
  /** Por que um modelo ficou de fora, para a tela de diagnostico. */
  avisos: string[];
}

export interface LimpezaMontada {
  motor: MotorDeLimpeza;
  processador: ProcessadorDeLimpeza | null;
  portao: boolean;
  /** Tudo que deu errado no caminho, em ordem. Vazio quando o primeiro pegou. */
  falhas: string[];
  /**
   * O plano contava com modelo, nenhum pegou, e a faixa foi aberta com o
   * supressor do navegador DESLIGADO. Quem chamou precisa reabrir com as
   * restricoes em `restricoesDeResgate`.
   */
  precisaReabrir: boolean;
  restricoesDeResgate: RestricoesDoNavegador;
}

export async function disponibilidade(): Promise<Disponibilidade> {
  const dfn3 = await verificarDeepFilter();
  return {
    deepfilternet3: dfn3.ok ? { ok: true } : { ok: false, motivo: dfn3.motivo },
    gtcrn: limpezaDisponivel(),
    portao: portaoDisponivel(),
  };
}

export async function planejarLimpeza(ajustes: AjustesDeLimpeza): Promise<PlanoDeLimpeza> {
  const avisos: string[] = [];
  let modelos: MotorDeModelo[] = [];

  if (ajustes.limpezaDeRuido) {
    const disp = await disponibilidade();
    modelos = modelosATentar(ajustes, disp);
    if (!disp.deepfilternet3.ok) avisos.push(`DeepFilterNet3: ${disp.deepfilternet3.motivo}`);
    if (!disp.gtcrn) avisos.push('GTCRN: este aparelho nao tem AudioWorklet ou WebAssembly');
  }

  return {
    modelos,
    restricoes: restricoesDoNavegador(ajustes, modelos.length > 0),
    avisos,
  };
}

function criar(motor: MotorDeModelo, opcoes: OpcoesDoProcessador): ProcessadorDeLimpeza {
  return motor === 'deepfilternet3' ? new LimpezaDeepFilter(opcoes) : new LimpezaGtcrn(opcoes);
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Tenta cada modelo do plano na faixa aberta.
 *
 * `aplicar` e quem pluga o processador de fato: na chamada, `setProcessor` do
 * LiveKit; no teste, `init` direto. Assim a cascata nao conhece LiveKit.
 */
export async function aplicarLimpeza(
  plano: PlanoDeLimpeza,
  ajustes: AjustesDeLimpeza,
  aplicar: (processador: ProcessadorDeLimpeza) => Promise<void>,
): Promise<LimpezaMontada> {
  const falhas = [...plano.avisos];
  const limiar = limiarDoPortao(ajustes);
  const opcoes = (): OpcoesDoProcessador => ({
    limiarDoPortaoDb: limiar,
    intensidade: intensidadeValida(ajustes.intensidadeDaLimpeza),
  });
  const resgate = restricoesDoNavegador(ajustes, false);

  for (const motor of plano.modelos) {
    const processador = criar(motor, opcoes());
    try {
      await aplicar(processador);
      return {
        motor,
        processador,
        portao: limiar !== null,
        falhas,
        precisaReabrir: false,
        restricoesDeResgate: resgate,
      };
    } catch (erro) {
      falhas.push(`${motor}: ${mensagemDe(erro)}`);
      await processador.destroy().catch(() => undefined);
    }
  }

  // Sem modelo. O motor passa a ser o navegador (ou nenhum), e a faixa
  // precisa ser reaberta se tinha sido pedida sem o supressor dele.
  const motor = motorSemModelo(ajustes);
  const precisaReabrir = plano.modelos.length > 0;

  /*
    O portao sozinho, quando ha modo por voz.

    Sem esta etapa, desligar a limpeza por modelo desligaria tambem a
    deteccao de voz, calado. Ela nao entra depois de uma falha dos modelos
    que exija reabrir: a reabertura troca a faixa de baixo do processador, e
    quem chama monta o portao de novo depois disso (ver controller.ts).
  */
  if (!precisaReabrir && portaoDisponivel()) {
    const processador = new ApenasPortao(opcoes(), motor);
    try {
      await aplicar(processador);
      return {
        motor,
        processador,
        portao: limiar !== null,
        falhas,
        precisaReabrir,
        restricoesDeResgate: resgate,
      };
    } catch (erro) {
      falhas.push(`portao: ${mensagemDe(erro)}`);
      await processador.destroy().catch(() => undefined);
    }
  }

  return {
    motor,
    processador: null,
    portao: false,
    falhas,
    precisaReabrir,
    restricoesDeResgate: resgate,
  };
}

/**
 * Plano de resgate: sem modelos, mas com portao se houver modo por voz.
 *
 * Usado depois de reabrir o microfone quando os modelos falharam.
 */
export function planoSemModelos(ajustes: AjustesDeLimpeza, avisos: string[]): PlanoDeLimpeza {
  return { modelos: [], restricoes: restricoesDoNavegador(ajustes, false), avisos };
}

/**
 * Comeca o autoteste do DeepFilterNet3 sem esperar por ele.
 *
 * Chamado quando o aplicativo abre, com folga: o teste leva de meio a um
 * segundo e meio, e a primeira entrada em chamada nao precisa esperar por ele.
 */
export function aquecerLimpeza(): void {
  const iniciar = (): void => void verificarDeepFilter();
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(iniciar, { timeout: 5000 });
  } else {
    setTimeout(iniciar, 2000);
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

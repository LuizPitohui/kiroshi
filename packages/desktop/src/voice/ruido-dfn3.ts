import { DeepFilterNet3Core } from 'deepfilternet3-noise-filter';
import {
  avaliarAutoteste,
  intensidadeValida,
  rms,
  type ResultadoDoAutoteste,
} from './limpeza.js';
import { ProcessadorBase, TAXA, limpezaDisponivel } from './ruido.js';

/**
 * DeepFilterNet3: o motor principal da limpeza de ruido.
 *
 * Rede neural de realce de voz (Schroter et al., ICASSP 2022), compilada para
 * WebAssembly e rodando num AudioWorklet. Remove bem o que o RNNoise e o
 * GTCRN deixam passar: teclado mecanico, clique de mouse, gente falando ao
 * fundo. O preco e processador — por isso o autoteste abaixo, e o GTCRN como
 * reserva.
 *
 * A integracao usa o pacote `deepfilternet3-noise-filter` (MIT/Apache-2.0),
 * FIXADO em 1.3.0. Nao atualizar sem ler "Atualizando o DeepFilterNet3" em
 * docs/SUPRESSAO-DE-RUIDO.md: o binario WASM precisa bater exatamente com o
 * codigo de cola embutido no pacote, e versoes diferentes nao batem.
 *
 * TRES COMPORTAMENTOS DO PACOTE QUE MOLDARAM ESTE ARQUIVO:
 *
 * 1. Ele baixa o modelo de uma CDN de terceiros por padrao. O Kiroshi e
 *    auto-hospedado e o microfone das pessoas nao vai depender de um servidor
 *    que nao e nosso. Os arquivos vao DENTRO do instalador e sao servidos
 *    pelo protocolo `kiroshi-modelos://`, registrado em electron/main.ts.
 *
 * 2. Ele carrega o worklet por uma URL `blob:`. Por isso a politica de
 *    seguranca em index.html libera `blob:` em `script-src`. A troca esta
 *    explicada la.
 *
 * 3. Se o modelo falhar dentro do worklet, ele NAO avisa: registra um erro no
 *    console do thread de audio e passa a copiar a entrada para a saida. Um
 *    motor quebrado e um motor funcionando sao indistinguiveis por fora. Esse
 *    e o motivo do autoteste existir, e de ele medir o RESULTADO em vez de
 *    confiar em "nao deu erro".
 */

/**
 * De onde o pacote busca os arquivos.
 *
 * O pacote acrescenta `v3/pkg/df_bg.wasm` e `v3/models/DeepFilterNet3_onnx.tar.gz`.
 * O processo principal responde a esse esquema lendo de `resources/modelos/`.
 */
export const BASE_DOS_ARQUIVOS = 'kiroshi-modelos://dfn3';

/**
 * Duracao do audio do autoteste.
 *
 * Dois segundos diluem o custo fixo de carregar o modelo no thread de audio,
 * que entra na medicao de tempo. Com menos, maquina boa seria reprovada por
 * causa da carga, nao do processamento.
 */
const SEGUNDOS_DE_TESTE = 2;

/** Intensidade usada no teste. Ver REDUCAO_MAXIMA_DB em limpeza.ts. */
const INTENSIDADE_DE_TESTE = 60;

/**
 * Ruido branco deterministico.
 *
 * Deterministico para o resultado do teste nao variar de uma execucao para
 * outra. Amplitude 0,1 (cerca de -25 dBFS eficaz): alto o bastante para medir
 * a reducao, baixo o bastante para nao saturar.
 */
function ruidoDeTeste(dados: Float32Array): void {
  let semente = 12345;
  for (let i = 0; i < dados.length; i++) {
    semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
    dados[i] = ((semente / 2 ** 32) * 2 - 1) * 0.1;
  }
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

/**
 * Prova, com audio de verdade, que o DeepFilterNet3 funciona nesta maquina.
 *
 * Roda o modelo num OfflineAudioContext — renderiza o mais rapido que o
 * processador consegue, sem tocar nada e sem microfone — sobre ruido branco,
 * e mede duas coisas:
 *
 *   REDUCAO   o ruido saiu mais baixo do que entrou? Pega o modelo quebrado
 *             que so repassa o som (0 dB) e a saida morta (silencio).
 *
 *   TEMPO     quanto do tempo real o modelo gastou? Pega o processador fraco
 *             demais, que picotaria a voz numa chamada de verdade.
 *
 * Mede-se a SEGUNDA metade do audio: a primeira inclui a latencia do modelo,
 * em que a saida ainda e silencio por construcao.
 *
 * Tambem pega, de graca, tudo que impediria o motor de rodar: arquivos
 * ausentes, protocolo nao registrado, politica de seguranca bloqueando o
 * worklet, WASM incompativel com o pacote.
 */
async function rodarAutoteste(): Promise<ResultadoDoAutoteste> {
  if (!limpezaDisponivel() || typeof OfflineAudioContext !== 'function') {
    return { ok: false, motivo: 'este aparelho nao tem AudioWorklet ou WebAssembly' };
  }

  const total = Math.round(TAXA * SEGUNDOS_DE_TESTE);
  const contexto = new OfflineAudioContext(1, total, TAXA);
  const nucleo = new DeepFilterNet3Core({
    sampleRate: TAXA,
    noiseReductionLevel: INTENSIDADE_DE_TESTE,
    assetConfig: { cdnUrl: BASE_DOS_ARQUIVOS },
  });

  try {
    try {
      await nucleo.initialize();
    } catch (erro) {
      return {
        ok: false,
        motivo: `nao consegui carregar os arquivos do modelo (${mensagemDe(erro)}). Rode "npm run modelos" antes de gerar o instalador.`,
      };
    }

    // O pacote tipa o parametro como AudioContext, mas so usa `audioWorklet`
    // e o construtor de AudioWorkletNode, que o contexto offline tambem tem.
    const no = await nucleo.createAudioWorkletNode(contexto as unknown as AudioContext);

    const entrada = contexto.createBuffer(1, total, TAXA);
    const dados = entrada.getChannelData(0);
    ruidoDeTeste(dados);

    const fonte = contexto.createBufferSource();
    fonte.buffer = entrada;
    fonte.connect(no);
    no.connect(contexto.destination);
    fonte.start();

    const inicio = performance.now();
    const saida = await contexto.startRendering();
    const msGastos = performance.now() - inicio;

    const metade = Math.floor(total / 2);
    return avaliarAutoteste({
      rmsEntrada: rms(dados, metade),
      rmsSaida: rms(saida.getChannelData(0), metade),
      msGastos,
      segundosDeAudio: SEGUNDOS_DE_TESTE,
    });
  } catch (erro) {
    return { ok: false, motivo: `o modelo nao rodou (${mensagemDe(erro)})` };
  } finally {
    nucleo.destroy();
  }
}

/**
 * Resultado do autoteste, medido UMA vez por execucao do aplicativo.
 *
 * O processador da maquina nao muda durante o uso, e refazer o teste a cada
 * entrada em chamada atrasaria justamente o momento em que a pessoa quer
 * falar. Para refazer (depois de rodar `npm run modelos`, por exemplo), basta
 * reabrir o aplicativo.
 */
let verificacao: Promise<ResultadoDoAutoteste> | null = null;

export function verificarDeepFilter(): Promise<ResultadoDoAutoteste> {
  verificacao ??= rodarAutoteste().then((resultado) => {
    if (resultado.ok) {
      console.info(
        `[limpeza] DeepFilterNet3 aprovado: ${resultado.reducaoDb.toFixed(1)} dB de reducao, ` +
          `${Math.round(resultado.fracaoDoTempoReal * 100)}% do tempo real`,
      );
    } else {
      console.warn(`[limpeza] DeepFilterNet3 reprovado: ${resultado.motivo}`);
    }
    return resultado;
  });
  return verificacao;
}

/**
 * O processador que o LiveKit pluga na faixa do microfone.
 *
 * Cada instancia monta o proprio nucleo e le os arquivos de novo do disco.
 * Sao ~8 MB lidos localmente e compilados em milissegundos; guardar entre
 * republicacoes exigiria mexer nas entranhas do pacote, e nao compensa.
 */
export class LimpezaDeepFilter extends ProcessadorBase {
  readonly name = 'kiroshi-deepfilternet3';
  readonly motor = 'deepfilternet3' as const;
  private nucleo: DeepFilterNet3Core | null = null;

  protected async criarModelo(contexto: AudioContext): Promise<AudioNode> {
    const nucleo = new DeepFilterNet3Core({
      sampleRate: TAXA,
      noiseReductionLevel: intensidadeValida(this.opcoes.intensidade),
      assetConfig: { cdnUrl: BASE_DOS_ARQUIVOS },
    });
    await nucleo.initialize();
    const no = await nucleo.createAudioWorkletNode(contexto);
    this.nucleo = nucleo;
    return no;
  }

  protected liberarModelo(): void {
    // A memoria do modelo mora no thread de audio e so volta quando o
    // AudioContext fecha — o que a base faz logo depois disto.
    this.nucleo?.destroy();
    this.nucleo = null;
  }

  protected override aplicarIntensidade(valor: number): void {
    this.nucleo?.setSuppressionLevel(intensidadeValida(valor));
  }
}

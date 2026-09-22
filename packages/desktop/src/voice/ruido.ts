import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

/**
 * Limpeza de ruido do microfone com RNNoise.
 *
 * POR QUE EXISTE, e nao e capricho: medimos nas maquinas do grupo que o
 * navegador ja entrega tudo que tem — `noiseSuppression`, `echoCancellation`,
 * `autoGainControl` e `voiceIsolation`, os quatro ligados e confirmados por
 * `getSettings()`. E ainda assim da para ouvir teclado.
 *
 * A razao e o tipo de ruido. O supressor do WebRTC estima um piso de ruido e o
 * subtrai: funciona para som CONSTANTE — ventilador, chiado, ar-condicionado —
 * e falha em som que aparece e some, porque quando ele percebe o teclado a
 * tecla ja foi. RNNoise e uma rede neural treinada para reconhecer VOZ: ela
 * nao estima piso nenhum, decide quadro a quadro o que e fala e descarta o
 * resto.
 *
 * ONDE ENTRA, e por que nao pode ser em outro lugar: antes do Opus. Depois da
 * compressao as amostras individuais ja foram jogadas fora e nao ha o que
 * limpar — um processador de quadros codificados nao consegue fazer isto, por
 * mais bem escrito que seja.
 *
 * A cadeia:
 *
 *   faixa do microfone -> MediaStreamSource -> RnnoiseWorklet -> faixa limpa
 *
 * NUNCA DOIS SUPRESSORES. Quem liga este tem que desligar o do navegador: os
 * modelos sao treinados em audio cru, e alimentar um com a saida do outro da
 * voz robotica e gasta processador duas vezes. Quem cuida disso e o
 * controlador, ao montar as restricoes de captura.
 */

/**
 * RNNoise trabalha em 48 kHz. Nao e preferencia: o modelo foi treinado nessa
 * taxa e em outra ele processa a frequencia errada, o que soa como voz
 * afinada para cima ou para baixo.
 */
const TAXA = 48000;

/**
 * O binario e carregado UMA vez por execucao do aplicativo.
 *
 * Sao 152 KB que nao mudam. Recarregar a cada vez que o microfone e
 * republicado — trocar de aparelho de entrada, voltar de uma queda — custaria
 * tempo no pior momento, que e justamente quando a pessoa quer voltar a falar.
 */
let binario: Promise<ArrayBuffer> | null = null;

function carregarBinario(): Promise<ArrayBuffer> {
  binario ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  return binario;
}

/** Contextos que ja receberam o modulo do worklet; `addModule` de novo e desperdicio. */
const comModulo = new WeakSet<AudioContext>();

async function garantirModulo(contexto: AudioContext): Promise<void> {
  if (comModulo.has(contexto)) return;
  await contexto.audioWorklet.addModule(rnnoiseWorkletUrl);
  comModulo.add(contexto);
}

/**
 * O processador que o LiveKit pluga na faixa local.
 *
 * Monta o proprio contexto de audio em vez de usar o que o LiveKit oferece:
 * o dele pode estar em outra taxa de amostragem, e RNNoise em taxa errada
 * nao e "um pouco pior", e voz desafinada.
 */
export class LimpezaDeRuido implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'rnnoise';

  processedTrack?: MediaStreamTrack;

  private contexto: AudioContext | null = null;
  private origem: MediaStreamAudioSourceNode | null = null;
  private no: RnnoiseWorkletNode | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;

  async init(opcoes: AudioProcessorOptions): Promise<void> {
    await this.montar(opcoes.track);
  }

  /** Trocar de microfone sem sair da chamada passa por aqui. */
  async restart(opcoes: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.montar(opcoes.track);
  }

  async destroy(): Promise<void> {
    try {
      this.no?.destroy();
      this.origem?.disconnect();
      this.no?.disconnect();
      this.destino?.disconnect();
    } catch {
      // Ja desfeito.
    }

    const contexto = this.contexto;
    this.no = null;
    this.origem = null;
    this.destino = null;
    this.contexto = null;
    this.processedTrack = undefined;

    if (contexto) await contexto.close().catch(() => undefined);
  }

  private async montar(faixa: MediaStreamTrack): Promise<void> {
    const contexto = new AudioContext({ sampleRate: TAXA });
    this.contexto = contexto;

    const [wasmBinary] = await Promise.all([carregarBinario(), garantirModulo(contexto)]);

    /*
      Um canal so.

      Voz de microfone e mono, e pedir dois faria o modelo rodar duas vezes
      sobre o mesmo sinal — o dobro do processador para o mesmo resultado.
    */
    const no = new RnnoiseWorkletNode(contexto, { maxChannels: 1, wasmBinary });
    const origem = contexto.createMediaStreamSource(new MediaStream([faixa]));
    const destino = contexto.createMediaStreamDestination();

    origem.connect(no);
    no.connect(destino);

    this.no = no;
    this.origem = origem;
    this.destino = destino;
    this.processedTrack = destino.stream.getAudioTracks()[0];
  }
}

/**
 * O aparelho aguenta rodar isto?
 *
 * Checa o que e verificavel antes de tentar: sem AudioWorklet ou sem
 * WebAssembly nao ha o que fazer, e e melhor nao oferecer a opcao do que
 * oferecer uma que falha calada.
 */
export function limpezaDisponivel(): boolean {
  return typeof AudioWorkletNode === 'function' && typeof WebAssembly === 'object';
}

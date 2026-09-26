import { NoiseGateWorkletNode } from '@sapphi-red/web-noise-suppressor';
import portaoWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import type { AudioProcessorOptions, LocalAudioTrack, Track, TrackProcessor } from 'livekit-client';
import type { MotorDeLimpeza } from './limpeza.js';
import monoWorkletUrl from './mono.worklet.js?url';

/**
 * A cadeia de audio do microfone depois da captura:
 *
 *   microfone -> MediaStreamSource -> MONO -> [PORTAO] -> faixa mono que vai para a chamada
 *
 * MONO junta os canais do microfone num so (`mono.worklet.js`). Sem ele, voz
 * de headset numa entrada estereo saia de UM lado do fone de todo mundo (pedido
 * do dono em 2026-09-26): com o cancelamento de eco desligado o Chromium
 * entrega os dois canais crus, e o servidor de voz negocia Opus estereo. A
 * faixa que sai e mono; o Opus a manda igual para os dois lados.
 *
 * O PORTAO fecha o microfone no silencio, no modo "por atividade de voz".
 * Antes dele esse modo transmitia o tempo todo: o ajuste de limiar existia nas
 * configuracoes mas nao era lido em lugar nenhum.
 *
 * Aqui morava tambem a limpeza por modelo (DeepFilterNet3 e GTCRN), retirada
 * na 2.0.2 para ser refeita do zero (backlog F3). A supressao de ruido, ate
 * la, e a do navegador, pedida na captura.
 *
 * ONDE ENTRA: antes do Opus. Depois da compressao as amostras ja foram
 * jogadas fora e nao ha o que tratar.
 *
 * 48 kHz, a taxa do Opus: a cadeia monta o proprio AudioContext em vez de
 * usar o que o LiveKit oferece, cuja taxa depende da placa de som.
 */
export const TAXA = 48000;

/** O que o controlador de voz enxerga da cadeia. */
export interface ProcessadorDeLimpeza
  extends TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly motor: MotorDeLimpeza;
  /** Liga, desliga ou muda o limiar do portao, ao vivo. `null` = sem portao. */
  definirPortao(limiarDb: number | null): Promise<void>;
  /**
   * O som ANTES do portao — o que o portao compara com o limiar. Para o
   * medidor do teste de microfone: medir depois do portao mostrava zero em
   * tudo abaixo do limiar, e o limiar nao tinha como ser calibrado no olho.
   */
  medidorAntesDoPortao?(): AnalyserNode | null;
}

export interface OpcoesDoProcessador {
  limiarDoPortaoDb: number | null;
}

/**
 * Histerese do portao: fecha 6 dB abaixo de onde abre.
 *
 * Com um limiar so, voz perto do limite faz o portao abrir e fechar dezenas
 * de vezes por segundo, e o que chega do outro lado e uma voz picotada.
 */
const HISTERESE_DB = 6;

/**
 * Quanto tempo o portao espera no silencio antes de fechar.
 *
 * Fim de palavra e mais baixo que o comeco: sem espera, o portao come o
 * final das frases ("obrigad-").
 */
const ESPERA_MS = 300;

/** Contextos que ja receberam cada modulo de worklet. `addModule` de novo e desperdicio. */
const modulosCarregados = new WeakMap<BaseAudioContext, Set<string>>();

export async function garantirModulo(contexto: BaseAudioContext, url: string): Promise<void> {
  let carregados = modulosCarregados.get(contexto);
  if (!carregados) {
    carregados = new Set();
    modulosCarregados.set(contexto, carregados);
  }
  if (carregados.has(url)) return;
  await contexto.audioWorklet.addModule(url);
  carregados.add(url);
}

/**
 * Contexto de audio que so existe para satisfazer uma checagem do LiveKit.
 *
 * `LocalAudioTrack.setProcessor` recusa rodar se a faixa nao tiver um
 * AudioContext: "Audio context needs to be set on LocalAudioTrack in order to
 * enable processors". Quem da esse contexto a faixa e a SALA, dentro de
 * `publishTrack`. Uma faixa criada com `createLocalAudioTrack` e ainda nao
 * publicada nao tem nenhum.
 *
 * O controlador aplica o processador ANTES de publicar (de proposito, para
 * nao haver corte audivel no meio da chamada). Sem este contexto,
 * `setProcessor` falhava em TODAS as maquinas — foi o bug que deixou o
 * teclado passar por varias versoes.
 *
 * O contexto entregue aqui nao processa nada: e suspenso logo ao nascer e
 * nao gasta processador. A cadeia monta o proprio contexto a 48 kHz. Ao
 * publicar, a sala troca este pelo dela, como sempre fez.
 */
let referencia: AudioContext | null = null;

export function prepararFaixaParaProcessador(faixa: LocalAudioTrack): void {
  if (!referencia || referencia.state === 'closed') {
    referencia = new AudioContext({ sampleRate: TAXA });
    void referencia.suspend().catch(() => undefined);
  }
  faixa.setAudioContext(referencia);
}

/**
 * O no que junta os canais do microfone num so.
 *
 * Sem o worklet (nao deveria acontecer no Electron), a media simples dos
 * canais pelo proprio Web Audio: a voz de um lado so sai 6 dB mais baixa, mas
 * sai dos dois lados do fone.
 */
async function criarMono(contexto: AudioContext): Promise<AudioNode> {
  try {
    await garantirModulo(contexto, monoWorkletUrl);
    return new AudioWorkletNode(contexto, 'kiroshi-mono-do-microfone', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Recebe quantos canais o microfone tiver, sem misturar nada antes.
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
    });
  } catch (erro) {
    console.warn('[microfone] sem o mono do worklet, usando a media dos canais', erro);
    const media = contexto.createGain();
    media.channelCount = 1;
    media.channelCountMode = 'explicit';
    media.channelInterpretation = 'speakers';
    return media;
  }
}

/**
 * A cadeia do portao: contexto, entrada, portao, saida.
 *
 * O no do meio e um GainNode que so repassa: e nele que o portao e o medidor
 * se penduram, e e ele que continua no lugar quando o portao e trocado.
 */
export class ApenasPortao implements ProcessadorDeLimpeza {
  readonly name = 'kiroshi-portao';
  readonly motor: MotorDeLimpeza;

  processedTrack?: MediaStreamTrack;

  private contexto: AudioContext | null = null;
  private origem: MediaStreamAudioSourceNode | null = null;
  private mono: AudioNode | null = null;
  private meio: GainNode | null = null;
  private portao: AudioWorkletNode | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;
  /** Derivacao so de leitura antes do portao: nao muda nada no que sai. */
  private medidor: AnalyserNode | null = null;

  constructor(
    private readonly opcoes: OpcoesDoProcessador,
    motor: MotorDeLimpeza,
  ) {
    this.motor = motor;
  }

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
      this.origem?.disconnect();
      this.mono?.disconnect();
      this.meio?.disconnect();
      this.portao?.disconnect();
      this.destino?.disconnect();
      this.medidor?.disconnect();
    } catch {
      // Ja desfeito.
    }

    const contexto = this.contexto;
    this.contexto = null;
    this.origem = null;
    this.mono = null;
    this.meio = null;
    this.portao = null;
    this.destino = null;
    this.medidor = null;
    this.processedTrack = undefined;

    if (contexto) await contexto.close().catch(() => undefined);
  }

  medidorAntesDoPortao(): AnalyserNode | null {
    return this.medidor;
  }

  /**
   * Refaz so a ponta final da cadeia.
   *
   * O portao do `@sapphi-red/web-noise-suppressor` nao aceita mudar limiar
   * depois de criado. Trocar o no inteiro e barato e acontece sem reabrir o
   * microfone.
   */
  async definirPortao(limiarDb: number | null): Promise<void> {
    this.opcoes.limiarDoPortaoDb = limiarDb;
    if (this.contexto) await this.ligarSaida(this.contexto);
  }

  private async montar(faixa: MediaStreamTrack): Promise<void> {
    const contexto = new AudioContext({ sampleRate: TAXA });
    this.contexto = contexto;

    try {
      const origem = contexto.createMediaStreamSource(new MediaStream([faixa]));
      const mono = await criarMono(contexto);
      const meio = contexto.createGain();
      const destino = contexto.createMediaStreamDestination();
      // A faixa que vai para a chamada tem UM canal: o que o fone de quem ouve
      // recebe dos dois lados. (O padrao do no e 2.)
      destino.channelCount = 1;
      origem.connect(mono);
      mono.connect(meio);

      this.origem = origem;
      this.mono = mono;
      this.meio = meio;
      this.destino = destino;
      this.medidor = contexto.createAnalyser();
      this.medidor.fftSize = 1024;

      await this.ligarSaida(contexto);
      this.processedTrack = destino.stream.getAudioTracks()[0];
    } catch (erro) {
      // Nada pela metade: quem chamou segue sem a cadeia.
      await this.destroy();
      throw erro;
    }
  }

  private async ligarSaida(contexto: AudioContext): Promise<void> {
    const meio = this.meio;
    const destino = this.destino;
    if (!meio || !destino) return;

    const limiar = this.opcoes.limiarDoPortaoDb;
    let novoPortao: AudioWorkletNode | null = null;

    if (limiar !== null) {
      await garantirModulo(contexto, portaoWorkletUrl);
      novoPortao = new NoiseGateWorkletNode(contexto, {
        openThreshold: limiar,
        closeThreshold: limiar - HISTERESE_DB,
        holdMs: ESPERA_MS,
        // So olha e so passa o canal 0: certo porque a entrada ja vem mono (MONO).
        // Antes do MONO, era isto que deixava a voz estereo num lado so.
        maxChannels: 1,
      });
    }

    // So troca depois de o novo existir: um erro acima deixa a cadeia antiga
    // funcionando, em vez de um microfone mudo.
    meio.disconnect();
    this.portao?.disconnect();

    if (novoPortao) {
      meio.connect(novoPortao);
      novoPortao.connect(destino);
    } else {
      meio.connect(destino);
    }
    // O disconnect acima solta tambem o medidor: religa.
    if (this.medidor) meio.connect(this.medidor);
    this.portao = novoPortao;
  }
}

export function portaoDisponivel(): boolean {
  return typeof AudioWorkletNode === 'function';
}

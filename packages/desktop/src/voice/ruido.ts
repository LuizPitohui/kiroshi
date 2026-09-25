import { GtcrnWorkletNode, NoiseGateWorkletNode } from '@sapphi-red/web-noise-suppressor';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';
import portaoWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import { Track } from 'livekit-client';
import type { AudioProcessorOptions, LocalAudioTrack, TrackProcessor } from 'livekit-client';
import type { MotorDeLimpeza } from './limpeza.js';

/**
 * A cadeia de audio da limpeza de ruido, e o que ela tem em comum entre os
 * motores.
 *
 *   microfone -> MediaStreamSource -> MODELO -> [PORTAO] -> faixa limpa
 *
 * O MODELO muda conforme o motor:
 *
 *   DeepFilterNet3   o principal. Em `ruido-dfn3.ts`.
 *   GTCRN            reserva, para maquina onde o DFN3 nao roda. Aqui.
 *   (nenhum)         `ApenasPortao`: um GainNode que so repassa, para o
 *                    portao existir mesmo sem modelo.
 *
 * O PORTAO fecha o microfone no silencio. Antes dele o modo "por atividade de
 * voz" transmitia o tempo todo: o ajuste de limiar existia nas configuracoes
 * mas nao era lido em lugar nenhum.
 *
 * ONDE ENTRA: antes do Opus. Depois da compressao as amostras ja foram
 * jogadas fora e nao ha o que limpar.
 *
 * 48 kHz SEMPRE. Os dois modelos foram treinados nessa taxa. Em outra, o
 * modelo processa a frequencia errada, e o resultado nao e "um pouco pior": e
 * voz desafinada. Por isso cada processador monta o proprio AudioContext em
 * vez de usar o que o LiveKit oferece, cuja taxa depende da placa de som.
 */
export const TAXA = 48000;

/** O que o controlador de voz enxerga de qualquer motor. */
export interface ProcessadorDeLimpeza
  extends TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly motor: MotorDeLimpeza;
  /** 0 a 100. Ao vivo, sem reabrir o microfone. So o DFN3 usa. */
  definirIntensidade(valor: number): void;
  /** Liga, desliga ou muda o limiar do portao, ao vivo. `null` = sem portao. */
  definirPortao(limiarDb: number | null): Promise<void>;
  /**
   * O som depois da limpeza e ANTES do portao — o que o portao compara com o
   * limiar. Para o medidor do teste de microfone: medir depois do portao
   * mostrava zero em tudo abaixo do limiar, e o limiar nao tinha como ser
   * calibrado no olho.
   */
  medidorAntesDoPortao?(): AnalyserNode | null;
}

export interface OpcoesDoProcessador {
  limiarDoPortaoDb: number | null;
  intensidade: number;
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
 * Le um binario empacotado sem depender so de `fetch`.
 *
 * O aplicativo instalado abre a interface por `file://`, e o Chromium pode
 * recusar `fetch` nesse esquema. XHR continua funcionando la, entao e a
 * segunda tentativa. Se as duas falharem, o erro sobe com a URL — erro
 * engolido foi exatamente o que escondeu a falta de limpeza por varias
 * versoes.
 */
export async function lerBinario(url: string): Promise<ArrayBuffer> {
  try {
    const resposta = await fetch(url);
    if (resposta.ok) return await resposta.arrayBuffer();
  } catch {
    // Cai para o XHR.
  }
  return await new Promise<ArrayBuffer>((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () =>
      xhr.response instanceof ArrayBuffer && xhr.response.byteLength > 0
        ? resolver(xhr.response)
        : rejeitar(new Error(`binario vazio: ${url}`));
    xhr.onerror = () => rejeitar(new Error(`nao consegui ler ${url}`));
    xhr.send();
  });
}

/**
 * Contexto de audio que so existe para satisfazer uma checagem do LiveKit.
 *
 * ESTA FUNCAO E O CONSERTO DO BUG QUE DEIXAVA O TECLADO PASSAR.
 *
 * `LocalAudioTrack.setProcessor` recusa rodar se a faixa nao tiver um
 * AudioContext: "Audio context needs to be set on LocalAudioTrack in order to
 * enable processors". Quem da esse contexto a faixa e a SALA, dentro de
 * `publishTrack`. Uma faixa criada com `createLocalAudioTrack` e ainda nao
 * publicada nao tem nenhum.
 *
 * O controlador aplicava o processador ANTES de publicar (de proposito, para
 * nao haver corte audivel no meio da chamada). Resultado: `setProcessor`
 * falhava em TODAS as maquinas, o erro ia para um `console.warn`, e como a
 * supressao do navegador ja tinha sido desligada para "dar lugar ao modelo",
 * o microfone saia cru — sem limpeza nenhuma.
 *
 * O contexto entregue aqui nao processa nada: e suspenso logo ao nascer e
 * nao gasta processador. Nossos processadores montam o proprio contexto a
 * 48 kHz. Ao publicar, a sala troca este pelo dela, como sempre fez.
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
 * A parte comum a todos os motores: contexto, entrada, portao, saida.
 *
 * Cada motor so diz como criar e desfazer o proprio no de modelo.
 */
export abstract class ProcessadorBase implements ProcessadorDeLimpeza {
  abstract readonly name: string;
  abstract readonly motor: MotorDeLimpeza;

  processedTrack?: MediaStreamTrack;

  protected contexto: AudioContext | null = null;
  private origem: MediaStreamAudioSourceNode | null = null;
  private saidaDoModelo: AudioNode | null = null;
  private portao: AudioWorkletNode | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;
  /** Derivacao so de leitura na saida do modelo: nao muda nada no que sai. */
  private medidor: AnalyserNode | null = null;

  constructor(protected readonly opcoes: OpcoesDoProcessador) {}

  /** Cria o no do modelo dentro do contexto. Pode lancar: a cascata trata. */
  protected abstract criarModelo(contexto: AudioContext): Promise<AudioNode>;

  /** Libera o que o modelo segura (memoria do WASM, por exemplo). */
  protected abstract liberarModelo(): void;

  /** Aplica a intensidade no modelo ja montado. Padrao: nao ha o que fazer. */
  protected aplicarIntensidade(_valor: number): void {}

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
      this.saidaDoModelo?.disconnect();
      this.portao?.disconnect();
      this.destino?.disconnect();
      this.medidor?.disconnect();
    } catch {
      // Ja desfeito.
    }
    try {
      this.liberarModelo();
    } catch {
      // Ja liberado.
    }

    const contexto = this.contexto;
    this.contexto = null;
    this.origem = null;
    this.saidaDoModelo = null;
    this.portao = null;
    this.destino = null;
    this.medidor = null;
    this.processedTrack = undefined;

    if (contexto) await contexto.close().catch(() => undefined);
  }

  definirIntensidade(valor: number): void {
    this.opcoes.intensidade = valor;
    this.aplicarIntensidade(valor);
  }

  medidorAntesDoPortao(): AnalyserNode | null {
    return this.medidor;
  }

  /**
   * Refaz so a ponta final da cadeia.
   *
   * O portao do `@sapphi-red/web-noise-suppressor` nao aceita mudar limiar
   * depois de criado. Trocar o no inteiro e barato — o modelo, que e o caro,
   * continua onde esta — e acontece sem reabrir o microfone.
   */
  async definirPortao(limiarDb: number | null): Promise<void> {
    this.opcoes.limiarDoPortaoDb = limiarDb;
    if (this.contexto) await this.ligarSaida(this.contexto);
  }

  private async montar(faixa: MediaStreamTrack): Promise<void> {
    const contexto = new AudioContext({ sampleRate: TAXA });
    this.contexto = contexto;

    try {
      const modelo = await this.criarModelo(contexto);
      const origem = contexto.createMediaStreamSource(new MediaStream([faixa]));
      const destino = contexto.createMediaStreamDestination();
      origem.connect(modelo);

      this.origem = origem;
      this.saidaDoModelo = modelo;
      this.destino = destino;
      this.medidor = contexto.createAnalyser();
      this.medidor.fftSize = 1024;

      await this.ligarSaida(contexto);
      this.processedTrack = destino.stream.getAudioTracks()[0];
    } catch (erro) {
      // Nada pela metade: a cascata vai tentar o proximo motor.
      await this.destroy();
      throw erro;
    }
  }

  private async ligarSaida(contexto: AudioContext): Promise<void> {
    const modelo = this.saidaDoModelo;
    const destino = this.destino;
    if (!modelo || !destino) return;

    const limiar = this.opcoes.limiarDoPortaoDb;
    let novoPortao: AudioWorkletNode | null = null;

    if (limiar !== null) {
      await garantirModulo(contexto, portaoWorkletUrl);
      novoPortao = new NoiseGateWorkletNode(contexto, {
        openThreshold: limiar,
        closeThreshold: limiar - HISTERESE_DB,
        holdMs: ESPERA_MS,
        maxChannels: 1,
      });
    }

    // So troca depois de o novo existir: um erro acima deixa a cadeia antiga
    // funcionando, em vez de um microfone mudo.
    modelo.disconnect();
    this.portao?.disconnect();

    if (novoPortao) {
      modelo.connect(novoPortao);
      novoPortao.connect(destino);
    } else {
      modelo.connect(destino);
    }
    // O disconnect acima solta tambem o medidor: religa.
    if (this.medidor) modelo.connect(this.medidor);
    this.portao = novoPortao;
  }
}

// ---------------------------------------------------------------------------
// GTCRN: a reserva
// ---------------------------------------------------------------------------

/**
 * O binario do GTCRN e carregado UMA vez por execucao do aplicativo.
 *
 * Sao ~190 KB que nao mudam. Recarregar a cada republicacao do microfone
 * custaria tempo no pior momento: quando a pessoa quer voltar a falar.
 */
let binarioGtcrn: Promise<ArrayBuffer> | null = null;

function carregarGtcrn(): Promise<ArrayBuffer> {
  binarioGtcrn ??= lerBinario(gtcrnWasmUrl).catch((erro: unknown) => {
    binarioGtcrn = null; // deixa tentar de novo na proxima entrada
    throw erro;
  });
  return binarioGtcrn;
}

/**
 * GTCRN: modelo pequeno, da mesma biblioteca que ja estava no projeto.
 *
 * Entra quando o DeepFilterNet3 nao passa no autoteste — processador fraco
 * ou arquivos do modelo ausentes. E bem mais leve e bem melhor que o RNNoise
 * que o Kiroshi usava antes, mas deixa passar mais teclado que o DFN3.
 *
 * Nao tem controle de intensidade: `definirIntensidade` nao faz nada aqui.
 */
export class LimpezaGtcrn extends ProcessadorBase {
  readonly name = 'kiroshi-gtcrn';
  readonly motor = 'gtcrn' as const;
  private no: GtcrnWorkletNode | null = null;

  protected async criarModelo(contexto: AudioContext): Promise<AudioNode> {
    const [wasmBinary] = await Promise.all([
      carregarGtcrn(),
      garantirModulo(contexto, gtcrnWorkletUrl),
    ]);
    // Um canal: voz de microfone e mono, e dois fariam o modelo rodar duas
    // vezes sobre o mesmo sinal.
    this.no = new GtcrnWorkletNode(contexto, { maxChannels: 1, wasmBinary });
    return this.no;
  }

  protected liberarModelo(): void {
    this.no?.destroy();
    this.no = null;
  }
}

// ---------------------------------------------------------------------------
// Sem modelo, so portao
// ---------------------------------------------------------------------------

/**
 * Cadeia sem modelo: o "modelo" e um GainNode que so repassa.
 *
 * Existe para o portao continuar funcionando quando a limpeza por modelo esta
 * desligada (perfil "Estudio") ou nao roda na maquina. Sem ele, desligar o
 * modelo tambem desligaria, calado, a deteccao de voz.
 */
export class ApenasPortao extends ProcessadorBase {
  readonly name = 'kiroshi-portao';
  readonly motor: MotorDeLimpeza;

  constructor(opcoes: OpcoesDoProcessador, motor: 'navegador' | 'nenhum') {
    super(opcoes);
    this.motor = motor;
  }

  protected async criarModelo(contexto: AudioContext): Promise<AudioNode> {
    return contexto.createGain();
  }

  protected liberarModelo(): void {}
}

/**
 * O aparelho aguenta rodar modelo?
 *
 * Sem AudioWorklet ou sem WebAssembly nao ha o que fazer, e e melhor nao
 * tentar do que tentar e falhar no meio da entrada na chamada.
 */
export function limpezaDisponivel(): boolean {
  return typeof AudioWorkletNode === 'function' && typeof WebAssembly === 'object';
}

export function portaoDisponivel(): boolean {
  return typeof AudioWorkletNode === 'function';
}

/**
 * O microfone em UM canal, antes do portao — sem perder volume quando a voz
 * vem de um lado so.
 *
 * Por que existe (pedido do dono em 2026-09-26: "as pessoas so escutam minha
 * voz de um lado do fone"). Microfone de headset (mono) ligado na entrada da
 * placa-mae, que e estereo, chega com a voz num canal e silencio no outro. Com
 * o cancelamento de eco desligado, o Chromium entrega os dois canais crus
 * (pedir `channelCount: 1` nao muda nada), o servidor de voz negocia Opus
 * estereo, e o lado vazio chegava intacto ao fone de quem ouve. O portao ainda
 * piorava: so olhava e so passava o canal 0.
 *
 * A media simples dos canais resolveria o lado, mas deixaria a voz de um lado
 * so 6 dB mais baixa. Aqui cada canal CONTA se tiver energia perto da do mais
 * forte, e a saida e a media so dos que contam:
 *
 *   voz so no esquerdo (ou so no direito)  -> esse canal inteiro
 *   a mesma voz nos dois (estereo de verdade) -> a media, que e a propria voz
 *   um canal 10 dB abaixo do outro          -> a media dos dois (histerese)
 *
 * A decisao usa a energia media (~130 ms) e so anda quando ha som acima de
 * -80 dBFS: o silencio entre as frases nao muda nada. Pesos mudam em rampa de
 * ~20 ms, sem estalo. Arquivo JS puro e sem import: o AudioWorklet carrega
 * este arquivo como esta (`?url`), fora do empacotador.
 */

/** Energia (nao amplitude): 10^(dB/10). */
const deDb = (db) => 10 ** (db / 10);

/** Um canal que conta para de contar abaixo disto em relacao ao mais forte. */
export const SAI_DB = -15;
/** Um canal que nao conta volta a contar acima disto (histerese de 6 dB). */
export const ENTRA_DB = -9;
/** Abaixo disto o bloco e silencio e nao muda a decisao. */
export const PISO_DB = -80;
/** Maximo de canais tratados (arranjo de microfones de notebook chega a 4). */
const MAX_CANAIS = 8;

const SAI = deDb(SAI_DB);
const ENTRA = deDb(ENTRA_DB);
const PISO = deDb(PISO_DB);
/** Media exponencial por bloco de 128 amostras: ~130 ms a 48 kHz. */
const ALFA = 0.02;
/** Constante de tempo da rampa dos pesos, em segundos. */
const RAMPA_S = 0.02;

export class MonoDoMicrofone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.canais = 0;
    this.energia = new Float64Array(MAX_CANAIS);
    this.bloco = new Float64Array(MAX_CANAIS);
    this.peso = new Float64Array(MAX_CANAIS);
    this.ativo = new Uint8Array(MAX_CANAIS);
    this.passo = 1 - Math.exp(-1 / (RAMPA_S * sampleRate));
  }

  /** Canal novo (outro microfone): comeca da media de todos. */
  recomecar(n) {
    this.canais = n;
    this.energia.fill(0);
    this.ativo.fill(0);
    this.peso.fill(0);
    for (let c = 0; c < n; c++) {
      this.ativo[c] = 1;
      this.peso[c] = 1 / n;
    }
  }

  process(inputs, outputs) {
    const saida = outputs[0] && outputs[0][0];
    if (!saida) return true;
    const entrada = inputs[0];
    const n = entrada ? Math.min(entrada.length, MAX_CANAIS) : 0;
    if (n === 0) {
      saida.fill(0);
      return true;
    }
    if (n === 1) {
      saida.set(entrada[0]);
      return true;
    }
    if (n !== this.canais) this.recomecar(n);

    let maiorNoBloco = 0;
    for (let c = 0; c < n; c++) {
      const x = entrada[c];
      let e = 0;
      for (let i = 0; i < x.length; i++) e += x[i] * x[i];
      e /= x.length;
      this.bloco[c] = e;
      if (e > maiorNoBloco) maiorNoBloco = e;
    }

    if (maiorNoBloco > PISO) {
      let maior = 0;
      for (let c = 0; c < n; c++) {
        this.energia[c] += ALFA * (this.bloco[c] - this.energia[c]);
        if (this.energia[c] > maior) maior = this.energia[c];
      }
      for (let c = 0; c < n; c++) {
        const razao = this.energia[c] / maior;
        if (this.ativo[c] && razao < SAI) this.ativo[c] = 0;
        else if (!this.ativo[c] && razao > ENTRA) this.ativo[c] = 1;
      }
    }

    // O mais forte tem razao 1 e sempre conta: nunca fica zero canal.
    let contam = 0;
    for (let c = 0; c < n; c++) contam += this.ativo[c];
    if (contam === 0) contam = 1;

    const passo = this.passo;
    for (let i = 0; i < saida.length; i++) {
      let s = 0;
      for (let c = 0; c < n; c++) {
        const alvo = this.ativo[c] ? 1 / contam : 0;
        this.peso[c] += (alvo - this.peso[c]) * passo;
        s += this.peso[c] * entrada[c][i];
      }
      saida[i] = s;
    }
    return true;
  }
}

registerProcessor('kiroshi-mono-do-microfone', MonoDoMicrofone);

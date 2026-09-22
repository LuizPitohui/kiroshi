/**
 * A cadeia de saida do audio da chamada.
 *
 * Existe por um defeito concreto: o controle de volume por pessoa vai ate
 * 200%, mas `HTMLAudioElement.volume` e LIMITADO A 1 pela especificacao —
 * atribuir 1.5 lanca `IndexSizeError`. O codigo antigo fazia
 * `Math.min(1, ...)`, o que evitava a excecao e escondia o problema: o
 * deslizante andava, mostrava "150%", e nao fazia nada acima de 100%.
 *
 * Para passar de 1 e preciso sair do elemento e entrar no Web Audio, onde
 * `GainNode.gain` aceita qualquer valor. Foi medido nesta versao do Electron:
 * o elemento recusa 1.5, o ganho aceita 2.
 *
 * A cadeia:
 *
 *   srcObject do <audio> -> MediaStreamSource -> Gain (por faixa)
 *                                              -> Compensacao -> Limitador
 *
 * O limitador e a compensacao sao compartilhados e trabalham em par. Sozinho,
 * o limitador so DESCE: segura o pico e nunca levanta o que chega baixo — foi
 * assim que a queixa "a voz esta baixa" sobreviveu ao conserto do controle por
 * pessoa. A compensacao levanta o conjunto, e o limitador — ULTIMO da fila —
 * apara o que passar do teto. A ordem inversa foi tentada e medida: o ganho
 * depois do limitador anula o limitador, e voz alta estourava 21.625 amostras.
 */

/**
 * Teto do ganho por faixa.
 *
 * Quatro, e nao dois, porque os dois controles se COMPOEM: volume geral a
 * 200% com a pessoa a 200% pede 4. Com o teto em 2 os dois juntos nao
 * passavam de um, e quem mexesse nos dois achava que o segundo nao fazia
 * nada — o mesmo tipo de mentira silenciosa que o `Math.min(1, ...)` fazia.
 *
 * Quem impede que isso vire distorcao e o limitador, nao o teto.
 */
export const GANHO_MAXIMO = 4;

/**
 * Ganho de compensacao depois do limitador.
 *
 * Um limitador sozinho so DESCE: ele segura o pico e nunca levanta o que esta
 * baixo. Era meio aparelho — a queixa "a voz esta baixa" continuava depois de
 * consertar o controle por pessoa, porque em 100% a cadeia estava em ganho
 * unitario e unitario nao ajuda quem ja chega baixo.
 *
 * Com a compensacao, a cadeia vira niveladora: levanta tudo, e o limitador
 * apara o que passar do teto.
 *
 * 1.4 (+3 dB), e nao 2 (+6 dB), e o numero saiu de medicao. A 2x a voz baixa
 * sobe mais — 0.237 contra 0.166 —, mas o preco e o controle de volume parar
 * de significar alguma coisa: para voz media, ir de 100% para 200% rendia
 * apenas +6%, porque tudo ja batia no limitador. A 1.4x o mesmo passo rende
 * +48%.
 *
 * O compromisso e deliberado: um pouco menos de levantada automatica em troca
 * de um controle que responde. Perder o controle foi exatamente a reclamacao
 * que trouxe a cadeia ate aqui.
 */
const COMPENSACAO = 1.4;

interface Faixa {
  origem: MediaStreamAudioSourceNode;
  ganho: GainNode;
}

export class SaidaDeAudio {
  private contexto: AudioContext | null = null;
  private limitador: DynamicsCompressorNode | null = null;
  private compensacao: GainNode | null = null;
  private readonly faixas = new Map<HTMLMediaElement, Faixa>();

  /**
   * Verdadeiro quando a cadeia esta de pe.
   *
   * Quem chama precisa saber: se o Web Audio nao subiu, o volume volta a ser
   * o do elemento, limitado a 100%. E melhor ouvir baixo do que nao ouvir.
   */
  get ativa(): boolean {
    return this.contexto !== null;
  }

  private garantirContexto(): AudioContext | null {
    if (this.contexto) {
      if (this.contexto.state === 'suspended') void this.contexto.resume();
      return this.contexto;
    }

    try {
      const ctx = new AudioContext();

      /*
        Limitador, nao compressor de mixagem.

        Joelho zero e razao alta: abaixo do limiar nao mexe em nada, acima
        segura firme. Ataque de 3 ms pega o pico antes de ele estourar;
        soltura de 250 ms evita o efeito de bombeamento que se ouve quando o
        ganho sobe e desce junto com cada silaba.
      */
      const limitador = ctx.createDynamicsCompressor();
      /*
        -6 dB, e nao -3.

        Medido com a compensacao ligada: a -3 o caso extremo — voz alta com o
        volume geral e o da pessoa nos dois maximos — ainda estourava 2.006
        amostras. A -6 nao estoura nenhuma, E levanta MAIS a voz baixa
        (0.148 contra 0.122), porque o limitador entra antes e a compensacao
        trabalha sobre um sinal ja nivelado. -9 levantaria ainda mais, mas
        achata a voz normal: 0.671 contra 0.759.
      */
      limitador.threshold.value = -6;
      limitador.knee.value = 0;
      limitador.ratio.value = 20;
      limitador.attack.value = 0.003;
      limitador.release.value = 0.25;
      /*
        A ordem importa, e a primeira versao errou: compensacao ANTES do
        limitador.

        Com ela depois, o limitador segurava o pico em 0.88 e a compensacao
        multiplicava por dois logo em seguida — 1.75, bem acima do teto de 1.
        Medido: voz alta a 100% estourava 21.625 amostras. Ganho depois do
        limitador simplesmente anula o limitador.

        Nesta ordem o limitador e a ULTIMA palavra: a compensacao levanta o
        sinal, e o que passar do teto ele apara. Quem chega baixo sobe; quem
        chega alto nao estoura.
      */
      const compensacao = ctx.createGain();
      compensacao.gain.value = COMPENSACAO;
      compensacao.connect(limitador);
      limitador.connect(ctx.destination);

      this.contexto = ctx;
      this.limitador = limitador;
      this.compensacao = compensacao;
      return ctx;
    } catch {
      // Sem saida de audio no sistema. Quem chama cai para o volume do
      // elemento.
      return null;
    }
  }

  /**
   * Liga um elemento na cadeia e devolve se conseguiu.
   *
   * PELO FLUXO, NAO PELO ELEMENTO. A primeira versao usava
   * `createMediaElementSource`, e isso NAO FUNCIONA com elemento alimentado
   * por `srcObject` — que e exatamente como o LiveKit entrega audio remoto.
   *
   * Medido: com `srcObject`, `createMediaElementSource` entrega nivel ZERO ao
   * grafo, enquanto `createMediaStreamSource` entrega 0.707 do mesmo sinal. A
   * cadeia inteira — ganho, compensacao, limitador — estava ligada no silencio,
   * e o elemento seguia tocando por fora em volume fixo. O sintoma para quem
   * usava: o volume nunca mudava, e zerar alguem continuava deixando a pessoa
   * audivel.
   */
  ligar(elemento: HTMLMediaElement): boolean {
    if (this.faixas.has(elemento)) return true;

    const fluxo = elemento.srcObject;
    if (!(fluxo instanceof MediaStream)) return false;

    const ctx = this.garantirContexto();
    if (!ctx || !this.compensacao) return false;

    try {
      const origem = ctx.createMediaStreamSource(fluxo);
      const ganho = ctx.createGain();
      origem.connect(ganho);
      // Entra na compensacao, nao no limitador: ele e o ultimo da fila.
      ganho.connect(this.compensacao);

      /*
        O elemento e silenciado, nao removido.

        Silenciado porque agora quem toca e o grafo: deixar os dois soando
        daria o som em dobro, um deles fora de qualquer controle de volume.

        Nao removido porque ele continua util — e o que satisfaz a politica de
        reproducao automatica do navegador e mantem o fluxo remoto vivo.
      */
      elemento.muted = true;
      this.faixas.set(elemento, { origem, ganho });
      return true;
    } catch {
      return false;
    }
  }

  /** Ajusta o volume de um elemento ja ligado. Ignora o que nao esta. */
  ajustar(elemento: HTMLMediaElement, volume: number): void {
    const faixa = this.faixas.get(elemento);
    if (!faixa) return;
    faixa.ganho.gain.value = Math.max(0, Math.min(GANHO_MAXIMO, volume));
  }

  /** Solta um elemento. Sem isto os nos ficam no grafo depois de a pessoa sair. */
  desligar(elemento: HTMLMediaElement): void {
    const faixa = this.faixas.get(elemento);
    if (!faixa) return;
    try {
      faixa.origem.disconnect();
      faixa.ganho.disconnect();
    } catch {
      // Ja desconectado.
    }
    // Devolve o som ao elemento: se a cadeia sair de cena, e ele quem toca.
    elemento.muted = false;
    this.faixas.delete(elemento);
  }

  /**
   * Manda o som para outro aparelho de saida.
   *
   * Quando o audio passa pelo Web Audio, `setSinkId` do ELEMENTO nao vale
   * mais — quem toca e o contexto. Trocar so no elemento faria o seletor de
   * dispositivo parecer quebrado.
   */
  async trocarSaida(deviceId: string): Promise<boolean> {
    const ctx = this.contexto;
    if (!ctx || typeof (ctx as { setSinkId?: unknown }).setSinkId !== 'function') return false;
    try {
      await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Desfaz tudo: ao sair da chamada. */
  fechar(): void {
    for (const elemento of [...this.faixas.keys()]) this.desligar(elemento);
    this.limitador?.disconnect();
    this.compensacao?.disconnect();
    void this.contexto?.close().catch(() => undefined);
    this.limitador = null;
    this.compensacao = null;
    this.contexto = null;
  }
}

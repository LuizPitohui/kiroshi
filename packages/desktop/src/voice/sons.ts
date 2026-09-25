/**
 * Os avisos sonoros da chamada: alguem entrou, alguem saiu.
 *
 * Os sons sao SINTETIZADOS, nao arquivos. Duas razoes:
 *
 *   nao ha arquivo para baixar, licenciar, versionar nem carregar — o
 *   instalador nao cresce um byte, e nao ha o risco classico de o som nao
 *   tocar na primeira vez porque o arquivo ainda estava chegando;
 *
 *   uma senoide com envelope curto e mais limpa do que quase qualquer
 *   amostra: nao estala, nao satura, e soa igual em caixa de notebook e em
 *   fone bom.
 *
 * A gramatica e a obvia, e e obvia de proposito: SOBE quando alguem chega,
 * DESCE quando alguem sai. Ninguem precisa aprender.
 *
 * Volume baixo por decisao, nao por esquecimento. Este som toca no meio de uma
 * conversa, muitas vezes por cima de alguem falando — ele tem que ser notado
 * sem interromper. Alto demais, a primeira coisa que a pessoa faz e desligar,
 * e ai o aviso deixa de existir.
 */

/** Sobe: chegou. Desce: saiu. */
export type Aviso = 'entrada' | 'saida';

/*
  Duas notas cada, em Lá maior, na oitava media.

  Notas de verdade e nao frequencias soltas: duas frequencias quaisquer batem
  desafinadas quando tocam juntas ou em sequencia rapida, e desafinacao chama
  atencao pelo motivo errado.
*/
const NOTAS: Record<Aviso, [number, number]> = {
  entrada: [587.33, 880.0], // Re5 -> La5
  saida: [880.0, 587.33], // La5 -> Re5
};

/** Cada nota. Curto: o aviso inteiro cabe em menos de um quarto de segundo. */
const DURACAO = 0.11;
const VOLUME = 0.07;

let contexto: AudioContext | null = null;

/**
 * O contexto de audio nasce na primeira vez que se toca algo.
 *
 * Criar antes seria criar um contexto que talvez nunca toque nada — e o
 * navegador suspende contextos criados fora de um gesto, entao o primeiro som
 * sairia mudo sem ninguem entender por que.
 */
function obterContexto(): AudioContext | null {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume();
    return contexto;
  } catch {
    // Sem saida de audio disponivel: o aviso sonoro simplesmente nao existe.
    // Nao e erro que valha interromper nada.
    return null;
  }
}

function tocarNota(ctx: AudioContext, hz: number, inicio: number, duracao = DURACAO, volume = VOLUME): void {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();

  // Triangulo, e nao senoide pura: tem um pouco de brilho e atravessa a voz
  // sem precisar de volume.
  osc.type = 'triangle';
  osc.frequency.value = hz;

  /*
    Envelope com ataque e queda suaves.

    Ligar e desligar um oscilador no zero produz um CLIQUE — a descontinuidade
    vira ruido de banda larga. Cinco milissegundos de rampa em cada ponta
    resolvem, e sao curtos demais para alguem perceber como rampa.
  */
  ganho.gain.setValueAtTime(0, inicio);
  ganho.gain.linearRampToValueAtTime(volume, inicio + 0.005);
  ganho.gain.setValueAtTime(volume, inicio + duracao - 0.02);
  ganho.gain.linearRampToValueAtTime(0, inicio + duracao);

  osc.connect(ganho);
  ganho.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao + 0.01);
}

/**
 * Toca o aviso. Nunca estoura: som e enfeite, e enfeite que derruba a chamada
 * nao vale a pena.
 */
/**
 * O toque de uma chamada em DM, em laco ate quem chamou parar.
 *
 *   recebida  alguem esta te ligando: tres notas subindo, repetidas. Mais
 *             alto que o aviso de entrada, porque precisa ser ouvido de longe
 *             do computador — e ainda assim longe de um alarme.
 *   feita     voce esta ligando e o outro lado ainda nao atendeu: um pulso
 *             baixo e espacado, so para saber que esta chamando.
 *
 * Devolve a funcao que para. Parar no meio de uma frase deixa as notas ja
 * agendadas terminarem sozinhas: cada uma dura menos de um quinto de segundo.
 */
export function tocarToque(tipo: 'recebida' | 'feita'): () => void {
  const ctx = obterContexto();
  if (!ctx) return () => undefined;

  const frase = (): void => {
    try {
      const agora = ctx.currentTime;
      if (tipo === 'recebida') {
        // La5 -> Do#6 -> Mi6: o acorde de La maior dos outros avisos, subindo.
        [880.0, 1108.73, 1318.51].forEach((hz, i) => tocarNota(ctx, hz, agora + i * 0.13, 0.12, 0.09));
      } else {
        tocarNota(ctx, 587.33, agora, 0.18, 0.045);
        tocarNota(ctx, 587.33, agora + 0.3, 0.18, 0.045);
      }
    } catch {
      // Som e enfeite: falhar aqui nao pode derrubar a chamada.
    }
  };

  frase();
  const laco = setInterval(frase, tipo === 'recebida' ? 2000 : 3200);
  return () => clearInterval(laco);
}

export function tocarAviso(aviso: Aviso): void {
  const ctx = obterContexto();
  if (!ctx) return;

  try {
    const [primeira, segunda] = NOTAS[aviso];
    const agora = ctx.currentTime;
    tocarNota(ctx, primeira, agora);
    // A segunda emenda na primeira, sem respiro: sao uma frase, nao dois bipes.
    tocarNota(ctx, segunda, agora + DURACAO);
  } catch {
    // Idem.
  }
}

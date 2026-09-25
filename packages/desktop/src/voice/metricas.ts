/**
 * O que a transmissao esta fazendo de verdade, a partir do `getStats`.
 *
 * Existe porque "as transmissoes estao travando muito" nao tinha como ser
 * medido: o app nao lia nenhuma metrica de video, e o servidor tambem nao
 * (docs/conhecimento/04-midia.md). Sem numero, cada conserto seria palpite.
 *
 * Duas pontas, cada uma respondendo a uma pergunta:
 *
 *   quem ENVIA   — cada camada do simulcast esta viva, em que resolucao e fps,
 *                  e se o codificador esta limitado por CPU ou por banda;
 *   quem ASSISTE — que camada chegou, quantas vezes a imagem travou e por
 *                  quanto tempo, e quanto se perdeu no caminho.
 *
 * Tudo aqui e puro: recebe as entradas do relatorio (objetos simples) e a
 * amostra anterior, e devolve o resumo. Taxas (bits por segundo, travadas no
 * intervalo) saem da DIFERENCA entre duas amostras, porque os contadores do
 * WebRTC sao acumulados desde o inicio da chamada — uma perda que aconteceu
 * uma hora atras nao pode continuar pintando o diagnostico de vermelho.
 */

/** Uma entrada do `RTCStatsReport`, do jeito que o navegador entrega. */
export type EntradaDeStats = { id: string; type: string; timestamp: number } & Record<string, unknown>;

export type Limitacao = 'nenhuma' | 'cpu' | 'banda' | 'outra';

export interface CamadaEnviada {
  /** `q`, `h`, `f` no simulcast do LiveKit; null sem simulcast. */
  rid: string | null;
  largura: number | null;
  altura: number | null;
  fps: number | null;
  /** Bits por segundo no intervalo; null na primeira amostra. */
  bitrate: number | null;
  limitacao: Limitacao;
  /** Tempo medio para codificar um quadro no intervalo, em ms. */
  msPorQuadro: number | null;
  /** Pedidos de quadro-chave (PLI) no intervalo. */
  pedidosDeQuadroChave: number | null;
  /** Reenvios pedidos (NACK) no intervalo. */
  reenvios: number | null;
  codificador: string | null;
}

export interface VideoRecebido {
  largura: number | null;
  altura: number | null;
  fps: number | null;
  bitrate: number | null;
  /** Travadas no intervalo (o `freezeCount` do WebRTC). */
  travadas: number | null;
  /** Segundos travados no intervalo. */
  segundosTravado: number | null;
  /** Quadros descartados pelo decodificador no intervalo. */
  quadrosDescartados: number | null;
  /** Perda de pacotes no intervalo, 0 a 1. */
  perda: number | null;
  jitterMs: number | null;
  /** Atraso medio do buffer de jitter, em ms (acumulado). */
  atrasoDeBufferMs: number | null;
  decodificador: string | null;
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** Diferenca de um contador entre duas amostras; null se falta um dos lados ou se o contador voltou. */
function delta(atual: unknown, anterior: unknown): number | null {
  const a = numero(atual);
  const b = numero(anterior);
  if (a === null || b === null || a < b) return null;
  return a - b;
}

function taxa(bytesAtual: unknown, bytesAnterior: unknown, msAtual: number, msAnterior: number): number | null {
  const bytes = delta(bytesAtual, bytesAnterior);
  const ms = msAtual - msAnterior;
  if (bytes === null || ms <= 0) return null;
  return Math.round((bytes * 8 * 1000) / ms);
}

function limitacaoDe(valor: unknown): Limitacao {
  switch (valor) {
    case 'none':
      return 'nenhuma';
    case 'cpu':
      return 'cpu';
    case 'bandwidth':
      return 'banda';
    case undefined:
    case null:
      return 'nenhuma';
    default:
      return 'outra';
  }
}

function porId(entradas: readonly EntradaDeStats[] | null): Map<string, EntradaDeStats> {
  return new Map((entradas ?? []).map((e) => [e.id, e]));
}

/**
 * As camadas que um video local esta enviando, da menor para a maior.
 *
 * `anterior` e o relatorio da amostra passada, para as taxas; sem ele, tudo
 * que e taxa sai null (a primeira amostra so da estado, nao ritmo).
 */
export function resumirEnvio(
  atual: readonly EntradaDeStats[],
  anterior: readonly EntradaDeStats[] | null,
): CamadaEnviada[] {
  const antes = porId(anterior);
  const camadas: CamadaEnviada[] = [];

  for (const e of atual) {
    if (e.type !== 'outbound-rtp' || e.kind !== 'video') continue;
    const a = antes.get(e.id);

    const quadros = delta(e.framesEncoded, a?.framesEncoded);
    const tempo = delta(e.totalEncodeTime, a?.totalEncodeTime);

    camadas.push({
      rid: texto(e.rid),
      largura: numero(e.frameWidth),
      altura: numero(e.frameHeight),
      fps: numero(e.framesPerSecond),
      bitrate: a ? taxa(e.bytesSent, a.bytesSent, e.timestamp, a.timestamp) : null,
      limitacao: limitacaoDe(e.qualityLimitationReason),
      msPorQuadro: quadros && tempo !== null ? Math.round((tempo * 1000 * 10) / quadros) / 10 : null,
      pedidosDeQuadroChave: a ? delta(e.pliCount, a.pliCount) : null,
      reenvios: a ? delta(e.nackCount, a.nackCount) : null,
      codificador: texto(e.encoderImplementation),
    });
  }

  return camadas.sort((x, y) => (x.altura ?? 0) - (y.altura ?? 0));
}

/**
 * O video que esta chegando de uma faixa remota (ha no maximo um por faixa).
 * Null se o relatorio ainda nao tem o `inbound-rtp` de video — comum nos
 * primeiros instantes depois de assinar.
 */
export function resumirRecebimento(
  atual: readonly EntradaDeStats[],
  anterior: readonly EntradaDeStats[] | null,
): VideoRecebido | null {
  const e = atual.find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
  if (!e) return null;
  const a = porId(anterior).get(e.id);

  const recebidos = delta(e.packetsReceived, a?.packetsReceived);
  const perdidos = delta(e.packetsLost, a?.packetsLost);
  const total = recebidos !== null && perdidos !== null ? recebidos + perdidos : null;

  const atraso = numero(e.jitterBufferDelay);
  const emitidos = numero(e.jitterBufferEmittedCount);
  const jitter = numero(e.jitter);

  return {
    largura: numero(e.frameWidth),
    altura: numero(e.frameHeight),
    fps: numero(e.framesPerSecond),
    bitrate: a ? taxa(e.bytesReceived, a.bytesReceived, e.timestamp, a.timestamp) : null,
    travadas: a ? delta(e.freezeCount, a.freezeCount) : null,
    segundosTravado: a ? delta(e.totalFreezesDuration, a.totalFreezesDuration) : null,
    quadrosDescartados: a ? delta(e.framesDropped, a.framesDropped) : null,
    perda: total ? (perdidos ?? 0) / total : a ? 0 : null,
    jitterMs: jitter === null ? null : Math.round(jitter * 1000),
    atrasoDeBufferMs: atraso !== null && emitidos ? Math.round((atraso / emitidos) * 1000) : null,
    decodificador: texto(e.decoderImplementation),
  };
}

export type Veredito = 'boa' | 'instavel' | 'ruim';

export interface Diagnostico {
  veredito: Veredito;
  /** Frases curtas, para a pessoa, do que esta pesando. Vazio = nada a dizer. */
  motivos: string[];
}

/**
 * Traduz o video recebido para quem assiste: esta bom, instavel ou ruim, e
 * por que. Os limiares sao de partida — o objetivo da telemetria e ajusta-los
 * com dado de verdade.
 */
export function diagnosticarRecebimento(video: VideoRecebido, fpsEsperado: number | null): Diagnostico {
  const motivos: string[] = [];
  let pior: Veredito = 'boa';
  const piora = (v: Veredito) => {
    if (v === 'ruim' || (v === 'instavel' && pior === 'boa')) pior = v;
  };

  if ((video.segundosTravado ?? 0) >= 1 || (video.travadas ?? 0) >= 3) {
    motivos.push('a imagem travou no último intervalo');
    piora('ruim');
  } else if ((video.travadas ?? 0) > 0) {
    motivos.push('a imagem travou por um instante');
    piora('instavel');
  }

  if (video.perda !== null && video.perda >= 0.05) {
    motivos.push(`perdendo ${Math.round(video.perda * 100)}% dos pacotes no caminho`);
    piora('ruim');
  } else if (video.perda !== null && video.perda >= 0.01) {
    motivos.push(`perdendo ${Math.round(video.perda * 100)}% dos pacotes no caminho`);
    piora('instavel');
  }

  if (fpsEsperado !== null && video.fps !== null && video.fps < fpsEsperado * 0.6) {
    motivos.push(`chegando a ${Math.round(video.fps)} fps de ${fpsEsperado}`);
    piora('instavel');
  }

  return { veredito: pior, motivos };
}

/** Do lado de quem envia: o que esta segurando a transmissao, se algo esta. */
export function diagnosticarEnvio(camadas: readonly CamadaEnviada[]): Diagnostico {
  const motivos: string[] = [];
  let veredito: Veredito = 'boa';

  if (camadas.some((c) => c.limitacao === 'cpu')) {
    motivos.push('o processador não está dando conta de codificar a transmissão');
    veredito = 'instavel';
  }
  if (camadas.some((c) => c.limitacao === 'banda')) {
    motivos.push('a internet de envio não comporta a qualidade escolhida');
    veredito = 'instavel';
  }
  const lenta = camadas.find((c) => c.msPorQuadro !== null && c.fps !== null && c.fps > 0 && c.msPorQuadro > 1000 / c.fps);
  if (lenta) {
    motivos.push(`cada quadro leva ${lenta.msPorQuadro} ms para codificar, mais que o tempo entre quadros`);
    veredito = 'ruim';
  }

  return { veredito, motivos };
}

/**
 * As DECISOES da limpeza de ruido, separadas de qualquer audio.
 *
 * Tudo aqui e funcao pura: recebe ajustes e fatos medidos, devolve o que
 * fazer. Fica fora de `ruido.ts` e `ruido-dfn3.ts` de proposito — aqueles
 * precisam de AudioContext, WebAssembly e microfone para rodar, e isto aqui
 * precisa ser testado sem nada disso. Foi uma decisao errada escondida no
 * meio do codigo de audio que deixou o Kiroshi transmitindo microfone cru por
 * varias versoes sem ninguem perceber (ver docs/SUPRESSAO-DE-RUIDO.md).
 *
 * O vocabulario:
 *
 *   MOTOR   quem remove o ruido. Dois modelos (DeepFilterNet3 e GTCRN), o
 *           supressor do proprio navegador, ou nenhum.
 *
 *   PORTAO  quem fecha o microfone no silencio, no modo "por atividade de
 *           voz". Independe do motor: existe tambem sem modelo nenhum.
 *
 * A ordem de preferencia dos modelos e fixa: DeepFilterNet3 primeiro, GTCRN
 * como reserva. Nao existe escolha manual de modelo na interface — quem usa
 * quer "sem ruido", nao um nome de rede neural. A escolha entre os dois e
 * feita por medicao (o autoteste), nao por preferencia.
 */

export type MotorDeModelo = 'deepfilternet3' | 'gtcrn';
export type MotorDeLimpeza = MotorDeModelo | 'navegador' | 'nenhum';

export type ModoDeEntrada = 'voice-activity' | 'push-to-talk';

/** O pedaco dos ajustes de voz que importa para a limpeza. */
export interface AjustesDeLimpeza {
  /** Usar um modelo (DeepFilterNet3 ou GTCRN) no lugar do navegador. */
  limpezaDeRuido: boolean;
  /** Intensidade do DeepFilterNet3, 0 a 100. O GTCRN ignora. */
  intensidadeDaLimpeza: number;
  noiseSuppression: boolean;
  voiceIsolation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  inputMode: ModoDeEntrada;
  /** Nivel, em dB, acima do qual o portao abre. */
  limiarDeVozDb: number;
}

/**
 * Intensidade padrao: 100, o maximo.
 *
 * No DeepFilterNet3 este numero e o LIMITE DE ATENUACAO em dB. 100 significa
 * "sem limite": o modelo remove tudo que julgar ruido. Valores menores
 * misturam de volta um pouco do som original — a voz fica mais natural, e o
 * fundo volta junto. O problema que motivou tudo isto foi teclado passando,
 * entao o padrao e o mais forte; quem achar a voz artificial abaixa.
 */
export const INTENSIDADE_PADRAO = 100;

/**
 * Limiar padrao do portao: -45 dB.
 *
 * Medido para funcionar DEPOIS do modelo: o ruido que sobra fica abaixo de
 * -60 dB, e voz normal perto do microfone fica entre -30 e -10 dB. -45 fica
 * no meio, com folga para quem fala baixo.
 */
export const LIMIAR_PADRAO_DB = -45;

/** Limites do controle de sensibilidade na interface. */
export const LIMIAR_MINIMO_DB = -70;
export const LIMIAR_MAXIMO_DB = -20;

/**
 * O que se sabe sobre cada modelo NESTA maquina.
 *
 * `deepfilternet3` vem do autoteste: ele so e oferecido depois de provar,
 * com audio de verdade, que remove ruido e cabe no processador.
 */
export interface Disponibilidade {
  deepfilternet3: { ok: true } | { ok: false; motivo: string };
  /** AudioWorklet e WebAssembly existem. E tudo que o GTCRN precisa. */
  gtcrn: boolean;
  /** AudioWorklet existe. E tudo que o portao precisa. */
  portao: boolean;
}

/**
 * Quais modelos tentar, em ordem.
 *
 * Lista vazia significa "nao use modelo": ou a pessoa desligou a limpeza, ou
 * nenhum dos dois roda aqui.
 */
export function modelosATentar(
  ajustes: Pick<AjustesDeLimpeza, 'limpezaDeRuido'>,
  disponivel: Disponibilidade,
): MotorDeModelo[] {
  if (!ajustes.limpezaDeRuido) return [];
  const ordem: MotorDeModelo[] = [];
  if (disponivel.deepfilternet3.ok) ordem.push('deepfilternet3');
  if (disponivel.gtcrn) ordem.push('gtcrn');
  return ordem;
}

/**
 * Sem modelo, quem limpa: o navegador, ou ninguem.
 *
 * "Ninguem" e uma escolha legitima — e o perfil "Estudio", de quem tem
 * microfone bom em sala silenciosa e quer o som cru.
 */
export function motorSemModelo(
  ajustes: Pick<AjustesDeLimpeza, 'noiseSuppression' | 'voiceIsolation'>,
): 'navegador' | 'nenhum' {
  return ajustes.noiseSuppression || ajustes.voiceIsolation ? 'navegador' : 'nenhum';
}

export interface RestricoesDoNavegador {
  noiseSuppression: boolean;
  voiceIsolation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

/**
 * O que pedir ao navegador na captura.
 *
 * NUNCA DOIS SUPRESSORES. Com um modelo na frente, a supressao e o
 * isolamento do navegador saem: os modelos foram treinados com audio cru, e
 * alimentar um deles com a saida de outro supressor da voz robotica.
 *
 * Cancelamento de eco e ganho automatico ficam como a pessoa escolheu nos
 * dois casos. Eco nao e ruido — e o som da propria caixa de som voltando pelo
 * microfone, que o modelo nao sabe distinguir de voz. Ganho nivela volume.
 * Nenhum dos dois disputa com o modelo.
 */
export function restricoesDoNavegador(
  ajustes: Pick<
    AjustesDeLimpeza,
    'noiseSuppression' | 'voiceIsolation' | 'echoCancellation' | 'autoGainControl'
  >,
  comModelo: boolean,
): RestricoesDoNavegador {
  return {
    noiseSuppression: comModelo ? false : ajustes.noiseSuppression,
    voiceIsolation: comModelo ? false : ajustes.voiceIsolation,
    echoCancellation: ajustes.echoCancellation,
    autoGainControl: ajustes.autoGainControl,
  };
}

/**
 * O limiar do portao, ou `null` quando nao ha portao.
 *
 * Push-to-talk nao precisa: quem decide quando o microfone abre e a tecla.
 * Um portao ali so cortaria o comeco das frases de quem fala baixo.
 */
export function limiarDoPortao(
  ajustes: Pick<AjustesDeLimpeza, 'inputMode' | 'limiarDeVozDb'>,
): number | null {
  if (ajustes.inputMode !== 'voice-activity') return null;
  return limiarValido(ajustes.limiarDeVozDb);
}

export function limiarValido(db: number): number {
  if (!Number.isFinite(db)) return LIMIAR_PADRAO_DB;
  return Math.min(LIMIAR_MAXIMO_DB, Math.max(LIMIAR_MINIMO_DB, Math.round(db)));
}

export function intensidadeValida(valor: number): number {
  if (!Number.isFinite(valor)) return INTENSIDADE_PADRAO;
  return Math.min(100, Math.max(0, Math.round(valor)));
}

/**
 * Ajustes que so valem abrindo o microfone de novo.
 *
 * Os do navegador sao pedidos NA CAPTURA: mudar depois exige capturar outra
 * vez. E a troca de modelo exige montar a cadeia do zero.
 *
 * Intensidade, limiar e modo de entrada NAO estao aqui: esses mudam ao vivo,
 * sem cortar a voz de quem esta falando. Antes desta lista, NENHUM ajuste
 * alem do aparelho valia durante a chamada — mexer no interruptor e continuar
 * ouvindo o mesmo ruido convencia qualquer um de que a limpeza nao existia.
 */
export const AJUSTES_QUE_REABREM_O_MICROFONE = [
  'inputDeviceId',
  'limpezaDeRuido',
  'noiseSuppression',
  'voiceIsolation',
  'echoCancellation',
  'autoGainControl',
] as const;

export function exigeReabrirMicrofone(
  mudanca: Readonly<Record<string, unknown>>,
  anterior: Readonly<Record<string, unknown>>,
): boolean {
  return AJUSTES_QUE_REABREM_O_MICROFONE.some(
    (chave) => mudanca[chave] !== undefined && mudanca[chave] !== anterior[chave],
  );
}

// ---------------------------------------------------------------------------
// Autoteste do DeepFilterNet3
// ---------------------------------------------------------------------------

/**
 * Reducao minima, em dB, para o autoteste aceitar.
 *
 * O teste passa ruido branco pelo modelo com intensidade 60. Funcionando, a
 * reducao fica entre 10 e 60 dB. Com o modelo quebrado a biblioteca copia a
 * entrada para a saida sem avisar (ver `ruido-dfn3.ts`), e a reducao da 0.
 * 10 dB separa os dois casos com folga.
 */
export const REDUCAO_MINIMA_DB = 10;

/**
 * Teto de reducao aceitavel com intensidade 60.
 *
 * Com o limite de 60 dB o modelo NUNCA pode passar muito disso: acima,
 * a saida esta morta (silencio), nao limpa. Aceitar esse caso faria o
 * microfone de alguem ficar mudo na chamada com o indicador dizendo que esta
 * tudo certo.
 */
export const REDUCAO_MAXIMA_DB = 70;

/**
 * Quanto do tempo real o modelo pode gastar, no maximo.
 *
 * 0,6 = processar 1 segundo de audio em ate 600 ms, contando a carga do
 * modelo. Acima disso a maquina ate da conta no teste, mas numa chamada
 * dividindo processador com jogo e transmissao de tela o audio comeca a
 * picotar. E melhor cair para o GTCRN, que e bem mais leve.
 */
export const FRACAO_MAXIMA_DO_TEMPO_REAL = 0.6;

export interface MedicaoDoAutoteste {
  rmsEntrada: number;
  rmsSaida: number;
  msGastos: number;
  segundosDeAudio: number;
}

export type ResultadoDoAutoteste =
  | { ok: true; reducaoDb: number; fracaoDoTempoReal: number }
  | { ok: false; motivo: string; reducaoDb?: number; fracaoDoTempoReal?: number };

export function avaliarAutoteste(m: MedicaoDoAutoteste): ResultadoDoAutoteste {
  if (!(m.rmsEntrada > 0)) {
    return { ok: false, motivo: 'o sinal de teste saiu vazio' };
  }
  const fracaoDoTempoReal = m.msGastos / (m.segundosDeAudio * 1000);

  if (!(m.rmsSaida > 0)) {
    return {
      ok: false,
      motivo: 'o modelo devolveu silencio absoluto: o microfone ficaria mudo',
      fracaoDoTempoReal,
    };
  }

  const reducaoDb = 20 * Math.log10(m.rmsEntrada / m.rmsSaida);

  if (reducaoDb < REDUCAO_MINIMA_DB) {
    return {
      ok: false,
      motivo: `o modelo nao reduziu o ruido (${reducaoDb.toFixed(1)} dB): esta so repassando o som`,
      reducaoDb,
      fracaoDoTempoReal,
    };
  }
  if (reducaoDb > REDUCAO_MAXIMA_DB) {
    return {
      ok: false,
      motivo: `a saida do modelo esta morta (${reducaoDb.toFixed(1)} dB de reducao)`,
      reducaoDb,
      fracaoDoTempoReal,
    };
  }
  if (fracaoDoTempoReal > FRACAO_MAXIMA_DO_TEMPO_REAL) {
    return {
      ok: false,
      motivo: `processador lento demais para o modelo (${Math.round(fracaoDoTempoReal * 100)}% do tempo real)`,
      reducaoDb,
      fracaoDoTempoReal,
    };
  }
  return { ok: true, reducaoDb, fracaoDoTempoReal };
}

/** Valor eficaz de um trecho de amostras. */
export function rms(amostras: Float32Array, inicio = 0, fim = amostras.length): number {
  let soma = 0;
  const n = Math.max(0, fim - inicio);
  if (n === 0) return 0;
  for (let i = inicio; i < fim; i++) {
    const a = amostras[i] ?? 0;
    soma += a * a;
  }
  return Math.sqrt(soma / n);
}

// ---------------------------------------------------------------------------
// Como mostrar
// ---------------------------------------------------------------------------

export function nomeDoMotor(motor: MotorDeLimpeza): string {
  switch (motor) {
    case 'deepfilternet3':
      return 'DeepFilterNet3';
    case 'gtcrn':
      return 'GTCRN (reserva)';
    case 'navegador':
      return 'Navegador';
    case 'nenhum':
      return 'Nenhum';
  }
}

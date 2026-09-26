/**
 * As DECISOES da entrada de audio, separadas de qualquer audio.
 *
 * Tudo aqui e funcao pura: recebe ajustes, devolve o que fazer. Fica fora de
 * `ruido.ts` de proposito — aquele precisa de AudioContext e microfone para
 * rodar, e isto aqui precisa ser testado sem nada disso. Foi uma decisao
 * errada escondida no meio do codigo de audio que deixou o Kiroshi
 * transmitindo microfone cru por varias versoes sem ninguem perceber (ver
 * docs/SUPRESSAO-DE-RUIDO.md).
 *
 * A LIMPEZA POR MODELO SAIU (2.0.2). O dono pediu a supressao de ruido refeita
 * do zero, com o processo: retirar a atual, estudar, plano comprovado, so
 * entao implementar (backlog F3). O DeepFilterNet3 e o GTCRN foram retirados
 * no primeiro passo; ate a nova chegar, quem limpa e o navegador.
 *
 * O vocabulario:
 *
 *   MOTOR   quem remove o ruido: o supressor do proprio navegador, ou nenhum.
 *
 *   PORTAO  quem fecha o microfone no silencio, no modo "por atividade de
 *           voz". Independe do motor, e nao e supressao de ruido: e a
 *           sensibilidade de entrada.
 */

export type MotorDeLimpeza = 'navegador' | 'nenhum';

export type ModoDeEntrada = 'voice-activity' | 'push-to-talk';

/** O pedaco dos ajustes de voz que importa para a entrada. */
export interface AjustesDeLimpeza {
  noiseSuppression: boolean;
  voiceIsolation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  inputMode: ModoDeEntrada;
  /** Nivel, em dB, acima do qual o portao abre. */
  limiarDeVozDb: number;
}

/**
 * Limiar padrao do portao: -45 dB.
 *
 * Voz normal perto do microfone fica entre -30 e -10 dB; -45 fica abaixo dela,
 * com folga para quem fala baixo. Sem o modelo, o ruido de fundo que sobra
 * depende do supressor do navegador e do lugar: quem ouvir o fundo abrindo o
 * microfone sobe o limiar na tela de voz, com o medidor na frente.
 */
export const LIMIAR_PADRAO_DB = -45;

/** Limites do controle de sensibilidade na interface. */
export const LIMIAR_MINIMO_DB = -70;
export const LIMIAR_MAXIMO_DB = -20;

/**
 * Quem limpa: o navegador, ou ninguem.
 *
 * "Ninguem" e uma escolha legitima — e o perfil "Estudio", de quem tem
 * microfone bom em sala silenciosa e quer o som cru.
 */
export function motorDaLimpeza(
  ajustes: Pick<AjustesDeLimpeza, 'noiseSuppression' | 'voiceIsolation'>,
): MotorDeLimpeza {
  return ajustes.noiseSuppression || ajustes.voiceIsolation ? 'navegador' : 'nenhum';
}

export interface RestricoesDoNavegador {
  noiseSuppression: boolean;
  voiceIsolation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

/**
 * O que pedir ao navegador na captura: exatamente o que a pessoa escolheu.
 *
 * Cancelamento de eco nao e ruido — e o som da propria caixa de som voltando
 * pelo microfone. Ganho nivela volume. Os quatro sao pedidos juntos porque o
 * navegador so os aplica na hora de abrir o microfone.
 */
export function restricoesDoNavegador(
  ajustes: Pick<
    AjustesDeLimpeza,
    'noiseSuppression' | 'voiceIsolation' | 'echoCancellation' | 'autoGainControl'
  >,
): RestricoesDoNavegador {
  return {
    noiseSuppression: ajustes.noiseSuppression,
    voiceIsolation: ajustes.voiceIsolation,
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

/**
 * Ajustes que so valem abrindo o microfone de novo.
 *
 * Os do navegador sao pedidos NA CAPTURA: mudar depois exige capturar outra
 * vez.
 *
 * Limiar e modo de entrada NAO estao aqui: esses mudam ao vivo, sem cortar a
 * voz de quem esta falando. Antes desta lista, NENHUM ajuste alem do aparelho
 * valia durante a chamada — mexer no interruptor e continuar ouvindo o mesmo
 * ruido convencia qualquer um de que a limpeza nao existia.
 */
export const AJUSTES_QUE_REABREM_O_MICROFONE = [
  'inputDeviceId',
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

/**
 * Os ajustes gravados por uma versao com a limpeza por modelo.
 *
 * Quem tinha a limpeza por IA ligada queria ruido fora. Sem o modelo, o que
 * sobra para isso e o supressor do navegador — que, com a IA ligada, podia
 * ter ficado desligado sem ninguem notar, porque nao fazia efeito. Liga de
 * volta uma vez, na primeira leitura depois da atualizacao, e apaga as chaves
 * antigas para a regra nao valer de novo por cima de uma escolha nova.
 */
export function migrarAjustesDaLimpezaPorModelo<T extends { noiseSuppression: boolean }>(lido: T): T {
  const antigo = lido as T & { limpezaDeRuido?: unknown; intensidadeDaLimpeza?: unknown };
  if (antigo.limpezaDeRuido === true) antigo.noiseSuppression = true;
  delete antigo.limpezaDeRuido;
  delete antigo.intensidadeDaLimpeza;
  return antigo;
}

// ---------------------------------------------------------------------------
// Como mostrar
// ---------------------------------------------------------------------------

export function nomeDoMotor(motor: MotorDeLimpeza): string {
  switch (motor) {
    case 'navegador':
      return 'Navegador';
    case 'nenhum':
      return 'Nenhum';
  }
}

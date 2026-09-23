/**
 * As leituras da faixa de estado.
 *
 * A faixa fica no rodape, sempre visivel, em monoespacada — o cromo de
 * instrumento que o aplicativo nao tinha. O que ela mostra e SO o que o
 * aplicativo de fato mede: estado do elo com o servidor, latencia da voz,
 * quantas pessoas estao na chamada. Nada de numero decorativo.
 *
 * Isso e uma regra, nao um detalhe. Uma faixa tecnica cheia de dado inventado
 * — "SUBNET 17.4", "UPTIME 04H" que ninguem calculou — fica bonita e ensina a
 * pessoa a ignorar a faixa inteira. Quando o dia ruim chegar e a latencia
 * estiver em 400ms, ela vai estar escrita num lugar que ninguem mais le.
 *
 * A logica mora aqui, separada do componente, porque e onde estao as decisoes:
 * o que conta como elo bom, quando um numero vira `--`, que grau de aviso cada
 * faixa de latencia merece. Decisao merece teste; JSX nao.
 */

/** Os estados do elo com o gateway, como a store os nomeia. */
export type EstadoDaConexao =
  | 'idle'
  | 'connecting'
  | 'identifying'
  | 'ready'
  | 'reconnecting'
  | 'failed';

export interface LeituraDoElo {
  /** O que aparece escrito. */
  rotulo: string;
  /** Classe de cor: verde, ambar, vermelho. */
  grau: 'bom' | 'atencao' | 'ruim';
  /** Frase para leitor de tela e para o `title`. */
  descricao: string;
}

/**
 * O elo com o servidor.
 *
 * `identifying` conta como bom de proposito: o soquete ja esta de pe e o
 * servidor esta conferindo quem e voce — dura frações de segundo, e piscar
 * ambar nesse intervalo treina a pessoa a ignorar o ambar.
 */
export function lerElo(estado: EstadoDaConexao): LeituraDoElo {
  switch (estado) {
    case 'ready':
      return { rotulo: 'ELO_OK', grau: 'bom', descricao: 'Conectado ao servidor' };
    case 'identifying':
      return { rotulo: 'ELO_OK', grau: 'bom', descricao: 'Conectado, confirmando a sessao' };
    case 'connecting':
      return { rotulo: 'ELO...', grau: 'atencao', descricao: 'Conectando ao servidor' };
    case 'reconnecting':
      return { rotulo: 'RELIGANDO', grau: 'atencao', descricao: 'A conexao caiu e esta voltando' };
    case 'failed':
      return { rotulo: 'SEM_ELO', grau: 'ruim', descricao: 'Sem conexao com o servidor' };
    case 'idle':
      return { rotulo: 'PARADO', grau: 'atencao', descricao: 'Ainda nao conectou' };
  }
}

/**
 * A latencia, com o grau que a pessoa SENTE — nao o que soa bonito.
 *
 * Os cortes sao os mesmos que o HUD ja usava, e vem de como a conversa se
 * comporta: ate 60ms ela flui; acima de 150ms o ritmo quebra, porque duas
 * pessoas comecam a falar por cima uma da outra sem perceber.
 *
 * Fora de chamada nao ha o que medir, e o traco diz isso melhor que um zero.
 * Zero seria uma mentira precisa: "medi e deu zero".
 */
export function lerLatencia(ms: number | null): { texto: string; grau: 'bom' | 'atencao' | 'ruim' } {
  if (ms === null || !Number.isFinite(ms)) return { texto: '--', grau: 'bom' };
  const inteiro = Math.max(0, Math.round(ms));
  return {
    texto: `${inteiro}MS`,
    grau: inteiro < 60 ? 'bom' : inteiro < 150 ? 'atencao' : 'ruim',
  };
}

/**
 * Quantas pessoas na chamada, contando voce.
 *
 * `participants` do controlador de voz nao inclui quem esta lendo — e a lista
 * dos OUTROS. Mostrar esse numero cru daria "VOZ 3" numa sala de quatro, e a
 * pessoa que conta cabeças na tela acha que o aplicativo perdeu alguem.
 */
export function lerVoz(conectado: boolean, outros: number): string {
  if (!conectado) return '--';
  return String(outros + 1);
}

/**
 * O relogio da faixa, com segundos.
 *
 * Com segundos porque e o unico elemento que se MEXE, e um instrumento parado
 * e indistinguivel de um instrumento quebrado. O segundo correndo e a prova
 * barata de que a interface esta viva — util de verdade no dia em que o
 * aplicativo travar, porque e o primeiro lugar onde da para notar.
 */
export function lerRelogio(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(agora.getHours())}:${p(agora.getMinutes())}:${p(agora.getSeconds())}`;
}

/** Como o LiveKit classifica o elo de cada pessoa na chamada. */
export type QualidadeDoElo = 'excellent' | 'good' | 'poor' | 'unknown';

export interface LeituraDeQualidade {
  /** Grau de cor, o mesmo vocabulario da faixa de estado. */
  grau: 'bom' | 'atencao' | 'ruim' | 'neutro';
  /**
   * A palavra na tela. Vazia quando esta tudo bem, de proposito.
   *
   * Um quadro de chamada tem doze pixels de altura para escrever coisa, e
   * "OTIMO" embaixo de toda pessoa numa grade de nove e ruido que ensina a
   * ignorar a regua inteira. A palavra aparece so quando ela muda uma decisao:
   * quando alguem esta picotando, e quem esta ouvindo precisa saber que o
   * problema nao e o proprio ouvido.
   */
  rotulo: string;
  /** Sempre presente. E o que o leitor de tela le, e o que o `title` mostra. */
  descricao: string;
}

/**
 * O elo de UMA pessoa na chamada.
 *
 * O dado ja existia — `connectionQuality` vem do LiveKit por participante — e
 * so era usado para escrever "instavel" quando estava ruim. O resto do tempo
 * a informacao existia e nao aparecia em lugar nenhum.
 *
 * Isso importa porque numa chamada de dez pessoas, quando a voz pica, a
 * primeira pergunta e DE QUEM e o problema. Sem o dado por pessoa, cada um
 * testa o proprio microfone.
 *
 * `unknown` nao vira "ruim". Ainda nao ha medida — e o mesmo motivo pelo qual
 * a latencia sem chamada e um traco e nao um zero. Pintar de vermelho o que
 * nao foi medido e inventar um problema.
 */
export function lerQualidade(q: QualidadeDoElo): LeituraDeQualidade {
  switch (q) {
    case 'excellent':
      return { grau: 'bom', rotulo: '', descricao: 'Conexao otima' };
    case 'good':
      return { grau: 'bom', rotulo: '', descricao: 'Conexao boa' };
    case 'poor':
      return { grau: 'ruim', rotulo: 'INSTAVEL', descricao: 'Conexao instavel — a voz pode picotar' };
    case 'unknown':
      return { grau: 'neutro', rotulo: '', descricao: 'Ainda medindo a conexao' };
  }
}

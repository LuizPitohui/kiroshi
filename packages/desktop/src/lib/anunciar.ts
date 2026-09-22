/**
 * O que o aplicativo diz em voz alta.
 *
 * Ate aqui, nada. O Kiroshi inteiro nao tinha uma unica regiao `aria-live`:
 * mensagem nova chegava, alguem entrava na chamada, a conexao caia — e para
 * quem usa leitor de tela nada disso existia. A informacao estava na tela,
 * que e exatamente o lugar onde essa pessoa nao olha.
 *
 * Duas urgencias, e a diferenca importa. "normal" espera a pessoa terminar o
 * que esta ouvindo; "urgente" interrompe. Quase tudo e normal. Interromper
 * uma frase pela metade para dizer "Fulano entrou na chamada" e pior do que
 * nao dizer nada, porque atrapalha o que ela estava fazendo.
 *
 * Aqui so vive a fila. Quem desenha as regioes e `ui/Anunciador.tsx`.
 */

export type Urgencia = 'normal' | 'urgente';

export interface Anuncio {
  texto: string;
  urgencia: Urgencia;
  /**
   * Muda a cada anuncio, mesmo com o texto repetido.
   *
   * Leitor de tela so fala quando o CONTEUDO da regiao muda. Duas mensagens
   * iguais seguidas — "Fulano entrou na chamada" duas vezes — e a segunda
   * passa em silencio. O numero garante que o conteudo sempre difere.
   */
  id: number;
}

type Ouvinte = (anuncio: Anuncio) => void;

const ouvintes = new Set<Ouvinte>();
let proximoId = 1;

export function assinarAnuncios(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function anunciar(texto: string, urgencia: Urgencia = 'normal'): void {
  const limpo = texto.trim();
  if (!limpo) return;
  const anuncio: Anuncio = { texto: limpo, urgencia, id: proximoId++ };
  for (const ouvinte of ouvintes) ouvinte(anuncio);
}

// ---------------------------------------------------------------------------

/** Quanto texto de uma mensagem vale a pena ler em voz alta de uma vez. */
const LIMITE_DE_LEITURA = 140;

export interface ChegadaParaAnunciar {
  autor: string;
  texto: string;
}

/**
 * Transforma um punhado de mensagens que chegaram juntas em uma frase.
 *
 * O motivo de agrupar e simples: em uma conversa animada chegam cinco
 * mensagens em dois segundos, e anunciar as cinco enfileira trinta segundos
 * de fala que a pessoa nao consegue interromper nem pular. O resumo diz o que
 * aconteceu em uma frase, e o conteudo continua na tela para ser lido no
 * ritmo dela.
 *
 * Uma mensagem sozinha vai inteira, porque ai o resumo nao economiza nada e
 * custa a informacao.
 */
export function resumirChegadas(chegadas: readonly ChegadaParaAnunciar[]): string {
  if (chegadas.length === 0) return '';

  if (chegadas.length === 1) {
    const { autor, texto } = chegadas[0]!;
    const corpo =
      texto.length > LIMITE_DE_LEITURA ? `${texto.slice(0, LIMITE_DE_LEITURA)}...` : texto;
    // Anexo sem texto e um caso real: sem isto o anuncio seria so o nome.
    return corpo.trim() ? `${autor}: ${corpo}` : `${autor} enviou um anexo`;
  }

  const autores = [...new Set(chegadas.map((c) => c.autor))];

  if (autores.length === 1) {
    return `${autores[0]} enviou ${chegadas.length} mensagens`;
  }

  // Dois nomes bastam para situar; a lista inteira vira um trava-linguas.
  const nomeados = autores.slice(0, 2).join(' e ');
  const resto = autores.length - 2;
  return resto > 0
    ? `${chegadas.length} mensagens novas de ${nomeados} e mais ${resto}`
    : `${chegadas.length} mensagens novas de ${nomeados}`;
}

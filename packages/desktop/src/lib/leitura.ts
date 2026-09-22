/**
 * Duas preferencias de quem le e escreve o dia inteiro.
 *
 * Estao juntas porque sao a mesma pergunta feita de dois lados: quanto do seu
 * jeito de usar o aplicativo voce pode ajustar sem pedir. Separa-las em dois
 * arquivos de dez linhas cada nao daria nada em troca.
 *
 * Seguem o molde do `movimento.ts`: leem, normalizam, pintam uma marca no
 * <html> e devolvem o que foi mesmo aplicado. O CSS decide o resto, e nada
 * aqui sabe quais regras existem.
 */

// ---------------------------------------------------------------------------
// Densidade
// ---------------------------------------------------------------------------

/**
 * Quanto espaco cada mensagem ocupa.
 *
 * Nao e questao de gosto so. "Confortavel" e o padrao porque separar as
 * mensagens ajuda a acompanhar quem falou o que numa conversa de varias
 * pessoas. "Compacto" existe porque numa janela lateral estreita — a conversa
 * da chamada, por exemplo — o confortavel mostra quatro mensagens por tela, e
 * ai a conversa vira um tunel.
 */
const CHAVE_DENSIDADE = 'kiroshi.densidade';

export type Densidade = 'confortavel' | 'compacto';

function densidadeValida(v: string | null): v is Densidade {
  return v === 'confortavel' || v === 'compacto';
}

function lerDensidade(): Densidade {
  try {
    const guardado = localStorage.getItem(CHAVE_DENSIDADE);
    return densidadeValida(guardado) ? guardado : 'confortavel';
  } catch {
    return 'confortavel';
  }
}

function pintarDensidade(valor: Densidade): void {
  // O confortavel nao escreve nada: e o padrao do CSS, e um atributo a menos
  // e uma regra a menos para manter em sincronia.
  if (valor === 'confortavel') delete document.documentElement.dataset.densidade;
  else document.documentElement.dataset.densidade = valor;
}

function escreverDensidade(valor: string): Densidade {
  const escolha: Densidade = densidadeValida(valor) ? valor : 'confortavel';
  try {
    localStorage.setItem(CHAVE_DENSIDADE, escolha);
  } catch {
    // Sem guardar, vale so para esta sessao.
  }
  pintarDensidade(escolha);
  /*
    Avisa quem precisa de um NUMERO, e nao de uma marca no documento.

    O avatar de cada mensagem recebe o tamanho por propriedade, em pixels — o
    CSS nao consegue encolhe-lo sem `!important`. A primeira versao tentou por
    CSS: a calha diminuia para 26px e o avatar continuava com 40, transbordando
    por cima do texto. Quem desenha o avatar precisa saber da escolha.
  */
  window.dispatchEvent(new CustomEvent('kiroshi:densidade', { detail: escolha }));
  return escolha;
}

export const aplicarDensidade = {
  ler: lerDensidade,
  escrever: escreverDensidade,
  instalar: () => pintarDensidade(lerDensidade()),
};

// ---------------------------------------------------------------------------
// Como enviar
// ---------------------------------------------------------------------------

/**
 * O que a tecla Enter faz no campo de escrever.
 *
 * `enter` envia e Shift+Enter quebra a linha — o padrao, e o que quase todo
 * mundo espera.
 *
 * `ctrl-enter` inverte: Enter quebra a linha e Ctrl+Enter envia. Existe para
 * quem escreve mensagens de varios paragrafos e ja mandou mais de uma pela
 * metade sem querer. Uma mensagem enviada nao volta atras, e "e so apertar
 * Shift" nao ajuda quem ja apertou.
 *
 * Isto nao pinta nada no documento: quem le e o proprio campo de escrever, na
 * hora da tecla.
 */
const CHAVE_ENVIO = 'kiroshi.envio';

export type ModoDeEnvio = 'enter' | 'ctrl-enter';

function envioValido(v: string | null): v is ModoDeEnvio {
  return v === 'enter' || v === 'ctrl-enter';
}

function lerEnvio(): ModoDeEnvio {
  try {
    const guardado = localStorage.getItem(CHAVE_ENVIO);
    return envioValido(guardado) ? guardado : 'enter';
  } catch {
    return 'enter';
  }
}

function escreverEnvio(valor: string): ModoDeEnvio {
  const escolha: ModoDeEnvio = envioValido(valor) ? valor : 'enter';
  try {
    localStorage.setItem(CHAVE_ENVIO, escolha);
  } catch {
    // Sem guardar, vale so para esta sessao.
  }
  // Avisa quem estiver com um campo aberto agora. Sem isto, mudar a
  // preferencia nos ajustes so valia no proximo canal aberto, e a pessoa
  // testava ali mesmo e concluia que a opcao nao funcionava.
  window.dispatchEvent(new CustomEvent('kiroshi:envio', { detail: escolha }));
  return escolha;
}

export const aplicarEnvio = { ler: lerEnvio, escrever: escreverEnvio };

// ---------------------------------------------------------------------------

/**
 * A tecla apertada deve enviar a mensagem?
 *
 * Pura de proposito: e a regra que decide se uma mensagem sai ou nao, e o
 * jeito de testar isso dentro do campo seria montar o aplicativo inteiro.
 *
 * Nota sobre `code`: teclados numericos reportam `NumpadEnter`, e alguns
 * clientes ainda mandam o nome legado `Return`. Os tres precisam valer, senao
 * o Enter do teclado numerico simplesmente nao envia — e o defeito aparece
 * so para quem usa aquele teclado.
 */
export interface TeclaDeEnvio {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export function deveEnviar(tecla: TeclaDeEnvio, modo: ModoDeEnvio): boolean {
  const ehEnter =
    tecla.key === 'Enter' ||
    tecla.key === 'Return' ||
    tecla.code === 'Enter' ||
    tecla.code === 'NumpadEnter';

  if (!ehEnter) return false;

  // Shift quebra a linha nos dois modos: e o gesto que todo mundo ja tem na
  // mao, e tira-lo no modo ctrl-enter nao ganharia nada.
  if (tecla.shiftKey) return false;
  if (tecla.altKey) return false;

  const comControle = Boolean(tecla.ctrlKey || tecla.metaKey);

  return modo === 'ctrl-enter' ? comControle : !comControle;
}

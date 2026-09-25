/**
 * O markdown das mensagens, como arvore.
 *
 * O renderizador da 1.x (`components/MessageContent.tsx`) montava os
 * elementos React direto das expressoes regulares, e quatro defeitos moravam
 * nessa mistura:
 *
 * - **A formatacao rodava antes dos links.** Um endereco com `_` no caminho
 *   (`https://x.com/a_b_c`) virava "a", "b" em italico e "c", e o link
 *   quebrava. Aqui links e mencoes sao separados ANTES e voltam como folhas.
 * - **Codigo cortava a formatacao ao meio.** `**veja `isto` aqui**` mostrava
 *   os asteriscos, porque o codigo dividia o texto em pedacos formatados um a
 *   um. Aqui o codigo tambem vira folha, e o negrito passa por cima dele.
 * - **O padrao era escolhido pelo tipo, nao pela posicao.** `*a **b** c*`
 *   perdia o italico: o negrito do meio era achado primeiro e os asteriscos de
 *   fora iam parar em pedacos diferentes. Aqui a leitura anda da esquerda para
 *   a direita e, onde duas regras casam, fica a mais longa — como o Discord.
 * - **`nome_do_arquivo` ficava com "do" em italico.** Sublinhado so abre e
 *   fecha italico na borda da palavra.
 *
 * Tambem entram aqui o escape com barra (`\*` e um asterisco, nao italico),
 * `@everyone`/`@here` destacados pela mesma regra do servidor, a citacao de
 * varias linhas (`>>> `) e o link entre `<>`, que o Discord usa para nao
 * gerar previa.
 *
 * Nada aqui e HTML: a arvore vira elementos React em `Conteudo.tsx`, e o
 * texto e sempre texto. Pura, para os casos dificeis serem testados sem
 * montar componente.
 */

export type Formato = 'negrito' | 'italico' | 'sublinhado' | 'riscado' | 'spoiler';

export type Trecho =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'codigo'; texto: string }
  | { tipo: Formato; filhos: Trecho[] }
  | { tipo: 'pessoa'; id: string }
  | { tipo: 'cargo'; id: string }
  | { tipo: 'canal'; id: string }
  | { tipo: 'emoji'; nome: string; id: string; animado: boolean }
  | { tipo: 'todos'; alvo: 'everyone' | 'here' }
  | { tipo: 'link'; url: string };

export type Bloco =
  | { tipo: 'texto'; filhos: Trecho[] }
  | { tipo: 'citacao'; filhos: Trecho[] }
  | { tipo: 'codigo'; linguagem: string | null; texto: string };

/*
  Marcadores na area de uso privado do Unicode.

  Um trecho ja resolvido (codigo, mencao, link) vira UM caractere que nenhuma
  regra de formatacao reconhece. A formatacao roda por cima deles sem
  enxergar o que tem dentro, e cada marcador volta a ser o trecho na hora de
  montar as folhas. Um escape (`\*`) vira outro marcador, que volta como o
  caractere literal.
*/
const ESCAPAVEIS = '\\*_~`|><:@#';
const BASE_DO_ESCAPE = 0xe000;
const BASE_DO_TRECHO = 0xe100;
const FIM_DA_AREA = 0xf8ff;
const AREA_PRIVADA = /[-]/g;

const LETRA_OU_NUMERO = /[\p{L}\p{N}_]/u;

/** Linguagem na primeira linha do bloco de codigo: ```ts */
const LINGUAGEM = /^[a-zA-Z0-9+#.-]{1,20}$/;

// ---------------------------------------------------------------------------
// Entidades: mencoes, emojis do servidor e links
// ---------------------------------------------------------------------------

const ENTIDADES = new RegExp(
  [
    /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,20})>/.source, // 1 animado, 2 nome, 3 id
    /<@&(\d{1,20})>/.source, // 4 cargo
    /<@!?(\d{1,20})>/.source, // 5 pessoa
    /<#(\d{1,20})>/.source, // 6 canal
    // A mesma borda que o servidor usa em `parseMentions`: so destaca o que
    // de fato notificou.
    /(?<=^|\s)@(everyone|here)(?=\s|$)/.source, // 7 todos
    /<(https?:\/\/[^\s<>]+)>/.source, // 8 link sem previa
    /https?:\/\/[^\s<>"']+/.source, // o resto: link
  ].join('|'),
  'g',
);

/** Pontuacao que termina a frase, e nao o endereco: "veja https://x.com." */
const FIM_DE_FRASE = /[.,:;!?'"*_~|]$/;

function contar(texto: string, caractere: string): number {
  let n = 0;
  for (const c of texto) if (c === caractere) n++;
  return n;
}

/**
 * Tira do fim do link o que e da frase em volta. Parentese so sai se estiver
 * sobrando: `https://pt.wikipedia.org/wiki/Foo_(bar)` continua inteiro.
 */
function aparar(url: string): string {
  let fim = url;
  for (;;) {
    if (FIM_DE_FRASE.test(fim)) fim = fim.slice(0, -1);
    else if (fim.endsWith(')') && contar(fim, ')') > contar(fim, '(')) fim = fim.slice(0, -1);
    else if (fim.endsWith(']') && contar(fim, ']') > contar(fim, '[')) fim = fim.slice(0, -1);
    else return fim;
  }
}

// ---------------------------------------------------------------------------
// Formatacao: leitura da esquerda para a direita
// ---------------------------------------------------------------------------

interface Regra {
  formato: Formato;
  /** Ancorada (`y`): so casa exatamente na posicao pedida. */
  padrao: RegExp;
  /** Desempate entre regras que casam no mesmo lugar com o mesmo tamanho. */
  peso: number;
  /** Condicao sobre o caractere anterior (a borda da palavra do `_`). */
  antes?: (anterior: string | undefined) => boolean;
}

const REGRAS: readonly Regra[] = [
  { formato: 'spoiler', padrao: /\|\|([\s\S]+?)\|\|/y, peso: 0.3 },
  // O italico com asterisco aceita negrito dentro (`*a **b** c*`) e nao abre
  // com espaco (`2 * 3 * 4` e conta, nao italico).
  {
    formato: 'italico',
    padrao: /\*(?=\S)((?:\*\*|\s+(?:[^\s*]|\*\*)|[^\s*])+?)\*(?!\*)/y,
    peso: 0.2,
  },
  {
    formato: 'italico',
    padrao: /_((?:__|[^_])+?)_(?![\p{L}\p{N}_])/uy,
    peso: 0.2,
    antes: (anterior) => anterior === undefined || !LETRA_OU_NUMERO.test(anterior),
  },
  { formato: 'negrito', padrao: /\*\*([\s\S]+?)\*\*(?!\*)/y, peso: 0.1 },
  { formato: 'sublinhado', padrao: /__([\s\S]+?)__(?!_)/y, peso: 0 },
  { formato: 'riscado', padrao: /~~([\s\S]+?)~~/y, peso: 0 },
];

const ABRE_FORMATO = /[*_~|]/;

class Leitor {
  /** Os trechos ja resolvidos, apontados pelos marcadores. */
  private readonly trechos: Trecho[] = [];

  marcar(trecho: Trecho): string {
    const codigo = BASE_DO_TRECHO + this.trechos.length;
    // 4000 caracteres por mensagem nunca chegam perto, mas um marcador fora
    // da area privada viraria texto comum; nesse caso o trecho sai como texto.
    if (codigo > FIM_DA_AREA) return trecho.tipo === 'codigo' ? trecho.texto : '';
    this.trechos.push(trecho);
    return String.fromCharCode(codigo);
  }

  /**
   * Codigo em linha e escapes, numa passada so e na ordem em que aparecem:
   * um acento grave escapado (`\``) nao abre codigo, e dentro do codigo a
   * barra e so uma barra.
   */
  separarCodigo(texto: string): string {
    let saida = '';
    let i = 0;
    while (i < texto.length) {
      const c = texto[i]!;
      if (c === '\\' && i + 1 < texto.length && ESCAPAVEIS.includes(texto[i + 1]!)) {
        saida += String.fromCharCode(BASE_DO_ESCAPE + ESCAPAVEIS.indexOf(texto[i + 1]!));
        i += 2;
        continue;
      }
      if (c === '`') {
        let abertura = 1;
        while (texto[i + abertura] === '`') abertura++;
        if (abertura <= 2) {
          const cerca = '`'.repeat(abertura);
          const fecha = texto.indexOf(cerca, i + abertura);
          const dentro = fecha === -1 ? '' : texto.slice(i + abertura, fecha);
          // Um acento so: sem quebrar linha, como na 1.x. Dois (``a ` b``):
          // pode ter acento dentro.
          const valido =
            fecha !== -1 && dentro.length > 0 && texto[fecha + abertura] !== '`' && (abertura === 2 || !dentro.includes('\n'));
          if (valido) {
            saida += this.marcar({ tipo: 'codigo', texto: abertura === 2 ? dentro.trim() || dentro : dentro });
            i = fecha + abertura;
            continue;
          }
        }
        saida += texto.slice(i, i + abertura);
        i += abertura;
        continue;
      }
      saida += c;
      i++;
    }
    return saida;
  }

  separarEntidades(texto: string): string {
    ENTIDADES.lastIndex = 0;
    let saida = '';
    let ultimo = 0;
    let m: RegExpExecArray | null;
    while ((m = ENTIDADES.exec(texto)) !== null) {
      let trecho: Trecho;
      let fim = m.index + m[0].length;
      if (m[3]) trecho = { tipo: 'emoji', nome: m[2]!, id: m[3], animado: m[1] === 'a' };
      else if (m[4]) trecho = { tipo: 'cargo', id: m[4] };
      else if (m[5]) trecho = { tipo: 'pessoa', id: m[5] };
      else if (m[6]) trecho = { tipo: 'canal', id: m[6] };
      else if (m[7]) trecho = { tipo: 'todos', alvo: m[7] as 'everyone' | 'here' };
      else if (m[8]) trecho = { tipo: 'link', url: m[8] };
      else {
        const url = aparar(m[0]);
        // "http://" sozinho, ou so pontuacao depois do esquema: nao e link.
        if (url.length <= url.indexOf('//') + 2) continue;
        trecho = { tipo: 'link', url };
        fim = m.index + url.length;
        ENTIDADES.lastIndex = fim;
      }
      saida += texto.slice(ultimo, m.index) + this.marcar(trecho);
      ultimo = fim;
    }
    return saida + texto.slice(ultimo);
  }

  /** Um pedaco sem formatacao volta a ser texto e trechos. */
  folhas(texto: string): Trecho[] {
    const saida: Trecho[] = [];
    let acumulado = '';
    const soltar = () => {
      if (acumulado) saida.push({ tipo: 'texto', texto: acumulado });
      acumulado = '';
    };
    for (const c of texto) {
      const codigo = c.charCodeAt(0);
      if (codigo >= BASE_DO_TRECHO && codigo <= FIM_DA_AREA) {
        const trecho = this.trechos[codigo - BASE_DO_TRECHO];
        if (trecho) {
          soltar();
          saida.push(trecho);
        }
      } else if (codigo >= BASE_DO_ESCAPE && codigo < BASE_DO_TRECHO) {
        acumulado += ESCAPAVEIS[codigo - BASE_DO_ESCAPE] ?? '';
      } else {
        acumulado += c;
      }
    }
    soltar();
    return saida;
  }

  formatar(texto: string): Trecho[] {
    const saida: Trecho[] = [];
    let solto = '';
    const soltar = () => {
      if (solto) saida.push(...this.folhas(solto));
      solto = '';
    };

    let i = 0;
    while (i < texto.length) {
      const c = texto[i]!;
      if (ABRE_FORMATO.test(c)) {
        let melhor: { regra: Regra; m: RegExpExecArray; nota: number } | null = null;
        for (const regra of REGRAS) {
          if (regra.antes && !regra.antes(i === 0 ? undefined : texto[i - 1])) continue;
          regra.padrao.lastIndex = i;
          const m = regra.padrao.exec(texto);
          if (!m) continue;
          const nota = m[0].length + regra.peso;
          if (!melhor || nota > melhor.nota) melhor = { regra, m, nota };
        }
        if (melhor) {
          soltar();
          saida.push({ tipo: melhor.regra.formato, filhos: this.formatar(melhor.m[1] ?? '') });
          i += melhor.m[0].length;
          continue;
        }
      }
      solto += c;
      i++;
    }
    soltar();
    return saida;
  }

  emLinha(texto: string): Trecho[] {
    return this.formatar(this.separarEntidades(this.separarCodigo(texto)));
  }
}

// ---------------------------------------------------------------------------
// Blocos: codigo, citacao, texto
// ---------------------------------------------------------------------------

const CERCA = /```([\s\S]*?)```/g;

function blocoDeCodigo(dentro: string): Bloco {
  const quebra = dentro.indexOf('\n');
  const primeira = quebra === -1 ? '' : dentro.slice(0, quebra).trim();
  const temLinguagem = LINGUAGEM.test(primeira);
  let texto = temLinguagem ? dentro.slice(quebra + 1) : dentro;
  // A quebra logo depois da cerca e a de antes do fechamento sao da sintaxe,
  // nao do codigo — na 1.x viravam uma linha vazia em cima.
  if (texto.startsWith('\n')) texto = texto.slice(1);
  if (texto.endsWith('\n')) texto = texto.slice(0, -1);
  return { tipo: 'codigo', linguagem: temLinguagem ? primeira.toLowerCase() : null, texto };
}

/** Texto entre blocos de codigo: linhas comuns e citacoes, agrupadas. */
function blocosDeTexto(texto: string, leitor: Leitor, saida: Bloco[]): void {
  const linhas = texto.split('\n');
  let tipo: 'texto' | 'citacao' | null = null;
  let acumuladas: string[] = [];

  const soltar = () => {
    if (tipo && acumuladas.length) {
      saida.push({ tipo, filhos: leitor.emLinha(acumuladas.join('\n')) });
    }
    acumuladas = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;
    // `>>> ` cita tudo daqui ate o fim do trecho.
    if (linha.startsWith('>>> ')) {
      soltar();
      tipo = 'citacao';
      acumuladas = [linha.slice(4), ...linhas.slice(i + 1)];
      soltar();
      tipo = null;
      return;
    }
    const citada = linha.startsWith('> ') || linha === '>';
    const deste: 'texto' | 'citacao' = citada ? 'citacao' : 'texto';
    if (deste !== tipo) {
      soltar();
      tipo = deste;
    }
    acumuladas.push(citada ? linha.slice(2) : linha);
  }
  soltar();
}

/**
 * Le uma mensagem inteira.
 *
 * Caracteres da area privada do Unicode que ja venham no texto viram `�`: sao
 * os marcadores internos, e deixa-los passar abriria um jeito de uma mensagem
 * apontar para o trecho de outra.
 */
export function analisar(conteudo: string): Bloco[] {
  const limpo = conteudo.replace(/\r\n?/g, '\n').replace(AREA_PRIVADA, '�');
  const leitor = new Leitor();
  const saida: Bloco[] = [];

  let ultimo = 0;
  CERCA.lastIndex = 0;
  let m: RegExpExecArray | null;
  const partes: Array<{ codigo: boolean; texto: string }> = [];
  while ((m = CERCA.exec(limpo)) !== null) {
    // "``````" nao tem nada dentro: fica como texto, como na 1.x.
    if (!m[1]) continue;
    partes.push({ codigo: false, texto: limpo.slice(ultimo, m.index) });
    partes.push({ codigo: true, texto: m[1] });
    ultimo = m.index + m[0].length;
  }
  partes.push({ codigo: false, texto: limpo.slice(ultimo) });

  partes.forEach((parte, i) => {
    if (parte.codigo) {
      saida.push(blocoDeCodigo(parte.texto));
      return;
    }
    let texto = parte.texto;
    // A quebra encostada num bloco de codigo e da sintaxe: sem isso sobraria
    // uma linha vazia antes e depois de todo bloco.
    if (i > 0 && partes[i - 1]!.codigo && texto.startsWith('\n')) texto = texto.slice(1);
    if (i < partes.length - 1 && partes[i + 1]!.codigo && texto.endsWith('\n')) texto = texto.slice(0, -1);
    if (texto) blocosDeTexto(texto, leitor, saida);
  });

  return saida;
}

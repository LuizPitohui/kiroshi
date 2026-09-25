/**
 * Autocompletar de `@pessoa`, `@cargo`, `#canal` e `:emoji:`, e a traducao
 * entre o que se ve no campo e o que o servidor entende.
 *
 * O campo e um `textarea` comum. Escrever `<@1234567890>` nele seria
 * ilegivel, entao o campo mostra o nome (`@kaya`, `#geral`, `:gato:`) e a
 * troca pelas marcas acontece no envio (`paraEnvio`); ao editar, o caminho
 * inverso (`paraEdicao`). A pessoa entra pelo nome de usuario, que e unico; o
 * nome de exibicao tambem vale, mas so quando nenhuma outra pessoa tem o
 * mesmo — senao a mencao cairia em quem nao foi chamado.
 *
 * Nada disso toca codigo (`` `@kaya` `` continua texto), endereco
 * (`https://x.com/@kaya`) nem marca que ja esteja escrita.
 *
 * Puro: a regra que decide QUEM recebe uma notificacao nao pode depender de
 * montar o compositor para ser testada.
 */
import { GRUPOS_DE_EMOJI } from '../../lib/emojis.js';
import { PALAVRAS_DE_EMOJI, normalizar } from '../../components/emoji-palavras.js';

export type Gatilho = '@' | '#' | ':';

export interface Consulta {
  gatilho: Gatilho;
  /** O que foi digitado depois do gatilho. */
  termo: string;
  /** Posicao do gatilho no texto. */
  inicio: number;
  /** Onde a consulta termina: o cursor. */
  fim: number;
}

/** O que pode vir logo antes de um gatilho. "email@x" nao abre nada. */
const ANTES_DO_GATILHO = /[\s([{"'«]/;

const TERMO_VALIDO: Record<Gatilho, RegExp> = {
  '@': /^[\p{L}\p{N}_.-]*$/u,
  '#': /^[\p{L}\p{N}_-]*$/u,
  ':': /^[\p{L}\p{N}_+-]*$/u,
};

/** O maior termo que vale a pena procurar (nome de usuario tem ate 32). */
const TERMO_MAXIMO = 32;

function dentroDeCodigo(texto: string, posicao: number): boolean {
  const antes = texto.slice(0, posicao);
  if ((antes.split('```').length - 1) % 2 === 1) return true;
  const linha = antes.slice(antes.lastIndexOf('\n') + 1).replace(/```/g, '');
  return (linha.split('`').length - 1) % 2 === 1;
}

/**
 * A consulta que o cursor esta fazendo agora, ou `null`.
 *
 * `:` pede dois caracteres, como no Discord: com um so, qualquer "ok:" no fim
 * de frase abriria a lista de emojis.
 */
export function consultaNoCursor(texto: string, cursor: number): Consulta | null {
  for (let i = cursor - 1; i >= 0 && cursor - i <= TERMO_MAXIMO + 1; i--) {
    const c = texto[i]!;
    if (c === '@' || c === '#' || c === ':') {
      const anterior = i === 0 ? undefined : texto[i - 1];
      if (anterior !== undefined && !ANTES_DO_GATILHO.test(anterior)) return null;
      const termo = texto.slice(i + 1, cursor);
      if (!TERMO_VALIDO[c].test(termo)) return null;
      if (c === ':' && termo.length < 2) return null;
      if (dentroDeCodigo(texto, i)) return null;
      return { gatilho: c, termo, inicio: i, fim: cursor };
    }
    if (/\s/.test(c)) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sugestoes
// ---------------------------------------------------------------------------

export interface FontesDeSugestao {
  pessoas: ReadonlyArray<{ id: string; username: string; nome: string; avatarUrl: string | null }>;
  cargos: ReadonlyArray<{ id: string; nome: string; cor: string | null; membros: number }>;
  /** `@everyone` e `@here` so aparecem para quem pode usar. */
  podeMencionarTodos: boolean;
  canais: ReadonlyArray<{ id: string; nome: string; categoria: string | null }>;
  /** Os do servidor aberto primeiro. */
  emojis: ReadonlyArray<{ id: string; nome: string; url: string; animado: boolean }>;
}

export type Sugestao =
  | { tipo: 'pessoa'; chave: string; id: string; rotulo: string; detalhe: string; avatarUrl: string | null; inserir: string }
  | { tipo: 'cargo'; chave: string; id: string; rotulo: string; detalhe: string; cor: string | null; inserir: string }
  | { tipo: 'todos'; chave: string; rotulo: string; detalhe: string; inserir: string }
  | { tipo: 'canal'; chave: string; id: string; rotulo: string; detalhe: string | null; inserir: string }
  | { tipo: 'emoji'; chave: string; rotulo: string; url: string | null; caractere: string | null; inserir: string };

/**
 * Quanto um nome responde ao termo: igual, comeca com, alguma palavra comeca
 * com, contem. -1 quando nao responde. Sem acento e sem caixa dos dois lados.
 */
export function pontuar(termo: string, alvos: readonly string[]): number {
  const t = normalizar(termo);
  if (!t) return 1;
  let melhor = -1;
  for (const alvo of alvos) {
    const a = normalizar(alvo);
    if (a === t) return 100;
    if (a.startsWith(t)) melhor = Math.max(melhor, 80);
    else if (a.split(/[\s_.-]+/).some((p) => p.startsWith(t))) melhor = Math.max(melhor, 60);
    else if (a.includes(t)) melhor = Math.max(melhor, 40);
  }
  return melhor;
}

function ordenar<T extends { rotulo: string }>(itens: Array<{ item: T; nota: number }>): T[] {
  return itens
    .filter((x) => x.nota >= 0)
    .sort((a, b) => b.nota - a.nota || a.item.rotulo.localeCompare(b.item.rotulo, 'pt-BR'))
    .map((x) => x.item);
}

/**
 * A palavra do emoji que respondeu ao termo, e quanto respondeu. A primeira
 * palavra e o nome do desenho: `:fogo` acha o 🔥 antes do extintor, que so
 * tem "fogo" entre as outras palavras.
 */
export function palavraDoEmoji(emoji: string, termo: string): { palavra: string; nota: number } | null {
  const palavras = PALAVRAS_DE_EMOJI[emoji]?.split(' ');
  if (!palavras) return null;
  const t = normalizar(termo);
  let melhor: { palavra: string; nota: number } | null = null;
  palavras.forEach((p, i) => {
    const n = normalizar(p);
    const nota = n.startsWith(t) ? (i === 0 ? 3 : 2) : n.includes(t) ? 1 : 0;
    if (nota > (melhor?.nota ?? 0)) melhor = { palavra: p, nota };
  });
  return melhor;
}

export function sugerir(consulta: Consulta, fontes: FontesDeSugestao, limite = 10): Sugestao[] {
  const { termo } = consulta;

  if (consulta.gatilho === '@') {
    const pessoas = ordenar(
      fontes.pessoas.map((p) => ({
        item: {
          tipo: 'pessoa' as const,
          chave: `p${p.id}`,
          id: p.id,
          rotulo: p.nome,
          detalhe: `@${p.username}`,
          avatarUrl: p.avatarUrl,
          inserir: `@${p.username} `,
        },
        nota: pontuar(termo, [p.username, p.nome]),
      })),
    ).slice(0, 8);
    const cargos = ordenar(
      fontes.cargos.map((c) => ({
        item: {
          tipo: 'cargo' as const,
          chave: `c${c.id}`,
          id: c.id,
          rotulo: c.nome,
          detalhe: c.membros === 1 ? '1 membro' : `${c.membros} membros`,
          cor: c.cor,
          inserir: `@${c.nome} `,
        },
        nota: pontuar(termo, [c.nome]),
      })),
    ).slice(0, 4);
    const todos: Sugestao[] = fontes.podeMencionarTodos
      ? ordenar([
          {
            item: { tipo: 'todos' as const, chave: 'everyone', rotulo: '@everyone', detalhe: 'todos que veem o canal', inserir: '@everyone ' },
            nota: pontuar(termo, ['everyone', 'todos']),
          },
          {
            item: { tipo: 'todos' as const, chave: 'here', rotulo: '@here', detalhe: 'quem está online', inserir: '@here ' },
            nota: pontuar(termo, ['here', 'aqui']),
          },
        ])
      : [];
    return [...pessoas, ...cargos, ...todos].slice(0, limite);
  }

  if (consulta.gatilho === '#') {
    return ordenar(
      fontes.canais.map((c) => ({
        item: { tipo: 'canal' as const, chave: `k${c.id}`, id: c.id, rotulo: c.nome, detalhe: c.categoria, inserir: `#${c.nome} ` },
        nota: pontuar(termo, [c.nome]),
      })),
    ).slice(0, limite);
  }

  // ':' — os do servidor primeiro, na ordem em que vieram; depois os unicode.
  const doServidor: Sugestao[] = [];
  const vistos = new Set<string>();
  for (const e of fontes.emojis) {
    if (vistos.has(e.nome) || pontuar(termo, [e.nome]) < 0) continue;
    vistos.add(e.nome);
    doServidor.push({ tipo: 'emoji', chave: `e${e.id}`, rotulo: e.nome, url: e.url, caractere: null, inserir: `:${e.nome}: ` });
  }
  const unicode: Array<{ s: Sugestao; nota: number }> = [];
  const vistosUnicode = new Set<string>();
  for (const grupo of GRUPOS_DE_EMOJI) {
    for (const emoji of grupo.emojis) {
      if (vistosUnicode.has(emoji)) continue;
      const achado = palavraDoEmoji(emoji, termo);
      if (!achado) continue;
      vistosUnicode.add(emoji);
      unicode.push({ s: { tipo: 'emoji', chave: `u${emoji}`, rotulo: achado.palavra, url: null, caractere: emoji, inserir: `${emoji} ` }, nota: achado.nota });
    }
  }
  // Ordenacao estavel: dentro da mesma nota, fica a ordem dos grupos.
  unicode.sort((a, b) => b.nota - a.nota);
  return [...doServidor, ...unicode.map((u) => u.s)].slice(0, limite);
}

/** Troca a consulta pela sugestao e diz onde o cursor fica. */
export function aplicarSugestao(texto: string, consulta: Consulta, sugestao: Sugestao): { texto: string; cursor: number } {
  const depois = texto.slice(consulta.fim);
  // Ja tem espaco depois do cursor: nao dobra.
  const inserir = /^\s/.test(depois) ? sugestao.inserir.trimEnd() : sugestao.inserir;
  const novo = texto.slice(0, consulta.inicio) + inserir + depois;
  return { texto: novo, cursor: consulta.inicio + inserir.length };
}

// ---------------------------------------------------------------------------
// Traducao entre o campo e as marcas
// ---------------------------------------------------------------------------

export interface Dicionario {
  /** `nomes`: apelido e nome de exibicao, alem do nome de usuario. */
  pessoas: ReadonlyArray<{ id: string; username: string; nomes: readonly string[] }>;
  cargos: ReadonlyArray<{ id: string; nome: string }>;
  canais: ReadonlyArray<{ id: string; nome: string }>;
  /** Na ordem de preferencia: numa colisao de nome, vale o primeiro. */
  emojis: ReadonlyArray<{ id: string; nome: string; animado: boolean }>;
}

/**
 * O que nunca se traduz: codigo, enderecos e marcas ja escritas. Cada trecho
 * desses passa inteiro, e so o que esta entre eles e traduzido.
 */
const INTOCAVEL = /```[\s\S]*?```|``[\s\S]+?``|`[^`\n]+`|https?:\/\/[^\s<>"']+|<(?:@[!&]?|#|a?:[a-zA-Z0-9_]{2,32}:)\d{1,20}>/g;

function foraDoIntocavel(texto: string, traduzir: (trecho: string) => string): string {
  let saida = '';
  let ultimo = 0;
  for (const m of texto.matchAll(INTOCAVEL)) {
    saida += traduzir(texto.slice(ultimo, m.index)) + m[0];
    ultimo = m.index + m[0].length;
  }
  return saida + traduzir(texto.slice(ultimo));
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Alternancia do maior para o menor: `@Moderador Chefe` antes de `@Moderador`. */
function alternancia(nomes: Iterable<string>): string | null {
  const lista = [...nomes].filter(Boolean).sort((a, b) => b.length - a.length);
  return lista.length ? lista.map(escaparRegex).join('|') : null;
}

function tabelaDeArroba(d: Dicionario): Map<string, string> {
  const tabela = new Map<string, string>();
  // Nome de usuario primeiro: e unico, e numa colisao com cargo a pessoa ganha.
  for (const p of d.pessoas) tabela.set(p.username.toLowerCase(), `<@${p.id}>`);

  const quantos = new Map<string, number>();
  for (const p of d.pessoas) {
    for (const n of new Set(p.nomes.map((x) => x.trim().toLowerCase()).filter(Boolean))) {
      quantos.set(n, (quantos.get(n) ?? 0) + 1);
    }
  }
  for (const p of d.pessoas) {
    for (const nome of p.nomes) {
      const n = nome.trim().toLowerCase();
      if (n && quantos.get(n) === 1 && !tabela.has(n)) tabela.set(n, `<@${p.id}>`);
    }
  }
  for (const c of d.cargos) {
    const n = c.nome.trim().toLowerCase();
    if (n && !tabela.has(n)) tabela.set(n, `<@&${c.id}>`);
  }
  // Ficam como texto: o servidor le os dois e decide se notificam.
  tabela.delete('everyone');
  tabela.delete('here');
  return tabela;
}

/**
 * O texto do campo, com os nomes trocados pelas marcas, pronto para enviar.
 *
 * So troca o que tem dono conhecido; o resto fica como a pessoa escreveu.
 */
export function paraEnvio(texto: string, d: Dicionario): string {
  const arroba = tabelaDeArroba(d);
  const canais = new Map<string, string>();
  for (const c of d.canais) {
    const n = c.nome.toLowerCase();
    if (!canais.has(n)) canais.set(n, `<#${c.id}>`);
  }
  const emojis = new Map<string, string>();
  for (const e of d.emojis) {
    if (!emojis.has(e.nome)) emojis.set(e.nome, `<${e.animado ? 'a' : ''}:${e.nome}:${e.id}>`);
  }

  const altArroba = alternancia(arroba.keys());
  const altCanal = alternancia(canais.keys());
  const altEmoji = alternancia(emojis.keys());
  // Borda: nada de letra, numero, barra de escape ou "/" antes (email, escape,
  // caminho de endereco); nada de letra ou numero depois (`@kayaaa` nao e `@kaya`).
  const reArroba = altArroba ? new RegExp(`(?<![\\p{L}\\p{N}_\\\\/])@(${altArroba})(?![\\p{L}\\p{N}_])`, 'giu') : null;
  const reCanal = altCanal ? new RegExp(`(?<![\\p{L}\\p{N}_\\\\/&])#(${altCanal})(?![\\p{L}\\p{N}_-])`, 'giu') : null;
  const reEmoji = altEmoji ? new RegExp(`(?<![\\p{L}\\p{N}\\\\])(?<!<a?):(${altEmoji}):`, 'gu') : null;

  return foraDoIntocavel(texto, (trecho) => {
    let t = trecho;
    if (reArroba) t = t.replace(reArroba, (inteiro, nome: string) => arroba.get(nome.toLowerCase()) ?? inteiro);
    if (reCanal) t = t.replace(reCanal, (inteiro, nome: string) => canais.get(nome.toLowerCase()) ?? inteiro);
    if (reEmoji) t = t.replace(reEmoji, (inteiro, nome: string) => emojis.get(nome) ?? inteiro);
    return t;
  });
}

/** O caminho inverso, para editar: as marcas voltam a ser nomes. */
export function paraEdicao(conteudo: string, d: Dicionario): string {
  const pessoas = new Map(d.pessoas.map((p) => [p.id, p.username]));
  const cargos = new Map(d.cargos.map((c) => [c.id, c.nome]));
  const canais = new Map(d.canais.map((c) => [c.id, c.nome]));
  const emojis = new Set(d.emojis.map((e) => e.id));

  let saida = '';
  let ultimo = 0;
  // Aqui o intocavel e so o codigo: as marcas SAO o que se quer traduzir.
  for (const m of conteudo.matchAll(/```[\s\S]*?```|``[\s\S]+?``|`[^`\n]+`/g)) {
    saida += traduzirMarcas(conteudo.slice(ultimo, m.index)) + m[0];
    ultimo = m.index + m[0].length;
  }
  return saida + traduzirMarcas(conteudo.slice(ultimo));

  function traduzirMarcas(trecho: string): string {
    return trecho
      .replace(/<@&(\d{1,20})>/g, (inteiro, id: string) => (cargos.has(id) ? `@${cargos.get(id)}` : inteiro))
      .replace(/<@!?(\d{1,20})>/g, (inteiro, id: string) => (pessoas.has(id) ? `@${pessoas.get(id)}` : inteiro))
      .replace(/<#(\d{1,20})>/g, (inteiro, id: string) => (canais.has(id) ? `#${canais.get(id)}` : inteiro))
      .replace(/<a?:([a-zA-Z0-9_]{2,32}):(\d{1,20})>/g, (inteiro, nome: string, id: string) => (emojis.has(id) ? `:${nome}:` : inteiro));
  }
}

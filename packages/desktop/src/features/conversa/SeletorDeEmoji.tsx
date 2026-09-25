import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../../store/index.js';
import { GRUPOS_DE_EMOJI } from '../../lib/emojis.js';
import { PALAVRAS_DE_EMOJI, emojiCombina, normalizar } from '../../components/emoji-palavras.js';
import { palavraDoEmoji } from './mencoes.js';

export type EmojiEscolhido =
  | { tipo: 'unicode'; emoji: string }
  | { tipo: 'servidor'; id: string; nome: string; animado: boolean; url: string };

const CHAVE_DOS_RECENTES = 'kiroshi.emojis-recentes';
const QUANTOS_RECENTES = 18;
const COLUNAS = 9;

function lerRecentes(): EmojiEscolhido[] {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_DOS_RECENTES) ?? '[]') as unknown;
    return Array.isArray(lista) ? (lista as EmojiEscolhido[]).filter((e) => e && (e.tipo === 'unicode' || e.tipo === 'servidor')) : [];
  } catch {
    return [];
  }
}

function guardarRecente(e: EmojiEscolhido): void {
  const chave = (x: EmojiEscolhido) => (x.tipo === 'unicode' ? x.emoji : x.id);
  const lista = [e, ...lerRecentes().filter((x) => chave(x) !== chave(e))].slice(0, QUANTOS_RECENTES);
  try {
    localStorage.setItem(CHAVE_DOS_RECENTES, JSON.stringify(lista));
  } catch {
    // sem armazenamento: so nao lembra
  }
}

function nomeDe(e: EmojiEscolhido): string {
  return e.tipo === 'servidor' ? e.nome : (PALAVRAS_DE_EMOJI[e.emoji]?.split(' ')[0] ?? '');
}

interface Grupo {
  nome: string;
  itens: EmojiEscolhido[];
}

/**
 * Seletor de emoji, para reagir e para escrever.
 *
 * Uma so parada de tabulacao na grade (setas andam, Enter escolhe): com um
 * botao tabulavel por emoji seriam trezentas paradas entre a busca e o fim.
 * Os recentes vem primeiro; depois os do servidor aberto, os dos outros e os
 * unicode. A busca acha pelas palavras em portugues (`emoji-palavras.ts`).
 */
export function SeletorDeEmoji({ guildId, aoEscolher }: { guildId: string | null; aoEscolher: (e: EmojiEscolhido) => void }) {
  const guilds = useStore((s) => s.guilds);
  const [busca, setBusca] = useState('');
  const [emFoco, setEmFoco] = useState<EmojiEscolhido | null>(null);
  const grade = useRef<HTMLDivElement>(null);
  const [recentes] = useState(lerRecentes);

  const grupos = useMemo<Grupo[]>(() => {
    const doServidor: EmojiEscolhido[] = [];
    const atual = guildId ? guilds.get(guildId) : undefined;
    for (const g of [...(atual ? [atual] : []), ...[...guilds.values()].filter((g) => g.id !== guildId)]) {
      for (const e of g.emojis) doServidor.push({ tipo: 'servidor', id: e.id, nome: e.name, animado: e.animated, url: e.url });
    }
    const termo = normalizar(busca.trim());
    if (termo) {
      // O nome do desenho primeiro: "fogo" traz o 🔥 antes do extintor, que
      // so tem "fogo" entre as outras palavras. O nome do grupo ("festa")
      // traz o grupo inteiro, depois dos que responderam pelo nome.
      const notas = new Map<string, number>();
      for (const g of GRUPOS_DE_EMOJI) {
        const doGrupo = normalizar(g.name).includes(termo);
        for (const e of g.emojis) {
          const nota = palavraDoEmoji(e, termo)?.nota ?? (emojiCombina(e, termo) ? 1 : 0);
          const final = Math.max(nota, doGrupo ? 0.5 : 0);
          if (final > (notas.get(e) ?? 0)) notas.set(e, final);
        }
      }
      const unicode = [...notas.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
      const achados: EmojiEscolhido[] = [
        ...doServidor.filter((e) => e.tipo === 'servidor' && normalizar(e.nome).includes(termo)),
        ...unicode.map((emoji): EmojiEscolhido => ({ tipo: 'unicode', emoji })),
      ];
      return [{ nome: 'Resultados', itens: achados }];
    }
    // Recente de servidor que nao existe mais nao volta.
    const existentes = new Set(doServidor.map((e) => (e.tipo === 'servidor' ? e.id : '')));
    const recentesValidos = recentes.filter((e) => e.tipo === 'unicode' || existentes.has(e.id));
    return [
      ...(recentesValidos.length ? [{ nome: 'Recentes', itens: recentesValidos }] : []),
      ...(doServidor.length ? [{ nome: 'Dos servidores', itens: doServidor }] : []),
      ...GRUPOS_DE_EMOJI.map((g) => ({ nome: g.name, itens: g.emojis.map((emoji): EmojiEscolhido => ({ tipo: 'unicode', emoji })) })),
    ];
  }, [guilds, guildId, busca, recentes]);

  const todos = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);

  function escolher(e: EmojiEscolhido) {
    guardarRecente(e);
    aoEscolher(e);
  }

  function botoes(): HTMLButtonElement[] {
    return [...(grade.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
  }

  function focar(indice: number) {
    const lista = botoes();
    const alvo = lista[Math.max(0, Math.min(lista.length - 1, indice))];
    if (!alvo) return;
    for (const b of lista) b.tabIndex = -1;
    alvo.tabIndex = 0;
    alvo.focus();
  }

  function aoTeclarNaGrade(e: KeyboardEvent<HTMLDivElement>) {
    const lista = botoes();
    const atual = lista.indexOf(document.activeElement as HTMLButtonElement);
    if (atual === -1) return;
    const passo = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUNAS, ArrowUp: -COLUNAS }[e.key];
    if (passo === undefined) return;
    e.preventDefault();
    // Subir da primeira linha volta para a busca.
    if (atual + passo < 0) {
      grade.current?.parentElement?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    focar(atual + passo);
  }

  let indice = 0;
  return (
    <div className="flex w-[348px] flex-col">
      <div className="flex items-center gap-2 border-b border-borda px-3">
        <Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focar(0);
            } else if (e.key === 'Enter' && todos[0]) {
              e.preventDefault();
              escolher(todos[0]);
            }
          }}
          placeholder="Buscar: risada, coração, fogo…"
          aria-label="Buscar emoji"
          className="h-10 min-w-0 flex-1 bg-transparente text-14 text-texto outline-none placeholder:text-mudo"
        />
      </div>
      <div ref={grade} onKeyDown={aoTeclarNaGrade} className="k-rolagem h-[320px] overflow-y-auto px-2 pb-2">
        {todos.length === 0 ? (
          <p className="px-2 py-8 text-center text-13 text-texto-3">
            Nada para “{busca.trim()}”. Tente o que o desenho mostra: risada, coração, fogo, joia.
          </p>
        ) : (
          grupos.map((g) =>
            g.itens.length === 0 ? null : (
              <section key={g.nome} aria-label={g.nome}>
                <p className="k-rotulo sticky top-0 bg-elevado px-1 pb-1 pt-2.5">{g.nome}</p>
                <div className="grid grid-cols-9">
                  {g.itens.map((e) => {
                    const i = indice++;
                    const nome = nomeDe(e);
                    return (
                      <button
                        key={`${g.nome}-${e.tipo === 'unicode' ? e.emoji : e.id}`}
                        type="button"
                        data-emoji
                        tabIndex={i === 0 ? 0 : -1}
                        aria-label={nome ? `${e.tipo === 'unicode' ? e.emoji : ''} ${nome}`.trim() : e.tipo === 'unicode' ? e.emoji : 'emoji'}
                        onClick={() => escolher(e)}
                        onFocus={() => setEmFoco(e)}
                        onMouseEnter={() => setEmFoco(e)}
                        className="grid size-9 place-items-center text-[22px] leading-none hover:bg-realce-forte focus-visible:bg-acento-tenue focus-visible:outline-offset-[-2px]"
                      >
                        {e.tipo === 'unicode' ? e.emoji : <img src={e.url} alt="" draggable={false} className="size-6 object-contain" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ),
          )
        )}
      </div>
      <div aria-hidden className="flex h-10 items-center gap-2 border-t border-borda px-3 text-13 text-texto-2">
        {emFoco ? (
          <>
            <span className="text-[20px] leading-none">
              {emFoco.tipo === 'unicode' ? emFoco.emoji : <img src={emFoco.url} alt="" className="size-5 object-contain" />}
            </span>
            <span className="truncate font-mono text-12">:{nomeDe(emFoco)}:</span>
          </>
        ) : (
          <span className="font-mono text-10 uppercase tracking-rotulo text-mudo">Setas navegam · Enter escolhe</span>
        )}
      </div>
    </div>
  );
}

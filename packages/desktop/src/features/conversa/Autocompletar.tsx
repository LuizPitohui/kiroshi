import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { Hash } from 'lucide-react';
import { Avatar, cx } from '../../design/primitivos/index.js';
import { aplicarSugestao, consultaNoCursor, sugerir, type Consulta, type FontesDeSugestao, type Sugestao } from './mencoes.js';

/**
 * Onde, em pixels, fica um caractere dentro do textarea.
 *
 * O textarea nao conta onde o cursor esta desenhado. A tecnica e a de sempre:
 * um espelho invisivel com o mesmo estilo e o mesmo texto ate a posicao, e um
 * marcador no fim. Serve para abrir a lista de sugestoes EM CIMA do que se
 * esta digitando, e nao na borda esquerda cobrindo o comeco das mensagens.
 */
const PROPRIEDADES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const;

export function posicaoDoCaractere(campo: HTMLTextAreaElement, indice: number): { x: number; y: number } {
  const espelho = document.createElement('div');
  const estilo = getComputedStyle(campo);
  for (const p of PROPRIEDADES) espelho.style[p] = estilo[p];
  espelho.style.position = 'absolute';
  espelho.style.visibility = 'hidden';
  espelho.style.whiteSpace = 'pre-wrap';
  espelho.style.overflowWrap = 'break-word';
  espelho.style.top = '0';
  espelho.style.left = '-9999px';
  espelho.textContent = campo.value.slice(0, indice);
  const marca = document.createElement('span');
  marca.textContent = campo.value.slice(indice) || '.';
  espelho.appendChild(marca);
  document.body.appendChild(espelho);
  const posicao = { x: marca.offsetLeft - campo.scrollLeft, y: marca.offsetTop - campo.scrollTop };
  espelho.remove();
  return posicao;
}

interface Opcoes {
  campo: RefObject<HTMLTextAreaElement | null>;
  valor: string;
  /** Troca o texto do campo e poe o cursor na posicao. */
  aoTrocar: (texto: string, cursor: number) => void;
  obterFontes: () => FontesDeSugestao;
}

export interface Autocompletar {
  aberto: boolean;
  sugestoes: Sugestao[];
  indice: number;
  consulta: Consulta | null;
  /** Chamar depois de cada mudanca de texto ou de cursor. */
  atualizar: () => void;
  /** Chamar primeiro no `onKeyDown` do campo; `true` = a tecla foi usada aqui. */
  aoTeclar: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  aceitar: (s: Sugestao) => void;
  escolherIndice: (i: number) => void;
  fechar: () => void;
  idDaLista: string;
  idDaOpcao: (i: number) => string;
}

export function useAutocompletar({ campo, valor, aoTrocar, obterFontes }: Opcoes): Autocompletar {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [indice, setIndice] = useState(0);
  // Esc fecha ate a consulta mudar de lugar: fechar e continuar digitando o
  // mesmo nome nao pode reabrir a lista a cada letra.
  const [fechadaEm, setFechadaEm] = useState<number | null>(null);
  const idDaLista = useId();

  // As fontes so sao lidas quando ha consulta; o texto da consulta e a chave.
  const chave = consulta ? `${consulta.gatilho}${consulta.termo}` : '';
  const sugestoes = useMemo(() => (consulta ? sugerir(consulta, obterFontes()) : []), [chave]);
  const aberto = Boolean(consulta) && sugestoes.length > 0 && fechadaEm !== consulta?.inicio;

  function atualizar() {
    const el = campo.current;
    if (!el) return;
    const nova = el.selectionStart === el.selectionEnd ? consultaNoCursor(el.value, el.selectionStart) : null;
    const mesmoLugar = Boolean(nova && consulta && nova.inicio === consulta.inicio);
    if (!mesmoLugar) setFechadaEm(null);
    // A selecao so volta ao topo quando o termo muda: mover o cursor sem
    // digitar nao pode perder a opcao que a pessoa escolheu com as setas.
    if (!mesmoLugar || nova?.termo !== consulta?.termo) setIndice(0);
    setConsulta(nova);
  }

  function aceitar(s: Sugestao) {
    if (!consulta) return;
    const r = aplicarSugestao(valor, consulta, s);
    aoTrocar(r.texto, r.cursor);
    setConsulta(null);
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!aberto || !consulta) return false;
    const n = sugestoes.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      const s = sugestoes[indice];
      if (!s) return false;
      e.preventDefault();
      aceitar(s);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setFechadaEm(consulta.inicio);
      return true;
    }
    return false;
  }

  return {
    aberto,
    sugestoes,
    indice,
    consulta,
    atualizar,
    aoTeclar,
    aceitar,
    escolherIndice: setIndice,
    fechar: () => consulta && setFechadaEm(consulta.inicio),
    idDaLista,
    idDaOpcao: (i) => `${idDaLista}-${i}`,
  };
}

const TITULOS: Record<Sugestao['tipo'], string> = {
  pessoa: 'Pessoas',
  cargo: 'Cargos',
  todos: 'Todos',
  canal: 'Canais',
  emoji: 'Emojis',
};

/**
 * A lista, acima do campo e alinhada ao gatilho. O foco fica no campo o tempo
 * todo (a lista e `aria-activedescendant` dele): clicar numa opcao nao pode
 * tirar o cursor de onde a pessoa escreve.
 */
export function ListaDeSugestoes({ auto, campo }: { auto: Autocompletar; campo: RefObject<HTMLTextAreaElement | null> }) {
  if (!auto.aberto || !auto.consulta) return null;

  const el = campo.current;
  let esquerda = 0;
  if (el) {
    const { x } = posicaoDoCaractere(el, auto.consulta.inicio);
    esquerda = Math.max(0, Math.min(x + el.offsetLeft - 12, el.offsetLeft + el.clientWidth - 320));
  }

  let grupoAnterior: string | null = null;
  return (
    <div
      id={auto.idDaLista}
      role="listbox"
      aria-label={`Sugestões de ${TITULOS[auto.sugestoes[0]!.tipo].toLowerCase()}`}
      className="absolute bottom-full z-[var(--k-z-menu)] mb-2 w-[320px] border border-borda-2 bg-elevado py-1 shadow-camada"
      style={{ left: esquerda }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {auto.sugestoes.map((s, i) => {
        const titulo = TITULOS[s.tipo];
        const cabeca = titulo !== grupoAnterior ? titulo : null;
        grupoAnterior = titulo;
        const selecionada = i === auto.indice;
        return (
          <div key={s.chave}>
            {cabeca ? (
              <p aria-hidden className="k-rotulo px-2.5 pb-1 pt-2">
                {cabeca}
              </p>
            ) : null}
            <div
              id={auto.idDaOpcao(i)}
              role="option"
              aria-selected={selecionada}
              onMouseEnter={() => auto.escolherIndice(i)}
              onClick={() => auto.aceitar(s)}
              className={cx(
                'flex h-[34px] cursor-pointer items-center gap-2.5 px-2.5 text-[13.5px]',
                selecionada ? 'bg-acento-tenue text-texto shadow-[inset_2px_0_0_var(--k-acento)]' : 'text-texto-2',
              )}
            >
              {s.tipo === 'pessoa' ? <Avatar nome={s.rotulo} id={s.id} url={s.avatarUrl} tamanho={20} /> : null}
              {s.tipo === 'cargo' || s.tipo === 'todos' ? (
                <span
                  aria-hidden
                  className="grid size-5 place-items-center border border-borda-2 font-mono text-11 text-mencao"
                  style={s.tipo === 'cargo' && s.cor ? { color: s.cor } : undefined}
                >
                  @
                </span>
              ) : null}
              {s.tipo === 'canal' ? <Hash aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} /> : null}
              {s.tipo === 'emoji' ? (
                <span aria-hidden className="grid size-5 place-items-center text-[18px] leading-none">
                  {s.url ? <img src={s.url} alt="" className="size-5 object-contain" /> : s.caractere}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{s.tipo === 'emoji' ? `:${s.rotulo}:` : s.rotulo}</span>
              {'detalhe' in s && s.detalhe ? (
                <small className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-texto-3">{s.detalhe}</small>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Os atributos ARIA do campo com autocompletar. Sem : num
 * textarea ele troca o anuncio de "campo de texto de varias linhas" por
 * "caixa de combinacao", que nao e o que o campo e.
 */
export function ariaDoCampo(auto: Autocompletar) {
  return {
    'aria-autocomplete': 'list' as const,
    'aria-controls': auto.aberto ? auto.idDaLista : undefined,
    'aria-activedescendant': auto.aberto ? auto.idDaOpcao(auto.indice) : undefined,
  };
}


import { create } from 'zustand';
import type { AcaoDeAtalho, Atalho } from '../../electron/preload.js';

/*
  Os atalhos da chamada do lado da interface: o nome para mostrar, a captura
  da tecla escolhida e o estado (quais atalhos, e se a escuta global do
  processo principal esta de pe). A escuta em si mora em electron/atalhos.ts.
*/

export type { AcaoDeAtalho, Atalho };

const MODIFICADORES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

const NOMES: Record<string, string> = {
  Space: 'Espaço',
  Backquote: "'",
  CapsLock: 'Caps Lock',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl direito',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift direito',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  MetaLeft: 'Windows',
  MetaRight: 'Windows direito',
  ArrowUp: 'Seta para cima',
  ArrowDown: 'Seta para baixo',
  ArrowLeft: 'Seta para a esquerda',
  ArrowRight: 'Seta para a direita',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

const NOMES_DO_MOUSE: Record<3 | 4 | 5, string> = { 3: 'Botão do meio', 4: 'Mouse 4 (voltar)', 5: 'Mouse 5 (avançar)' };

/** O nome de uma tecla pelo codigo do navegador: "KeyV" -> "V", "Numpad1" -> "Num 1". */
export function nomeDaTecla(codigo: string): string {
  if (codigo.startsWith('Key')) return codigo.slice(3);
  if (codigo.startsWith('Digit')) return codigo.slice(5);
  if (codigo.startsWith('Numpad')) return `Num ${codigo.slice(6)}`;
  return NOMES[codigo] ?? codigo;
}

/** "V", "Ctrl + Shift + M", "Mouse 4 (voltar)"; sem atalho, "Nenhum". */
export function rotuloDoAtalho(atalho: Atalho | null): string {
  if (!atalho) return 'Nenhum';
  if (atalho.tipo === 'mouse') return NOMES_DO_MOUSE[atalho.botao];
  const partes: string[] = [];
  if (atalho.ctrl && !atalho.codigo.startsWith('Control')) partes.push('Ctrl');
  if (atalho.shift && !atalho.codigo.startsWith('Shift')) partes.push('Shift');
  if (atalho.alt && !atalho.codigo.startsWith('Alt')) partes.push('Alt');
  if (atalho.meta && !atalho.codigo.startsWith('Meta')) partes.push('Windows');
  partes.push(atalho.nome ?? nomeDaTecla(atalho.codigo));
  return partes.join(' + ');
}

type EventoDeTecla = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'> & { key?: string };

/**
 * O nome que a pessoa ve na tecla. O codigo e a POSICAO no teclado americano:
 * no ABNT2 a tecla do "Ç" tem o codigo do ponto e virgula. O caractere que ela
 * escreve, lido na captura, e o nome certo; teclas sem caractere usam a lista.
 */
function nomeVisto(e: EventoDeTecla): string | undefined {
  const k = e.key;
  if (!k || k.length !== 1 || k === ' ' || e.code.startsWith('Numpad')) return undefined;
  return k.toUpperCase();
}

/**
 * O atalho que uma tecla apertada vira.
 *
 * Falar e segurar: a tecla sozinha vale, inclusive um modificador (Alt Gr e
 * Caps Lock sao escolhas comuns), e os modificadores apertados junto nao
 * contam. Mutar e ensurdecer sao combinacoes: um modificador sozinho ainda nao
 * e o atalho — a pessoa esta no meio de montar Ctrl + Shift + M.
 */
export function atalhoDaTecla(e: EventoDeTecla, acao: AcaoDeAtalho): Atalho | null {
  if (!e.code || e.code === 'Escape') return null;
  const nome = nomeVisto(e);
  if (acao === 'falar') return { tipo: 'tecla', codigo: e.code, ctrl: false, shift: false, alt: false, meta: false, ...(nome ? { nome } : {}) };
  if (MODIFICADORES.has(e.code)) return null;
  // Com Shift apertado o caractere muda ("1" vira "!"): sem ele, o nome da lista.
  const semShift = e.shiftKey ? undefined : nome;
  return {
    tipo: 'tecla',
    codigo: e.code,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    ...(semShift ? { nome: semShift } : {}),
  };
}

/** Botao do mouse apertado -> atalho; esquerdo e direito nunca (clicar em algo mutaria). */
export function atalhoDoMouse(botaoDoNavegador: number): Atalho | null {
  // Navegador: 1 meio, 3 voltar, 4 avancar. Escuta global: 3, 4 e 5.
  const botao = botaoDoNavegador === 1 ? 3 : botaoDoNavegador === 3 ? 4 : botaoDoNavegador === 4 ? 5 : null;
  return botao ? { tipo: 'mouse', botao } : null;
}

/** A tecla apertada e este atalho (com a janela em foco, sem a escuta global). */
export function teclaBate(atalho: Atalho | null, e: EventoDeTecla, acao: AcaoDeAtalho): boolean {
  if (!atalho || atalho.tipo !== 'tecla' || atalho.codigo !== e.code) return false;
  if (acao === 'falar') return true;
  return atalho.ctrl === e.ctrlKey && atalho.shift === e.shiftKey && atalho.alt === e.altKey && atalho.meta === e.metaKey;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

interface EstadoDosAtalhos {
  atalhos: Record<AcaoDeAtalho, Atalho | null>;
  /** A escuta global do processo principal esta de pe. */
  globais: boolean;
  carregado: boolean;
  carregar: () => Promise<void>;
  definir: (acao: AcaoDeAtalho, atalho: Atalho | null) => Promise<void>;
}

export const useAtalhos = create<EstadoDosAtalhos>((set, get) => ({
  atalhos: { falar: null, mutar: null, ensurdecer: null },
  globais: false,
  carregado: false,
  carregar: async () => {
    const ponte = window.kiroshi;
    if (!ponte?.preferencias) return;
    const [preferencias, globais] = await Promise.all([ponte.preferencias.ler(), ponte.atalhos.ativos()]);
    set({ atalhos: preferencias.atalhos, globais, carregado: true });
  },
  definir: async (acao, atalho) => {
    const ponte = window.kiroshi;
    if (!ponte?.preferencias) return;
    const preferencias = await ponte.preferencias.gravar({ atalhos: { ...get().atalhos, [acao]: atalho } });
    set({ atalhos: preferencias.atalhos, globais: await ponte.atalhos.ativos() });
  },
}));

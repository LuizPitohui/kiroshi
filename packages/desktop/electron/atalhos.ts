import type { AcaoDeAtalho, Atalho } from './preload.js';

/**
 * Atalhos globais: falar (segurar), mutar e ensurdecer, com o jogo na frente.
 *
 * Pela escuta de teclado do sistema (`uiohook-napi`), e nao pelo
 * `globalShortcut` do Electron, por dois motivos que o jogo sente:
 *
 *   o `globalShortcut` so avisa quando a tecla desce — segurar para falar
 *   virava alternar, e a pessoa ficava com o microfone aberto sem perceber;
 *
 *   ele toma a tecla para si: a combinacao registrada deixa de chegar ao
 *   jogo. A escuta so observa; a tecla segue para quem estiver na frente.
 *
 * Nada e guardado nem enviado: cada evento e comparado com os atalhos
 * escolhidos e esquecido. Sem nenhum atalho definido, a escuta nem liga.
 */

type Gancho = typeof import('uiohook-napi');

const ACOES: readonly AcaoDeAtalho[] = ['falar', 'mutar', 'ensurdecer'];

/** Nomes do navegador (`KeyboardEvent.code`) que a escuta chama diferente. */
const RENOMES: Record<string, string> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  ShiftLeft: 'Shift',
  AltLeft: 'Alt',
  MetaLeft: 'Meta',
};

let gancho: Gancho | null | undefined;
let rodando = false;
let ouvindo = false;
let enviar: (acao: AcaoDeAtalho, pressionado: boolean) => void = () => undefined;
/** Os atalhos ja traduzidos para os codigos da escuta. */
let alvos: { acao: AcaoDeAtalho; atalho: Atalho; codigo: number | null }[] = [];
/** O que esta apertado agora: segurar a tecla repete o evento, e isso nao e um aperto novo. */
const apertadas = new Set<AcaoDeAtalho>();

async function carregar(): Promise<Gancho | null> {
  if (gancho !== undefined) return gancho;
  try {
    gancho = await import('uiohook-napi');
  } catch (erro) {
    // Sem a escuta (modulo nativo ausente ou recusado), os atalhos valem so com
    // a janela em foco — a interface cuida disso. O app abre igual.
    console.error('[atalhos] escuta global indisponivel', erro);
    gancho = null;
  }
  return gancho;
}

/** `KeyV` -> codigo da escuta; null quando a escuta nao conhece a tecla. */
export function codigoDaEscuta(g: Gancho, codigo: string): number | null {
  const nome = codigo.startsWith('Key') ? codigo.slice(3) : codigo.startsWith('Digit') ? codigo.slice(5) : (RENOMES[codigo] ?? codigo);
  const valor = (g.UiohookKey as Record<string, number>)[nome];
  return typeof valor === 'number' ? valor : null;
}

function modificadoresBatem(atalho: Extract<Atalho, { tipo: 'tecla' }>, e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return atalho.ctrl === e.ctrlKey && atalho.shift === e.shiftKey && atalho.alt === e.altKey && atalho.meta === e.metaKey;
}

function descer(acao: AcaoDeAtalho): void {
  if (apertadas.has(acao)) return;
  apertadas.add(acao);
  enviar(acao, true);
}

function subir(acao: AcaoDeAtalho): void {
  if (!apertadas.delete(acao)) return;
  // So falar precisa do soltar; mutar e ensurdecer alternam no aperto.
  if (acao === 'falar') enviar(acao, false);
}

function ouvir(g: Gancho): void {
  if (ouvindo) return;
  ouvindo = true;
  g.uIOhook.on('keydown', (e) => {
    for (const alvo of alvos) {
      if (alvo.atalho.tipo !== 'tecla' || alvo.codigo !== e.keycode) continue;
      // Falar vale com qualquer modificador: ninguem solta o Shift para falar correndo.
      if (alvo.acao !== 'falar' && !modificadoresBatem(alvo.atalho, e)) continue;
      descer(alvo.acao);
    }
  });
  g.uIOhook.on('keyup', (e) => {
    for (const alvo of alvos) {
      if (alvo.atalho.tipo === 'tecla' && alvo.codigo === e.keycode) subir(alvo.acao);
    }
  });
  g.uIOhook.on('mousedown', (e) => {
    for (const alvo of alvos) if (alvo.atalho.tipo === 'mouse' && alvo.atalho.botao === e.button) descer(alvo.acao);
  });
  g.uIOhook.on('mouseup', (e) => {
    for (const alvo of alvos) if (alvo.atalho.tipo === 'mouse' && alvo.atalho.botao === e.button) subir(alvo.acao);
  });
}

/**
 * Liga, troca ou desliga a escuta conforme os atalhos. Devolve se ela esta
 * de pe (ou se nao precisava estar).
 */
export async function configurarAtalhos(
  atalhos: Record<AcaoDeAtalho, Atalho | null>,
  aoAcionar: (acao: AcaoDeAtalho, pressionado: boolean) => void,
): Promise<boolean> {
  enviar = aoAcionar;
  const algum = ACOES.some((acao) => atalhos[acao]);
  const g = algum ? await carregar() : gancho;

  if (g) {
    alvos = ACOES.flatMap((acao) => {
      const atalho = atalhos[acao];
      if (!atalho) return [];
      return [{ acao, atalho, codigo: atalho.tipo === 'tecla' ? codigoDaEscuta(g, atalho.codigo) : null }];
    });
    // Trocar um atalho no meio de um aperto nao pode deixar o microfone aberto.
    for (const acao of [...apertadas]) subir(acao);
  }

  if (algum && g && !rodando) {
    ouvir(g);
    try {
      g.uIOhook.start();
      rodando = true;
    } catch (erro) {
      console.error('[atalhos] a escuta global nao ligou', erro);
    }
  } else if (!algum && g && rodando) {
    g.uIOhook.stop();
    rodando = false;
  }
  return !algum || rodando;
}

/** A escuta global esta de pe agora. */
export function atalhosGlobaisAtivos(): boolean {
  return rodando;
}

export function pararAtalhos(): void {
  if (gancho && rodando) {
    try {
      gancho.uIOhook.stop();
    } catch {
      // saindo do app: nada a fazer
    }
  }
  rodando = false;
}

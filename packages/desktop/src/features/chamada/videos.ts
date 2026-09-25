/**
 * Os elementos `<video>` da chamada, criados uma vez e movidos — nunca
 * recriados (regra 2 de docs/conhecimento/04-midia.md).
 *
 * Na 1.x trocar do canal de voz para um de texto desmontava um palco e
 * montava outro: o video era solto, a faixa ficava invisivel, voltava, e a
 * imagem esperava um quadro-chave — uma travada a cada troca de tela. Aqui
 * cada video (pessoa + fonte) tem UM elemento para a vida inteira da
 * transmissao. O quadro que o mostra so empresta: ao montar, move o elemento
 * para dentro de si; ao sair, deixa-o para o proximo (destaque, grade, mini
 * palco).
 *
 * Com `Element.moveBefore` (Chromium 133+, o Electron 38 tem) a mudanca de
 * lugar preserva a reproducao; sem ele, `appendChild` e um `play()` logo em
 * seguida.
 */

/** O que se anexa a um `<video>`: faixa do LiveKit, ou a sintetica da vitrine. */
export interface FonteDeVideo {
  attach(elemento: HTMLMediaElement): HTMLMediaElement;
  detach(elemento: HTMLMediaElement): HTMLMediaElement;
}

interface Registro {
  elemento: HTMLVideoElement;
  fonte: FonteDeVideo | null;
}

const registros = new Map<string, Registro>();

function registro(chave: string): Registro {
  let r = registros.get(chave);
  if (!r) {
    const elemento = document.createElement('video');
    elemento.autoplay = true;
    elemento.playsInline = true;
    // O som nunca sai daqui: voz e audio da transmissao tem elementos proprios
    // no controlador, com volume por pessoa.
    elemento.muted = true;
    elemento.dataset.video = chave;
    elemento.className = 'block size-full bg-preto object-contain';
    r = { elemento, fonte: null };
    registros.set(chave, r);
  }
  return r;
}

/** Liga a fonte ao elemento da chave. A mesma fonte de novo nao faz nada. */
export function ligarFonte(chave: string, fonte: FonteDeVideo | null): void {
  const r = registro(chave);
  if (r.fonte === fonte) return;
  if (r.fonte) r.fonte.detach(r.elemento);
  r.fonte = fonte;
  if (fonte) fonte.attach(r.elemento);
}

type ComMoveBefore = HTMLElement & { moveBefore?: (no: Node, antes: Node | null) => void };

/** Poe o elemento da chave dentro de `destino`, movendo-o se estiver em outro lugar. */
export function hospedar(chave: string, destino: HTMLElement): HTMLVideoElement {
  const { elemento } = registro(chave);
  if (elemento.parentElement !== destino) {
    const d = destino as ComMoveBefore;
    let movido = false;
    // So move preservando estado entre dois pontos do MESMO documento vivo.
    if (d.moveBefore && elemento.isConnected && destino.isConnected) {
      try {
        d.moveBefore(elemento, null);
        movido = true;
      } catch {
        // cai no caminho comum
      }
    }
    if (!movido) destino.appendChild(elemento);
  }
  if (elemento.paused) void elemento.play().catch(() => undefined);
  return elemento;
}

/** Espelha (a propria camera) ou nao. */
export function espelhar(chave: string, sim: boolean): void {
  registro(chave).elemento.style.transform = sim ? 'scaleX(-1)' : '';
}

/**
 * Solta tudo que nao esta mais na chamada (parou de transmitir, desligou a
 * camera, saiu). O elemento de quem continua nao e tocado.
 */
export function podar(vivas: ReadonlySet<string>): void {
  for (const [chave, r] of registros) {
    if (vivas.has(chave)) continue;
    if (r.fonte) r.fonte.detach(r.elemento);
    r.elemento.remove();
    registros.delete(chave);
  }
}

/** Quantos videos existem, para os testes e o diagnostico. */
export function quantosVideos(): number {
  return registros.size;
}

/** O elemento de uma chave, se existir (tela cheia, diagnostico). */
export function elementoDe(chave: string): HTMLVideoElement | null {
  return registros.get(chave)?.elemento ?? null;
}

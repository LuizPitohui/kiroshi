/**
 * Tema da interface: escuro, claro ou o do sistema.
 *
 * Aplicado ANTES do primeiro desenho (chamado no `main.tsx`). A interface
 * antiga aplicava num efeito do React, depois do primeiro quadro, e quem usava
 * o tema claro via a janela piscar escura ao abrir.
 *
 * "Sistema" segue o Windows ao vivo: trocar o tema do computador com o app
 * aberto troca o app, sem reiniciar.
 */

export type Tema = 'escuro' | 'claro' | 'sistema';

const CHAVE = 'kiroshi.tema';

function valido(valor: string | null): valor is Tema {
  return valor === 'escuro' || valor === 'claro' || valor === 'sistema';
}

function ler(): Tema {
  try {
    const guardado = localStorage.getItem(CHAVE);
    return valido(guardado) ? guardado : 'escuro';
  } catch {
    return 'escuro';
  }
}

const preferenciaClara =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

/** O tema que vale de fato agora, resolvendo "sistema". */
export function temaEfetivo(tema: Tema, sistemaClaro: boolean): 'escuro' | 'claro' {
  if (tema === 'sistema') return sistemaClaro ? 'claro' : 'escuro';
  return tema;
}

function pintar(tema: Tema): void {
  const efetivo = temaEfetivo(tema, preferenciaClara?.matches ?? false);
  if (efetivo === 'claro') document.documentElement.dataset.tema = 'claro';
  else delete document.documentElement.dataset.tema;
}

let atual: Tema = 'escuro';

function escrever(tema: Tema): Tema {
  atual = valido(tema) ? tema : 'escuro';
  try {
    localStorage.setItem(CHAVE, atual);
  } catch {
    // Sem armazenamento (janela privada, disco cheio): vale so nesta sessao.
  }
  pintar(atual);
  return atual;
}

function instalar(): void {
  atual = ler();
  pintar(atual);
  preferenciaClara?.addEventListener('change', () => {
    if (atual === 'sistema') pintar(atual);
  });
}

export const aplicarTema = { ler: () => atual, escrever, instalar };

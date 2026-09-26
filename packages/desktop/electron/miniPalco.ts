import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';

/**
 * A miniatura da chamada como janela propria do Windows.
 *
 * Pedido do dono em 2026-09-26: "essa miniatura da transmissao devo poder
 * mover ela livremente pelo computador e poder redimensionar ela, clicar nela
 * e ter a opcao de voltar para a tela da chamada". Presa no canto da janela do
 * app, ela nao saia de la e sumia com o app minimizado.
 *
 * A interface abre a janela com `window.open('', NOME_DA_JANELA_DO_MINI_PALCO)`
 * e desenha dentro dela por um portal do React (`JanelaFlutuante.tsx`); o
 * video e o mesmo elemento do palco, movido (`videos.ts`). Aqui o processo
 * principal so da o que a janela precisa ser: sem moldura, sempre por cima,
 * 16:9, fora da barra de tarefas, e nunca perdida fora das telas.
 */

/**
 * Prefixo do nome da janela, o mesmo da interface (`JanelaFlutuante.tsx`). A
 * interface poe um numero depois a cada abertura.
 */
export const NOME_DA_JANELA_DO_MINI_PALCO = 'kiroshi-mini-palco';

export function opcoesDoMiniPalco(icone: string): BrowserWindowConstructorOptions {
  return {
    frame: false,
    // A borda grossa do Windows e o que deixa redimensionar pelas beiradas
    // numa janela sem moldura.
    thickFrame: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Aparece depois de posicionada, e sem roubar o foco de quem esta lendo
    // outro canal ou jogando (`showInactive` no `did-create-window`).
    show: false,
    minWidth: 256,
    minHeight: 144,
    backgroundColor: '#000000',
    title: 'Kiroshi — chamada',
    icon: icone,
    webPreferences: {
      // Por cima de um jogo em tela cheia ela continua desenhando.
      backgroundThrottling: false,
    },
  };
}

/**
 * Onde a janela fica para caber na area de trabalho da tela: o mesmo tamanho
 * (ate o da area) e empurrada para dentro. Posicao salva num monitor que foi
 * desligado, ou arrastada para fora, volta a ser alcancavel.
 */
export function limitesDentroDaArea(janela: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(janela.width, area.width);
  const height = Math.min(janela.height, area.height);
  const x = Math.min(Math.max(janela.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(janela.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

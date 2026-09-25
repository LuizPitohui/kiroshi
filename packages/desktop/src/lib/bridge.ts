import type { KiroshiApi } from '../../electron/preload.js';

/**
 * Substituto do preload para quando a interface roda fora do Electron.
 *
 * Serve para abrir a tela em um navegador comum durante o desenvolvimento e
 * conferir layout sem empacotar o app. Tudo que depende do sistema (captura de
 * tela, bandeja, atalho global) vira um no-op explicito em vez de quebrar a
 * pagina com "cannot read property of undefined".
 */

function createBrowserFallback(): KiroshiApi {
  const noop = (): void => undefined;
  const unsubscribe = (): void => undefined;

  return {
    window: {
      minimize: noop,
      maximize: noop,
      close: noop,
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: () => unsubscribe,
      // No navegador a aba escondida ja e `hidden`: e o mesmo sinal.
      onOcultaChange: (handler: (oculta: boolean) => void) => {
        const aoMudar = () => handler(document.visibilityState === 'hidden');
        document.addEventListener('visibilitychange', aoMudar);
        return () => document.removeEventListener('visibilitychange', aoMudar);
      },
    },
    google: {
      /*
        Fora do Electron nao ha como levantar porta local nem abrir o navegador
        do sistema — e o Google recusaria a aba embutida de qualquer forma.
        Falha explicita e melhor que um botao que nao faz nada.
      */
      preparar: () => Promise.reject(new Error('login com Google so no aplicativo')),
      abrirEEsperar: () =>
        Promise.resolve({ entrega: null, erro: 'login com Google so no aplicativo' }),
      cancelar: () => Promise.resolve(false),
    },
    app: {
      quit: noop,
      version: () => Promise.resolve('dev'),
      platform: () => Promise.resolve(navigator.platform),
    },
    screen: {
      // Sem Electron nao ha como listar janelas do sistema.
      sources: () => Promise.resolve([]),
      select: () => Promise.resolve(false),
    },
    pushToTalk: {
      register: () => Promise.resolve(false),
      unregister: () => Promise.resolve(false),
      onToggle: () => unsubscribe,
    },
    notifications: {
      show: (title: string, body: string) => {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission === 'granted') new Notification(title, { body });
      },
      setBadge: noop,
      flash: noop,
    },
    autostart: {
      get: () => Promise.resolve(false),
      set: (enabled: boolean) => Promise.resolve(enabled),
    },
    atualizacao: {
      // Fora do Electron nao ha o que atualizar: a pagina ja e a versao nova.
      estado: () =>
        Promise.resolve({ fase: 'ocioso' as const, versao: null, progresso: 0, erro: null }),
      instalarEReiniciar: noop,
      procurar: () =>
        Promise.resolve({ fase: 'ocioso' as const, versao: null, progresso: 0, erro: null }),
      aoMudar: () => unsubscribe,
    },
  };
}

/** Garante que window.kiroshi exista antes de qualquer componente montar. */
export function installBridge(): void {
  migrarChavesAntigas();
  if (window.kiroshi) return;
  window.kiroshi = createBrowserFallback();
  console.info('Kiroshi rodando fora do Electron: recursos do sistema desativados.');
}

/**
 * Move o que estava guardado sob o nome antigo do produto.
 *
 * O aplicativo se chamava Order e as chaves locais seguiam esse nome. Trocar o
 * nome sem mover nada desconectaria todo mundo e zeraria as preferencias de
 * audio — um incomodo gratuito causado por uma decisao de marca. Roda uma vez
 * e nao volta a fazer nada.
 */
function migrarChavesAntigas(): void {
  try {
    if (localStorage.getItem('kiroshi.migrado') === '1') return;

    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (!chave?.startsWith('order.')) continue;

      const nova = chave.replace(/^order\./, 'kiroshi.');
      if (localStorage.getItem(nova) !== null) continue;

      const valor = localStorage.getItem(chave);
      if (valor !== null) localStorage.setItem(nova, valor);
    }

    localStorage.setItem('kiroshi.migrado', '1');
  } catch {
    // Armazenamento bloqueado: segue sem migrar, a pessoa so entra de novo.
  }
}

export function isElectron(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

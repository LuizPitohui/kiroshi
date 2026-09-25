import { contextBridge, ipcRenderer } from 'electron';

/**
 * Ponte entre a interface e o processo principal.
 *
 * A interface nao tem acesso a node nem ao ipcRenderer cru: so ao conjunto
 * fechado de funcoes abaixo. Se algo aqui nao existe, a interface nao
 * consegue fazer.
 */

/**
 * Onde a atualizacao esta.
 *
 *   ocioso      nada em andamento
 *   procurando  consultando o servidor
 *   baixando    tem versao nova e esta vindo; `progresso` de 0 a 100
 *   pronta      baixada, basta reiniciar
 *   erro        nao deu; o aplicativo continua funcionando normalmente
 */
export interface AtualizacaoEstado {
  fase: 'ocioso' | 'procurando' | 'baixando' | 'pronta' | 'erro';
  versao: string | null;
  progresso: number;
  erro: string | null;
}

/**
 * Um atalho global: uma tecla (o `KeyboardEvent.code` do navegador, com os
 * modificadores) ou um botao do mouse (numeracao da escuta: 3 meio, 4 voltar,
 * 5 avancar).
 */
export type Atalho =
  | {
      tipo: 'tecla';
      codigo: string;
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta: boolean;
      /** O caractere que a tecla escreve no teclado de quem escolheu (ABNT2: "Ç"), so para mostrar. */
      nome?: string;
    }
  | { tipo: 'mouse'; botao: 3 | 4 | 5 };

export type AcaoDeAtalho = 'falar' | 'mutar' | 'ensurdecer';

/** O que o processo principal guarda e le sozinho (electron/preferencias.ts). */
export interface PreferenciasDoApp {
  /** Fechar a janela deixa o Kiroshi na bandeja; desligado, fecha de vez. */
  fecharParaBandeja: boolean;
  /** Iniciando com o Windows, abre escondido na bandeja. */
  iniciarEscondido: boolean;
  atalhos: Record<AcaoDeAtalho, Atalho | null>;
}

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Devolve a funcao de limpeza, para usar direto no retorno de useEffect. */
    onMaximizedChange: (handler: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: unknown, maximized: boolean): void => handler(maximized);
      ipcRenderer.on('window:maximized', listener);
      return () => {
        ipcRenderer.removeListener('window:maximized', listener);
      };
    },
    /** Minimizada ou escondida na bandeja (true), ou de volta (false). */
    onOcultaChange: (handler: (oculta: boolean) => void): (() => void) => {
      const listener = (_event: unknown, oculta: boolean): void => handler(oculta);
      ipcRenderer.on('window:oculta', listener);
      return () => {
        ipcRenderer.removeListener('window:oculta', listener);
      };
    },
  },

  /**
   * Login com Google.
   *
   * Tres passos porque o endereco de retorno precisa existir ANTES de pedir a
   * URL de consentimento: o servidor assina esse endereco dentro do estado, e
   * ele nao pode mudar no meio do caminho.
   */
  google: {
    /** Levanta a porta local e devolve o endereco de retorno. */
    preparar: (): Promise<string> => ipcRenderer.invoke('google:preparar'),
    /** Abre a tela do Google no navegador e espera a volta. */
    abrirEEsperar: (url: string): Promise<{ entrega: string | null; erro: string | null }> =>
      ipcRenderer.invoke('google:abrir', url),
    /** Desiste e fecha a porta. */
    cancelar: (): Promise<boolean> => ipcRenderer.invoke('google:cancelar'),
  },

  app: {
    quit: () => ipcRenderer.send('app:quit'),
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    platform: (): Promise<string> => ipcRenderer.invoke('app:platform'),
  },

  screen: {
    /** Lista telas e janelas com miniatura, para o seletor da interface. */
    sources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('screen:sources'),
    /**
     * Marca qual fonte o proximo getDisplayMedia deve usar. Chame logo antes
     * de pedir a captura; a escolha vale uma vez so.
     */
    select: (id: string, withAudio: boolean): Promise<boolean> =>
      ipcRenderer.invoke('screen:select', id, withAudio),
  },

  pushToTalk: {
    register: (accelerator: string): Promise<boolean> =>
      ipcRenderer.invoke('ptt:register', accelerator),
    unregister: (): Promise<boolean> => ipcRenderer.invoke('ptt:unregister'),
    onToggle: (handler: () => void): (() => void) => {
      const listener = (): void => handler();
      ipcRenderer.on('ptt:toggle', listener);
      return () => {
        ipcRenderer.removeListener('ptt:toggle', listener);
      };
    },
  },

  notifications: {
    /** `alvo`: o endereco (hash) que o clique na notificacao abre. */
    show: (title: string, body: string, silent = false, alvo?: string) =>
      ipcRenderer.send('notify', { title, body, silent, alvo }),
    aoAbrir: (handler: (alvo: string) => void): (() => void) => {
      const listener = (_event: unknown, alvo: string): void => handler(alvo);
      ipcRenderer.on('notificacao:abrir', listener);
      return () => {
        ipcRenderer.removeListener('notificacao:abrir', listener);
      };
    },
    setBadge: (count: number) => ipcRenderer.send('badge:set', count),
    flash: () => ipcRenderer.send('flash'),
  },

  /** Links kiroshi:// (convites): a rota ja vem traduzida, `#/convite/<codigo>`. */
  links: {
    /** O link com que o app foi aberto, uma vez so; depois, null. */
    pendente: (): Promise<string | null> => ipcRenderer.invoke('link:pendente'),
    /** Links que chegam com o app ja aberto. */
    aoAbrir: (handler: (rota: string) => void): (() => void) => {
      const listener = (_event: unknown, rota: string): void => handler(rota);
      ipcRenderer.on('link:abrir', listener);
      return () => {
        ipcRenderer.removeListener('link:abrir', listener);
      };
    },
  },

  autostart: {
    get: (): Promise<boolean> => ipcRenderer.invoke('autostart:get'),
    set: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('autostart:set', enabled),
  },

  preferencias: {
    ler: (): Promise<PreferenciasDoApp> => ipcRenderer.invoke('preferencias:ler'),
    gravar: (patch: Partial<PreferenciasDoApp>): Promise<PreferenciasDoApp> =>
      ipcRenderer.invoke('preferencias:gravar', patch),
  },

  atalhos: {
    /** A escuta global de teclado esta de pe (sem ela, atalhos so com a janela em foco). */
    ativos: (): Promise<boolean> => ipcRenderer.invoke('atalhos:ativos'),
    aoAcionar: (handler: (acao: AcaoDeAtalho, pressionado: boolean) => void): (() => void) => {
      const listener = (_event: unknown, acao: AcaoDeAtalho, pressionado: boolean): void => handler(acao, pressionado);
      ipcRenderer.on('atalho', listener);
      return () => {
        ipcRenderer.removeListener('atalho', listener);
      };
    },
  },

  /**
   * Atualizacao automatica.
   *
   * O download acontece sozinho, em segundo plano. A interface so precisa
   * saber quando ha algo pronto, para oferecer o reinicio — nunca para pedir
   * que a pessoa baixe nada.
   */
  atualizacao: {
    /** Estado atual, para quem abre a tela depois do aviso ja ter passado. */
    estado: (): Promise<AtualizacaoEstado> => ipcRenderer.invoke('atualizacao:estado'),
    /** Fecha e reabre o aplicativo ja na versao nova. */
    instalarEReiniciar: () => ipcRenderer.send('atualizacao:instalar'),
    /** Procura agora, sem esperar a verificacao periodica. */
    procurar: (): Promise<AtualizacaoEstado> => ipcRenderer.invoke('atualizacao:procurar'),
    aoMudar: (handler: (estado: AtualizacaoEstado) => void): (() => void) => {
      const listener = (_event: unknown, estado: AtualizacaoEstado): void => handler(estado);
      ipcRenderer.on('atualizacao:mudou', listener);
      return () => {
        ipcRenderer.removeListener('atualizacao:mudou', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('kiroshi', api);

export type KiroshiApi = typeof api;

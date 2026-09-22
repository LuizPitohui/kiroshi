/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Servidor padrao embutido no build; a pessoa pode trocar no login. */
  readonly VITE_KIROSHI_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Versao do aplicativo, injetada pelo build a partir do package.json.
 *
 * Existe para que o numero viva em um lugar so: o instalador e o que o cliente
 * informa ao servidor saem da mesma fonte.
 */
declare const __VERSAO__: string;

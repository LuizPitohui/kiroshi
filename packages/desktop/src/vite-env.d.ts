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

/**
 * Qual interface este build carrega: `true` com `VITE_INTERFACE=nova` no
 * ambiente do build (o Kiroshi Beta), `false` no instalador de todo mundo.
 *
 * E uma constante trocada pelo texto `true`/`false` na compilacao — e nao uma
 * leitura de `import.meta.env` — para o minificador apagar o ramo que nao
 * vale: o instalador estavel nem leva o codigo da interface nova, e o Beta nao
 * leva o da antiga.
 */
declare const __INTERFACE_NOVA__: boolean;

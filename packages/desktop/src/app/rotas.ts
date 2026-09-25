import { useSyncExternalStore } from 'react';

/**
 * Onde a pessoa esta, como endereco.
 *
 * A interface antiga guardava isso so no store (servidor e canal
 * selecionados) e em `useState` espalhados — por isso nao havia voltar e
 * avancar, uma notificacao so conseguia trazer a janela para a frente, e um
 * convite nao tinha como virar link. Aqui a posicao e um hash
 * (`#/s/<servidor>/<canal>`): funciona igual no Electron, que carrega
 * `file://`, e no navegador, sem servidor nenhum por tras.
 *
 * O hash e a unica fonte da verdade. O store continua sabendo o que existe;
 * a rota diz o que esta aberto.
 */

export type PaginaDeAjuste =
  | 'perfil'
  | 'conta'
  | 'voz-e-video'
  | 'transmissao'
  | 'notificacoes'
  | 'atalhos'
  | 'aparencia'
  | 'windows'
  | 'sobre'
  | 'diagnostico';

export type PaginaDeAjusteDoServidor =
  | 'visao-geral'
  | 'membros'
  | 'cargos'
  | 'convites'
  | 'banimentos'
  | 'canais'
  | 'emojis'
  | 'soundboard'
  | 'auditoria';

export type AbaDoInicio = 'online' | 'todos' | 'pendentes' | 'bloqueados';

export type Rota =
  | { tela: 'inicio'; aba: AbaDoInicio }
  | { tela: 'dm'; canalId: string }
  | { tela: 'servidor'; guildId: string; canalId: string | null }
  | { tela: 'ajustes'; pagina: PaginaDeAjuste }
  | { tela: 'ajustes-servidor'; guildId: string; pagina: PaginaDeAjusteDoServidor }
  | { tela: 'convite'; codigo: string };

const PAGINAS_DE_AJUSTE: readonly PaginaDeAjuste[] = [
  'perfil',
  'conta',
  'voz-e-video',
  'transmissao',
  'notificacoes',
  'atalhos',
  'aparencia',
  'windows',
  'sobre',
  'diagnostico',
];

const PAGINAS_DO_SERVIDOR: readonly PaginaDeAjusteDoServidor[] = [
  'visao-geral',
  'membros',
  'cargos',
  'convites',
  'banimentos',
  'canais',
  'emojis',
  'soundboard',
  'auditoria',
];

const ABAS_DO_INICIO: readonly AbaDoInicio[] = ['online', 'todos', 'pendentes', 'bloqueados'];

export const ROTA_INICIAL: Rota = { tela: 'inicio', aba: 'online' };

// Ids sao snowflakes: so digitos. Codigo de convite: o alfabeto do servidor.
const ID = /^\d{1,20}$/;
const CODIGO = /^[A-Za-z0-9]{6,12}$/;

function umDe<T extends string>(valor: string | undefined, opcoes: readonly T[]): T | null {
  return valor !== undefined && (opcoes as readonly string[]).includes(valor) ? (valor as T) : null;
}

/**
 * Le um hash. Qualquer coisa que nao reconhece vira o inicio — um endereco
 * velho ou digitado errado nunca pode deixar a tela em branco.
 */
export function lerRota(hash: string): Rota {
  const partes = hash
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean)
    .map((parte) => decodeURIComponent(parte));

  const [primeira, segunda, terceira, quarta] = partes;

  switch (primeira) {
    case undefined:
      return ROTA_INICIAL;
    case 'inicio': {
      return { tela: 'inicio', aba: umDe(segunda, ABAS_DO_INICIO) ?? 'online' };
    }
    case 'dm':
      return segunda && ID.test(segunda) ? { tela: 'dm', canalId: segunda } : ROTA_INICIAL;
    case 's': {
      if (!segunda || !ID.test(segunda)) return ROTA_INICIAL;
      if (terceira === 'ajustes') {
        return {
          tela: 'ajustes-servidor',
          guildId: segunda,
          pagina: umDe(quarta, PAGINAS_DO_SERVIDOR) ?? 'visao-geral',
        };
      }
      return {
        tela: 'servidor',
        guildId: segunda,
        canalId: terceira && ID.test(terceira) ? terceira : null,
      };
    }
    case 'ajustes':
      return { tela: 'ajustes', pagina: umDe(segunda, PAGINAS_DE_AJUSTE) ?? 'perfil' };
    case 'convite':
      return segunda && CODIGO.test(segunda) ? { tela: 'convite', codigo: segunda } : ROTA_INICIAL;
    default:
      return ROTA_INICIAL;
  }
}

/** O inverso de `lerRota`: `lerRota(escreverRota(r))` devolve `r`. */
export function escreverRota(rota: Rota): string {
  switch (rota.tela) {
    case 'inicio':
      return rota.aba === 'online' ? '#/inicio' : `#/inicio/${rota.aba}`;
    case 'dm':
      return `#/dm/${rota.canalId}`;
    case 'servidor':
      return rota.canalId ? `#/s/${rota.guildId}/${rota.canalId}` : `#/s/${rota.guildId}`;
    case 'ajustes':
      return `#/ajustes/${rota.pagina}`;
    case 'ajustes-servidor':
      return `#/s/${rota.guildId}/ajustes/${rota.pagina}`;
    case 'convite':
      return `#/convite/${encodeURIComponent(rota.codigo)}`;
  }
}

/**
 * Leva a pessoa a outro lugar.
 *
 * `substituir` troca a entrada atual do historico em vez de empilhar uma
 * nova: e o certo para correcoes automaticas (servidor sem canal escolhido
 * que ganha o ultimo canal visitado), que nao devem virar um passo a mais no
 * "voltar".
 */
export function navegar(rota: Rota, opcoes: { substituir?: boolean } = {}): void {
  const destino = escreverRota(rota);
  if (location.hash === destino) return;
  if (opcoes.substituir) {
    history.replaceState(history.state, '', destino);
    // replaceState nao dispara hashchange; o aviso sai daqui.
    avisar();
  } else {
    location.hash = destino;
  }
}

/*
  Uma rota por hash, reaproveitada enquanto o hash nao muda. Sem isto,
  `useSyncExternalStore` receberia um objeto novo a cada leitura e entraria
  em loop de renderizacao — a mesma armadilha dos seletores do Zustand v5.
*/
let ultimoHash: string | null = null;
let ultimaRota: Rota = ROTA_INICIAL;

function rotaAtual(): Rota {
  const hash = typeof location === 'undefined' ? '' : location.hash;
  if (hash !== ultimoHash) {
    ultimoHash = hash;
    ultimaRota = lerRota(hash);
  }
  return ultimaRota;
}

const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1) window.addEventListener('hashchange', avisar);
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) window.removeEventListener('hashchange', avisar);
  };
}

/** A rota atual, re-renderizando so quando ela muda. */
export function useRota(): Rota {
  return useSyncExternalStore(assinar, rotaAtual, () => ROTA_INICIAL);
}

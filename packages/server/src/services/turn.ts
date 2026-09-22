import type { IceServer } from '@kiroshi/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Credenciais de relay para quem nao alcanca o servidor de midia direto.
 *
 * A midia vai direto ao servidor por IPv6. Quem nao tem IPv6 — e nao e raro,
 * principalmente fora do Brasil — entra no canal, aparece na lista, e nao
 * ouve ninguem. Um relay resolve, e so e usado por quem precisa: o ICE sempre
 * prefere o caminho curto.
 *
 * A Cloudflare nao aceita a chave como credencial. A chave e um segredo longo
 * que fica no servidor e serve para pedir credenciais curtas, uma por sessao.
 * Isso e melhor do que parece: um segredo fixo mandado a todo cliente vaza no
 * primeiro print de tela, e nao da para revogar sem trocar para todo mundo.
 */

interface EntradaDeIce {
  urls?: string[] | string;
  username?: string;
  credential?: string;
}

/**
 * `iceServers` vem como LISTA, nao como um objeto so.
 *
 * Medido contra a API de verdade: a resposta traz duas entradas, uma de STUN
 * sem credencial e outra de TURN com usuario e senha. Tratar como objeto unico
 * fazia a leitura sair vazia e o relay simplesmente nao existir — sem erro
 * nenhum, porque a chamada HTTP tinha dado 201.
 *
 * O tipo aceita as duas formas mesmo assim: custa uma linha e protege de uma
 * mudanca de formato virar relay silenciosamente desligado outra vez.
 */
interface RespostaDaCloudflare {
  iceServers?: EntradaDeIce | EntradaDeIce[];
}

/** Tempo de vida da credencial. Acompanha o token de voz, que vale 6 horas. */
const VALIDADE_SEGUNDOS = 6 * 60 * 60;

/**
 * Guarda a ultima credencial emitida.
 *
 * Entrar em canal de voz e raro, mas reconectar depois de uma oscilacao nao e:
 * cada tentativa pediria uma credencial nova, e uma rede instavel viraria uma
 * rajada de chamadas a API. Reusar enquanto sobra folga resolve sem risco,
 * porque a credencial nao carrega nada de quem a usa.
 */
let emCache: { servidores: IceServer[]; expiraEm: number } | null = null;

/** Renova antes do fim, para ninguem receber algo prestes a vencer. */
const FOLGA_MS = 30 * 60 * 1000;

function normalizar(resposta: RespostaDaCloudflare): IceServer[] {
  const bruto = resposta.iceServers;
  if (!bruto) return [];

  const entradas = Array.isArray(bruto) ? bruto : [bruto];

  return entradas.flatMap((entrada) => {
    const urls = Array.isArray(entrada.urls)
      ? entrada.urls
      : entrada.urls
        ? [entrada.urls]
        : [];

    /*
      A porta 53 e recusada pelos navegadores e so serve para o candidato
      expirar depois de uma espera. Com trickle ICE nao chega a atrapalhar,
      mas tirar sai de graca e evita candidato morto na negociacao.

      A porta e extraida, nao procurada como texto: ":53" tambem aparece
      dentro de ":5349", que e a porta do TURN sobre TLS e precisa ficar.
    */
    const uteis = urls.filter((u) => portaDe(u) !== 53);
    if (uteis.length === 0) return [];

    return [
      {
        urls: uteis,
        ...(entrada.username ? { username: entrada.username } : {}),
        ...(entrada.credential ? { credential: entrada.credential } : {}),
      },
    ];
  });
}

async function pedirACloudflare(): Promise<IceServer[]> {
  const { turnKeyId, turnApiToken } = config.voice;
  if (!turnKeyId || !turnApiToken) return [];

  const resposta = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${turnApiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl: VALIDADE_SEGUNDOS }),
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new Error(`${resposta.status} ${corpo.slice(0, 200)}`);
  }

  return normalizar((await resposta.json()) as RespostaDaCloudflare);
}

/**
 * O que o cliente recebe ao entrar na voz.
 *
 * Nunca lanca. Falhar aqui significaria recusar a entrada no canal por causa
 * de um relay que a maioria das pessoas nem vai usar — quem tem IPv6 conecta
 * direto de qualquer jeito. Entao um problema com a Cloudflare vira aviso no
 * log e a chamada segue sem relay.
 */
export async function montarIceServers(): Promise<IceServer[]> {
  // Lista fixa no .env ganha, para dar como trocar de provedor sem mexer em
  // codigo.
  if (config.voice.turnServers.length > 0) return config.voice.turnServers;

  if (!config.voice.turnKeyId || !config.voice.turnApiToken) return [];

  if (emCache && emCache.expiraEm - FOLGA_MS > Date.now()) return emCache.servidores;

  try {
    const servidores = await pedirACloudflare();

    /*
      Exige pelo menos uma entrada com credencial.

      A resposta traz STUN junto, e STUN so descobre endereco — nao
      retransmite. Aceitar uma lista so de STUN daria a impressao de relay
      configurado enquanto quem precisa dele continuaria sem voz.
    */
    const temRelay = servidores.some((s) => s.username && s.credential);
    if (!temRelay) {
      logger.warn(
        { entradas: servidores.length },
        'a Cloudflare respondeu sem nenhum servidor de relay com credencial',
      );
      return [];
    }
    emCache = { servidores, expiraEm: Date.now() + VALIDADE_SEGUNDOS * 1000 };
    logger.info({ urls: servidores[0]?.urls.length }, 'credenciais de relay renovadas');
    return servidores;
  } catch (erro) {
    logger.error(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      'nao consegui credenciais de relay; a chamada segue sem ele',
    );
    // Devolve o cache vencido se houver: relay velho ainda e melhor que nenhum
    // para quem depende dele, e o pior caso e o candidato ser recusado.
    return emCache?.servidores ?? [];
  }
}

/** Esquece o que estava guardado. Usado em teste. */
export function limparCacheDeTurn(): void {
  emCache = null;
}

/**
 * A porta de uma URL de ICE, ou null quando nao ha.
 *
 * Formato: `turn:host:porta?transport=udp`. Nao da para usar `new URL`: os
 * esquemas turn/turns/stun nao seguem a forma que o parser espera e a porta
 * sai vazia.
 */
function portaDe(url: string): number | null {
  const semParametros = url.split('?')[0] ?? '';
  const encontrado = /:(\d+)$/.exec(semParametros);
  return encontrado ? Number(encontrado[1]) : null;
}

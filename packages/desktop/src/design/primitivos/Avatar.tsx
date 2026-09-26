import { useEffect, useState } from 'react';
import type { PresenceStatus } from '@kiroshi/shared';
import { cx } from './cx.js';
import { baixarAnimada } from './fotosAnimadas.js';

/**
 * Quanto a foto animada continua depois de a pessoa parar de falar.
 *
 * O "falando" vem do SFU e vai e volta nas pausas entre as palavras; trocar a
 * foto a cada pausa faria o GIF recomecar sem parar. Segurando um pouco, ele
 * corre enquanto a pessoa esta falando de verdade.
 */
const SEGURA_MS = 1200;

/** Verdadeiro enquanto `ligado`, e por `ms` depois que desliga. */
function useSegurar(ligado: boolean, ms: number): boolean {
  const [segurando, setSegurando] = useState(ligado);
  useEffect(() => {
    if (ligado) {
      setSegurando(true);
      return;
    }
    const t = setTimeout(() => setSegurando(false), ms);
    return () => clearTimeout(t);
  }, [ligado, ms]);
  return ligado || segurando;
}

/**
 * O endereco da animacao enquanto `tocando`: um `blob:` novo a cada vez (ver
 * `fotosAnimadas.ts`), que some quando para. Sem os bytes (a rede falhou), o
 * endereco direto ainda anima, so sem a garantia de comecar do primeiro quadro.
 */
function useAnimacao(urlAnimada: string | null | undefined, tocando: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (urlAnimada) void baixarAnimada(urlAnimada);
  }, [urlAnimada]);

  useEffect(() => {
    if (!tocando || !urlAnimada) return;
    let ativo = true;
    let objeto: string | null = null;
    void baixarAnimada(urlAnimada).then((blob) => {
      if (!ativo) return;
      objeto = blob ? URL.createObjectURL(blob) : null;
      setSrc(objeto ?? urlAnimada);
    });
    return () => {
      ativo = false;
      setSrc(null);
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [tocando, urlAnimada]);

  return tocando ? src : null;
}

/*
  Cores de fundo para quem nao tem foto: neons da familia, escolhidos pelo id
  (sempre a mesma cor para a mesma pessoa, em qualquer tela).
*/
const CORES = ['#22d3ee', '#f472b6', '#a3e635', '#facc15', '#a78bfa', '#fb923c'] as const;

function corDe(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) | 0;
  return CORES[Math.abs(h) % CORES.length] ?? CORES[0];
}

const TAMANHOS = {
  20: { caixa: 'size-5', letra: 'text-10', status: 8 },
  24: { caixa: 'size-6', letra: 'text-11', status: 9 },
  32: { caixa: 'size-8', letra: 'text-14', status: 11 },
  40: { caixa: 'size-10', letra: 'text-16', status: 12 },
  72: { caixa: 'size-[72px]', letra: 'text-28', status: 18 },
} as const;

const NOME_DO_STATUS: Record<PresenceStatus, string> = {
  ONLINE: 'online',
  IDLE: 'ausente',
  DND: 'não perturbe',
  OFFLINE: 'offline',
};

/**
 * O estado muda de FORMA, nao so de cor, para quem nao distingue verde de
 * vermelho: online = cheio, ausente = lua, nao perturbe = traco, offline = aro.
 */
function IndicadorDeStatus({ status, px }: { status: PresenceStatus; px: number }) {
  const cor =
    status === 'ONLINE' ? 'var(--k-ok)' : status === 'IDLE' ? 'var(--k-aviso)' : status === 'DND' ? 'var(--k-perigo)' : 'var(--k-texto-3)';
  return (
    <svg
      aria-hidden
      width={px}
      height={px}
      viewBox="0 0 12 12"
      className="absolute -bottom-0.5 -right-0.5 rounded-full"
      style={{ background: 'var(--k-deck)', padding: 1.5, boxSizing: 'content-box' }}
    >
      {status === 'ONLINE' ? <circle cx="6" cy="6" r="6" fill={cor} /> : null}
      {status === 'IDLE' ? (
        <path d="M6 0a6 6 0 1 0 6 6A4.5 4.5 0 0 1 6 0z" fill={cor} />
      ) : null}
      {status === 'DND' ? (
        <>
          <circle cx="6" cy="6" r="6" fill={cor} />
          <rect x="2.5" y="5" width="7" height="2" fill="var(--k-deck)" />
        </>
      ) : null}
      {status === 'OFFLINE' ? <circle cx="6" cy="6" r="4.5" fill="none" stroke={cor} strokeWidth="3" /> : null}
    </svg>
  );
}

interface Props {
  /** Nome exibido: a inicial e o texto alternativo saem daqui. */
  nome: string;
  /** Chave estavel da cor (o id da pessoa). */
  id: string;
  /** A foto parada: a de todo lugar. */
  url?: string | null;
  /**
   * A mesma foto animada, de quem subiu um GIF. So toca enquanto a pessoa
   * fala (`falando`) ou com `animar`; no resto do tempo fica a parada.
   */
  urlAnimada?: string | null;
  tamanho?: keyof typeof TAMANHOS;
  status?: PresenceStatus;
  /** Anel verde de quem esta falando — e o GIF, se houver, anima. */
  falando?: boolean;
  /** Anima o GIF sem o anel: o cartao de perfil, a tela de perfil, o proprio painel. */
  animar?: boolean;
  className?: string;
}

/**
 * Foto redonda (a unica coisa redonda da interface, como no Nexus).
 *
 * Foto em GIF (pedido do dono em 2026-09-26): parada, e animando enquanto a
 * pessoa fala. A animada entra POR CIMA da parada, em vez de trocar o
 * endereco da mesma imagem: enquanto ela carrega, aparece a parada, e nunca um
 * buraco. Anima com o movimento reduzido do sistema tambem (desligar as
 * animacoes do Windows liga o movimento reduzido no Chromium): e a foto que a
 * pessoa escolheu mostrar, disparada pela propria voz dela.
 */
export function Avatar({
  nome,
  id,
  url,
  urlAnimada,
  tamanho = 32,
  status,
  falando = false,
  animar = false,
  className,
}: Props): React.JSX.Element {
  const [falhou, setFalhou] = useState(false);
  const [animadaFalhou, setAnimadaFalhou] = useState(false);
  const tocando = useSegurar(falando || animar, SEGURA_MS);
  const srcAnimada = useAnimacao(url && !falhou && !animadaFalhou ? urlAnimada : null, tocando);
  const t = TAMANHOS[tamanho];
  const inicial = (nome.trim()[0] ?? '?').toUpperCase();
  const descricao = status ? `${nome}, ${NOME_DO_STATUS[status]}` : nome;

  // Foto nova: tenta de novo, mesmo que a anterior tenha falhado.
  useEffect(() => setFalhou(false), [url]);
  useEffect(() => setAnimadaFalhou(false), [urlAnimada]);

  return (
    <span
      role="img"
      aria-label={descricao}
      className={cx(
        'relative inline-grid shrink-0 place-items-center rounded-full',
        t.caixa,
        falando && 'shadow-[0_0_0_2px_var(--k-deck),0_0_0_3.5px_var(--k-fala),0_0_10px_var(--k-fala-brilho)]',
        'animado:transition-shadow animado:duration-[120ms]',
        className,
      )}
    >
      {url && !falhou ? (
        <img src={url} alt="" draggable={false} onError={() => setFalhou(true)} className="size-full rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className={cx('grid size-full place-items-center rounded-full font-display font-bold text-preto', t.letra)}
          style={{ background: corDe(id) }}
        >
          {inicial}
        </span>
      )}
      {srcAnimada ? (
        <img
          src={srcAnimada}
          alt=""
          draggable={false}
          data-animada=""
          onError={() => setAnimadaFalhou(true)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      ) : null}
      {status ? <IndicadorDeStatus status={status} px={t.status} /> : null}
    </span>
  );
}

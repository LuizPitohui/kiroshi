import { useState } from 'react';
import type { PresenceStatus } from '@kiroshi/shared';
import { cx } from './cx.js';

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
  url?: string | null;
  tamanho?: keyof typeof TAMANHOS;
  status?: PresenceStatus;
  /** Anel verde de quem esta falando. */
  falando?: boolean;
  className?: string;
}

/** Foto redonda (a unica coisa redonda da interface, como no Nexus). */
export function Avatar({ nome, id, url, tamanho = 32, status, falando = false, className }: Props): React.JSX.Element {
  const [falhou, setFalhou] = useState(false);
  const t = TAMANHOS[tamanho];
  const inicial = (nome.trim()[0] ?? '?').toUpperCase();
  const descricao = status ? `${nome}, ${NOME_DO_STATUS[status]}` : nome;

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
      {status ? <IndicadorDeStatus status={status} px={t.status} /> : null}
    </span>
  );
}

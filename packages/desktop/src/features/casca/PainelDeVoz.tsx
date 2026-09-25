import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Settings } from 'lucide-react';
import type { PresenceStatus } from '@kiroshi/shared';
import { useStore } from '../../store/index.js';
import { navegar } from '../../app/rotas.js';
import { Avatar, BotaoIcone, cx } from '../../design/primitivos/index.js';
import { alternarFone, alternarMicrofone, sairDaVoz } from './acoesDeVoz.js';
import { useVoz } from './useVoz.js';

const ic = 'size-[18px]';

/** Barras de sinal pela latencia: verde abaixo de 150 ms, amarelo ate 300, vermelho acima. */
function Sinal({ ping }: { ping: number | null }) {
  const nivel = ping === null ? 0 : ping < 150 ? 4 : ping < 300 ? 2 : 1;
  const cor = nivel >= 4 ? 'bg-ok' : nivel >= 2 ? 'bg-aviso' : 'bg-perigo';
  return (
    <span aria-hidden className="flex h-3 items-end gap-0.5">
      {[4, 7, 10, 12].map((altura, i) => (
        <i key={altura} className={cx('block w-[3px]', i < nivel ? cor : 'bg-borda-2')} style={{ height: altura }} />
      ))}
    </span>
  );
}

/**
 * Painel da voz conectada, embaixo da navegacao (onde o Discord poe): em que
 * canal, como esta o sinal, e sair. So aparece com chamada aberta.
 */
export function PainelDeVoz(): React.JSX.Element | null {
  const conectado = useVoz((v) => v.connected);
  const conectando = useVoz((v) => v.connecting);
  const ping = useVoz((v) => v.ping);
  const canalId = useVoz((v) => v.channelId);
  const guildId = useVoz((v) => v.guildId);
  const onde = useStore((s) => {
    if (!canalId) return '';
    const canal = s.channels.get(canalId)?.name ?? 'Chamada';
    return guildId ? `${s.guilds.get(guildId)?.name ?? ''} / ${canal}` : canal;
  });

  if (!conectado && !conectando) return null;

  return (
    <section aria-label="Chamada" className="shrink-0 border-t border-borda bg-deck px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Sinal ping={ping} />
        <span className={cx('font-mono text-10 uppercase tracking-rotulo', conectado ? 'text-ok' : 'text-aviso')}>
          {conectado ? 'Voz conectada' : 'Conectando…'}
        </span>
        <span className="ml-auto font-mono text-10 tabular-nums text-texto-3">{ping === null ? '' : `RTT ${ping} ms`}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (canalId && guildId) navegar({ tela: 'servidor', guildId, canalId });
            else if (canalId) navegar({ tela: 'dm', canalId });
          }}
          className="min-w-0 flex-1 truncate text-left text-12 text-texto-2 hover:text-texto hover:underline"
        >
          {onde}
        </button>
        <BotaoIcone rotulo="Sair da chamada" icone={<PhoneOff className="size-4" strokeWidth={1.5} />} tamanho="sm" alerta onClick={sairDaVoz} />
      </div>
    </section>
  );
}

const NOME_DO_STATUS: Record<PresenceStatus, string> = {
  ONLINE: 'Online',
  IDLE: 'Ausente',
  DND: 'Não perturbe',
  OFFLINE: 'Invisível',
};

/** Quem eu sou, e os controles que valem em qualquer tela: microfone, fone, ajustes. */
export function Identidade(): React.JSX.Element | null {
  const eu = useStore((s) => s.user);
  const mudo = useVoz((v) => v.selfMuted);
  const surdo = useVoz((v) => v.selfDeafened);
  // O mesmo aviso dos controles da chamada: aqui o botao tambem nao abre nada.
  const moderado = useVoz((v) => v.silenciadoPeloServidor || v.ensurdecidoPeloServidor);
  if (!eu) return null;

  const status = eu.status;
  return (
    <section aria-label="Sua conta" className="flex h-14 shrink-0 items-center gap-2.5 border-t border-borda bg-void pl-3 pr-2">
      <Avatar nome={eu.displayName || eu.username} id={eu.id} url={eu.avatarUrl} tamanho={32} status={status} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-13 font-semibold text-texto">{eu.displayName || eu.username}</p>
        <p className="truncate font-mono text-10 uppercase tracking-[0.08em] text-texto-3">
          {eu.customStatus || NOME_DO_STATUS[status]}
        </p>
      </div>
      <BotaoIcone
        rotulo={moderado ? 'Silenciado pela moderação' : mudo ? 'Ligar microfone' : 'Silenciar microfone'}
        icone={mudo || moderado ? <MicOff className={ic} strokeWidth={1.5} /> : <Mic className={ic} strokeWidth={1.5} />}
        ligado={mudo || moderado}
        alerta={mudo || moderado}
        disabled={moderado}
        onClick={() => void alternarMicrofone()}
      />
      <BotaoIcone
        rotulo={surdo ? 'Voltar a ouvir' : 'Ensurdecer'}
        icone={surdo ? <HeadphoneOff className={ic} strokeWidth={1.5} /> : <Headphones className={ic} strokeWidth={1.5} />}
        ligado={surdo}
        alerta={surdo}
        onClick={() => void alternarFone()}
      />
      <BotaoIcone
        rotulo="Configurações"
        icone={<Settings className={ic} strokeWidth={1.5} />}
        onClick={() => navegar({ tela: 'ajustes', pagina: 'aparencia' })}
      />
    </section>
  );
}

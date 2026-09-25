import { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { cx } from '../../design/primitivos/index.js';
import { useVoz } from './useVoz.js';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * O relogio mora sozinho: ele muda todo segundo, e se estivesse na barra
 * inteira ela redesenharia junto — ou pior, quem a contem.
 */
function Relogio() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-acento">
      SYS <span className="tabular-nums">{`${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`}</span>
    </span>
  );
}

const LINK = {
  ready: { texto: 'LINK_OK', cor: 'text-ok', ponto: 'bg-ok' },
  connecting: { texto: 'CONECTANDO', cor: 'text-aviso', ponto: 'bg-aviso' },
  identifying: { texto: 'CONECTANDO', cor: 'text-aviso', ponto: 'bg-aviso' },
  reconnecting: { texto: 'RECONECTANDO', cor: 'text-aviso', ponto: 'bg-aviso' },
  failed: { texto: 'SEM_LINK', cor: 'text-perigo', ponto: 'bg-perigo' },
  idle: { texto: 'OFFLINE', cor: 'text-texto-3', ponto: 'bg-texto-3' },
} as const;

const Sep = () => (
  <span aria-hidden className="text-borda-2">
    ·
  </span>
);

/**
 * A faixa de instrumento no rodape, com dado que presta: estado do link com o
 * servidor, latencia da voz, onde a pessoa esta falando. So informa — quem
 * age sao os controles; e por isso ela nao e uma regiao falada (o estado que
 * importa ja e anunciado por quem o muda).
 */
export function BarraDeEstado(): React.JSX.Element {
  const conexao = useStore((s) => s.connection);
  const emVoz = useVoz((v) => v.connected);
  const ping = useVoz((v) => v.ping);
  const canalDeVoz = useVoz((v) => v.channelId);
  const guildDeVoz = useVoz((v) => v.guildId);
  const ondeFala = useStore((s) => {
    if (!canalDeVoz) return null;
    const canal = s.channels.get(canalDeVoz)?.name ?? 'chamada';
    const servidor = guildDeVoz ? s.guilds.get(guildDeVoz)?.name : 'DM';
    return `${servidor ?? ''}/${canal}`;
  });
  const link = LINK[conexao];

  return (
    <footer className="flex h-[22px] shrink-0 items-center gap-2.5 border-t border-borda bg-void px-3 font-mono text-10 uppercase tracking-[0.14em] text-mudo">
      <span className={cx('flex items-center gap-1.5', link.cor)}>
        <span aria-hidden className={cx('size-1.5 rounded-full', link.ponto)} />
        {link.texto}
      </span>
      {emVoz ? (
        <>
          <Sep />
          <span>
            RTT <span className="text-texto-2 tabular-nums">{ping === null ? '—' : `${ping} ms`}</span>
          </span>
          <Sep />
          <span>
            VOZ <span className="text-texto-2">{ondeFala}</span>
          </span>
        </>
      ) : null}
      <span className="ml-auto flex items-center gap-2.5">
        <Relogio />
      </span>
    </footer>
  );
}

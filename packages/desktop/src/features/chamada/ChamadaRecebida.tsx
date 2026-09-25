import { useEffect, useId, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import type { Call } from '@kiroshi/shared';
import { selectors, useStore, useVoiceMembersOf } from '../../store/index.js';
import { Avatar } from '../../design/primitivos/index.js';
import { anunciar } from '../../lib/anunciar.js';
import { tocarToque } from '../../voice/sons.js';
import { useVoz } from '../casca/useVoz.js';
import { atender, recusar } from '../inicio/acoes.js';
import { chamadaQueToca, nomeDaConversa } from './dm.js';

/** Quanto o toque dura no servidor (DM_CALL_RING_SECONDS), so para a barra de tempo. */
const DURACAO_DO_TOQUE_MS = 30_000;

interface PropsDoCartao {
  titulo: string;
  subtitulo: string;
  /** Id para a cor do avatar sem foto. */
  avatarId: string;
  avatarUrl: string | null;
  grupo: boolean;
  /** 1 no comeco do toque, 0 quando ele acaba. */
  restante: number;
  aoAtender: () => void;
  aoRecusar: () => void;
}

/**
 * O cartao da chamada recebida — a "holochamada" do desenho aprovado
 * (10-front-end-novo.md 4.5): avatar na moldura com a onda, nome, Atender em
 * verde e Recusar em vermelho, e a barra do tempo que resta de toque.
 *
 * So desenha. Quem toca o som, avisa o Windows e decide quando some e a
 * `ChamadasDiretas`, abaixo; a vitrine mostra este cartao sem conta nenhuma.
 *
 * Nao rouba o foco: quem esta digitando e aperta Enter nao pode atender sem
 * querer. O leitor de tela e avisado na hora, pela regiao urgente.
 */
export function CartaoDeChamadaRecebida({ titulo, subtitulo, avatarId, avatarUrl, grupo, restante, aoAtender, aoRecusar }: PropsDoCartao) {
  const idTitulo = useId();
  const idDescricao = useId();
  return (
    <section
      role="dialog"
      aria-labelledby={idTitulo}
      aria-describedby={idDescricao}
      className="k-varredura w-[380px] overflow-hidden border border-acento bg-void/95 px-[18px] pb-4 pt-[18px] shadow-[0_0_0_1px_var(--k-acento-tenue),0_24px_48px_rgba(0,0,0,0.8),0_0_40px_var(--k-acento-brilho)]"
    >
      <div className="flex items-center justify-between">
        <span className="k-rotulo text-acento">Holochamada recebida</span>
        <span className="font-mono text-10 uppercase tracking-rotulo text-acento">{grupo ? 'Grupo' : 'DM'}</span>
      </div>
      <div className="my-4 flex items-center gap-4">
        <div className="relative size-[72px] shrink-0">
          <span aria-hidden className="k-anima k-onda absolute -inset-[7px] rounded-full border border-acento opacity-80" />
          <Avatar nome={titulo} id={avatarId} url={avatarUrl} tamanho={72} />
        </div>
        <div className="min-w-0">
          <p id={idTitulo} className="truncate font-display text-[30px] font-bold leading-none tracking-[0.04em]">
            {titulo}
          </p>
          <p id={idDescricao} className="mt-1.5 text-13 text-texto-2">
            {subtitulo}
          </p>
        </div>
      </div>
      <div className="relative z-[2] flex gap-2.5">
        <button
          type="button"
          onClick={aoAtender}
          className="k-chanfro-sm flex h-[38px] flex-1 items-center justify-center gap-2 bg-fala font-mono text-11 font-medium tracking-[0.2em] text-[#04130a] outline-none hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          <Phone aria-hidden className="size-4" strokeWidth={1.75} />
          ATENDER
        </button>
        <button
          type="button"
          onClick={aoRecusar}
          className="k-chanfro-sm flex h-[38px] flex-1 items-center justify-center gap-2 border border-vivo font-mono text-11 tracking-[0.2em] text-vivo outline-none hover:bg-vivo/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          <PhoneOff aria-hidden className="size-4" strokeWidth={1.75} />
          RECUSAR
        </button>
      </div>
      <div aria-hidden className="relative z-[2] mt-3.5 h-0.5 bg-borda">
        <i
          className="absolute inset-y-0 left-0 bg-acento animado:transition-[width] animado:duration-1000 animado:ease-linear"
          style={{ width: `${Math.max(0, Math.min(1, restante)) * 100}%` }}
        />
      </div>
    </section>
  );
}

/** A chamada que me chama, com quem esta nela, pronta para o cartao. */
function CartaoAoVivo({ chamada }: { chamada: Call }) {
  const euSou = useStore((s) => s.user?.id ?? null);
  const canal = useStore((s) => s.channels.get(chamada.channelId));
  const naChamada = useVoiceMembersOf(chamada.channelId);
  const grupo = canal?.type === 'GROUP_DM';
  // Quem liga e quem esta na chamada ha mais tempo; sem ninguem ainda, o outro lado.
  const quemLiga =
    [...naChamada].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]?.userId ??
    canal?.recipientIds.find((id) => id !== euSou) ??
    null;
  const titulo = useStore((s) => {
    const nomeDe = (id: string) => selectors.displayNameOf(s, id, null);
    if (grupo && canal) return nomeDaConversa(canal, euSou, nomeDe);
    return quemLiga ? nomeDe(quemLiga) : 'Chamada';
  });
  const avatarUrl = useStore((s) => (quemLiga ? (s.users.get(quemLiga)?.avatarUrl ?? null) : null));
  const video = naChamada.some((v) => v.selfVideo);
  const subtitulo = grupo
    ? `Chamada em grupo · ${naChamada.length === 1 ? '1 na chamada' : `${naChamada.length} na chamada`}`
    : `${video ? 'Chamada de vídeo' : 'Chamada de voz'} · conversa direta`;

  // Toque, Windows e leitor de tela: uma vez por chamada que chega.
  useEffect(() => {
    const parar = tocarToque('recebida');
    window.kiroshi?.notifications.show(`${titulo} está te ligando`, 'Abra o Kiroshi para atender ou recusar.', true);
    window.kiroshi?.notifications.flash();
    anunciar(`${titulo} está te ligando. Atender ou recusar.`, 'urgente');
    return parar;
    // O nome pode chegar depois; tocar de novo por isso seria um segundo toque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chamada.channelId, chamada.startedAt]);

  const [inicio] = useState(() => Date.now());
  const [agora, setAgora] = useState(inicio);
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, []);

  return (
    <CartaoDeChamadaRecebida
      titulo={titulo}
      subtitulo={subtitulo}
      avatarId={quemLiga ?? chamada.channelId}
      avatarUrl={avatarUrl}
      grupo={grupo}
      restante={1 - (agora - inicio) / DURACAO_DO_TOQUE_MS}
      aoAtender={() => void atender(chamada.channelId)}
      aoRecusar={() => void recusar(chamada.channelId)}
    />
  );
}

/**
 * As chamadas em conversa direta, para a janela inteira (montada na casca,
 * como o mini palco):
 *
 * - o cartao da chamada que me chama, no alto — some quando o servidor para de
 *   tocar: atendi ou recusei aqui ou em outro aparelho, ou o toque acabou;
 * - o pulso de "chamando" enquanto eu ligo e ninguem atendeu ainda.
 */
export function ChamadasDiretas() {
  const euSou = useStore((s) => s.user?.id ?? null);
  const meuCanal = useVoz((v) => v.channelId);
  const tocando = useStore((s) => chamadaQueToca(s.calls.values(), euSou, meuCanal));

  const conectadoEm = useVoz((v) => (v.connected ? v.channelId : null));
  const sozinho = useVoz((v) => v.participants.every((p) => p.isLocal));
  const chamandoAlguem = useStore((s) => {
    if (!conectadoEm) return false;
    const chamada = s.calls.get(conectadoEm);
    return Boolean(chamada && chamada.ringing.some((id) => id !== euSou));
  });
  const chamando = chamandoAlguem && sozinho;

  useEffect(() => {
    if (!chamando) return;
    return tocarToque('feita');
  }, [chamando]);

  if (!tocando) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-[var(--k-z-dialogo)] flex justify-center">
      <div className="pointer-events-auto">
        <CartaoAoVivo key={`${tocando.channelId}|${tocando.startedAt}`} chamada={tocando} />
      </div>
    </div>
  );
}

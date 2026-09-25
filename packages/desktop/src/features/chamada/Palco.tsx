import { useCallback, useMemo, type ReactNode } from 'react';
import { composicao } from '../../voice/palco.js';
import type { Preferencia } from '../../voice/recepcao.js';
import { cx } from '../../design/primitivos/index.js';
import { useFonteDaChamada } from './fonte.js';
import { montarQuadros, quadroEmDestaque } from './quadros.js';
import { useEstadoDoPalco } from './estadoDoPalco.js';
import { Quadro } from './Quadro.js';

interface Props {
  guildId: string | null;
  canalId: string | null;
  /** Os controles da chamada, no pe do palco. */
  controles?: ReactNode;
  className?: string;
}

/**
 * O palco da chamada: grade com todos, ou um em destaque e os outros numa
 * fita embaixo. Quadros entram e saem de lugar sem recriar o video
 * (`videos.ts`); o destaque cabe nas duas dimensoes (16:9 limitado pela
 * largura e pela altura do espaco, por unidades de container).
 */
export function Palco({ guildId, canalId, controles, className }: Props) {
  const fonte = useFonteDaChamada();
  const { participantes, assistindoEu } = fonte.usarParticipantes();
  const quadros = useMemo(() => montarQuadros(participantes, assistindoEu), [participantes, assistindoEu]);
  const escolhido = useEstadoDoPalco((s) => s.destaque);
  const destacar = useEstadoDoPalco((s) => s.destacar);
  const preferencias = useEstadoDoPalco((s) => s.preferencias);
  const preferir = useEstadoDoPalco((s) => s.preferir);

  const destaque = quadroEmDestaque(quadros, escolhido);
  const quadroDestacado = destaque ? quadros.find((q) => q.chave === destaque) : undefined;
  const naGrade = destaque ? quadros.filter((q) => q.chave !== destaque) : quadros;
  const temVideo = quadros.some((q) => q.video || q.convite);
  const { modo, colunas, linhas } = composicao({ naGrade: naGrade.length, temVideo, temDestaque: Boolean(destaque) });

  const aoDestacar = useCallback((chave: string | null) => destacar(chave), [destacar]);
  const aoMudarPreferencia = useCallback((userId: string, p: Preferencia) => preferir(userId, p), [preferir]);

  const quadro = (q: (typeof quadros)[number], modoDoQuadro: 'destaque' | 'grade' | 'fita', extra?: string) => (
    <Quadro
      key={q.chave}
      quadro={q}
      guildId={guildId}
      canalId={canalId}
      modo={modoDoQuadro}
      emDestaque={q.chave === destaque}
      preferencia={preferencias[q.userId] ?? 'auto'}
      aoDestacar={aoDestacar}
      aoMudarPreferencia={aoMudarPreferencia}
      className={extra}
    />
  );

  return (
    <section
      aria-label="Palco da chamada"
      className={cx('flex min-h-0 flex-col gap-3 bg-void bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.025),transparent_60%)] px-4 pt-4', className)}
    >
      {quadros.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center font-mono text-11 uppercase tracking-rotulo text-texto-3">Conectando à chamada…</div>
      ) : quadroDestacado ? (
        <>
          <div className="relative grid min-h-0 flex-1 place-items-center [container-type:size]">
            <div className="k-colchetes relative aspect-video w-[min(calc(100cqw-16px),calc((100cqh-16px)*16/9))]">
              <span className="k-colchetes-extra" aria-hidden />
              {quadro(quadroDestacado, 'destaque')}
            </div>
          </div>
          {naGrade.length > 0 ? (
            <div className="k-rolagem flex h-[96px] shrink-0 justify-center gap-2.5 overflow-x-auto">
              {naGrade.map((q) => quadro(q, 'fita', 'h-[92px] w-[164px] shrink-0'))}
            </div>
          ) : null}
        </>
      ) : (
        <div
          className={cx('grid min-h-0 flex-1 gap-2.5', modo === 'faixa' && 'content-center')}
          style={{
            gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
            gridTemplateRows: modo === 'faixa' ? undefined : `repeat(${linhas}, minmax(0, 1fr))`,
          }}
        >
          {naGrade.map((q) => (
            <div key={q.chave} className={cx('grid min-h-0 min-w-0 place-items-center [container-type:size]', modo === 'faixa' && 'aspect-video')}>
              <div className={cx('aspect-video w-[min(100cqw,calc(100cqh*16/9))]', modo === 'solo' && 'max-w-[1280px]')}>{quadro(q, 'grade')}</div>
            </div>
          ))}
        </div>
      )}
      {controles}
    </section>
  );
}

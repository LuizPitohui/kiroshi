import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoDePonteiro } from 'react';
import { CornerUpLeft, PhoneOff, X } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import { navegar, useRota } from '../../app/rotas.js';
import { Botao, BotaoIcone, SeloVivo } from '../../design/primitivos/index.js';
import { isElectron } from '../../lib/bridge.js';
import { useVoz } from '../casca/useVoz.js';
import { sairDaVoz } from '../casca/acoesDeVoz.js';
import { useFonteDaChamada } from './fonte.js';
import { montarQuadros, quadroEmDestaque, type Quadro as DadosDoQuadro } from './quadros.js';
import { useEstadoDoPalco } from './estadoDoPalco.js';
import { Quadro, VideoHospedado } from './Quadro.js';
import { JanelaFlutuante, guardarLimites } from './JanelaFlutuante.js';
import { useRecepcaoDaJanela } from './ganchos.js';
import { nomeDaConversa } from './dm.js';

const nada = () => undefined;

/**
 * A chamada continua com video enquanto se le outro canal.
 *
 * No app instalado, numa JANELA PROPRIA (pedido do dono em 2026-09-26): ela
 * anda pelo computador inteiro, por cima de outros programas e com o app
 * minimizado; arrasta por qualquer ponto da imagem, redimensiona pelas
 * beiradas (sempre 16:9), e um clique abre as opcoes — voltar para a chamada,
 * fechar a miniatura, sair. Abre onde a pessoa a deixou da ultima vez.
 *
 * Na versao web, presa no canto da pagina, como antes.
 *
 * Nos dois casos o video e O MESMO elemento do palco, movido (videos.ts) —
 * nunca recriado. So aparece quando ha imagem: sem video, o painel da voz na
 * navegacao ja diz que a chamada segue.
 */
export function MiniPalco() {
  const rota = useRota();
  const fonte = useFonteDaChamada();
  const { participantes, assistindoEu } = fonte.usarParticipantes();
  const canalDaChamada = useVoz((v) => (v.connected ? v.channelId : null));
  const guildId = useVoz((v) => v.guildId);
  const escolhido = useEstadoDoPalco((s) => s.destaque);
  const miniFechada = useEstadoDoPalco((s) => s.miniFechada);
  const fecharMini = useEstadoDoPalco((s) => s.fecharMini);
  const reabrirMini = useEstadoDoPalco((s) => s.reabrirMini);
  const nomeDoCanal = useStore((s) => {
    const canal = canalDaChamada ? s.channels.get(canalDaChamada) : undefined;
    if (!canal) return canalDaChamada ? 'chamada' : '';
    if (canal.guildId) return canal.name ?? 'chamada';
    return nomeDaConversa(canal, s.user?.id ?? null, (id) => s.users.get(id)?.displayName ?? '?');
  });

  const quadros = useMemo(() => montarQuadros(participantes, assistindoEu), [participantes, assistindoEu]);
  const destaque = quadroEmDestaque(quadros, escolhido);
  // O destaque, se tiver imagem; senao a primeira imagem que houver (a
  // transmissao que se assiste antes da camera de alguem).
  const alvo = quadros.find((q) => q.chave === destaque && q.video) ?? quadros.find((q) => q.video && !q.local) ?? quadros.find((q) => q.video);
  const nomeDoAlvo = useStore((s) => (alvo ? selectors.displayNameOf(s, alvo.userId, guildId) : ''));

  const naPropriaTela = (rota.tela === 'servidor' || rota.tela === 'dm') && rota.canalId === canalDaChamada;
  // Voltar para a tela da chamada desfaz o "fechar": a proxima saida mostra de novo.
  useEffect(() => {
    if (naPropriaTela && miniFechada) reabrirMini();
  }, [naPropriaTela, miniFechada, reabrirMini]);

  if (!canalDaChamada || naPropriaTela || !alvo || miniFechada) return null;

  const voltar = () => {
    window.kiroshi.window.mostrar();
    if (guildId) navegar({ tela: 'servidor', guildId, canalId: canalDaChamada });
    else navegar({ tela: 'dm', canalId: canalDaChamada });
  };

  if (!isElectron()) {
    return (
      <aside aria-label="Chamada em andamento" className="group/mini absolute bottom-[92px] right-4 z-[var(--k-z-palco-flutuante)] w-[320px] shadow-camada">
        <div className="relative aspect-video">
          <Quadro
            quadro={alvo}
            guildId={guildId}
            canalId={canalDaChamada}
            modo="mini"
            emDestaque={false}
            preferencia="auto"
            aoDestacar={voltar}
            aoMudarPreferencia={nada}
          />
        </div>
        <div className="flex h-8 items-center gap-1 border border-t-0 border-borda-2 bg-elevado pl-2.5 pr-1">
          <span className="min-w-0 flex-1 truncate font-mono text-10 uppercase tracking-rotulo text-texto-2">{nomeDoCanal}</span>
          <BotaoIcone rotulo="Voltar para a chamada" tamanho="sm" onClick={voltar} icone={<CornerUpLeft className="size-4" strokeWidth={1.5} />} />
          <BotaoIcone rotulo="Sair da chamada" tamanho="sm" alerta onClick={sairDaVoz} icone={<PhoneOff className="size-4" strokeWidth={1.5} />} />
        </div>
      </aside>
    );
  }

  const rotulo = alvo.tipo === 'tela' ? `Tela — ${nomeDoAlvo}` : nomeDoAlvo;
  return (
    <JanelaFlutuante titulo={`${rotulo} · ${nomeDoCanal} — Kiroshi`} aoSerFechada={fecharMini}>
      {(janela) => (
        <ConteudoFlutuante
          janela={janela}
          alvo={alvo}
          rotulo={rotulo}
          canal={nomeDoCanal}
          aoVoltar={voltar}
          aoFechar={fecharMini}
          aoSair={sairDaVoz}
        />
      )}
    </JanelaFlutuante>
  );
}

/** Quanto o ponteiro anda antes de um clique virar arraste (px). */
const LIMIAR_DO_ARRASTE = 4;

/**
 * Arrastar a janela por qualquer ponto da imagem. Janela sem moldura nao tem
 * barra de titulo; a area de arraste do sistema (`app-region: drag`) engoliria
 * o clique que abre as opcoes, entao o arraste e feito aqui: ponteiro
 * capturado e, a cada movimento, a posicao nova em coordenadas de tela para o
 * processo principal. O `window.moveTo` do navegador serviria, mas prende a
 * janela no monitor em que ela esta (medido: parava na beirada da tela).
 */
function useArrasteDaJanela(janela: Window, aoClicar: () => void) {
  const inicio = useRef<{ id: number; sx: number; sy: number; wx: number; wy: number; x: number; y: number; moveu: boolean } | null>(null);
  return {
    onPointerDown: (e: EventoDePonteiro<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const wx = janela.screenX;
      const wy = janela.screenY;
      inicio.current = { id: e.pointerId, sx: e.screenX, sy: e.screenY, wx, wy, x: wx, y: wy, moveu: false };
    },
    onPointerMove: (e: EventoDePonteiro<HTMLElement>) => {
      const i = inicio.current;
      if (!i || e.pointerId !== i.id) return;
      const dx = e.screenX - i.sx;
      const dy = e.screenY - i.sy;
      if (!i.moveu && Math.hypot(dx, dy) < LIMIAR_DO_ARRASTE) return;
      i.moveu = true;
      i.x = i.wx + dx;
      i.y = i.wy + dy;
      window.kiroshi.window.moverMiniatura(i.x, i.y);
    },
    onPointerUp: (e: EventoDePonteiro<HTMLElement>) => {
      const i = inicio.current;
      if (!i || e.pointerId !== i.id) return;
      inicio.current = null;
      // Guarda para onde foi pedida: a posicao que a janela informa ainda
      // pode ser a de antes do ultimo movimento.
      if (i.moveu) guardarLimites(janela, { x: i.x, y: i.y });
      else aoClicar();
    },
    onPointerCancel: () => {
      inicio.current = null;
    },
  };
}

interface PropsDoConteudo {
  janela: Window;
  alvo: DadosDoQuadro;
  rotulo: string;
  canal: string;
  aoVoltar: () => void;
  aoFechar: () => void;
  aoSair: () => void;
}

/** O que a janela flutuante mostra: a imagem inteira, e as opcoes por cima quando clicada. */
function ConteudoFlutuante({ janela, alvo, rotulo, canal, aoVoltar, aoFechar, aoSair }: PropsDoConteudo) {
  const [opcoes, setOpcoes] = useState(false);
  useRecepcaoDaJanela(
    janela,
    alvo.local ? null : { userId: alvo.userId, fonte: alvo.tipo === 'tela' ? 'tela' : 'camera', preferencia: 'auto' },
  );
  const arraste = useArrasteDaJanela(janela, () => setOpcoes((v) => !v));

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpcoes(false);
    };
    janela.document.addEventListener('keydown', tecla);
    return () => janela.document.removeEventListener('keydown', tecla);
  }, [janela]);

  // Os botoes nao comecam arraste nem fecham as opcoes por baixo deles.
  const soOBotao = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      role="group"
      aria-label={`Chamada em andamento: ${rotulo}`}
      className="group/flut relative h-screen w-screen cursor-grab select-none overflow-hidden bg-preto active:cursor-grabbing"
      {...arraste}
    >
      <VideoHospedado quadro={alvo} />

      {alvo.tipo === 'tela' ? (
        <span className="pointer-events-none absolute left-2 top-2">
          <SeloVivo />
        </span>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-preto/85 to-transparent px-2.5 pb-2 pt-6 opacity-0 transition-opacity group-hover/flut:opacity-100">
        <p className="truncate font-mono text-11 uppercase tracking-rotulo text-texto">{rotulo}</p>
        <p className="truncate font-mono text-10 uppercase tracking-rotulo text-texto-3">{canal} · clique para opções</p>
      </div>

      <button
        type="button"
        aria-label="Fechar miniatura"
        title="Fechar miniatura"
        onPointerDown={soOBotao}
        onClick={aoFechar}
        className="absolute right-1.5 top-1.5 grid size-7 place-items-center bg-preto/70 text-texto opacity-0 transition-opacity hover:bg-perigo group-hover/flut:opacity-100"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>

      {opcoes ? (
        <div
          className="absolute inset-0 grid cursor-default place-items-center bg-preto/75"
          onPointerDown={soOBotao}
          onClick={() => setOpcoes(false)}
        >
          <div className="flex flex-col items-stretch gap-1.5" onClick={soOBotao}>
            <Botao variante="primario" tamanho="sm" icone={<CornerUpLeft className="size-4" strokeWidth={1.5} />} onClick={aoVoltar}>
              Voltar para a chamada
            </Botao>
            <Botao variante="secundario" tamanho="sm" icone={<X className="size-4" strokeWidth={1.5} />} onClick={aoFechar}>
              Fechar miniatura
            </Botao>
            <Botao variante="perigo" tamanho="sm" icone={<PhoneOff className="size-4" strokeWidth={1.5} />} onClick={aoSair}>
              Sair da chamada
            </Botao>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, Focus, HeadphoneOff, Maximize2, MicOff, Minimize2, Monitor, SlidersHorizontal, X } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import { NOMES_DA_PREFERENCIA, type Preferencia } from '../../voice/recepcao.js';
import { Avatar, BotaoIcone, Botao, Menu, MenuConteudo, MenuGatilho, MenuItem, MenuRotulo, SeloVivo, cx } from '../../design/primitivos/index.js';
import { useFonteDaChamada } from './fonte.js';
import { GRADE, chaveDoVideo, type Quadro as DadosDoQuadro } from './quadros.js';
import * as videos from './videos.js';
import { useQualidadeEnviada, useQualidadeRecebida, useRecepcao } from './ganchos.js';
import { CartaoNaChamada } from './CartaoNaChamada.js';

export type ModoDoQuadro = 'destaque' | 'grade' | 'fita' | 'mini';

/** O `<video>` do registro, emprestado a este quadro enquanto ele existe. */
export function VideoHospedado({ quadro }: { quadro: DadosDoQuadro }) {
  const fonte = useFonteDaChamada();
  const versao = fonte.usarVersaoDeMidia();
  const caixa = useRef<HTMLDivElement>(null);
  const chave = chaveDoVideo(quadro);

  useLayoutEffect(() => {
    videos.ligarFonte(chave, fonte.videoDe(quadro.userId, quadro.tipo === 'tela' ? 'tela' : 'camera'));
    // A propria camera vem espelhada, como a pessoa se ve; tela nunca.
    videos.espelhar(chave, quadro.local && quadro.tipo === 'pessoa');
    if (caixa.current) videos.hospedar(chave, caixa.current);
  }, [chave, versao, quadro.userId, quadro.tipo, quadro.local, fonte]);

  return <div ref={caixa} className="absolute inset-0" />;
}

/** Fichas pretas sobre o video, em mono, como no prototipo. */
function Ficha({ children, tom }: { children: React.ReactNode; tom?: 'ok' | 'aviso' }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-branco/10 bg-preto/70 px-[7px] py-[3px] font-mono text-[10.5px] tracking-[0.1em] text-texto">
      {tom ? <span aria-hidden className={tom === 'ok' ? 'text-fala' : 'text-aviso'}>■</span> : null}
      {children}
    </span>
  );
}

function QualidadeDaTransmissao({ quadro }: { quadro: DadosDoQuadro }) {
  const fonte = useFonteDaChamada();
  const deOutro = fonte.mede && quadro.tipo === 'tela' && !quadro.local && quadro.video;
  const minha = fonte.mede && quadro.tipo === 'tela' && quadro.local;
  const recebido = useQualidadeRecebida(deOutro ? quadro.userId : null, 'tela', deOutro);
  const enviado = useQualidadeEnviada(minha);

  if (recebido?.imagem) {
    return (
      <>
        <Ficha tom={recebido.instavel ? 'aviso' : 'ok'}>{recebido.imagem}</Ficha>
        {recebido.banda ? <Ficha>{recebido.banda}</Ficha> : null}
        {recebido.travadas > 0 ? <Ficha tom="aviso">{recebido.travadas === 1 ? '1 travada' : `${recebido.travadas} travadas`} · 30 s</Ficha> : null}
      </>
    );
  }
  if (enviado?.imagem) {
    return (
      <>
        <Ficha tom={enviado.limitacao ? 'aviso' : 'ok'}>Enviando {enviado.imagem}</Ficha>
        {enviado.banda ? <Ficha>{enviado.banda}</Ficha> : null}
        {enviado.limitacao ? <Ficha tom="aviso">{enviado.limitacao === 'cpu' ? 'Limitada pela CPU' : 'Limitada pela banda'}</Ficha> : null}
      </>
    );
  }
  return null;
}

interface Props {
  quadro: DadosDoQuadro;
  guildId: string | null;
  canalId: string | null;
  modo: ModoDoQuadro;
  emDestaque: boolean;
  preferencia: Preferencia;
  aoDestacar: (chave: string | null) => void;
  aoMudarPreferencia: (userId: string, preferencia: Preferencia) => void;
  className?: string;
}

/**
 * Um quadro do palco: uma pessoa (camera ou o rosto) ou uma transmissao.
 *
 * Clique poe em destaque (ou tira), duplo clique ou F poe em tela cheia,
 * botao direito (Shift+F10) abre o cartao da pessoa. A transmissao de outra
 * pessoa comeca como convite: sem video e sem baixar nada ate "Assistir".
 */
export const Quadro = memo(function Quadro({ quadro, guildId, canalId, modo, emDestaque, preferencia, aoDestacar, aoMudarPreferencia, className }: Props) {
  const fonte = useFonteDaChamada();
  const pessoa = fonte.usarPessoa(quadro.userId);
  const nome = useStore((s) => selectors.displayNameOf(s, quadro.userId, guildId));
  const avatar = useStore((s) => s.users.get(quadro.userId)?.avatarUrl ?? null);
  const avatarAnimado = useStore((s) => s.users.get(quadro.userId)?.avatarAnimatedUrl ?? null);
  const caixa = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  const [cartao, setCartao] = useState(false);
  const tela = quadro.tipo === 'tela';
  const pequeno = modo === 'fita' || modo === 'mini';

  useRecepcao(caixa, quadro.video && !quadro.local ? { userId: quadro.userId, fonte: tela ? 'tela' : 'camera', preferencia: tela ? preferencia : 'auto' } : null);

  /*
    Tela cheia, lida do navegador e nao de um booleano proprio. Neste Electron
    o evento `fullscreenchange` nao chega (medido na 1.x): enquanto estiver em
    tela cheia, uma verificacao curta percebe a saida pelo Esc ou F11.
  */
  const sincronizar = useCallback(() => setCheia(document.fullscreenElement === caixa.current), []);
  useEffect(() => {
    document.addEventListener('fullscreenchange', sincronizar);
    return () => document.removeEventListener('fullscreenchange', sincronizar);
  }, [sincronizar]);
  useEffect(() => {
    if (!cheia) return;
    const relogio = setInterval(sincronizar, 250);
    return () => clearInterval(relogio);
  }, [cheia, sincronizar]);
  const alternarCheia = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await caixa.current?.requestFullscreen();
    } catch {
      // negado: o estado abaixo volta ao que for verdade
    }
    sincronizar();
  }, [sincronizar]);

  const podeCartao = !quadro.local;
  const rotulo = tela ? `Transmissão de ${nome}` : nome;

  return (
    <CartaoNaChamada userId={quadro.userId} guildId={guildId} canalId={canalId} transmitindo={tela} aberto={cartao} aoMudar={setCartao}>
      <div
        ref={caixa}
        role="group"
        aria-label={`${rotulo}${pessoa.falando ? ', falando' : ''}${pessoa.mudo ? ', microfone desligado' : ''}${pessoa.surdo ? ', som desligado' : ''}`}
        tabIndex={0}
        data-quadro={quadro.chave}
        onClick={() => !quadro.convite && modo !== 'destaque' && aoDestacar(quadro.chave)}
        onDoubleClick={() => !quadro.convite && void alternarCheia()}
        onContextMenu={(e) => {
          if (!podeCartao) return;
          e.preventDefault();
          setCartao(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (quadro.convite) fonte.assistir(quadro.userId);
            else aoDestacar(emDestaque ? GRADE : quadro.chave);
          } else if ((e.key === 'f' || e.key === 'F') && !quadro.convite) {
            e.preventDefault();
            void alternarCheia();
          } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
            if (!podeCartao) return;
            e.preventDefault();
            setCartao(true);
          }
        }}
        className={cx(
          'group relative size-full overflow-hidden border bg-terminal outline-none',
          modo === 'destaque' ? 'k-chanfro' : 'k-chanfro-sm',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-acento',
          pessoa.falando && !tela ? 'border-fala' : 'border-borda',
          !quadro.convite && modo !== 'destaque' && 'cursor-pointer',
          cheia && 'bg-preto',
          className,
        )}
      >
        {quadro.video ? (
          <VideoHospedado quadro={quadro} />
        ) : quadro.convite ? (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_50%_30%,rgba(220,38,38,0.12),transparent_70%)] p-3 text-center">
            <div className="flex flex-col items-center gap-2">
              <Monitor aria-hidden className={cx('text-acento', pequeno ? 'size-5' : 'size-8')} strokeWidth={1.5} />
              <p className={cx('font-semibold text-texto', pequeno ? 'text-12' : 'text-15')}>
                {nome} está transmitindo
                {quadro.espectadores > 0 && !pequeno ? <span className="block font-mono text-10 font-normal tracking-[0.1em] text-texto-3">{quadro.espectadores} assistindo</span> : null}
              </p>
              <Botao
                tamanho="sm"
                variante="primario"
                onClick={(e) => {
                  e.stopPropagation();
                  fonte.assistir(quadro.userId);
                  aoDestacar(quadro.chave);
                }}
              >
                ▸ Assistir
              </Botao>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <Avatar
              nome={nome}
              id={quadro.userId}
              url={avatar}
              urlAnimada={avatarAnimado}
              tamanho={modo === 'fita' || modo === 'mini' ? 40 : 72}
              falando={pessoa.falando}
            />
          </div>
        )}

        {/* O anel de quem fala vai POR CIMA do video: embaixo, a camera o cobria. */}
        {pessoa.falando && !tela ? (
          <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] shadow-[inset_0_0_0_2px_var(--k-fala),inset_0_0_22px_var(--k-fala-brilho)]" />
        ) : null}

        {/* Em cima, a esquerda: ao vivo e espectadores. */}
        {tela && !quadro.convite ? (
          <div className={cx('absolute left-2 top-2 z-[2] flex items-center gap-2', !pequeno && 'left-3 top-3')}>
            <SeloVivo grande={!pequeno} />
            {!pequeno && (quadro.local || quadro.espectadores > 0) ? (
              <Ficha>
                <Eye aria-hidden className="size-3.5" strokeWidth={1.5} />
                <span className="sr-only">Espectadores: </span>
                {quadro.espectadores}
              </Ficha>
            ) : null}
          </div>
        ) : null}

        {/* Em cima, a direita: a qualidade de verdade (transmissao) ou as marcas (pessoa). */}
        {!pequeno && tela && !quadro.convite ? (
          <div className="absolute right-3 top-3 z-[2] flex flex-wrap justify-end gap-1.5">
            <QualidadeDaTransmissao quadro={quadro} />
          </div>
        ) : null}
        {!tela && (pessoa.mudo || pessoa.surdo) ? (
          <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1 text-perigo">
            {pessoa.surdo ? <HeadphoneOff aria-hidden className="size-3.5" strokeWidth={1.5} /> : null}
            {pessoa.mudo ? <MicOff aria-hidden className="size-3.5" strokeWidth={1.5} /> : null}
          </div>
        ) : null}

        {/* Embaixo, a esquerda: o nome (o convite ja diz de quem e). */}
        <div className={cx('absolute bottom-1.5 left-2 z-[2] max-w-[calc(100%-16px)]', !pequeno && 'bottom-3 left-3', quadro.convite && 'hidden')}>
          {pequeno ? (
            <span className="block truncate font-mono text-10 uppercase tracking-[0.12em] text-texto-2 [text-shadow:0_1px_2px_#000]">
              {tela ? `tela · ${nome}` : nome}
            </span>
          ) : (
            <span className="inline-block max-w-full truncate border-l-2 border-acento bg-preto/70 px-2 py-[3px] text-13 font-semibold text-texto">
              {nome}
              {tela ? <span className="ml-1.5 font-normal text-texto-2">transmissão</span> : null}
            </span>
          )}
        </div>

        {/* Acoes, no hover e no foco. */}
        {!quadro.convite && !pequeno ? (
          <div
            className="absolute bottom-3 right-3 z-[3] flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {tela && !quadro.local ? (
              <>
                <Menu>
                  <MenuGatilho asChild>
                    <BotaoIcone
                      rotulo={`Qualidade: ${NOMES_DA_PREFERENCIA[preferencia]}`}
                      tamanho="sm"
                      className="border-branco/10 bg-preto/70"
                      icone={<SlidersHorizontal className="size-4" strokeWidth={1.5} />}
                    />
                  </MenuGatilho>
                  <MenuConteudo alinhar="end">
                    <MenuRotulo>Qualidade que chega</MenuRotulo>
                    {(Object.keys(NOMES_DA_PREFERENCIA) as Preferencia[]).map((p) => (
                      <MenuItem key={p} aoEscolher={() => aoMudarPreferencia(quadro.userId, p)} atalho={p === preferencia ? '■' : undefined}>
                        {NOMES_DA_PREFERENCIA[p]}
                      </MenuItem>
                    ))}
                  </MenuConteudo>
                </Menu>
                <BotaoIcone
                  rotulo="Parar de assistir"
                  tamanho="sm"
                  className="border-branco/10 bg-preto/70"
                  icone={<X className="size-4" strokeWidth={1.5} />}
                  onClick={() => {
                    fonte.pararDeAssistir(quadro.userId);
                    if (emDestaque) aoDestacar(GRADE);
                  }}
                />
              </>
            ) : null}
            <BotaoIcone
              rotulo={emDestaque ? 'Voltar para a grade' : 'Pôr em destaque'}
              tamanho="sm"
              className="border-branco/10 bg-preto/70"
              icone={<Focus className="size-4" strokeWidth={1.5} />}
              onClick={() => aoDestacar(emDestaque ? GRADE : quadro.chave)}
            />
            {quadro.video ? (
              <BotaoIcone
                rotulo={cheia ? 'Sair da tela cheia' : 'Tela cheia'}
                atalho="F"
                tamanho="sm"
                className="border-branco/10 bg-preto/70"
                icone={cheia ? <Minimize2 className="size-4" strokeWidth={1.5} /> : <Maximize2 className="size-4" strokeWidth={1.5} />}
                onClick={() => void alternarCheia()}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </CartaoNaChamada>
  );
});

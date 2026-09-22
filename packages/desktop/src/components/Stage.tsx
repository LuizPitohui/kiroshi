import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';
import { selectors, useStore } from '../store/index.js';
import { voice, type VoiceParticipant } from '../voice/controller.js';
import { composicao, rotuloDoQuadro } from '../voice/palco.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { Avatar } from './Avatar.js';
import { ParticipantTile } from './ui/ParticipantTile.js';
import { CartaoDePessoa } from './CartaoDePessoa.js';
import { Expand, Collapse, Focus, Chevron, Close, Monitor } from './Icons.js';

type Fonte = 'camera' | 'tela' | 'avatar';

interface Quadro {
  chave: string;
  participante: VoiceParticipant;
  fonte: Fonte;
  /**
   * Transmissao de outra pessoa que eu ainda nao escolhi assistir.
   *
   * Nesse estado o quadro mostra um convite, e nao video: o video nem esta
   * sendo baixado. Quem so entrou para conversar nao paga banda por uma
   * transmissao que nao pediu.
   */
  aguardandoEscolha?: boolean;
}

const ALTURA_PADRAO = 380;
const ALTURA_MIN = 170;
/** Sem ninguem transmitindo, basta uma faixa de rostos. */
const ALTURA_COMPACTA = 132;

/** A barra do proprio palco, que fica fora da area dos quadros. */
const ALTURA_BARRA = 30;

/**
 * O minimo de conversa que sempre sobra embaixo do palco.
 *
 * Sem um teto, uma altura guardada de uma janela maior — ou a janela sendo
 * reduzida depois — deixa o palco mais alto que o espaco disponivel e a
 * conversa desaparece. E um beco: o campo de escrever sai junto, entao nem da
 * para dizer que algo sumiu.
 *
 * O valor e medido contra o espaco real do container, nao contra a janela: a
 * janela inclui barra de titulo e barra de baixo, e repetir esses numeros aqui
 * seria copiar medidas que vivem no CSS e sairiam de sincronia na primeira vez
 * que alguem mexesse la.
 */
const MINIMO_DE_CONVERSA = 230;

/**
 * Palco de video, acima da conversa.
 *
 * Duas decisoes moldam esta tela.
 *
 * A primeira e empilhar em vez de substituir: assistir alguem jogando e
 * comentar ao mesmo tempo e exatamente o que esse grupo faz, e na disposicao
 * anterior abrir a transmissao escondia o chat.
 *
 * A segunda e manter todos os quadros no mesmo container, sempre. Promover um
 * quadro a principal so troca classe e tamanho — o elemento de video nunca e
 * desmontado, entao a faixa nao precisa ser reanexada e a imagem nao pisca no
 * meio da troca. E tambem o que deixa a mudanca animar sozinha.
 */
interface PropsDoPalco {
  /**
   * Ocupa toda a altura disponivel, em vez de dividir com uma conversa.
   *
   * E o modo do canal de voz aberto: ali nao ha nada embaixo para dividir
   * espaco, entao altura guardada, alca de arrastar e teto de altura nao tem
   * o que resolver — so limitariam o video sem motivo.
   */
  preencher?: boolean;
  /**
   * Sem a barra propria, porque outra coisa acima ja a substitui.
   *
   * E o caso da chamada em segundo plano: o dock logo acima ja diz o canal, o
   * numero de pessoas e como voltar. Manter a barra aqui repetia tudo isso na
   * linha seguinte.
   */
  semBarra?: boolean;
  /**
   * Recolhimento controlado de fora.
   *
   * Sem a barra propria o palco perderia o botao de recolher, entao quem
   * mostra a barra substituta assume o controle. Fora disso, o estado continua
   * aqui dentro — o canal de voz aberto nao precisa de ninguem para isso.
   */
  recolhido?: boolean;
  aoAlternarRecolhido?: () => void;
}

export function Stage({
  preencher = false,
  semBarra = false,
  recolhido: recolhidoDeFora,
  aoAlternarRecolhido,
}: PropsDoPalco) {
  const voz = useVoiceState();
  const store = useStore();
  const canal = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));

  const [altura, setAltura] = useState(() => {
    const salva = Number(localStorage.getItem('kiroshi.stage.height'));
    return Number.isFinite(salva) && salva >= ALTURA_MIN ? salva : ALTURA_PADRAO;
  });
  const [emFoco, setEmFoco] = useState<string | null>(null);
  const [recolhidoAqui, setRecolhidoAqui] = useState(false);

  // Controlado quando quem envolve manda; interno quando nao manda.
  const recolhido = recolhidoDeFora ?? recolhidoAqui;
  const alternarRecolhido = aoAlternarRecolhido ?? (() => setRecolhidoAqui((v) => !v));
  const [espacoDisponivel, setEspacoDisponivel] = useState(0);
  const arrastando = useRef(false);
  const palco = useRef<HTMLDivElement>(null);

  /*
    O cartao da pessoa, aberto no botao direito sobre um quadro.

    A ancora e uma referencia so, apontada para o quadro clicado no momento do
    clique. Uma referencia por quadro seria mais arrumado e nao serve: o balao
    precisa da posicao de UM elemento, e e sempre o ultimo em que se clicou.
  */
  const ancoraDoCartao = useRef<HTMLElement | null>(null);
  const [pessoaNoCartao, setPessoaNoCartao] = useState<string | null>(null);

  const quadros = useMemo<Quadro[]>(() => {
    const saida: Quadro[] = [];
    for (const p of voz.participants) {
      // Transmissao primeiro: e o que as pessoas vieram ver.
      if (p.hasScreenShare) {
        /*
          A minha propria transmissao aparece sempre — e a previa do que estou
          mandando, e nao faz sentido "escolher assistir" o que sai daqui.

          A dos outros comeca como convite. Antes toda transmissao entrava na
          tela e na banda de todo mundo assim que comecava, sem ninguem pedir.
        */
        const minha = p.isLocal;
        saida.push({
          chave: `${p.userId}:tela`,
          participante: p,
          fonte: 'tela',
          aguardandoEscolha: !minha && !voz.assistindo.includes(p.userId),
        });
      }
      // Todo mundo tem um quadro, com camera ou so com o rosto parado. Sem
      // isso, quem esta na chamada sem video simplesmente some da tela.
      saida.push({
        chave: `${p.userId}:pessoa`,
        participante: p,
        fonte: p.hasVideo ? 'camera' : 'avatar',
      });
    }
    return saida;
  }, [voz.participants, voz.assistindo]);

  // Convite nao e video: um quadro esperando escolha nao deve fazer o palco
  // crescer para caber uma imagem que nem esta chegando.
  const temVideo = quadros.some((q) => q.fonte !== 'avatar' && !q.aguardandoEscolha);
  const transmitindo = quadros.filter((q) => q.fonte === 'tela').length;
  const cameras = quadros.filter((q) => q.fonte === 'camera').length;
  const noPalco = quadros.length > 0;

  /*
    Mede o container em vez da janela, e reage a qualquer coisa que o mude —
    redimensionar, maximizar, a barra de baixo crescendo.

    A dependencia em `noPalco` nao e detalhe: fora de chamada este componente
    devolve null, entao no primeiro render nao existe elemento para observar.
    Com dependencias vazias o efeito rodava uma vez, nesse exato momento, saia
    sem observar nada e nunca mais voltava — e ai o teto ficava no valor de
    partida para sempre, exatamente na hora em que ele passa a importar.
  */
  useEffect(() => {
    if (!noPalco) return;
    const pai = palco.current?.parentElement;
    if (!pai) return;
    const observador = new ResizeObserver(([entrada]) => {
      setEspacoDisponivel(entrada?.contentRect.height ?? 0);
    });
    observador.observe(pai);
    return () => observador.disconnect();
  }, [noPalco]);

  const teto =
    espacoDisponivel > 0
      ? Math.max(ALTURA_MIN, espacoDisponivel - MINIMO_DE_CONVERSA - ALTURA_BARRA)
      : ALTURA_PADRAO;

  /*
    Promove ao destaque a transmissao que esta REALMENTE sendo vista.

    Antes promovia qualquer transmissao nova, e isso virou um problema quando
    assistir passou a ser escolha: o convite de alguem que comecou a
    transmitir tomaria o palco inteiro com um cartao, empurrando para a fita
    as pessoas com quem se esta conversando. Convite fica na grade; quem sobe
    ao destaque e o que foi aceito.
  */
  const telasAnteriores = useRef<string[]>([]);
  useEffect(() => {
    const telas = quadros
      .filter((q) => q.fonte === 'tela' && !q.aguardandoEscolha)
      .map((q) => q.chave);
    const nova = telas.find((t) => !telasAnteriores.current.includes(t));
    telasAnteriores.current = telas;
    if (nova) setEmFoco((atual) => atual ?? nova);
  }, [quadros]);

  // Se o quadro em destaque sumiu (parou de transmitir, saiu da chamada), volta
  // para a grade em vez de ficar apontando para o nada.
  useEffect(() => {
    if (emFoco && !quadros.some((q) => q.chave === emFoco)) setEmFoco(null);
  }, [emFoco, quadros]);

  // Arrastar a alca muda a altura; o valor so vai para o armazenamento quando
  // o arrasto termina, para nao escrever dezenas de vezes por segundo.
  useEffect(() => {
    function mover(e: MouseEvent): void {
      if (!arrastando.current) return;
      const topo = palco.current?.getBoundingClientRect().top ?? 0;
      const nova = Math.max(ALTURA_MIN, Math.min(teto, e.clientY - topo));
      setAltura(nova);
    }
    function soltar(): void {
      if (!arrastando.current) return;
      arrastando.current = false;
      document.body.style.cursor = '';
      localStorage.setItem('kiroshi.stage.height', String(altura));
    }

    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    return () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
  }, [altura, teto]);

  // Esc sai do destaque. A tela cheia o navegador ja trata sozinho.
  useEffect(() => {
    if (!emFoco) return;
    function tecla(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !document.fullscreenElement) setEmFoco(null);
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [emFoco]);

  const naGrade = emFoco ? quadros.filter((q) => q.chave !== emFoco) : quadros;

  // Como os quadros se arrumam. A conta mora em `voice/palco.ts`, que e uma
  // funcao pura e por isso da para testar sem montar este componente inteiro
  // — e montar este componente exige LiveKit, `localStorage` e um
  // `ResizeObserver`.
  const { modo, colunas, linhas } = useMemo(
    () => composicao({ naGrade: naGrade.length, temVideo, temDestaque: Boolean(emFoco) }),
    [naGrade.length, temVideo, emFoco],
  );

  // Depois de todos os hooks: sair antes mudaria a ordem entre renders, que e
  // a regra que o React nao perdoa.
  if (quadros.length === 0) return null;

  const alturaEfetiva = recolhido ? 0 : temVideo ? Math.min(altura, teto) : ALTURA_COMPACTA;

  return (
    <div
      ref={palco}
      className={[
        'stage',
        preencher ? 'fill' : '',
        recolhido ? 'collapsed' : '',
        emFoco ? 'spotlit' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // No modo que preenche, a altura vem do CSS (flex): fixar em pixel aqui
      // congelaria o palco no tamanho de um instante e ele pararia de
      // acompanhar a janela.
      style={preencher ? undefined : { height: alturaEfetiva + (semBarra ? 0 : ALTURA_BARRA) }}
    >
      <div className="stage-bar" hidden={semBarra}>
        <span className={`stage-title ${transmitindo > 0 ? 'live' : ''}`}>
          {transmitindo > 0 ? 'Ao vivo' : 'Na chamada'}
        </span>
        <span className="stage-sub">
          {canal?.name ?? 'canal'}
          {` · ${voz.participants.length} ${voz.participants.length === 1 ? 'pessoa' : 'pessoas'}`}
          {transmitindo > 0 ? ` · ${transmitindo} tela${transmitindo > 1 ? 's' : ''}` : ''}
          {cameras > 0 ? ` · ${cameras} camera${cameras > 1 ? 's' : ''}` : ''}
        </span>

        <div className="stage-actions">
          {emFoco && (
            <button
              className="stage-act"
              onClick={() => setEmFoco(null)}
              title="Voltar para a grade"
            >
              <Collapse size={14} />
              <span>Grade</span>
            </button>
          )}
          <button
            className="stage-act"
            onClick={alternarRecolhido}
            title={recolhido ? 'Mostrar o palco' : 'Recolher o palco'}
            aria-label={recolhido ? 'Mostrar o palco' : 'Recolher o palco'}
          >
            <Chevron size={14} style={recolhido ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
        </div>
      </div>

      {/*
        O modo vai como classe porque quem trata os casos e o CSS: uma chamada
        de duas pessoas nao e uma grade pequena, e um rosto parado sozinho nao
        deve esticar para o palco inteiro. Sem um nome para cada caso, todos
        recebiam o mesmo tratamento de grade.
      */}
      <div
        className={`stage-floor palco-${modo}`}
        style={{ '--cols': colunas, '--rows': linhas } as React.CSSProperties}
        aria-hidden={recolhido}
      >
        {quadros.map((q) => (
          <QuadroDeVideo
            key={q.chave}
            quadro={q}
            guildId={canal?.guildId ?? null}
            mediaVersion={voz.mediaVersion}
            destacado={q.chave === emFoco}
            miniatura={Boolean(emFoco) && q.chave !== emFoco}
            onDestacar={() => setEmFoco((atual) => (atual === q.chave ? null : q.chave))}
            /*
              Aceitar o convite faz as duas coisas de uma vez: passa a receber
              a transmissao e a poe em destaque. O destaque nao e enfeite — e
              ele que da ao quadro o tamanho que faz o LiveKit mandar a camada
              cheia em vez da miniatura.
            */
            onAssistir={() => {
              void voice.assistirTransmissao(q.participante.userId);
              setEmFoco(q.chave);
            }}
            onPararDeAssistir={() => {
              void voice.pararDeAssistir(q.participante.userId);
              setEmFoco((atual) => (atual === q.chave ? null : atual));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              ancoraDoCartao.current = e.currentTarget as HTMLElement;
              setPessoaNoCartao(q.participante.userId);
            }}
          />
        ))}
      </div>

      {/* Sem alca no modo que preenche: nao ha nada embaixo para ceder espaco. */}
      {!recolhido && temVideo && !preencher && (
        <div
          className="stage-resize"
          onMouseDown={() => {
            arrastando.current = true;
            document.body.style.cursor = 'ns-resize';
          }}
          role="separator"
          aria-label="Ajustar altura do palco"
        />
      )}

      {/*
        O cartao vive aqui, fora da grade, e nao dentro de cada quadro: um
        balao por quadro significaria um componente montado por participante
        so para ficar fechado. Um so, apontado para quem foi clicado.
      */}
      {pessoaNoCartao && (
        <CartaoDePessoa
          userId={pessoaNoCartao}
          guildId={canal?.guildId ?? null}
          ancora={ancoraDoCartao}
          aberto
          aoFechar={() => setPessoaNoCartao(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuadroDeVideo({
  quadro,
  guildId,
  mediaVersion,
  destacado,
  miniatura,
  onDestacar,
  onAssistir,
  onPararDeAssistir,
  onContextMenu,
}: {
  quadro: Quadro;
  guildId: string | null;
  mediaVersion: number;
  destacado: boolean;
  miniatura: boolean;
  onDestacar: () => void;
  onAssistir: () => void;
  onPararDeAssistir: () => void;
  onContextMenu: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const store = useStore();
  const usuario = useStore((s) => s.users.get(quadro.participante.userId));
  const [cheia, setCheia] = useState(false);

  /*
    Um convite nao tem imagem para anexar.

    Isto e o que impede o `<video>` de existir enquanto ninguem aceitou. Com o
    elemento na tela, o LiveKit consideraria a faixa em uso e voltaria a
    baixa-la — e a economia de banda, que e metade do motivo desta funcao,
    sumiria sem nenhum sinal visivel.
  */
  const temImagem = quadro.fonte !== 'avatar' && !quadro.aguardandoEscolha;

  /*
    Anexa a faixa, e nao reanexa a mesma faixa duas vezes.

    `mediaVersion` esta nas dependencias de proposito: a publicacao da faixa
    chega antes da assinatura, entao a primeira tentativa costuma vir vazia e
    sem reagir a mudanca o quadro ficaria preto esperando.

    O que faltava era a guarda. `detach` zera o `srcObject` do elemento, e
    reanexar a MESMA faixa apaga a imagem e a traz de volta — um piscar. Com a
    versao andando a cada amostra de audio, cinco vezes por segundo, era um
    piscar continuo em camera e transmissao.

    A causa principal foi corrigida no controlador, que agora so muda a versao
    quando as faixas mudam de verdade. Esta guarda fica mesmo assim: ela torna
    o efeito seguro para rodar de novo por qualquer motivo, inclusive o modo
    estrito do React, que monta e desmonta tudo duas vezes.
  */
  const anexado = useRef<{
    faixa: RemoteTrack | LocalVideoTrack;
    elemento: HTMLVideoElement;
  } | null>(null);

  /** Solta a faixa do elemento em que ela esta, se houver. */
  const soltar = useCallback(() => {
    if (!anexado.current) return;
    anexado.current.faixa.detach(anexado.current.elemento);
    anexado.current = null;
  }, []);

  useEffect(() => {
    const elemento = temImagem ? ref.current : null;
    const desejada = elemento
      ? (voice.getVideoTrack(
          quadro.participante.userId,
          quadro.fonte === 'tela' ? 'screen' : 'camera',
        ) as RemoteTrack | LocalVideoTrack | null)
      : null;

    const atual = anexado.current;

    // Mesma faixa no mesmo elemento, com imagem: nao ha o que fazer.
    if (atual && atual.faixa === desejada && atual.elemento === elemento && elemento?.srcObject) {
      return;
    }

    soltar();
    if (desejada && elemento) {
      desejada.attach(elemento);
      anexado.current = { faixa: desejada, elemento };
    }
    // Sem cleanup aqui de proposito: soltar a faixa a cada reexecucao era o
    // que fazia piscar. A liberacao acontece na saida do quadro, abaixo.
  }, [quadro.participante.userId, quadro.fonte, temImagem, mediaVersion, soltar]);

  // Ao sair da tela, solta: o navegador continuaria decodificando video que
  // ninguem esta vendo.
  useEffect(() => soltar, [soltar]);

  /** Le a verdade do navegador, em vez de manter um booleano proprio. */
  const sincronizarCheia = useCallback(() => {
    setCheia(document.fullscreenElement === caixa.current);
  }, []);

  /*
    Tres formas de descobrir a mesma coisa, porque uma so nao basta aqui.

    O caminho normal seria ouvir `fullscreenchange`. Acontece que neste
    Electron o evento nao chega — medido: a tela cheia entra e sai de verdade,
    `document.fullscreenElement` muda, e nenhum ouvinte dispara, nem no
    documento, nem no elemento, nem na variante com prefixo. Confiar so nele
    deixava o quadro em tela cheia sem a classe que o faz preencher a tela.

    Entao: o ouvinte fica, para quando o evento existir; o clique le o estado
    logo depois de agir; e enquanto estiver em tela cheia uma verificacao curta
    percebe a saida pelo Esc ou F11. Ela so roda nesse intervalo, e um quadro
    preso em tela cheia estragaria o palco inteiro.
  */
  useEffect(() => {
    document.addEventListener('fullscreenchange', sincronizarCheia);
    return () => document.removeEventListener('fullscreenchange', sincronizarCheia);
  }, [sincronizarCheia]);

  useEffect(() => {
    if (!cheia) return;
    const relogio = window.setInterval(sincronizarCheia, 250);
    return () => window.clearInterval(relogio);
  }, [cheia, sincronizarCheia]);

  const alternarCheia = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await caixa.current?.requestFullscreen();
      } catch {
        // Negado ou sem suporte: o estado abaixo volta ao que for verdade.
      }
      sincronizarCheia();
    },
    [sincronizarCheia],
  );

  const nome = selectors.displayNameOf(store, quadro.participante.userId, guildId);
  const rotulo = rotuloDoQuadro(quadro.fonte, nome);

  // So da para parar de assistir o que se escolheu assistir: a propria
  // transmissao e as cameras nao entram nessa conta.
  const podeSair = quadro.fonte === 'tela' && !quadro.participante.isLocal;

  return (
    <ParticipantTile
      ref={caixa}
      nome={rotulo}
      falando={quadro.participante.speaking}
      semMicrofone={quadro.participante.muted}
      aoVivo={quadro.fonte === 'tela'}
      destacado={destacado}
      miniatura={miniatura}
      semImagem={!temImagem}
      emTelaCheia={cheia}
      aviso={
        quadro.participante.connectionQuality === 'poor' ? (
          <span className="mono tile-warn">instavel</span>
        ) : undefined
      }
      // Um convite nao se destaca nem vai para tela cheia: nao ha o que
      // mostrar ate alguem aceitar. O clique nele e aceitar.
      onClick={quadro.aguardandoEscolha ? onAssistir : onDestacar}
      onDoubleClick={quadro.aguardandoEscolha ? undefined : alternarCheia}
      onContextMenu={onContextMenu}
      acoes={
        quadro.aguardandoEscolha ? undefined : (
          <>
            {/* Sair da transmissao fica junto das outras acoes do quadro, e
                nao escondido num menu: entrar foi um clique, sair tambem. */}
            {podeSair && (
              <button
                className="tile-tool"
                onClick={(e) => {
                  e.stopPropagation();
                  onPararDeAssistir();
                }}
                title="Parar de assistir"
                aria-label={`Parar de assistir a transmissao de ${nome}`}
              >
                <Close size={14} />
              </button>
            )}
            <button
              className="tile-tool"
              onClick={(e) => {
                e.stopPropagation();
                onDestacar();
              }}
              title={destacado ? 'Tirar do destaque' : 'Colocar como principal'}
              aria-label={destacado ? 'Tirar do destaque' : 'Colocar como principal'}
            >
              {destacado ? <Collapse size={14} /> : <Focus size={14} />}
            </button>
            <button
              className="tile-tool"
              onClick={alternarCheia}
              title={cheia ? 'Sair da tela cheia' : 'Tela cheia'}
              aria-label={cheia ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              {cheia ? <Collapse size={14} /> : <Expand size={14} />}
            </button>
          </>
        )
      }
    >
      {quadro.aguardandoEscolha ? (
        /*
          O convite. Diz de quem e, e oferece a acao — nada de video.

          Deliberadamente sem previa da tela transmitida: uma miniatura ao
          vivo exigiria baixar a transmissao, que e exatamente o que esta
          funcao evita. Quem nao quer assistir nao deve pagar por uma espiada.
        */
        <div className="convite-transmissao">
          <Monitor size={26} className="convite-icone" />
          <span className="convite-titulo">{nome} esta transmitindo</span>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              onAssistir();
            }}
          >
            Assistir
          </button>
        </div>
      ) : temImagem ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={quadro.participante.isLocal}
          // A propria camera vem espelhada, como a pessoa se ve; tela nao.
          style={
            quadro.fonte === 'camera' && quadro.participante.isLocal
              ? { transform: 'scaleX(-1)' }
              : undefined
          }
        />
      ) : (
        <Avatar url={usuario?.avatarUrl} name={nome} size={destacado ? 96 : 44} />
      )}
    </ParticipantTile>
  );
}

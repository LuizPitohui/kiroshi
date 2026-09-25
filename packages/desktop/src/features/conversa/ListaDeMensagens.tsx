import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Message } from '@kiroshi/shared';
import { compareIds } from '@kiroshi/shared';
import { ChevronDown, Copy } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import { corteDeNaoLidas, quantasNaoLidas } from '../../lib/naoLidas.js';
import { useAnunciarMensagens } from '../../hooks/useAnunciarMensagens.js';
import {
  Aviso,
  Botao,
  Confirmacao,
  Esqueleto,
  MenuDeContexto,
  MenuDeContextoConteudo,
  MenuDeContextoGatilho,
  MenuDeContextoItem,
  MenuDeContextoSeparador,
  avisar,
  cx,
} from '../../design/primitivos/index.js';
import { Mensagem, itensDaMensagem, type AcoesDaLista, type Permissoes } from './Mensagem.js';
import { apagar, alternarFixada, carregarAnteriores, carregarHistorico, copiarTexto, marcarComoLida, motivo } from './acoes.js';
import { horaCurta, montarLinhas } from './linhas.js';
import { useSalto } from './salto.js';
import { dicionarioDoCanal } from './fontes.js';
import { paraEdicao } from './mencoes.js';

/** Distancia do fim que ainda conta como "no fim". */
const MARGEM_DO_FIM = 80;
/** Perto assim do topo, a pagina anterior ja comeca a vir. */
const MARGEM_DO_TOPO = 400;
/** Quantas paginas para tras um salto pode ir buscar. */
const PAGINAS_POR_SALTO = 20;

export interface ControleDaLista {
  irParaOFim: () => void;
  /** Entra na lista pela mensagem mais nova. */
  focarAtiva: () => boolean;
}

interface Props {
  canalId: string;
  guildId: string | null;
  euSou: string | null;
  permissoes: Permissoes;
  editandoId: string | null;
  responder: (m: Message) => void;
  editar: (id: string | null) => void;
  campo: RefObject<HTMLTextAreaElement | null>;
  controle: RefObject<ControleDaLista | null>;
  /** O comeco do canal, quando o historico inteiro esta carregado. */
  inicio: ReactNode;
  rotulo: string;
}

// setTimeout, e nao requestAnimationFrame: com a janela escondida o quadro
// nao vem, e o salto ficaria parado ate a pessoa voltar para a janela.
const esperarVez = () => new Promise<void>((r) => setTimeout(r, 0));

export function ListaDeMensagens({ canalId, guildId, euSou, permissoes, editandoId, responder, editar, campo, controle, inicio, rotulo }: Props) {
  const mensagens = useStore((s) => selectors.messagesOf(s, canalId));
  const marcadorVivo = useStore((s) => s.readStates.get(canalId)?.lastReadMessageId ?? null);
  const itens = mensagens.items;

  const rolagem = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLOListElement>(null);
  const noFimRef = useRef(true);
  const [noFim, setNoFim] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [ativaId, setAtivaId] = useState<string | null>(null);
  const [reagindoEm, setReagindoEm] = useState<string | null>(null);
  // Onde o mouse esta, decidido aqui e nao em cada mensagem: com o estado em
  // cada uma, um mouseleave perdido deixava duas barras de acoes abertas.
  const [sobreId, setSobreId] = useState<string | null>(null);
  const [apagando, setApagando] = useState<Message | null>(null);
  const [destacada, setDestacada] = useState<string | null>(null);
  const [alvoDoMenu, setAlvoDoMenu] = useState<{ mensagem: Message; selecao: string } | null>(null);
  const [janelaEmFoco, setJanelaEmFoco] = useState(() => document.hasFocus());
  const ancora = useRef<{ altura: number; topo: number; primeiro: string | undefined } | null>(null);

  // ---- carga -------------------------------------------------------------

  const carregar = useCallback(() => {
    setErroDeCarga(null);
    carregarHistorico(canalId).catch((e: unknown) => setErroDeCarga(motivo(e, 'Não consegui carregar as mensagens.')));
  }, [canalId]);

  useEffect(carregar, [carregar]);

  const carregarMais = useCallback(async () => {
    const el = rolagem.current;
    const atual = useStore.getState().messages.get(canalId);
    if (!el || !atual?.hasMore || atual.loading || !atual.loaded) return;
    // Guarda onde se estava: ao entrar conteudo em cima, a lista nao pode pular.
    ancora.current = { altura: el.scrollHeight, topo: el.scrollTop, primeiro: atual.items[0]?.id };
    try {
      // Nada novo: a ancora nao pode sobrar para a proxima pagina.
      if ((await carregarAnteriores(canalId)) === 0) ancora.current = null;
    } catch (e) {
      ancora.current = null;
      avisar.erro('Não consegui carregar as mensagens anteriores', motivo(e, 'Tente de novo.'));
    }
  }, [canalId]);

  // ---- o marcador de leitura CONGELADO na entrada ------------------------
  /*
    O canal e marcado como lido menos de um segundo depois de aberto. Se o
    divisor seguisse o marcador vivo, sumiria antes de servir para algo. E so
    congela depois de as mensagens carregarem: ao abrir o app a lista monta
    antes de o gateway entregar os estados de leitura, e congelar ali poria o
    divisor no topo de uma conversa inteira ja lida (medido na 1.x: 52 de 52).
    Esta lista e montada de novo a cada canal (a chave e o canal), entao o
    marcador de outro canal nunca vaza para este.
  */
  const marcador = useRef<{ pronto: boolean; id: string | null }>({ pronto: false, id: null });
  if (mensagens.loaded && !marcador.current.pronto) {
    marcador.current = { pronto: true, id: useStore.getState().readStates.get(canalId)?.lastReadMessageId ?? null };
  }
  const historicoCompleto = mensagens.loaded && !mensagens.hasMore;
  const corte = useMemo(
    () => (marcador.current.pronto ? corteDeNaoLidas({ mensagens: itens, ultimaLida: marcador.current.id, euSou, historicoCompleto }) : null),
    [itens, euSou, historicoCompleto, mensagens.loaded],
  );
  const naoLidas = quantasNaoLidas(itens, corte, euSou);
  // O botao de baixo e uma acao AGORA: conta do marcador vivo, senao anunciaria
  // como nao lidas as mensagens que a pessoa acabou de ler.
  const naoLidasAgora = useMemo(
    () => quantasNaoLidas(itens, corteDeNaoLidas({ mensagens: itens, ultimaLida: marcadorVivo, euSou, historicoCompleto }), euSou),
    [itens, marcadorVivo, euSou, historicoCompleto],
  );

  const linhas = useMemo(() => montarLinhas(itens, corte, naoLidas), [itens, corte, naoLidas]);
  const porId = useMemo(() => new Map(itens.map((m) => [m.id, m])), [itens]);
  const ultimaId = itens[itens.length - 1]?.id;
  const ativa = ativaId && porId.has(ativaId) ? ativaId : ultimaId;

  // ---- rolagem -------------------------------------------------------------

  const aoRolar = useCallback(() => {
    const el = rolagem.current;
    if (!el) return;
    const chegou = el.scrollHeight - el.scrollTop - el.clientHeight < MARGEM_DO_FIM;
    noFimRef.current = chegou;
    // So redesenha ao cruzar a fronteira: o evento dispara dezenas de vezes por segundo.
    setNoFim((antes) => (antes === chegou ? antes : chegou));
    if (el.scrollTop < MARGEM_DO_TOPO) void carregarMais();
  }, [carregarMais]);

  // Depois de cada mudanca na lista, antes de pintar: conteudo novo em cima
  // mantem o lugar; quem esta no fim continua no fim.
  const primeiroId = itens[0]?.id;
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const a = ancora.current;
    if (a && a.primeiro !== primeiroId) {
      el.scrollTop = a.topo + (el.scrollHeight - a.altura);
      ancora.current = null;
      return;
    }
    if (noFimRef.current) el.scrollTop = el.scrollHeight;
  }, [itens, primeiroId]);

  // Imagem que termina de carregar, reacao nova, compositor que cresce: se a
  // pessoa estava no fim, continua no fim.
  useEffect(() => {
    const el = rolagem.current;
    const conteudo = lista.current;
    if (!el || !conteudo) return;
    const observador = new ResizeObserver(() => {
      if (noFimRef.current) el.scrollTop = el.scrollHeight;
    });
    observador.observe(el);
    observador.observe(conteudo);
    return () => observador.disconnect();
  }, []);

  // Conteudo que nao enche a tela nao deixa rolar: busca mais sozinho.
  useEffect(() => {
    const el = rolagem.current;
    if (!el || !mensagens.loaded || !mensagens.hasMore || mensagens.loading) return;
    if (el.scrollHeight <= el.clientHeight + MARGEM_DO_TOPO) void carregarMais();
  }, [mensagens.loaded, mensagens.hasMore, mensagens.loading, itens.length, carregarMais]);

  const irParaOFim = useCallback((suave = false) => {
    const el = rolagem.current;
    if (!el) return;
    noFimRef.current = true;
    setNoFim(true);
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
  }, []);

  // ---- leitura -------------------------------------------------------------

  useEffect(() => {
    const ganhou = () => setJanelaEmFoco(true);
    const perdeu = () => setJanelaEmFoco(false);
    window.addEventListener('focus', ganhou);
    window.addEventListener('blur', perdeu);
    return () => {
      window.removeEventListener('focus', ganhou);
      window.removeEventListener('blur', perdeu);
    };
  }, []);

  /*
    Marca como lido com a conversa visivel e no fim. `noFim` e o foco da janela
    estao nas dependencias: descer depois de ler o acumulado, ou voltar para a
    janela, tambem marca — na 1.x so marcava quando chegava mensagem nova.
  */
  useEffect(() => {
    if (!ultimaId || !noFim || !janelaEmFoco) return;
    if (useStore.getState().readStates.get(canalId)?.lastReadMessageId === ultimaId) return;
    const t = setTimeout(() => marcarComoLida(canalId, ultimaId), 700);
    return () => clearTimeout(t);
  }, [canalId, ultimaId, noFim, janelaEmFoco]);

  useAnunciarMensagens(canalId, itens, euSou, (userId) => selectors.displayNameOf(useStore.getState(), userId, guildId));

  // ---- saltos --------------------------------------------------------------

  const irPara = useCallback(
    async (id: string) => {
      for (let i = 0; i <= PAGINAS_POR_SALTO; i++) {
        const el = rolagem.current?.querySelector<HTMLElement>(`[data-mensagem="${id}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.focus({ preventScroll: true });
          setAtivaId(id);
          setDestacada(id);
          setTimeout(() => setDestacada((d) => (d === id ? null : d)), 2000);
          return;
        }
        const atual = useStore.getState().messages.get(canalId);
        const maisAntiga = atual?.items[0];
        // Mais nova que a mais antiga carregada e nao esta na tela: foi apagada.
        if (!atual?.hasMore || (maisAntiga && compareIds(id, maisAntiga.id) >= 0)) break;
        try {
          await carregarAnteriores(canalId);
        } catch {
          break;
        }
        await esperarVez();
      }
      avisar.info('Mensagem não encontrada', 'Ela pode ter sido apagada.');
    },
    [canalId],
  );

  const pendente = useSalto((s) => (s.pendente?.canalId === canalId ? s.pendente : null));
  useEffect(() => {
    if (!pendente || !mensagens.loaded) return;
    useSalto.getState().atendido(pendente.vez);
    void irPara(pendente.mensagemId);
  }, [pendente, mensagens.loaded, irPara]);

  // A mensagem em edicao aparece inteira na tela.
  useEffect(() => {
    if (!editandoId) return;
    rolagem.current?.querySelector(`[data-mensagem="${editandoId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [editandoId]);

  // ---- acoes ---------------------------------------------------------------

  const pedirApagar = useCallback((m: Message, direto: boolean) => {
    if (direto) void apagar(m).catch(() => undefined);
    else setApagando(m);
  }, []);

  const acoes = useMemo<AcoesDaLista>(
    () => ({
      responder,
      editar,
      reagir: setReagindoEm,
      apagar: pedirApagar,
      irPara: (id) => void irPara(id),
    }),
    [responder, editar, pedirApagar, irPara],
  );

  useEffect(() => {
    if (!controle) return;
    controle.current = {
      irParaOFim: () => irParaOFim(false),
      focarAtiva: () => {
        // Do compositor se entra pela mais nova, como no Discord: e a que
        // esta na tela e a mais provavel de ser o assunto.
        const todas = rolagem.current?.querySelectorAll<HTMLElement>('article[data-mensagem]');
        const alvo = todas?.[todas.length - 1];
        if (!alvo) return false;
        setAtivaId(alvo.dataset.mensagem ?? null);
        alvo.focus();
        alvo.scrollIntoView({ block: 'nearest' });
        return true;
      },
    };
  }, [controle, irParaOFim]);

  // ---- teclado -------------------------------------------------------------

  function focarVizinha(de: HTMLElement, passo: number | 'primeira' | 'ultima') {
    const todas = [...(rolagem.current?.querySelectorAll<HTMLElement>('article[data-mensagem]') ?? [])];
    const i = todas.indexOf(de);
    const alvo = passo === 'primeira' ? todas[0] : passo === 'ultima' ? todas[todas.length - 1] : todas[i + passo];
    if (!alvo) {
      // Subir alem da primeira carregada busca mais.
      if (passo === -1) void carregarMais();
      return;
    }
    alvo.focus();
    alvo.scrollIntoView({ block: 'nearest' });
    setAtivaId(alvo.dataset.mensagem ?? null);
  }

  function abrirMenu(el: HTMLElement) {
    const caixa = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: caixa.left + 80, clientY: caixa.top + Math.min(caixa.height, 28) }),
    );
  }

  function aoTeclar(e: KeyboardEvent<HTMLOListElement>) {
    const el = e.target as HTMLElement;
    if (el.tagName !== 'ARTICLE' || !el.dataset.mensagem) return;
    const m = porId.get(el.dataset.mensagem);
    if (!m) return;
    const semModificador = !e.ctrlKey && !e.altKey && !e.metaKey;
    const minha = m.authorId === euSou;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      focarVizinha(el, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    /*
      Mensagem focada pelo CLIQUE (para selecionar texto, por exemplo) nao e
      navegacao por teclado: ali Backspace nao pode apagar a mensagem nem "e"
      abrir a edicao. A letra vai para o compositor — trocar o foco durante o
      keydown entrega o caractere ao campo novo, e a pessoa escreve de onde
      estiver, como no Discord.
    */
    if (!el.matches(':focus-visible')) {
      if (e.key.length === 1 && semModificador) campo.current?.focus();
      return;
    }

    switch (e.key) {
      case 'Home':
      case 'End':
        if (!e.ctrlKey) return;
        e.preventDefault();
        focarVizinha(el, e.key === 'Home' ? 'primeira' : 'ultima');
        return;
      case 'Enter':
        e.preventDefault();
        abrirMenu(el);
        return;
      case 'Escape':
        e.preventDefault();
        campo.current?.focus();
        return;
      case 'Delete':
      case 'Backspace':
        if (minha || permissoes.gerenciar) {
          e.preventDefault();
          pedirApagar(m, e.shiftKey);
        }
        return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString() && m.content) {
      e.preventDefault();
      void copiarTexto(paraEdicao(m.content, dicionarioDoCanal(canalId)));
      return;
    }
    if (!semModificador) return;
    const tecla = e.key.toLowerCase();
    if (tecla === 'e' && minha) {
      e.preventDefault();
      editar(m.id);
    } else if (tecla === 'r') {
      e.preventDefault();
      responder(m);
    } else if (tecla === 'p' && permissoes.fixar) {
      e.preventDefault();
      void alternarFixada(m);
    } else if ((e.key === '+' || e.key === '=') && permissoes.reagir) {
      e.preventDefault();
      setReagindoEm(m.id);
    }
  }

  // ---- desenho -------------------------------------------------------------

  const gruposDoMenu = alvoDoMenu ? itensDaMensagem(alvoDoMenu.mensagem, euSou, permissoes, acoes) : [];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {mensagens.loading && itens.length > 0 ? (
        // Por cima, e nao dentro da lista: um indicador que ocupa espaco empurraria a conversa.
        <p className="k-rotulo pointer-events-none absolute inset-x-0 top-2 z-10 text-center">Carregando anteriores…</p>
      ) : null}
      <div ref={rolagem} onScroll={aoRolar} className="k-rolagem min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
        <div className="flex min-h-full flex-col justify-end pb-3 pt-2">
          {erroDeCarga ? (
            <div className="px-4 py-3">
              <Aviso tipo="erro" titulo="As mensagens não carregaram" acao={<Botao tamanho="sm" onClick={carregar}>Tentar de novo</Botao>}>
                {erroDeCarga}
              </Aviso>
            </div>
          ) : null}
          {historicoCompleto ? inicio : null}
          {mensagens.loading && itens.length === 0 ? (
            <div aria-hidden className="space-y-4 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-4">
                  <Esqueleto className="size-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Esqueleto className="h-3 w-40" />
                    <Esqueleto className={cx('h-3', i === 1 ? 'w-2/3' : 'w-1/2')} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <MenuDeContexto onOpenChange={(aberto) => !aberto && setAlvoDoMenu(null)}>
            <MenuDeContextoGatilho
              asChild
              onContextMenu={(e) => {
                // Fora de uma mensagem (ou numa ainda sem confirmacao) nao ha menu:
                // prevenir aqui faz o Radix nao abrir e o menu nativo nao aparecer.
                const el = (e.target as HTMLElement).closest<HTMLElement>('article[data-mensagem]');
                const m = el?.dataset.mensagem ? porId.get(el.dataset.mensagem) : undefined;
                if (!m || itensDaMensagem(m, euSou, permissoes, acoes).length === 0) {
                  e.preventDefault();
                  return;
                }
                setAlvoDoMenu({ mensagem: m, selecao: window.getSelection()?.toString() ?? '' });
              }}
            >
              <ol
                ref={lista}
                aria-label={rotulo}
                aria-busy={mensagens.loading}
                onKeyDown={aoTeclar}
                onMouseOver={(e) => {
                  const id = (e.target as HTMLElement).closest<HTMLElement>('article[data-mensagem]')?.dataset.mensagem ?? null;
                  if (id !== sobreId) setSobreId(id);
                }}
                onMouseLeave={() => setSobreId(null)}
              >
                {linhas.map((linha, i) => {
                  if (linha.tipo === 'dia') {
                    return (
                      <li key={linha.chave} data-divisor={linha.novas ? '' : undefined}>
                        <div role="separator" aria-label={linha.novas ? `${linha.rotulo}, ${linha.novas} novas` : linha.rotulo} className="mx-4 my-2 flex items-center gap-2.5">
                          <span aria-hidden className={cx('h-px flex-1', linha.novas ? 'bg-vivo' : 'bg-borda')} />
                          <span aria-hidden className="k-rotulo">
                            {linha.rotulo}
                          </span>
                          <span aria-hidden className={cx('h-px flex-1', linha.novas ? 'bg-vivo' : 'bg-borda')} />
                          {linha.novas ? (
                            <span aria-hidden className="bg-vivo px-1.5 py-px font-mono text-10 tracking-[0.2em] text-branco">
                              NOVAS
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  }
                  if (linha.tipo === 'novas') {
                    return (
                      <li key={linha.chave} data-divisor="">
                        <div
                          role="separator"
                          aria-label={linha.quantas === 1 ? '1 mensagem nova' : `${linha.quantas} mensagens novas`}
                          className="mx-4 my-1.5 flex items-center gap-2.5 font-mono text-10 tracking-[0.22em] text-acento-2"
                        >
                          <span aria-hidden className="h-px flex-1 bg-vivo" />
                          <span aria-hidden>NOVAS</span>
                        </div>
                      </li>
                    );
                  }
                  const m = itens[linha.indice]!;
                  const anterior = linhas[i - 1];
                  return (
                    <li key={linha.chave}>
                      <Mensagem
                        mensagem={m}
                        continua={linha.continua}
                        primeira={!anterior || anterior.tipo !== 'mensagem'}
                        guildId={guildId}
                        euSou={euSou}
                        permissoes={permissoes}
                        focavel={m.id === ativa}
                        sobre={m.id === sobreId}
                        editando={m.id === editandoId}
                        reagindo={m.id === reagindoEm}
                        destacada={m.id === destacada}
                        acoes={acoes}
                      />
                    </li>
                  );
                })}
              </ol>
            </MenuDeContextoGatilho>
            <MenuDeContextoConteudo>
              {alvoDoMenu?.selecao ? (
                <>
                  <MenuDeContextoItem icone={<Copy className="size-4" strokeWidth={1.5} />} atalho="Ctrl+C" aoEscolher={() => void copiarTexto(alvoDoMenu.selecao)}>
                    Copiar seleção
                  </MenuDeContextoItem>
                  <MenuDeContextoSeparador />
                </>
              ) : null}
              {gruposDoMenu.map((grupo, i) => (
                <div key={i}>
                  {i > 0 ? <MenuDeContextoSeparador /> : null}
                  {grupo.map((item) => (
                    <MenuDeContextoItem key={item.chave} icone={item.icone} atalho={item.atalho} perigo={item.perigo} aoEscolher={() => item.acao()}>
                      {item.rotulo}
                    </MenuDeContextoItem>
                  ))}
                </div>
              ))}
            </MenuDeContextoConteudo>
          </MenuDeContexto>
        </div>
      </div>

      {/*
        De volta ao fim, so quando se saiu dele. Dois rotulos: "N mensagens nao
        lidas" leva ao divisor (onde se parou de ler); "Ir para o fim" leva ao
        presente. Um botao so faria quem subiu para reler perder o lugar.
      */}
      {!noFim ? (
        <button
          type="button"
          onClick={() => {
            const divisor = rolagem.current?.querySelector('[data-divisor]');
            if (naoLidasAgora > 0 && divisor) divisor.scrollIntoView({ block: 'center', behavior: 'smooth' });
            else irParaOFim(true);
          }}
          className={cx(
            'absolute bottom-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-2 border px-3 font-mono text-11 uppercase tracking-rotulo shadow-camada',
            naoLidasAgora > 0 ? 'border-acento bg-acento text-sobre-acento' : 'border-borda-2 bg-elevado text-texto-2 hover:text-texto',
          )}
        >
          {naoLidasAgora > 0 ? (naoLidasAgora === 1 ? '1 mensagem não lida' : `${naoLidasAgora} mensagens não lidas`) : 'Ir para o fim'}
          <ChevronDown aria-hidden className="size-3.5" strokeWidth={1.5} />
        </button>
      ) : null}

      <Confirmacao
        aberto={apagando !== null}
        aoMudar={(aberto) => !aberto && setApagando(null)}
        titulo="Apagar mensagem"
        descricao={
          apagando ? (
            <>
              Esta mensagem {apagando.authorId === euSou ? 'sua' : `de ${selectors.displayNameOf(useStore.getState(), apagando.authorId, guildId)}`} das{' '}
              {horaCurta(apagando.createdAt)} some para todo mundo. Dica: Shift + clique em apagar pula esta pergunta.
            </>
          ) : null
        }
        confirmar="Apagar"
        perigo
        aoConfirmar={async () => {
          if (!apagando) return;
          // O erro aparece dentro do proprio dialogo; sem aviso duplicado.
          await apagar(apagando, false);
          setApagando(null);
          if (editandoId === apagando.id) editar(null);
        }}
      />
    </div>
  );
}

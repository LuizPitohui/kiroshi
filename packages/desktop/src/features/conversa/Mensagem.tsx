import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Message } from '@kiroshi/shared';
import { toPlainText } from '@kiroshi/shared';
import { Copy, CornerUpLeft, MoreHorizontal, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import {
  Avatar,
  Balao,
  BalaoAncora,
  BalaoConteudo,
  BalaoGatilho,
  BotaoIcone,
  Dica,
  Menu,
  MenuConteudo,
  MenuGatilho,
  MenuItem,
  MenuSeparador,
  cx,
} from '../../design/primitivos/index.js';
import { Conteudo } from './Conteudo.js';
import { Anexos, Cartoes } from './Anexos.js';
import { SeletorDeEmoji, type EmojiEscolhido } from './SeletorDeEmoji.js';
import { alternarFixada, alternarReacao, copiarTexto, editar, type EmojiDeReacao } from './acoes.js';
import { dataCompleta, horaCurta } from './linhas.js';
import { dicionarioDoCanal, fontesDoCanal } from './fontes.js';
import { paraEdicao, paraEnvio } from './mencoes.js';
import { ListaDeSugestoes, ariaDoCampo, useAutocompletar } from './Autocompletar.js';
import { idsOtimistas } from './envio.js';

/** O que a lista faz por uma mensagem. Um objeto estavel, para o `memo` valer. */
export interface AcoesDaLista {
  responder: (m: Message) => void;
  editar: (id: string | null) => void;
  reagir: (id: string | null) => void;
  /** `direto`: Shift apertado, apaga sem perguntar (como no Discord). */
  apagar: (m: Message, direto: boolean) => void;
  irPara: (id: string) => void;
}

export interface Permissoes {
  reagir: boolean;
  fixar: boolean;
  /** Apagar a mensagem dos outros. */
  gerenciar: boolean;
}

export function paraReacao(e: EmojiEscolhido): EmojiDeReacao {
  return e.tipo === 'unicode' ? { emoji: e.emoji } : { emojiId: e.id };
}

// ---------------------------------------------------------------------------
// Itens do menu: os mesmos no "mais", no botao direito e no teclado
// ---------------------------------------------------------------------------

export interface ItemDoMenu {
  chave: string;
  rotulo: string;
  icone: ReactNode;
  atalho?: string;
  perigo?: boolean;
  acao: (evento?: { shiftKey?: boolean }) => void;
}

const ic = 'size-4';

export function itensDaMensagem(m: Message, euSou: string | null, p: Permissoes, acoes: AcoesDaLista): ItemDoMenu[][] {
  const minha = m.authorId === euSou;
  const pendente = idsOtimistas.has(m.id);
  // Registro de chamada e do sistema: nada para responder, editar, fixar ou apagar.
  if (pendente || m.type === 'CALL') return [];
  const principais: ItemDoMenu[] = [];
  if (p.reagir) principais.push({ chave: 'reagir', rotulo: 'Reagir', icone: <SmilePlus className={ic} strokeWidth={1.5} />, atalho: '+', acao: () => acoes.reagir(m.id) });
  principais.push({ chave: 'responder', rotulo: 'Responder', icone: <Reply className={ic} strokeWidth={1.5} />, atalho: 'R', acao: () => acoes.responder(m) });
  if (minha) principais.push({ chave: 'editar', rotulo: 'Editar', icone: <Pencil className={ic} strokeWidth={1.5} />, atalho: 'E', acao: () => acoes.editar(m.id) });
  if (p.fixar) {
    principais.push({
      chave: 'fixar',
      rotulo: m.pinned ? 'Desafixar' : 'Fixar',
      icone: m.pinned ? <PinOff className={ic} strokeWidth={1.5} /> : <Pin className={ic} strokeWidth={1.5} />,
      atalho: 'P',
      acao: () => void alternarFixada(m),
    });
  }
  const outros: ItemDoMenu[] = [];
  if (m.content) {
    outros.push({
      chave: 'copiar',
      rotulo: 'Copiar texto',
      icone: <Copy className={ic} strokeWidth={1.5} />,
      atalho: 'Ctrl+C',
      acao: () => void copiarTexto(paraEdicao(m.content, dicionarioDoCanal(m.channelId))),
    });
  }
  const perigosos: ItemDoMenu[] = [];
  if (minha || p.gerenciar) {
    perigosos.push({ chave: 'apagar', rotulo: 'Apagar mensagem', icone: <Trash2 className={ic} strokeWidth={1.5} />, atalho: 'Del', perigo: true, acao: (e) => acoes.apagar(m, Boolean(e?.shiftKey)) });
  }
  return [principais, outros, perigosos].filter((g) => g.length > 0);
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

function Referencia({ mensagem, guildId, irPara }: { mensagem: Message; guildId: string | null; irPara: (id: string) => void }) {
  const original = mensagem.referencedMessage;
  const nome = useStore((s) => (original ? selectors.displayNameOf(s, original.authorId, guildId) : ''));
  const cor = useStore((s) => (original ? selectors.colorOf(s, original.authorId, guildId) : null));
  if (!mensagem.reference) return null;

  const conector = <span aria-hidden className="absolute left-9 top-[11px] h-2.5 w-7 border-l-2 border-t-2 border-borda-2 compacto:left-6 compacto:w-4" />;
  if (!original) {
    return (
      <div className="relative col-span-2 flex h-[22px] items-center pl-[72px] text-13 italic text-texto-3 compacto:pl-[62px]">
        {conector}
        Mensagem original apagada
      </div>
    );
  }
  const s = useStore.getState();
  const previa =
    toPlainText(original.content, {
      user: (id) => selectors.displayNameOf(s, id, guildId),
      role: (id) => s.roles.get(id)?.name,
      channel: (id) => s.channels.get(id)?.name ?? undefined,
    }) || (original.attachments.length ? 'Clique para ver o anexo' : '');

  return (
    <div className="relative col-span-2 flex h-[22px] min-w-0 items-center pl-[72px] compacto:pl-[62px]">
      {conector}
      <button
        type="button"
        onClick={() => irPara(original.id)}
        aria-label={`Resposta a ${nome}: ${previa}. Ir para a mensagem original.`}
        className="flex min-w-0 items-center gap-1.5 text-13 text-texto-3 hover:text-texto-2"
      >
        <CornerUpLeft aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
        <Avatar nome={nome} id={original.authorId} url={original.author.avatarUrl} tamanho={20} />
        <span className="shrink-0 font-semibold" style={cor ? { color: cor } : undefined}>
          {nome}
        </span>
        <span className="min-w-0 truncate">{previa}</span>
      </button>
    </div>
  );
}

function BotaoDeReacao({ reacao, mensagem, guildId }: { reacao: Message['reactions'][number]; mensagem: Message; guildId: string | null }) {
  const url = useStore((s) => {
    if (!reacao.emojiId) return null;
    for (const g of s.guilds.values()) {
      const e = g.emojis.find((x) => x.id === reacao.emojiId);
      if (e) return e.url;
    }
    return null;
  });
  const nomeDoEmoji = reacao.emojiId ? `:${reacao.emojiName ?? 'emoji'}:` : (reacao.emoji ?? '');
  const quem = () => {
    const s = useStore.getState();
    const nomes = reacao.userIds.slice(0, 8).map((id) => selectors.displayNameOf(s, id, guildId));
    const resto = reacao.count - nomes.length;
    return `${nomes.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''} reagiu com ${nomeDoEmoji}`;
  };
  return (
    <Dica texto={<span className="max-w-[240px]">{quem()}</span>}>
      <button
        type="button"
        aria-pressed={reacao.me}
        aria-label={`${nomeDoEmoji}, ${reacao.count} ${reacao.count === 1 ? 'reação' : 'reações'}${reacao.me ? ', incluindo a sua' : ''}`}
        onClick={() => void alternarReacao(mensagem, reacao.emojiId ? { emojiId: reacao.emojiId } : { emoji: reacao.emoji ?? '' }, reacao.me)}
        className={cx(
          'inline-flex h-6 items-center gap-1.5 border px-[7px] font-mono text-12',
          reacao.me ? 'border-acento bg-acento-tenue text-texto' : 'border-borda-2 bg-terminal text-texto-2 hover:border-texto-3',
        )}
      >
        {reacao.emojiId ? (
          url ? (
            <img src={url} alt="" className="size-4 object-contain" />
          ) : (
            <span className="text-11">{nomeDoEmoji}</span>
          )
        ) : (
          <span className="text-[15px] leading-none">{reacao.emoji}</span>
        )}
        <span>{reacao.count}</span>
      </button>
    </Dica>
  );
}

function Reacoes({ mensagem, guildId, podeReagir }: { mensagem: Message; guildId: string | null; podeReagir: boolean }) {
  const [aberto, setAberto] = useState(false);
  if (mensagem.reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {mensagem.reactions.map((r) => (
        <BotaoDeReacao key={r.emojiId ? `c${r.emojiId}` : r.emoji} reacao={r} mensagem={mensagem} guildId={guildId} />
      ))}
      {podeReagir ? (
        <Balao open={aberto} onOpenChange={setAberto}>
          <BalaoGatilho asChild>
            <button
              type="button"
              aria-label="Adicionar reação"
              className="grid h-6 w-8 place-items-center border border-transparente text-texto-3 hover:border-borda-2 hover:text-texto"
            >
              <SmilePlus aria-hidden className="size-4" strokeWidth={1.5} />
            </button>
          </BalaoGatilho>
          <BalaoConteudo rotulo="Escolher reação" lado="top" alinhar="start">
            <SeletorDeEmoji
              guildId={guildId}
              aoEscolher={(e) => {
                setAberto(false);
                void alternarReacao(mensagem, paraReacao(e), false);
              }}
            />
          </BalaoConteudo>
        </Balao>
      ) : null}
    </div>
  );
}

/** Campo de edicao no lugar do texto. Enter salva, Esc cancela, com autocompletar. */
function CampoDeEdicao({ mensagem, aoTerminar, aoApagar }: { mensagem: Message; aoTerminar: () => void; aoApagar: () => void }) {
  const [texto, setTexto] = useState(() => paraEdicao(mensagem.content, dicionarioDoCanal(mensagem.channelId)));
  const campo = useRef<HTMLTextAreaElement>(null);
  const cursorDepois = useRef<number | null>(null);
  const auto = useAutocompletar({
    campo,
    valor: texto,
    aoTrocar: (novo, cursor) => {
      cursorDepois.current = cursor;
      setTexto(novo);
    },
    obterFontes: () => fontesDoCanal(mensagem.channelId),
  });

  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    if (cursorDepois.current !== null) {
      el.setSelectionRange(cursorDepois.current, cursorDepois.current);
      cursorDepois.current = null;
    }
  }, [texto]);

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function salvar() {
    const limpo = texto.trim();
    if (!limpo && mensagem.attachments.length === 0) {
      aoApagar();
      return;
    }
    const conteudo = paraEnvio(limpo, dicionarioDoCanal(mensagem.channelId));
    aoTerminar();
    if (conteudo !== mensagem.content) void editar(mensagem, conteudo).catch(() => undefined);
  }

  return (
    <div className="relative mt-0.5">
      <ListaDeSugestoes auto={auto} campo={campo} />
      <textarea
        ref={campo}
        value={texto}
        rows={1}
        aria-label="Editar mensagem"
        {...ariaDoCampo(auto)}
        onChange={(e) => {
          setTexto(e.target.value);
          auto.atualizar();
        }}
        onSelect={auto.atualizar}
        onKeyDown={(e) => {
          if (auto.aoTeclar(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            aoTerminar();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            salvar();
          }
        }}
        className="k-rolagem block w-full resize-none border border-acento bg-terminal px-3 py-2 text-15 leading-[1.4] text-texto outline-none shadow-[0_0_0_1px_var(--k-acento-tenue)]"
      />
      <p className="mt-1 text-12 text-texto-3">
        Esc para{' '}
        <button type="button" onClick={aoTerminar} className="text-info hover:underline">
          cancelar
        </button>{' '}
        · Enter para{' '}
        <button type="button" onClick={salvar} className="text-info hover:underline">
          salvar
        </button>
      </p>
    </div>
  );
}

function BarraDeAcoes({
  mensagem,
  euSou,
  guildId,
  permissoes,
  acoes,
  reagindo,
  aoMudarMenu,
}: {
  mensagem: Message;
  euSou: string | null;
  guildId: string | null;
  permissoes: Permissoes;
  acoes: AcoesDaLista;
  reagindo: boolean;
  aoMudarMenu: (aberto: boolean) => void;
}) {
  const grupos = itensDaMensagem(mensagem, euSou, permissoes, acoes);
  if (grupos.length === 0) return null;
  const minha = mensagem.authorId === euSou;
  return (
    <div
      className="absolute -top-4 right-4 z-10 flex border border-borda-2 bg-elevado shadow-camada"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {permissoes.reagir ? (
        <Balao open={reagindo} onOpenChange={(aberto) => acoes.reagir(aberto ? mensagem.id : null)}>
          <BalaoAncora asChild>
            <span>
              <BotaoIcone
                rotulo="Reagir"
                atalho="+"
                icone={<SmilePlus className="size-4" strokeWidth={1.5} />}
                onClick={() => acoes.reagir(reagindo ? null : mensagem.id)}
              />
            </span>
          </BalaoAncora>
          <BalaoConteudo
            rotulo="Escolher reação"
            lado="left"
            alinhar="start"
            aoFecharFoco={(e) => {
              // Nao ha gatilho para o foco voltar (a barra pode ja ter sumido):
              // volta para a mensagem, a nao ser que um clique o tenha levado
              // para outro lugar.
              e.preventDefault();
              if (!document.activeElement || document.activeElement === document.body) {
                document.querySelector<HTMLElement>(`article[data-mensagem="${mensagem.id}"]`)?.focus();
              }
            }}
          >
            <SeletorDeEmoji
              guildId={guildId}
              aoEscolher={(e) => {
                acoes.reagir(null);
                void alternarReacao(mensagem, paraReacao(e), false);
              }}
            />
          </BalaoConteudo>
        </Balao>
      ) : null}
      <BotaoIcone rotulo="Responder" atalho="R" icone={<Reply className="size-4" strokeWidth={1.5} />} onClick={() => acoes.responder(mensagem)} />
      {minha ? <BotaoIcone rotulo="Editar" atalho="E" icone={<Pencil className="size-4" strokeWidth={1.5} />} onClick={() => acoes.editar(mensagem.id)} /> : null}
      <Menu onOpenChange={aoMudarMenu}>
        <MenuGatilho asChild>
          <BotaoIcone rotulo="Mais ações" icone={<MoreHorizontal className="size-4" strokeWidth={1.5} />} />
        </MenuGatilho>
        <MenuConteudo alinhar="end">
          {grupos.map((grupo, i) => (
            <div key={i}>
              {i > 0 ? <MenuSeparador /> : null}
              {grupo.map((item) => (
                <MenuItem key={item.chave} icone={item.icone} atalho={item.atalho} perigo={item.perigo} aoEscolher={() => item.acao()}>
                  {item.rotulo}
                </MenuItem>
              ))}
            </div>
          ))}
        </MenuConteudo>
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A mensagem
// ---------------------------------------------------------------------------

interface Props {
  mensagem: Message;
  /** Continua o bloco da anterior: sem avatar nem nome. */
  continua: boolean;
  /** A primeira da lista nao leva o respiro de cima. */
  primeira: boolean;
  guildId: string | null;
  euSou: string | null;
  permissoes: Permissoes;
  /** Tem a vez do Tab na lista (as setas movem a vez). */
  focavel: boolean;
  /** O mouse esta em cima (a lista sabe qual; so uma de cada vez). */
  sobre: boolean;
  editando: boolean;
  reagindo: boolean;
  destacada: boolean;
  acoes: AcoesDaLista;
}

/**
 * Uma mensagem, nas duas densidades.
 *
 * Confortavel: avatar de 40 px, nome e hora em cima, texto embaixo, respiro
 * entre blocos. Compacto: `22:31  nome  texto` numa linha so, sem avatar. A
 * densidade e so CSS (`compacto:`); o componente e o mesmo.
 *
 * As acoes aparecem no hover E no foco: quem navega pelo teclado ve a mesma
 * barra. Ela so existe no DOM enquanto a mensagem esta ativa — duzentas
 * barras escondidas seriam oitocentos botoes a mais na pagina.
 */
export const Mensagem = memo(function Mensagem({
  mensagem,
  continua,
  primeira,
  guildId,
  euSou,
  permissoes,
  focavel,
  sobre,
  editando,
  reagindo,
  destacada,
  acoes,
}: Props) {
  const nome = useStore((s) => selectors.displayNameOf(s, mensagem.authorId, guildId));
  const cor = useStore((s) => selectors.colorOf(s, mensagem.authorId, guildId));
  const avatar = useStore((s) => s.users.get(mensagem.authorId)?.avatarUrl ?? mensagem.author.avatarUrl);
  const meusCargos = useStore((s) => (guildId && euSou ? s.members.get(`${guildId}:${euSou}`)?.roleIds : undefined));
  // Foco pelo teclado mostra a barra; foco pelo clique (selecionar texto) nao.
  const [focoDeTeclado, setFocoDeTeclado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  const pendente = idsOtimistas.has(mensagem.id);
  const mencionaMe = Boolean(
    euSou &&
      mensagem.authorId !== euSou &&
      (mensagem.mentionedUserIds.includes(euSou) ||
        mensagem.mentionsEveryone ||
        meusCargos?.some((id) => mensagem.mentionedRoleIds.includes(id))),
  );
  const hora = horaCurta(mensagem.createdAt);
  const quando = dataCompleta(mensagem.createdAt);
  const mostrarBarra = !editando && (sobre || focoDeTeclado || menuAberto || reagindo);

  const fixada = mensagem.pinned ? (
    <span className="inline-flex items-center gap-1 font-mono text-10 uppercase tracking-rotulo text-info">
      <Pin aria-hidden className="size-3" strokeWidth={1.5} />
      Fixada
    </span>
  ) : null;

  const nomeDoAutor = (
    <span className="font-semibold text-[14.5px] text-texto compacto:text-14" style={cor ? { color: cor } : undefined}>
      {nome}
    </span>
  );

  return (
    <article
      data-mensagem={mensagem.id}
      tabIndex={focavel ? 0 : -1}
      aria-label={`${nome}, ${quando}`}
      onFocus={(e) => setFocoDeTeclado((e.target as HTMLElement).matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocoDeTeclado(false);
      }}
      className={cx(
        'group relative grid grid-cols-[72px_minmax(0,1fr)] pr-12 outline-none compacto:grid-cols-[62px_minmax(0,1fr)]',
        continua ? 'py-px' : cx('pb-0.5 pt-1', !primeira && 'mt-3 compacto:mt-1'),
        'focus-visible:bg-realce focus-visible:shadow-[inset_2px_0_0_var(--k-acento)]',
        mencionaMe ? 'bg-mencao-tenue shadow-[inset_2px_0_0_var(--k-mencao)]' : 'hover:bg-realce',
        destacada && 'bg-acento-tenue animado:transition-colors animado:duration-500',
        pendente && 'opacity-60',
      )}
    >
      <Referencia mensagem={mensagem} guildId={guildId} irPara={acoes.irPara} />

      {/* Calha: avatar no comeco do bloco; hora nas que continuam (no hover) e sempre no compacto. */}
      <div className="flex justify-end pr-2.5 compacto:pr-2">
        {continua ? null : (
          <span className="mr-auto ml-4 mt-0.5 compacto:hidden">
            <Avatar nome={nome} id={mensagem.authorId} url={avatar} tamanho={40} />
          </span>
        )}
        <time
          dateTime={mensagem.createdAt}
          title={quando}
          className={cx(
            'pt-[3px] text-right font-mono text-10 text-mudo compacto:block compacto:pt-[4px] compacto:opacity-100',
            continua ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : 'hidden',
          )}
        >
          {hora}
        </time>
      </div>

      <div className="min-w-0">
        {!continua ? (
          <div className="flex items-baseline gap-2 compacto:mr-2 compacto:inline-flex">
            {nomeDoAutor}
            <time dateTime={mensagem.createdAt} title={quando} className="font-mono text-[10.5px] tracking-[0.06em] text-mudo compacto:hidden">
              {hora}
            </time>
            {fixada}
          </div>
        ) : fixada ? (
          <div>{fixada}</div>
        ) : null}

        {editando ? (
          <CampoDeEdicao mensagem={mensagem} aoTerminar={() => acoes.editar(null)} aoApagar={() => acoes.apagar(mensagem, false)} />
        ) : (
          <Conteudo
            conteudo={mensagem.content}
            guildId={guildId}
            sufixo={
              mensagem.editedAt ? (
                <span className="ml-1 font-mono text-10 text-mudo" title={`Editada: ${dataCompleta(mensagem.editedAt)}`}>
                  (editada)
                </span>
              ) : null
            }
          />
        )}
        <Anexos anexos={mensagem.attachments} />
        <Cartoes cartoes={mensagem.embeds} />
        <Reacoes mensagem={mensagem} guildId={guildId} podeReagir={permissoes.reagir} />
      </div>

      {mostrarBarra ? (
        <BarraDeAcoes
          mensagem={mensagem}
          euSou={euSou}
          guildId={guildId}
          permissoes={permissoes}
          acoes={acoes}
          reagindo={reagindo}
          aoMudarMenu={setMenuAberto}
        />
      ) : null}
    </article>
  );
});

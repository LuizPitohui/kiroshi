import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, FolderPlus, Hash, Lock, Megaphone, Plus, RefreshCw, Search, Slash, Trash2, Volume2, X } from 'lucide-react';
import { LIMITS, Permission, deserialize, has, type Channel, type PermissionOverwrite } from '@kiroshi/shared';
import { useChannelsOfGuild, useMembersOfGuild, useRolesOfGuild, useStore } from '../../store/index.js';
import {
  Abas,
  AreaDeTexto,
  Aviso,
  Avatar,
  Balao,
  BalaoConteudo,
  BalaoGatilho,
  Botao,
  BotaoIcone,
  Campo,
  Confirmacao,
  ConteudoDaAba,
  Dialogo,
  Escolha,
  LinhaDeInterruptor,
  Selecao,
  cx,
} from '../../design/primitivos/index.js';
import { agruparCanais } from '../casca/organizar.js';
import { apagarCanal, criarCanal, editarCanal, gravarSobrescrita, reordenarCanais, sincronizarComCategoria } from './acoes.js';
import { MODO_LENTO, moverCanal, moverCategoria } from './ordemDosCanais.js';
import { bitsQueEuMudo, cargosEmOrdem, type MeuPoder } from './hierarquia.js';
import { bitDe, gruposDoCanal, type TipoDeCanal } from './permissoes.js';
import { usePoder } from './poder.js';
import { bitsDe, comEstado, estadoDoBit, privadoDeFato, sincronizado, valorHerdado, type Estado } from './sobrescritas.js';

const iconeDo = (tipo: Channel['type']) => (tipo === 'GUILD_VOICE' ? Volume2 : tipo === 'GUILD_ANNOUNCEMENT' ? Megaphone : Hash);

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------

export function JanelaDeCriarCanal({ guildId, categoria, aoFechar, aoCriar }: { guildId: string; categoria: boolean; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const canais = useChannelsOfGuild(guildId);
  const categorias = canais.filter((c) => c.type === 'GUILD_CATEGORY').sort((a, b) => a.position - b.position);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'GUILD_TEXT' | 'GUILD_VOICE'>('GUILD_TEXT');
  const [pai, setPai] = useState<string>(categorias[0]?.id ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  async function criar() {
    if (!nome.trim()) return;
    setCriando(true);
    setErro(null);
    try {
      const canal = await criarCanal(guildId, {
        name: nome.trim(),
        type: categoria ? 'GUILD_CATEGORY' : tipo,
        parentId: categoria || !pai ? null : pai,
      });
      aoCriar(canal.id);
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu certo.');
    } finally {
      setCriando(false);
    }
  }

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      rotulo="canais"
      titulo={categoria ? 'Criar categoria' : 'Criar canal'}
      largura="sm"
      acoes={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={criando}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={criando} disabled={!nome.trim()} onClick={() => void criar()}>
            Criar
          </Botao>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        {!categoria ? (
          <Escolha
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            opcoes={[
              { valor: 'GUILD_TEXT', rotulo: 'Texto', descricao: 'Mensagens, arquivos, reações' },
              { valor: 'GUILD_VOICE', rotulo: 'Voz', descricao: 'Chamada, câmera e tela' },
            ]}
          />
        ) : null}
        <Campo rotulo="Nome" value={nome} autoFocus maxLength={LIMITS.channelName.max} erro={erro} onChange={(e) => setNome(e.target.value)} placeholder={categoria ? 'Jogos' : tipo === 'GUILD_VOICE' ? 'Sala 2' : 'clipes'} />
        {!categoria && categorias.length ? (
          <Selecao
            rotulo="Categoria"
            valor={pai || 'nenhuma'}
            aoMudar={(v) => setPai(v === 'nenhuma' ? '' : v)}
            opcoes={[{ valor: 'nenhuma', rotulo: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.name ?? '' }))]}
          />
        ) : null}
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Arvore
// ---------------------------------------------------------------------------

function Arvore({ guildId, escolhido, aoEscolher }: { guildId: string; escolhido: string | null; aoEscolher: (id: string) => void }) {
  const canais = useChannelsOfGuild(guildId);
  const grupos = useMemo(() => agruparCanais(canais), [canais]);
  const categorias = grupos.map((g) => g.categoria).filter((c): c is Channel => Boolean(c));

  function mover(lista: Channel[], i: number, para: number, ehCategoria: boolean) {
    const pedido = ehCategoria ? moverCategoria(lista, i, para) : moverCanal(lista, i, para);
    if (pedido) void reordenarCanais(guildId, pedido);
  }

  const linha = (c: Channel, lista: Channel[], i: number, ehCategoria: boolean) => {
    const Icone = ehCategoria ? null : iconeDo(c.type);
    const ativo = escolhido === c.id;
    const podeSubir = ehCategoria ? i > 0 : moverCanal(lista, i, i - 1) !== null;
    const podeDescer = ehCategoria ? i < lista.length - 1 : moverCanal(lista, i, i + 1) !== null;
    return (
      <li key={c.id} className="group/linha relative">
        <button
          type="button"
          aria-current={ativo ? 'true' : undefined}
          onClick={() => aoEscolher(c.id)}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            mover(lista, i, e.key === 'ArrowUp' ? i - 1 : i + 1, ehCategoria);
          }}
          className={cx(
            'flex h-8 w-full items-center gap-2 pr-16 text-left',
            ehCategoria ? 'px-2 font-mono text-11 uppercase tracking-rotulo-largo' : 'pl-5 text-14',
            ativo ? 'bg-elevado text-texto' : 'text-texto-2 hover:bg-terminal hover:text-texto',
          )}
        >
          {ativo ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" /> : null}
          {Icone ? <Icone aria-hidden className="size-4 shrink-0 text-mudo" strokeWidth={1.5} /> : <span className="text-mudo">//</span>}
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {c.overwrites.length && !sincronizado(c) ? <Lock aria-label="com permissões próprias" className="size-3 shrink-0 text-mudo" strokeWidth={1.5} /> : null}
        </button>
        <span className={cx('absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5', ativo ? 'flex' : 'hidden group-hover/linha:flex group-focus-within/linha:flex')}>
          <BotaoIcone rotulo="Subir" semDica tamanho="sm" disabled={!podeSubir} icone={<ArrowUp className="size-3.5" strokeWidth={1.5} />} onClick={() => mover(lista, i, i - 1, ehCategoria)} />
          <BotaoIcone rotulo="Descer" semDica tamanho="sm" disabled={!podeDescer} icone={<ArrowDown className="size-3.5" strokeWidth={1.5} />} onClick={() => mover(lista, i, i + 1, ehCategoria)} />
        </span>
      </li>
    );
  };

  return (
    <ul aria-label="Canais do servidor" className="border border-borda bg-deck py-1">
      {grupos.map((g) => (
        <li key={g.categoria?.id ?? 'soltos'} className="mt-1 first:mt-0">
          <ul>
            {g.categoria ? linha(g.categoria, categorias, categorias.indexOf(g.categoria), true) : null}
            {g.canais.map((c, i) => linha(c, g.canais, i, false))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Geral
// ---------------------------------------------------------------------------

function AbaGeral({ canal }: { canal: Channel }) {
  const canais = useChannelsOfGuild(canal.guildId);
  const categorias = canais.filter((c) => c.type === 'GUILD_CATEGORY').sort((a, b) => a.position - b.position);
  const [nome, setNome] = useState(canal.name ?? '');
  const [topico, setTopico] = useState(canal.topic ?? '');
  const [limite, setLimite] = useState(String(canal.userLimit ?? 0));
  const [apagando, setApagando] = useState(false);
  const ehCategoria = canal.type === 'GUILD_CATEGORY';
  const ehVoz = canal.type === 'GUILD_VOICE';

  useEffect(() => setNome(canal.name ?? ''), [canal.name]);
  useEffect(() => setTopico(canal.topic ?? ''), [canal.topic]);
  useEffect(() => setLimite(String(canal.userLimit ?? 0)), [canal.userLimit]);

  return (
    <div className="space-y-5 pt-5">
      <Campo
        rotulo="Nome"
        value={nome}
        maxLength={LIMITS.channelName.max}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => {
          const limpo = nome.trim();
          if (!limpo) return setNome(canal.name ?? '');
          if (limpo !== canal.name) void editarCanal(canal.id, { name: limpo });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {!ehCategoria && !ehVoz ? (
        <AreaDeTexto
          rotulo="Tópico"
          value={topico}
          maxLength={LIMITS.channelTopic.max}
          rows={2}
          dica="Aparece no alto da conversa. Salva quando o campo perde o foco."
          onChange={(e) => setTopico(e.target.value)}
          onBlur={() => {
            if (topico.trim() !== (canal.topic ?? '')) void editarCanal(canal.id, { topic: topico.trim() || null });
          }}
        />
      ) : null}
      {!ehCategoria ? (
        <Selecao
          rotulo="Categoria"
          valor={canal.parentId ?? 'nenhuma'}
          aoMudar={(v) => void editarCanal(canal.id, { parentId: v === 'nenhuma' ? null : v })}
          opcoes={[{ valor: 'nenhuma', rotulo: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.name ?? '' }))]}
          dica="Dentro de uma categoria, o canal segue as permissões dela no que não disser por conta própria."
        />
      ) : null}
      {!ehCategoria ? (
        <Selecao
          rotulo="Modo lento"
          valor={String(canal.rateLimitPerUser)}
          aoMudar={(v) => void editarCanal(canal.id, { rateLimitPerUser: Number(v) })}
          opcoes={MODO_LENTO.map((m) => ({ valor: String(m.segundos), rotulo: m.rotulo }))}
          dica="Tempo mínimo entre duas mensagens da mesma pessoa. Quem gerencia mensagens não espera."
        />
      ) : null}
      {ehVoz ? (
        <Campo
          rotulo="Limite de pessoas"
          type="number"
          min={0}
          max={99}
          value={limite}
          dica="0 é sem limite. Quem pode mover membros entra mesmo com a sala cheia."
          onChange={(e) => setLimite(e.target.value)}
          onBlur={() => {
            const n = Math.max(0, Math.min(99, Math.round(Number(limite) || 0)));
            setLimite(String(n));
            if (n !== (canal.userLimit ?? 0)) void editarCanal(canal.id, { userLimit: n });
          }}
        />
      ) : null}
      <div className="border-t border-borda pt-5">
        <Botao variante="perigo" icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={() => setApagando(true)}>
          {ehCategoria ? 'Apagar a categoria' : 'Apagar o canal'}
        </Botao>
        <Confirmacao
          aberto={apagando}
          aoMudar={setApagando}
          titulo={`Apagar ${canal.name}?`}
          descricao={
            ehCategoria
              ? 'Os canais dentro dela ficam soltos, sem categoria, e deixam de seguir as permissões dela.'
              : ehVoz
                ? 'Quem estiver na chamada sai dela. Não dá para desfazer.'
                : 'As mensagens do canal somem junto. Não dá para desfazer.'
          }
          confirmar="Apagar"
          perigo
          aoConfirmar={() => apagarCanal(canal.id)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissoes do canal
// ---------------------------------------------------------------------------

export function TresEstados({ rotulo, estado, aoMudar, podePermitir, desativado }: { rotulo: string; estado: Estado; aoMudar: (e: Estado) => void; podePermitir: boolean; desativado: boolean }) {
  const botao = (valor: Estado, nome: string, icone: React.ReactNode, cor: string, pode = true) => (
    <button
      type="button"
      role="radio"
      aria-checked={estado === valor}
      aria-label={`${rotulo}: ${nome}`}
      title={nome}
      disabled={desativado || !pode}
      onClick={() => aoMudar(valor)}
      className={cx(
        'grid size-8 place-items-center border-y border-l border-borda-2 last:border-r disabled:opacity-30',
        estado === valor ? cor : 'text-texto-3 hover:bg-realce hover:text-texto',
      )}
    >
      {icone}
    </button>
  );
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex">
      {botao('negar', 'Negar', <X className="size-4" strokeWidth={1.75} />, 'bg-perigo/20 text-perigo')}
      {botao('herdar', 'Herdar', <Slash className="size-3.5" strokeWidth={1.75} />, 'bg-borda-2 text-texto')}
      {botao('permitir', 'Permitir', <Check className="size-4" strokeWidth={1.75} />, 'bg-ok/20 text-ok', podePermitir)}
    </div>
  );
}

type Alvo = { id: string; tipo: 'ROLE' | 'MEMBER' };

function AbaPermissoes({ canal, poder }: { canal: Channel; poder: MeuPoder }) {
  const guildId = canal.guildId!;
  const todosCargos = useRolesOfGuild(guildId);
  const membros = useMembersOfGuild(guildId);
  const pai = useStore((s) => (canal.parentId ? s.channels.get(canal.parentId) : undefined));
  const [alvo, setAlvo] = useState<Alvo>({ id: guildId, tipo: 'ROLE' });
  const [extras, setExtras] = useState<Alvo[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [busca, setBusca] = useState('');
  const posso = has(poder.permissoes, Permission.MANAGE_ROLES) && has(poder.permissoes, Permission.MANAGE_CHANNELS);
  const mudaveis = bitsQueEuMudo(poder);

  const cargos = cargosEmOrdem(todosCargos, guildId);
  const nomeDoAlvo = (a: Alvo) => {
    if (a.id === guildId) return '@everyone';
    if (a.tipo === 'ROLE') return todosCargos.find((c) => c.id === a.id)?.name ?? 'cargo apagado';
    const m = membros.find((x) => x.userId === a.id);
    return m?.nickname || m?.user.displayName || 'pessoa';
  };

  const sobrescrita = (id: string): PermissionOverwrite | undefined => canal.overwrites.find((o) => o.targetId === id);
  const alvos: Alvo[] = [
    { id: guildId, tipo: 'ROLE' },
    ...canal.overwrites.filter((o) => o.targetId !== guildId).map((o) => ({ id: o.targetId, tipo: o.targetType })),
    ...extras.filter((e) => !canal.overwrites.some((o) => o.targetId === e.id)),
  ];
  const listados = new Set(alvos.map((a) => a.id));
  const termo = busca.trim().toLowerCase();
  const cargosParaAdicionar = cargos.filter((c) => !listados.has(c.id) && (!termo || c.name.toLowerCase().includes(termo)));
  const pessoasParaAdicionar = membros
    .filter((m) => !listados.has(m.userId))
    .filter((m) => termo && ((m.nickname ?? m.user.displayName).toLowerCase().includes(termo) || m.user.username.includes(termo)))
    .slice(0, 8);

  const bits = bitsDe(sobrescrita(alvo.id));
  const tipo = canal.type as TipoDeCanal;
  // O que a categoria diz para o mesmo alvo, e o que o cargo tem no servidor: e de la que vem o "herdar".
  const naCategoria = (id: string) => {
    const o = pai?.overwrites.find((x) => x.targetId === id);
    return o ? bitsDe(o) : null;
  };
  const baseDoCargo = (id: string) => {
    const cargo = todosCargos.find((c) => c.id === id);
    return cargo ? deserialize(cargo.permissions) : null;
  };
  const doEveryone = bitsDe(sobrescrita(guildId));
  const everyoneNaCategoria = naCategoria(guildId);
  const baseDoEveryone = baseDoCargo(guildId) ?? 0n;
  const privado = privadoDeFato(doEveryone, everyoneNaCategoria, baseDoEveryone);
  const privadoPorHeranca = privado && estadoDoBit(doEveryone, Permission.VIEW_CHANNEL) === 'herdar';

  function mudar(bit: bigint, estado: Estado) {
    void gravarSobrescrita(canal.id, alvo.id, alvo.tipo, comEstado(bits, bit, estado));
  }

  /*
    Ligar deixa o canal fechado por conta propria. Desligar num canal que so
    esta fechado porque a categoria (ou o proprio @everyone) fecha precisa
    liberar de proposito; senao "herdar" ja basta.
  */
  function mudarPrivado(ligar: boolean) {
    const fechadoSemOCanal = privadoDeFato({ allow: 0n, deny: 0n }, everyoneNaCategoria, baseDoEveryone);
    const estado: Estado = ligar ? 'negar' : fechadoSemOCanal ? 'permitir' : 'herdar';
    void gravarSobrescrita(canal.id, guildId, 'ROLE', comEstado(doEveryone, Permission.VIEW_CHANNEL, estado));
  }

  return (
    <div className="space-y-5 pt-5">
      {!posso ? <Aviso tipo="aviso">Mexer nas permissões de um canal pede Gerenciar cargos e Gerenciar canais.</Aviso> : null}
      {canal.parentId && pai ? (
        sincronizado(canal) ? (
          <Aviso tipo="ok" titulo={`Sincronizado com ${pai.name}`}>
            Este canal segue a categoria em tudo. Mudar algo aqui vale só para ele, e o resto continua vindo da categoria.
          </Aviso>
        ) : (
          <Aviso
            tipo="info"
            titulo={`Diz algo por conta própria, além de ${pai.name}`}
            acao={
              posso ? (
                <Botao tamanho="sm" icone={<RefreshCw className="size-3.5" strokeWidth={1.5} />} onClick={() => void sincronizarComCategoria(canal.id)}>
                  Sincronizar
                </Botao>
              ) : undefined
            }
          >
            No que o canal não disser, vale a categoria. Sincronizar apaga o que é só deste canal.
          </Aviso>
        )
      ) : canal.type === 'GUILD_CATEGORY' ? (
        <p className="text-13 text-texto-3">Os canais dentro desta categoria seguem estas permissões no que não disserem por conta própria.</p>
      ) : null}

      <LinhaDeInterruptor
        titulo={canal.type === 'GUILD_CATEGORY' ? 'Categoria privada' : 'Canal privado'}
        descricao={
          privadoPorHeranca
            ? everyoneNaCategoria && estadoDoBit(everyoneNaCategoria, Permission.VIEW_CHANNEL) === 'negar'
              ? `Privado porque a categoria ${pai?.name ?? ''} esconde do @everyone. Desligar abre só este canal.`
              : 'Privado porque o @everyone não tem "ver canais" no servidor.'
            : 'Some para o @everyone. Depois, libere para os cargos ou pessoas que devem ver.'
        }
        ligado={privado}
        desativado={!posso}
        aoMudar={mudarPrivado}
      />

      <div className="flex gap-5">
        <div className="w-48 shrink-0">
          <p className="k-rotulo mb-1.5">Cargos e pessoas</p>
          <ul className="border border-borda bg-deck">
            {alvos.map((a) => {
              const cargo = a.tipo === 'ROLE' ? todosCargos.find((c) => c.id === a.id) : undefined;
              const membro = a.tipo === 'MEMBER' ? membros.find((m) => m.userId === a.id) : undefined;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-current={alvo.id === a.id ? 'true' : undefined}
                    onClick={() => setAlvo(a)}
                    className={cx('flex h-8 w-full items-center gap-2 px-2 text-left text-13', alvo.id === a.id ? 'bg-elevado text-texto' : 'text-texto-2 hover:bg-terminal')}
                  >
                    {membro ? (
                      <Avatar nome={nomeDoAlvo(a)} id={a.id} url={membro.user.avatarUrl} tamanho={20} />
                    ) : (
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cargo?.color ?? 'var(--k-texto-3)' }} />
                    )}
                    <span className="min-w-0 flex-1 truncate">{nomeDoAlvo(a)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {posso ? (
            <Balao
              open={adicionando}
              onOpenChange={(v) => {
                setAdicionando(v);
                if (!v) setBusca('');
              }}
            >
              <BalaoGatilho asChild>
                <Botao tamanho="sm" variante="fantasma" className="mt-2 w-full" icone={<Plus className="size-3.5" strokeWidth={1.5} />}>
                  Adicionar
                </Botao>
              </BalaoGatilho>
              <BalaoConteudo rotulo="Adicionar cargo ou pessoa" alinhar="start" className="w-64 p-1">
                <label className="mb-1 flex items-center gap-2 border-b border-borda px-2 py-1.5">
                  <Search aria-hidden className="size-3.5 text-texto-3" strokeWidth={1.5} />
                  <input
                    autoFocus
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Cargo, ou nome de alguém"
                    aria-label="Procurar cargo ou pessoa"
                    className="min-w-0 flex-1 bg-transparente text-13 text-texto outline-none placeholder:text-mudo"
                  />
                </label>
                <ul className="k-rolagem max-h-64 overflow-y-auto">
                  {[...cargosParaAdicionar.map((c) => ({ id: c.id, tipo: 'ROLE' as const, nome: c.name, cor: c.color })), ...pessoasParaAdicionar.map((m) => ({ id: m.userId, tipo: 'MEMBER' as const, nome: m.nickname || m.user.displayName, cor: null }))].map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const novo = { id: item.id, tipo: item.tipo };
                          setExtras((atual) => [...atual, novo]);
                          setAlvo(novo);
                          setAdicionando(false);
                          setBusca('');
                        }}
                        className="flex h-8 w-full items-center gap-2 px-2 text-left text-13 text-texto-2 hover:bg-realce hover:text-texto"
                      >
                        {item.tipo === 'ROLE' ? (
                          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: item.cor ?? 'var(--k-texto-3)' }} />
                        ) : (
                          <span aria-hidden className="font-mono text-10 text-mudo">@</span>
                        )}
                        <span className="truncate">{item.nome}</span>
                      </button>
                    </li>
                  ))}
                  {cargosParaAdicionar.length === 0 && pessoasParaAdicionar.length === 0 ? (
                    <li className="px-2 py-2 text-12 text-texto-3">{termo ? 'Nada com esse nome.' : 'Digite para achar uma pessoa.'}</li>
                  ) : null}
                </ul>
              </BalaoConteudo>
            </Balao>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-13 text-texto-3">
            Para <strong className="text-texto">{nomeDoAlvo(alvo)}</strong>: <X aria-hidden className="inline size-3.5 text-perigo" /> nega,{' '}
            <Check aria-hidden className="inline size-3.5 text-ok" /> permite, <Slash aria-hidden className="inline size-3 text-texto-3" /> herda
            {canal.parentId ? ' da categoria' : ' do cargo no servidor'}.
          </p>
          {gruposDoCanal(tipo).map((g) => (
            <section key={g.nome}>
              <h3 className="k-rotulo mb-2">{g.nome}</h3>
              <ul className="border border-borda bg-deck">
                {g.permissoes.map((p) => {
                  const bit = bitDe(p.nome);
                  const herdado = estadoDoBit(bits, bit) === 'herdar' ? valorHerdado(bit, naCategoria(alvo.id), alvo.tipo === 'ROLE' ? baseDoCargo(alvo.id) : null) : null;
                  return (
                    <li key={p.nome} className="flex items-center justify-between gap-4 border-b border-borda px-3 py-2 last:border-b-0">
                      <div className="min-w-0">
                        <p className="text-14 text-texto">{p.rotulo}</p>
                        {p.descricao ? <p className="text-12 text-texto-3">{p.descricao}</p> : null}
                        {herdado ? (
                          <p className="text-11 text-mudo">
                            Herdando: {herdado.permitido ? 'permitido' : 'negado'} {herdado.de === 'categoria' ? 'pela categoria' : 'pelo cargo no servidor'}
                          </p>
                        ) : null}
                      </div>
                      <TresEstados rotulo={p.rotulo} estado={estadoDoBit(bits, bit)} aoMudar={(e) => mudar(bit, e)} podePermitir={(mudaveis & bit) === bit} desativado={!posso} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

/**
 * Canais: a arvore (criar, reordenar com Alt + setas ou os botoes, mudar de
 * categoria, apagar) e as permissoes de cada canal em tres estados.
 */
export function PaginaCanais({ guildId }: { guildId: string }) {
  const canais = useChannelsOfGuild(guildId);
  const poder = usePoder(guildId);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aba, setAba] = useState<'geral' | 'permissoes'>('geral');
  const [criando, setCriando] = useState<'canal' | 'categoria' | null>(null);
  const canal = useStore((s) => (escolhido ? s.channels.get(escolhido) : undefined));

  useEffect(() => {
    if (!escolhido || !canal) setEscolhido(agruparCanais(canais)[0]?.canais[0]?.id ?? canais[0]?.id ?? null);
  }, [escolhido, canal, canais]);

  if (!poder) return null;
  const Icone = canal ? (canal.type === 'GUILD_CATEGORY' ? null : iconeDo(canal.type)) : null;

  return (
    <div className="flex gap-6">
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <div className="flex gap-2">
          <Botao variante="primario" className="flex-1" icone={<Plus className="size-4" strokeWidth={1.5} />} onClick={() => setCriando('canal')}>
            Canal
          </Botao>
          <Botao className="flex-1" icone={<FolderPlus className="size-4" strokeWidth={1.5} />} onClick={() => setCriando('categoria')}>
            Categoria
          </Botao>
        </div>
        <p className="text-12 text-texto-3">Alt + setas, ou os botões na linha, mudam a ordem.</p>
        <Arvore guildId={guildId} escolhido={escolhido} aoEscolher={setEscolhido} />
      </div>
      <div className="min-w-0 flex-1">
        {canal ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              {Icone ? <Icone aria-hidden className="size-5 text-mudo" strokeWidth={1.5} /> : <span className="font-mono text-mudo">//</span>}
              <h2 className="min-w-0 truncate font-display text-20 font-bold uppercase tracking-display">{canal.name}</h2>
            </div>
            <Abas
              rotulo="Partes do canal"
              valor={aba}
              aoMudar={(v) => setAba(v as 'geral' | 'permissoes')}
              abas={[
                { valor: 'geral', rotulo: 'Geral' },
                { valor: 'permissoes', rotulo: 'Permissões' },
              ]}
            >
              <ConteudoDaAba value="geral">
                <AbaGeral key={canal.id} canal={canal} />
              </ConteudoDaAba>
              <ConteudoDaAba value="permissoes">
                <AbaPermissoes key={canal.id} canal={canal} poder={poder} />
              </ConteudoDaAba>
            </Abas>
          </>
        ) : (
          <p className="text-13 text-texto-3">Nenhum canal ainda.</p>
        )}
      </div>
      {criando ? <JanelaDeCriarCanal guildId={guildId} categoria={criando === 'categoria'} aoFechar={() => setCriando(null)} aoCriar={setEscolhido} /> : null}
    </div>
  );
}

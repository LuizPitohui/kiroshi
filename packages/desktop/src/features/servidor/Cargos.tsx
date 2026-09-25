import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { LIMITS, Permission, deserialize, has, serialize, type Role } from '@kiroshi/shared';
import { selectors, useMembersOfGuild, useRolesOfGuild, useStore } from '../../store/index.js';
import {
  Abas,
  Avatar,
  Aviso,
  Balao,
  BalaoConteudo,
  BalaoGatilho,
  Botao,
  BotaoIcone,
  Campo,
  Confirmacao,
  ConteudoDaAba,
  Interruptor,
  LinhaDeInterruptor,
  cx,
} from '../../design/primitivos/index.js';
import { apagarCargo, criarCargo, darCargo, editarCargo, reordenarCargos, tirarCargo } from './acoes.js';
import { bitsQueEuMudo, cargosEmOrdem, moverCargo, podeAgirSobre, podeDarCargo, podeEditarCargo, podeMoverPara, podeTirarCargo, type MeuPoder } from './hierarquia.js';
import { GRUPOS_DE_PERMISSOES, bitDe } from './permissoes.js';
import { usePoder } from './poder.js';
import { contextoDoMembro } from '../../app/permissoes.js';

/** Cores prontas, a primeira e o vermelho da casa. */
const CORES = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8', '#e5e7eb'];

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function ListaDeCargos({
  guildId,
  cargos,
  poder,
  escolhido,
  aoEscolher,
}: {
  guildId: string;
  cargos: Role[];
  poder: MeuPoder;
  escolhido: string | null;
  aoEscolher: (id: string) => void;
}) {
  const membros = useMembersOfGuild(guildId);
  const everyone = useStore((s) => s.roles.get(guildId));
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const contagem = (id: string) => membros.filter((m) => m.roleIds.includes(id)).length;

  function mover(de: number, para: number) {
    if (!podeMoverPara(poder, cargos, de, para)) return;
    void reordenarCargos(guildId, moverCargo(cargos, de, para));
  }

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <p className="mb-2 text-12 text-texto-3">De cima para baixo: quem está mais alto age sobre quem está abaixo. Arraste, ou Alt + setas.</p>
      <ul aria-label="Cargos, do mais alto ao mais baixo" className="border border-borda bg-deck">
        {cargos.map((c, i) => {
          const movel = podeMoverPara(poder, cargos, i, i + 1) || podeMoverPara(poder, cargos, i, i - 1);
          return (
            <li
              key={c.id}
              draggable={movel}
              onDragStart={(e) => {
                setArrastando(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', c.id);
              }}
              onDragEnd={() => {
                setArrastando(null);
                setAlvo(null);
              }}
              onDragOver={(e) => {
                if (arrastando === null || !podeMoverPara(poder, cargos, arrastando, i)) return;
                e.preventDefault();
                setAlvo(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (arrastando !== null) mover(arrastando, i);
                setArrastando(null);
                setAlvo(null);
              }}
              className={cx(
                'relative border-b border-borda last:border-b-0',
                alvo === i && arrastando !== null && (arrastando > i ? 'shadow-[inset_0_2px_0_var(--k-acento)]' : 'shadow-[inset_0_-2px_0_var(--k-acento)]'),
                arrastando === i && 'opacity-40',
              )}
            >
              <button
                type="button"
                aria-current={escolhido === c.id ? 'true' : undefined}
                onClick={() => aoEscolher(c.id)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  mover(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
                }}
                className={cx(
                  'flex h-10 w-full items-center gap-2 px-2 text-left text-14',
                  escolhido === c.id ? 'bg-elevado text-texto' : 'text-texto-2 hover:bg-terminal hover:text-texto',
                )}
              >
                {escolhido === c.id ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" /> : null}
                <GripVertical aria-hidden className={cx('size-3.5 shrink-0', movel ? 'text-texto-3' : 'text-transparente')} strokeWidth={1.5} />
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--k-texto-3)' }} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-10 text-mudo" aria-label={`${contagem(c.id)} membros`}>
                  {contagem(c.id)}
                </span>
              </button>
            </li>
          );
        })}
        {everyone ? (
          <li className="relative border-t border-borda">
            <button
              type="button"
              aria-current={escolhido === guildId ? 'true' : undefined}
              onClick={() => aoEscolher(guildId)}
              className={cx(
                'flex h-10 w-full items-center gap-2 px-2 pl-[30px] text-left text-14',
                escolhido === guildId ? 'bg-elevado text-texto' : 'text-texto-2 hover:bg-terminal hover:text-texto',
              )}
            >
              {escolhido === guildId ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" /> : null}
              <span className="min-w-0 flex-1 truncate font-mono text-13">@everyone</span>
              <span className="font-mono text-10 text-mudo">todos</span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor: exibicao
// ---------------------------------------------------------------------------

function AbaExibicao({ guildId, cargo, editavel }: { guildId: string; cargo: Role; editavel: boolean }) {
  const [nome, setNome] = useState(cargo.name);
  const [cor, setCor] = useState(cargo.color ?? '#94a3b8');
  const [apagando, setApagando] = useState(false);
  const prazoDaCor = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setNome(cargo.name), [cargo.name]);
  useEffect(() => setCor(cargo.color ?? '#94a3b8'), [cargo.color]);
  useEffect(() => () => {
    if (prazoDaCor.current) clearTimeout(prazoDaCor.current);
  }, []);

  function salvarNome() {
    const limpo = nome.trim();
    if (!limpo || limpo === cargo.name) return setNome(cargo.name);
    void editarCargo(guildId, cargo.id, { name: limpo });
  }

  /*
    A cor salva sozinha, meio segundo depois de a pessoa parar de mexer. A 1.x
    so salvava quando o foco saia do seletor, e quem fechava a janela antes
    perdia a cor escolhida.
  */
  function mudarCor(nova: string | null, jaSalvar = false) {
    setCor(nova ?? '#94a3b8');
    if (prazoDaCor.current) clearTimeout(prazoDaCor.current);
    const salvar = () => void editarCargo(guildId, cargo.id, { color: nova });
    if (jaSalvar) salvar();
    else prazoDaCor.current = setTimeout(salvar, 500);
  }

  return (
    <div className="space-y-6 pt-5">
      <Campo
        rotulo="Nome do cargo"
        value={nome}
        maxLength={LIMITS.roleName.max}
        disabled={!editavel}
        onChange={(e) => setNome(e.target.value)}
        onBlur={salvarNome}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <div>
        <p className="mb-1.5 font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
          <span className="text-mudo">// </span>Cor
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!editavel}
            onClick={() => mudarCor(null, true)}
            aria-pressed={cargo.color === null}
            title="Sem cor"
            className={cx('grid size-8 place-items-center border text-texto-3 disabled:opacity-40', cargo.color === null ? 'border-acento' : 'border-borda-2')}
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
            <span className="sr-only">Sem cor</span>
          </button>
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!editavel}
              onClick={() => mudarCor(c, true)}
              aria-pressed={cargo.color === c}
              aria-label={`Cor ${c}`}
              className={cx('size-8 border-2 disabled:opacity-40', cargo.color === c ? 'border-texto' : 'border-transparente')}
              style={{ background: c }}
            />
          ))}
          <label className={cx('flex h-8 items-center gap-2 border border-borda-2 px-2 text-12 text-texto-2', !editavel && 'opacity-40')}>
            <input type="color" value={cor} disabled={!editavel} onChange={(e) => mudarCor(e.target.value)} className="size-5 cursor-pointer bg-transparente" />
            <span className="font-mono">{cor}</span>
          </label>
        </div>
        <p className="mt-1.5 text-12 text-texto-3">O nome da pessoa ganha a cor do cargo mais alto que tiver cor.</p>
      </div>
      <LinhaDeInterruptor
        titulo="Exibir separado na lista de membros"
        descricao="Quem tem o cargo aparece num grupo próprio, com o nome dele, no painel da direita."
        ligado={cargo.hoist}
        desativado={!editavel}
        aoMudar={(v) => void editarCargo(guildId, cargo.id, { hoist: v })}
      />
      {editavel ? (
        <div className="border-t border-borda pt-5">
          <Botao variante="perigo" icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={() => setApagando(true)}>
            Apagar o cargo
          </Botao>
          <Confirmacao
            aberto={apagando}
            aoMudar={setApagando}
            titulo={`Apagar ${cargo.name}?`}
            descricao="Quem tem o cargo perde o que ele dava, e as permissões dele nos canais somem junto. Não dá para desfazer."
            confirmar="Apagar"
            perigo
            aoConfirmar={() => apagarCargo(guildId, cargo.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor: permissoes
// ---------------------------------------------------------------------------

function AbaPermissoes({ guildId, cargo, editavel, poder }: { guildId: string; cargo: Role; editavel: boolean; poder: MeuPoder }) {
  const [busca, setBusca] = useState('');
  const bits = deserialize(cargo.permissions);
  const mudaveis = bitsQueEuMudo(poder);
  const termo = busca.trim().toLowerCase();

  function trocar(bit: bigint, ligar: boolean) {
    const novo = ligar ? bits | bit : bits & ~bit;
    void editarCargo(guildId, cargo.id, { permissions: serialize(novo) });
  }

  const grupos = GRUPOS_DE_PERMISSOES.map((g) => ({
    ...g,
    permissoes: g.permissoes.filter((p) => !termo || p.rotulo.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)),
  })).filter((g) => g.permissoes.length > 0);

  return (
    <div className="space-y-5 pt-5">
      {cargo.id === guildId ? (
        <Aviso tipo="info" titulo="O @everyone vale para todo mundo">
          O que ele permite, todos os membros podem. Os outros cargos só somam em cima dele.
        </Aviso>
      ) : null}
      {has(bits, Permission.ADMINISTRATOR) && cargo.id !== guildId ? (
        <Aviso tipo="aviso" titulo="Este cargo é administrador">
          Tem tudo, em todos os canais, e as permissões abaixo não mudam nada enquanto isso estiver ligado.
        </Aviso>
      ) : null}
      <div className="flex items-end gap-3">
        <Campo
          rotulo="Procurar permissão"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          prefixo={<Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />}
          className="flex-1"
        />
        {editavel ? (
          <Botao variante="fantasma" disabled={(bits & mudaveis) === 0n} onClick={() => void editarCargo(guildId, cargo.id, { permissions: serialize(bits & ~mudaveis) })}>
            Limpar
          </Botao>
        ) : null}
      </div>
      {grupos.map((g) => (
        <section key={g.nome}>
          <h3 className="k-rotulo mb-2">{g.nome}</h3>
          <ul className="border border-borda bg-deck">
            {g.permissoes.map((p) => {
              const bit = bitDe(p.nome);
              const ligado = (bits & bit) === bit;
              const posso = editavel && (mudaveis & bit) === bit;
              return (
                <li key={p.nome} className="flex items-center justify-between gap-6 border-b border-borda px-3 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-14 text-texto">{p.rotulo}</p>
                    {p.descricao ? <p className="text-12 text-texto-3">{p.descricao}</p> : null}
                    {editavel && !posso ? <p className="text-12 text-aviso">Você não tem esta permissão, então não pode mudá-la.</p> : null}
                  </div>
                  <Interruptor rotulo={p.rotulo} ligado={ligado} desativado={!posso} aoMudar={(v) => trocar(bit, v)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor: membros
// ---------------------------------------------------------------------------

function AbaMembros({ guildId, cargo, poder }: { guildId: string; cargo: Role; poder: MeuPoder }) {
  const membros = useMembersOfGuild(guildId);
  const nomes = useStore((s) => s.members);
  const [adicionando, setAdicionando] = useState(false);
  const [busca, setBusca] = useState('');
  const nomeDe = (userId: string) => {
    const m = nomes.get(`${guildId}:${userId}`);
    return m?.nickname || m?.user.displayName || '?';
  };
  const posso = (userId: string) => podeAgirSobre(poder, contextoDoMembro(useStore.getState(), guildId, userId));

  const tem = membros.filter((m) => m.roleIds.includes(cargo.id)).sort((a, b) => nomeDe(a.userId).localeCompare(nomeDe(b.userId), 'pt-BR'));
  const termo = busca.trim().toLowerCase();
  const podeDar = podeDarCargo(poder, cargo);
  const candidatos = podeDar
    ? membros
        .filter((m) => !m.roleIds.includes(cargo.id) && posso(m.userId))
        .filter((m) => !termo || nomeDe(m.userId).toLowerCase().includes(termo) || m.user.username.includes(termo))
        .sort((a, b) => nomeDe(a.userId).localeCompare(nomeDe(b.userId), 'pt-BR'))
    : [];

  return (
    <div className="space-y-4 pt-5">
      <div className="flex items-center justify-between">
        <p className="text-13 text-texto-3">
          {tem.length} {tem.length === 1 ? 'pessoa tem' : 'pessoas têm'} este cargo.
        </p>
        {podeDar ? (
          <Balao
            open={adicionando}
            onOpenChange={(v) => {
              setAdicionando(v);
              if (!v) setBusca('');
            }}
          >
            <BalaoGatilho asChild>
              <Botao icone={<UserPlus className="size-4" strokeWidth={1.5} />}>Adicionar pessoas</Botao>
            </BalaoGatilho>
            <BalaoConteudo rotulo="Adicionar pessoas ao cargo" className="w-72 p-1">
              <label className="mb-1 flex items-center gap-2 border-b border-borda px-2 py-1.5">
                <Search aria-hidden className="size-3.5 text-texto-3" strokeWidth={1.5} />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Procurar pessoa"
                  aria-label="Procurar pessoa"
                  className="min-w-0 flex-1 bg-transparente text-13 text-texto outline-none placeholder:text-mudo"
                />
              </label>
              <ul className="k-rolagem max-h-72 overflow-y-auto">
                {candidatos.map((m) => (
                  <li key={m.userId}>
                    <button
                      type="button"
                      onClick={() => void darCargo(guildId, m.userId, cargo.id)}
                      className="flex h-9 w-full items-center gap-2 px-2 text-left text-13 text-texto-2 hover:bg-realce hover:text-texto"
                    >
                      <Avatar nome={nomeDe(m.userId)} id={m.userId} url={m.user.avatarUrl} tamanho={24} />
                      <span className="min-w-0 flex-1 truncate">{nomeDe(m.userId)}</span>
                      <span className="truncate font-mono text-10 text-mudo">@{m.user.username}</span>
                    </button>
                  </li>
                ))}
                {candidatos.length === 0 ? <li className="px-2 py-2 text-12 text-texto-3">Ninguém para adicionar.</li> : null}
              </ul>
            </BalaoConteudo>
          </Balao>
        ) : null}
      </div>
      {tem.length ? (
        <ul className="border border-borda bg-deck">
          {tem.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 border-b border-borda px-3 py-2 last:border-b-0">
              <Avatar nome={nomeDe(m.userId)} id={m.userId} url={m.user.avatarUrl} tamanho={24} />
              <span className="min-w-0 flex-1 truncate text-14">{nomeDe(m.userId)}</span>
              <span className="font-mono text-11 text-texto-3">@{m.user.username}</span>
              {podeTirarCargo(poder, cargo) && posso(m.userId) ? (
                <BotaoIcone
                  rotulo={`Tirar ${cargo.name} de ${nomeDe(m.userId)}`}
                  tamanho="sm"
                  icone={<X className="size-4" strokeWidth={1.5} />}
                  onClick={() => void tirarCargo(guildId, m.userId, cargo.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

type AbaDoCargo = 'exibicao' | 'permissoes' | 'membros';

/**
 * Cargos: a lista ordenavel e o editor (Exibicao / Permissoes / Membros), como
 * no Discord. Tudo o que nao pode e mostrado desligado, com o motivo — a 1.x
 * deixava clicar e engolia a recusa do servidor.
 */
export function PaginaCargos({ guildId }: { guildId: string }) {
  const todos = useRolesOfGuild(guildId);
  const poder = usePoder(guildId);
  const cargos = useMemo(() => cargosEmOrdem(todos, guildId), [todos, guildId]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaDoCargo>('exibicao');
  const [criando, setCriando] = useState(false);
  const cargo = useStore((s) => (escolhido ? s.roles.get(escolhido) : undefined));
  const quantos = useStore((s) => (escolhido ? selectors.membersOfGuild(s, guildId).filter((m) => m.roleIds.includes(escolhido)).length : 0));

  // Escolhido que sumiu (apagado aqui ou em outro lugar): volta ao primeiro.
  useEffect(() => {
    if (escolhido && !cargo) setEscolhido(cargos[0]?.id ?? guildId);
    if (!escolhido) setEscolhido(cargos[0]?.id ?? guildId);
  }, [escolhido, cargo, cargos, guildId]);

  if (!poder) return null;
  const ehEveryone = cargo?.id === guildId;
  const editavel = cargo ? podeEditarCargo(poder, cargo) : false;
  const abaAtual: AbaDoCargo = ehEveryone ? 'permissoes' : aba;

  async function criar() {
    setCriando(true);
    const novo = await criarCargo(guildId);
    setCriando(false);
    if (novo) {
      setEscolhido(novo.id);
      setAba('exibicao');
    }
  }

  return (
    <div className="flex gap-6">
      <div className="flex flex-col gap-3">
        <Botao variante="primario" carregando={criando} icone={<Plus className="size-4" strokeWidth={1.5} />} onClick={() => void criar()} disabled={!has(poder.permissoes, Permission.MANAGE_ROLES) || cargos.length >= LIMITS.rolesPerGuild - 1}>
          Criar cargo
        </Botao>
        <ListaDeCargos guildId={guildId} cargos={cargos} poder={poder} escolhido={escolhido} aoEscolher={setEscolhido} />
      </div>
      <div className="min-w-0 flex-1">
        {cargo ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ background: cargo.color ?? 'var(--k-texto-3)' }} />
              <h2 className="min-w-0 truncate font-display text-20 font-bold uppercase tracking-display">{ehEveryone ? '@everyone' : cargo.name}</h2>
              {!ehEveryone ? <span className="font-mono text-11 text-texto-3">{quantos} {quantos === 1 ? 'membro' : 'membros'}</span> : null}
            </div>
            {!editavel ? (
              <div className="mb-3">
                <Aviso tipo="aviso">Este cargo está no seu nível ou acima dele: dá para ver, não para mudar.</Aviso>
              </div>
            ) : null}
            <Abas
              rotulo="Partes do cargo"
              valor={abaAtual}
              aoMudar={(v) => setAba(v as AbaDoCargo)}
              abas={ehEveryone ? [{ valor: 'permissoes', rotulo: 'Permissões' }] : [
                { valor: 'exibicao', rotulo: 'Exibição' },
                { valor: 'permissoes', rotulo: 'Permissões' },
                { valor: 'membros', rotulo: `Membros (${quantos})` },
              ]}
            >
              <ConteudoDaAba value="exibicao">
                {!ehEveryone ? <AbaExibicao key={cargo.id} guildId={guildId} cargo={cargo} editavel={editavel} /> : null}
              </ConteudoDaAba>
              <ConteudoDaAba value="permissoes">
                <AbaPermissoes guildId={guildId} cargo={cargo} editavel={editavel} poder={poder} />
              </ConteudoDaAba>
              <ConteudoDaAba value="membros">
                {!ehEveryone ? <AbaMembros guildId={guildId} cargo={cargo} poder={poder} /> : null}
              </ConteudoDaAba>
            </Abas>
          </>
        ) : null}
      </div>
    </div>
  );
}

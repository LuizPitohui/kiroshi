import { useMemo, useState, type FormEvent } from 'react';
import { Check, Link2, MessageSquare, MoreVertical, Phone, Plus, UserPlus, Users, Video, X } from 'lucide-react';
import type { PresenceStatus, Relationship, VoiceState } from '@kiroshi/shared';
import { useRelationships, useStore } from '../../store/index.js';
import { navegar, type AbaDoInicio } from '../../app/rotas.js';
import { useTelaLarga } from '../../app/largura.js';
import {
  Abas,
  Avatar,
  Botao,
  BotaoIcone,
  Campo,
  Confirmacao,
  ConteudoDaAba,
  EstadoVazio,
  Menu,
  MenuConteudo,
  MenuGatilho,
  MenuItem,
  MenuSeparador,
  SeloVivo,
  cx,
} from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { nomeDaConversa } from '../chamada/dm.js';
import { amigosEmVoz, filtrarPorBusca, relacoesDaAba } from './amigos.js';
import { abrirConversa, aceitarPedido, bloquear, desfazerRelacao, ligarPara, pedirAmizade } from './acoes.js';
import { JanelaDeServidorNovo } from '../servidor/JanelaDeServidorNovo.js';

const STATUS: Record<PresenceStatus, string> = {
  ONLINE: 'Online',
  IDLE: 'Ausente',
  DND: 'Não perturbe',
  OFFLINE: 'Offline',
};

const ic = 'size-[18px]';

// ---------------------------------------------------------------------------
// Adicionar amigo
// ---------------------------------------------------------------------------

/**
 * Quem a pessoa pode estar procurando: gente dos servidores em comum, pelo
 * nome de exibicao ou de usuario, que ainda nao e amiga nem esta bloqueada.
 * Ninguem precisa decorar o @usuario de ninguem.
 */
function useSugestoesDeAmizade(termo: string) {
  const eu = useStore((s) => s.user?.id);
  const usuarios = useStore((s) => s.users);
  const relacoes = useStore((s) => s.relationships);
  return useMemo(() => {
    const t = termo.trim().replace(/^@/, '').toLowerCase();
    if (!t) return [];
    const comRelacao = new Set([...relacoes.values()].map((r) => r.user.id));
    return [...usuarios.values()]
      .filter((u) => u.id !== eu && !u.bot && !comRelacao.has(u.id))
      .filter((u) => u.username.toLowerCase().includes(t) || (u.displayName ?? '').toLowerCase().includes(t))
      .sort((a, b) => Number(!a.username.startsWith(t)) - Number(!b.username.startsWith(t)) || a.username.localeCompare(b.username))
      .slice(0, 5);
  }, [termo, eu, usuarios, relacoes]);
}

function AdicionarAmigo({ aoFechar }: { aoFechar: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const sugestoes = useSugestoesDeAmizade(usuario);
  const exato = sugestoes.some((u) => u.username === usuario.trim().replace(/^@/, '').toLowerCase());

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await pedirAmizade(usuario);
    setEnviando(false);
    setResultado(r);
    if (r.ok) setUsuario('');
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="border-b border-borda bg-deck px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-20 font-bold uppercase tracking-display">Adicionar amigo</h2>
          <p className="mt-1 text-13 text-texto-3">Pelo nome de usuário — o que aparece depois do @ no perfil.</p>
        </div>
        <BotaoIcone rotulo="Fechar" tamanho="sm" onClick={aoFechar} icone={<X className="size-4" strokeWidth={1.5} />} />
      </div>
      <div className="mt-4 flex items-end gap-2">
        <Campo
          rotulo="Nome de usuário"
          prefixo="@"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={usuario}
          onChange={(e) => {
            setUsuario(e.target.value);
            setResultado(null);
          }}
          className="max-w-[420px] flex-1"
          erro={resultado && !resultado.ok ? resultado.mensagem : null}
        />
        <Botao variante="primario" type="submit" carregando={enviando} disabled={!usuario.trim()}>
          Enviar pedido
        </Botao>
      </div>
      {sugestoes.length > 0 && !exato && !resultado?.ok ? (
        <ul aria-label="Pessoas dos seus servidores" className="mt-2 max-w-[420px] border border-borda bg-elevado">
          {sugestoes.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => {
                  setUsuario(u.username);
                  setResultado(null);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-borda"
              >
                <Avatar nome={u.displayName || u.username} id={u.id} url={u.avatarUrl} tamanho={24} />
                <span className="min-w-0 flex-1 truncate text-13 text-texto">{u.displayName || u.username}</span>
                <span className="font-mono text-11 text-texto-3">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {resultado?.ok ? (
        <p role="status" className="mt-2 text-13 text-ok">
          {resultado.mensagem}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Uma pessoa na lista
// ---------------------------------------------------------------------------

type Confirmar = { tipo: 'remover' | 'bloquear'; relacao: Relationship } | null;

function LinhaDeRelacao({ relacao, aoConfirmar }: { relacao: Relationship; aoConfirmar: (c: Confirmar) => void }) {
  const u = relacao.user;
  const presenca = useStore((s) => s.presences.get(u.id));
  const status = presenca?.status ?? 'OFFLINE';
  const amigo = relacao.type === 'FRIEND';
  const nome = u.displayName || u.username;

  const legenda =
    relacao.type === 'PENDING_INCOMING'
      ? 'Pedido de amizade recebido'
      : relacao.type === 'PENDING_OUTGOING'
        ? 'Pedido enviado'
        : relacao.type === 'BLOCKED'
          ? 'Bloqueado'
          : presenca?.customStatus || STATUS[status];

  return (
    <li className="group relative border-t border-borda first:border-t-0">
      <div className="flex h-[60px] items-center gap-3 px-3 hover:bg-terminal focus-within:bg-terminal">
        <Avatar nome={nome} id={u.id} url={u.avatarUrl} tamanho={32} status={amigo ? status : undefined} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-15 font-semibold">
            {nome} <span className="font-mono text-11 font-normal text-texto-3">@{u.username}</span>
          </p>
          <p className="truncate text-13 text-texto-3">{legenda}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {amigo ? (
            <>
              <BotaoIcone rotulo={`Conversar com ${nome}`} onClick={() => void abrirConversa(u.id)} icone={<MessageSquare className={ic} strokeWidth={1.5} />} />
              <BotaoIcone rotulo={`Ligar para ${nome}`} onClick={() => void ligarPara(u.id)} icone={<Phone className={ic} strokeWidth={1.5} />} />
              <Menu>
                <MenuGatilho asChild>
                  <BotaoIcone rotulo={`Mais opções para ${nome}`} icone={<MoreVertical className={ic} strokeWidth={1.5} />} />
                </MenuGatilho>
                <MenuConteudo alinhar="end">
                  <MenuItem icone={<Video className="size-4" strokeWidth={1.5} />} aoEscolher={() => void ligarPara(u.id, { video: true })}>
                    Ligar com vídeo
                  </MenuItem>
                  <MenuSeparador />
                  <MenuItem perigo aoEscolher={() => aoConfirmar({ tipo: 'remover', relacao })}>
                    Desfazer amizade
                  </MenuItem>
                  <MenuItem perigo aoEscolher={() => aoConfirmar({ tipo: 'bloquear', relacao })}>
                    Bloquear
                  </MenuItem>
                </MenuConteudo>
              </Menu>
            </>
          ) : relacao.type === 'PENDING_INCOMING' ? (
            <>
              <BotaoIcone rotulo={`Aceitar ${nome}`} onClick={() => void aceitarPedido(relacao.id)} icone={<Check className={cx(ic, 'text-ok')} strokeWidth={1.75} />} />
              <BotaoIcone rotulo={`Recusar ${nome}`} alerta onClick={() => void desfazerRelacao(relacao.id)} icone={<X className={ic} strokeWidth={1.5} />} />
            </>
          ) : relacao.type === 'PENDING_OUTGOING' ? (
            <BotaoIcone rotulo={`Cancelar o pedido para ${nome}`} onClick={() => void desfazerRelacao(relacao.id)} icone={<X className={ic} strokeWidth={1.5} />} />
          ) : (
            <Botao tamanho="sm" onClick={() => void desfazerRelacao(relacao.id)}>
              Desbloquear
            </Botao>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// As abas
// ---------------------------------------------------------------------------

const VAZIO: Record<AbaDoInicio, { titulo: string; texto: string }> = {
  online: { titulo: 'Ninguém online', texto: 'Quando um amigo entrar no Kiroshi, ele aparece aqui.' },
  todos: { titulo: 'Sua rede começa aqui', texto: 'Adicione alguém pelo nome de usuário para conversar e ligar.' },
  pendentes: { titulo: 'Nenhum pedido', texto: 'Pedidos de amizade recebidos e enviados aparecem aqui.' },
  bloqueados: { titulo: 'Ninguém bloqueado', texto: 'Quem você bloquear não consegue te mandar mensagem nem te ligar.' },
};

const TITULO_DA_LISTA: Record<AbaDoInicio, string> = {
  online: 'Online',
  todos: 'Todos os amigos',
  pendentes: 'Pendentes',
  bloqueados: 'Bloqueados',
};

function ListaDaAba({ aba, relacoes, aoConfirmar }: { aba: AbaDoInicio; relacoes: Relationship[]; aoConfirmar: (c: Confirmar) => void }) {
  const [busca, setBusca] = useState('');
  const presencas = useStore((s) => s.presences);
  const daAba = useMemo(
    () => relacoesDaAba(relacoes, aba, (id) => presencas.get(id)?.status ?? 'OFFLINE'),
    [relacoes, aba, presencas],
  );
  const visiveis = filtrarPorBusca(daAba, busca);

  if (daAba.length === 0) {
    return <EstadoVazio titulo={VAZIO[aba].titulo}>{VAZIO[aba].texto}</EstadoVazio>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-4">
      {daAba.length > 5 ? (
        <Campo rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou usuário" className="mb-3 max-w-[420px]" />
      ) : null}
      <p className="k-rotulo mb-2">
        {TITULO_DA_LISTA[aba]} — {visiveis.length}
      </p>
      <ul aria-label={TITULO_DA_LISTA[aba]} className="k-rolagem min-h-0 flex-1 overflow-y-auto pb-4">
        {visiveis.map((r) => (
          <LinhaDeRelacao key={r.id} relacao={r} aoConfirmar={aoConfirmar} />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agora: quem esta em chamada
// ---------------------------------------------------------------------------

function LinhaDoAgora({ estado }: { estado: VoiceState }) {
  const euSou = useStore((s) => s.user?.id ?? null);
  const usuario = useStore((s) => s.users.get(estado.userId));
  const meuCanal = useVoz((v) => (v.connected ? v.channelId : null));
  const onde = useStore((s) => {
    if (!estado.channelId) return '';
    const canal = s.channels.get(estado.channelId);
    if (estado.guildId) return `${s.guilds.get(estado.guildId)?.name ?? 'Servidor'} / ${canal?.name ?? 'voz'}`;
    if (!canal) return 'Chamada privada';
    return `Chamada · ${nomeDaConversa(canal, euSou, (id) => s.users.get(id)?.displayName ?? '?')}`;
  });
  const nome = usuario?.displayName ?? '?';
  const junto = meuCanal !== null && meuCanal === estado.channelId;

  function ir() {
    if (!estado.channelId) return;
    if (estado.guildId) navegar({ tela: 'servidor', guildId: estado.guildId, canalId: estado.channelId });
    else navegar({ tela: 'dm', canalId: estado.channelId });
  }

  return (
    <li>
      <button type="button" onClick={ir} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-terminal">
        <Avatar nome={nome} id={estado.userId} url={usuario?.avatarUrl} tamanho={32} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-14 font-medium">{nome}</span>
            {estado.selfStream ? <SeloVivo /> : null}
          </span>
          <span className="block truncate text-12 text-texto-3">{junto ? 'Com você' : onde}</span>
        </span>
      </button>
    </li>
  );
}

function Agora({ amigos }: { amigos: string[] }) {
  const estados = useStore((s) => s.voiceStates);
  const emVoz = useMemo(() => amigosEmVoz(amigos, estados.values()), [amigos, estados]);

  return (
    <aside aria-label="Agora" className="k-rolagem flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-borda bg-deck">
      <div className="flex h-12 shrink-0 items-center border-b border-borda px-3.5">
        <p className="k-rotulo">Agora</p>
      </div>
      {emVoz.length === 0 ? (
        <p className="px-3.5 py-4 text-13 text-texto-3">Nenhum amigo em chamada agora. Quando alguém entrar na voz, aparece aqui — um clique e você está lá.</p>
      ) : (
        <ul className="py-2">
          {emVoz.map((v) => (
            <LinhaDoAgora key={v.userId} estado={v} />
          ))}
        </ul>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Conta nova
// ---------------------------------------------------------------------------

/**
 * "Sua rede comeca aqui" (10-front-end-novo.md 4.1): com o cadastro aberto, a
 * conta nasce sem amigos nem servidores, e a tela vazia precisa dizer o que
 * fazer. Os tres caminhos, cada um a um clique; some quando existir o primeiro
 * amigo ou servidor.
 */
function PrimeirosPassos({ aoAdicionar }: { aoAdicionar: () => void }) {
  const [janela, setJanela] = useState<'criar' | 'entrar' | null>(null);
  const caminho = (icone: React.ReactNode, titulo: string, texto: string, acao: string, aoClicar: () => void) => (
    <li className="flex flex-col gap-3 border border-borda bg-deck p-4">
      <span className="grid size-9 place-items-center border border-borda-2 text-acento">{icone}</span>
      <div>
        <p className="font-display text-16 font-bold uppercase tracking-[0.06em]">{titulo}</p>
        <p className="mt-1 text-13 text-texto-3">{texto}</p>
      </div>
      <Botao tamanho="sm" className="mt-auto self-start" onClick={aoClicar}>
        {acao}
      </Botao>
    </li>
  );

  return (
    <section aria-labelledby="primeiros-passos" className="border-b border-borda px-6 py-6">
      <p className="k-rotulo">Conta nova</p>
      <h2 id="primeiros-passos" className="mt-1 font-display text-28 font-bold uppercase tracking-display">
        Sua rede começa aqui
      </h2>
      <p className="mt-1 max-w-xl text-14 text-texto-3">Ninguém por perto ainda. Três jeitos de começar:</p>
      <ul className="mt-4 grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
        {caminho(<UserPlus className="size-4" strokeWidth={1.5} />, 'Adicionar amigo', 'Pelo nome de usuário. Amigos conversam e ligam direto.', 'Adicionar', aoAdicionar)}
        {caminho(<Link2 className="size-4" strokeWidth={1.5} />, 'Entrar num servidor', 'Recebeu um link de convite? Cole aqui.', 'Usar convite', () => setJanela('entrar'))}
        {caminho(<Plus className="size-4" strokeWidth={1.5} />, 'Criar um servidor', 'Para o seu grupo, com canal de texto e de voz.', 'Criar', () => setJanela('criar'))}
      </ul>
      <JanelaDeServidorNovo aberto={janela !== null} aoMudar={(v) => !v && setJanela(null)} modoInicial={janela ?? 'escolher'} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

/**
 * O Inicio (10-front-end-novo.md 4.2): amigos em quatro abas — online, todos,
 * pendentes, bloqueados —, adicionar por nome de usuario, conversar e ligar
 * de cada linha, e o quadro "agora" com quem esta em chamada.
 */
export function Inicio({ aba }: { aba: AbaDoInicio }) {
  const relacoes = useRelationships();
  const [adicionando, setAdicionando] = useState(false);
  const [confirmar, setConfirmar] = useState<Confirmar>(null);
  const telaLarga = useTelaLarga();
  const recebidos = relacoes.filter((r) => r.type === 'PENDING_INCOMING').length;
  const amigos = useMemo(() => relacoes.filter((r) => r.type === 'FRIEND').map((r) => r.user.id), [relacoes]);
  // Sem ninguem e sem servidor: a conta acabou de nascer.
  const semServidor = useStore((s) => s.guilds.size === 0);
  const contaNova = semServidor && relacoes.length === 0;

  const abas = [
    { valor: 'online', rotulo: 'Online' },
    { valor: 'todos', rotulo: 'Todos' },
    { valor: 'pendentes', rotulo: 'Pendentes', contagem: recebidos },
    { valor: 'bloqueados', rotulo: 'Bloqueados' },
  ];

  const alvo = confirmar?.relacao.user;
  const nomeDoAlvo = alvo ? alvo.displayName || alvo.username : '';

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-borda px-4">
          <h1 className="flex shrink-0 items-center gap-2 font-display text-20 font-bold tracking-[0.06em]">
            <Users aria-hidden className="size-5 text-acento" strokeWidth={1.5} />
            Amigos
          </h1>
          <Botao variante={adicionando ? 'secundario' : 'primario'} tamanho="sm" icone={<UserPlus className="size-4" strokeWidth={1.5} />} className="ml-auto" onClick={() => setAdicionando((v) => !v)}>
            Adicionar amigo
          </Botao>
        </header>
        {adicionando ? <AdicionarAmigo aoFechar={() => setAdicionando(false)} /> : null}
        {contaNova && !adicionando ? <PrimeirosPassos aoAdicionar={() => setAdicionando(true)} /> : null}
        <div className="flex min-h-0 flex-1 flex-col pt-2 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
          <Abas rotulo="Amigos" abas={abas} valor={aba} aoMudar={(valor) => navegar({ tela: 'inicio', aba: valor as AbaDoInicio })}>
            {abas.map((a) => (
              <ConteudoDaAba key={a.valor} value={a.valor} className="flex min-h-0 flex-1 flex-col outline-none">
                <ListaDaAba aba={a.valor as AbaDoInicio} relacoes={relacoes} aoConfirmar={setConfirmar} />
              </ConteudoDaAba>
            ))}
          </Abas>
        </div>
      </div>
      {telaLarga ? <Agora amigos={amigos} /> : null}

      <Confirmacao
        aberto={confirmar !== null}
        aoMudar={(aberto) => !aberto && setConfirmar(null)}
        titulo={confirmar?.tipo === 'bloquear' ? `Bloquear ${nomeDoAlvo}?` : `Desfazer a amizade com ${nomeDoAlvo}?`}
        descricao={
          confirmar?.tipo === 'bloquear'
            ? 'A amizade acaba, a conversa direta fecha para mensagens e chamadas, e a pessoa não é avisada.'
            : 'Vocês deixam de ser amigos. A conversa direta continua existindo.'
        }
        confirmar={confirmar?.tipo === 'bloquear' ? 'Bloquear' : 'Desfazer amizade'}
        perigo
        aoConfirmar={async () => {
          if (!confirmar) return;
          if (confirmar.tipo === 'bloquear') await bloquear(confirmar.relacao.user.id);
          else await desfazerRelacao(confirmar.relacao.id);
        }}
      />
    </div>
  );
}

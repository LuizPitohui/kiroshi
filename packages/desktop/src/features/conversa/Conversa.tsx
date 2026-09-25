import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Channel, Message } from '@kiroshi/shared';
import { Permission, has } from '@kiroshi/shared';
import { Hash, Megaphone, Search, Upload, Users, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { selectors, useStore, useTypingIn } from '../../store/index.js';
import { usePermissoesNoCanal } from '../../app/permissoes.js';
import { useInterface } from '../../app/interface.js';
import { useTelaLarga } from '../../app/largura.js';
import { Avatar, BotaoIcone } from '../../design/primitivos/index.js';
import { ListaDeMensagens, type ControleDaLista } from './ListaDeMensagens.js';
import { Compositor } from './Compositor.js';
import { Fixadas } from './Fixadas.js';
import { Busca } from './Busca.js';
import { useAnexosPendentes, idsOtimistas } from './envio.js';
import { quemDigita } from './linhas.js';
import type { Permissoes } from './Mensagem.js';

/** O outro lado de uma DM (o primeiro que nao sou eu). */
function useOutroLado(canal: Channel | undefined, euSou: string | null) {
  const id = canal && !canal.guildId ? (canal.recipientIds.find((r) => r !== euSou) ?? canal.recipientIds[0] ?? null) : null;
  const usuario = useStore((s) => (id ? s.users.get(id) : undefined));
  const status = useStore((s) => (id ? (s.presences.get(id)?.status ?? 'OFFLINE') : 'OFFLINE'));
  return { id, usuario, status };
}

function Cabecalho({ canal, euSou, aoBuscar, podeFixar, extra }: { canal: Channel; euSou: string | null; aoBuscar: () => void; podeFixar: boolean; extra?: ReactNode }) {
  const telaLarga = useTelaLarga();
  const membros = useInterface((s) => (telaLarga ? s.membros : s.gavetaDeMembros));
  const alternarMembros = useInterface((s) => s.alternarMembros);
  const outro = useOutroLado(canal, euSou);
  const Icone = canal.type === 'GUILD_ANNOUNCEMENT' ? Megaphone : canal.type === 'GUILD_VOICE' ? Volume2 : Hash;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-borda px-4">
      {canal.guildId ? (
        <h1 className="flex shrink-0 items-center gap-2 font-display text-20 font-bold tracking-[0.06em]">
          <Icone aria-hidden className="size-5 text-acento" strokeWidth={1.5} />
          {canal.name}
        </h1>
      ) : (
        <h1 className="flex shrink-0 items-center gap-2.5 text-15 font-semibold">
          <Avatar nome={outro.usuario?.displayName ?? '?'} id={outro.id ?? canal.id} url={outro.usuario?.avatarUrl} tamanho={24} status={outro.status} />
          {outro.usuario?.displayName ?? 'Conversa'}
          {outro.usuario ? <span className="font-mono text-11 font-normal text-texto-3">@{outro.usuario.username}</span> : null}
        </h1>
      )}
      {canal.topic ? <p className="min-w-0 truncate border-l border-borda pl-3 text-13 text-texto-3">{canal.topic}</p> : null}
      <div className="ml-auto flex items-center gap-1">
        {extra}
        <Fixadas canalId={canal.id} guildId={canal.guildId} podeFixar={podeFixar} />
        {canal.guildId ? (
          <BotaoIcone rotulo={membros ? 'Esconder membros' : 'Mostrar membros'} ligado={membros} onClick={() => alternarMembros(telaLarga)} icone={<Users className="size-[18px]" strokeWidth={1.5} />} />
        ) : null}
        <BotaoIcone rotulo="Buscar" atalho="Ctrl+F" onClick={aoBuscar} icone={<Search className="size-[18px]" strokeWidth={1.5} />} />
      </div>
    </header>
  );
}

function Inicio({ canal, euSou }: { canal: Channel; euSou: string | null }) {
  const outro = useOutroLado(canal, euSou);
  if (canal.guildId) {
    const voz = canal.type === 'GUILD_VOICE';
    const Icone = voz ? Volume2 : canal.type === 'GUILD_ANNOUNCEMENT' ? Megaphone : Hash;
    const nome = voz ? canal.name : `#${canal.name}`;
    return (
      <div className="px-4 pb-4 pt-10">
        <div className="mb-4 grid size-16 place-items-center border border-borda-2 bg-terminal">
          <Icone aria-hidden className="size-8 text-acento" strokeWidth={1.5} />
        </div>
        <h2 className="font-display text-28 font-bold tracking-[0.02em]">Bem-vindo a {nome}</h2>
        <p className="mt-1 text-14 text-texto-3">
          {voz ? `Este é o começo da conversa do canal de voz ${canal.name}.` : `Este é o começo do canal ${nome}.`}
        </p>
      </div>
    );
  }
  const nome = outro.usuario?.displayName ?? 'esta pessoa';
  return (
    <div className="px-4 pb-4 pt-10">
      <Avatar nome={nome} id={outro.id ?? canal.id} url={outro.usuario?.avatarUrl} tamanho={72} />
      <h2 className="mt-3 font-display text-28 font-bold tracking-[0.02em]">{nome}</h2>
      {outro.usuario ? <p className="font-mono text-12 text-texto-3">@{outro.usuario.username}</p> : null}
      <p className="mt-2 text-14 text-texto-3">Este é o começo da sua conversa direta com {nome}.</p>
    </div>
  );
}

function Digitando({ canalId, euSou, guildId }: { canalId: string; euSou: string | null; guildId: string | null }) {
  const entradas = useTypingIn(canalId);
  const s = useStore.getState();
  const nomes = entradas.filter((e) => e.userId !== euSou).map((e) => selectors.displayNameOf(s, e.userId, guildId));
  // Altura fixa: a faixa aparecer e sumir nao pode empurrar a conversa.
  return (
    <div className="flex h-[22px] shrink-0 items-center gap-1.5 px-4 font-mono text-[10.5px] tracking-[0.08em] text-texto-3">
      {nomes.length > 0 ? (
        <>
          <span aria-hidden className="flex gap-[3px]">
            {[0, 1, 2].map((i) => (
              <i key={i} className="k-anima k-pulso inline-block size-1 bg-texto-3" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          {quemDigita(nomes)}
        </>
      ) : null}
    </div>
  );
}

/** Tecla que escreve: letra, numero, pontuacao — nao atalho nem espaco. */
function escreve(e: KeyboardEvent): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function editavel(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  return h.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/**
 * Um canal de texto ou uma conversa direta: cabecalho, mensagens, quem esta
 * digitando e o compositor.
 *
 * Montada de novo a cada canal (a chave e o id): o estado de um canal —
 * resposta em andamento, edicao, anexos, rolagem — nunca vaza para outro.
 */
/**
 * `lateral`: a conversa da chamada, no painel da direita. Sem cabecalho (o
 * painel tem o seu) e sempre compacta — 300 px nao comportam foto de 40 px e
 * calha de 72 em cada mensagem.
 */
export function Conversa({
  canalId,
  extraNoCabecalho,
  topo,
  lateral = false,
}: {
  canalId: string;
  extraNoCabecalho?: ReactNode;
  /** Entre o cabecalho e as mensagens: a chamada da conversa direta. */
  topo?: ReactNode;
  lateral?: boolean;
}) {
  const canal = useStore((s) => s.channels.get(canalId));
  const euSou = useStore((s) => s.user?.id ?? null);
  const bits = usePermissoesNoCanal(canalId);
  const ehDM = Boolean(canal && !canal.guildId);

  const permissoes = useMemo<Permissoes>(
    () => ({
      reagir: has(bits, Permission.ADD_REACTIONS),
      // Em DM quem participa fixa (o servidor aceita desde esta versao).
      fixar: ehDM ? has(bits, Permission.VIEW_CHANNEL) : has(bits, Permission.MANAGE_MESSAGES),
      gerenciar: !ehDM && has(bits, Permission.MANAGE_MESSAGES),
    }),
    [bits, ehDM],
  );
  const podeEnviar = has(bits, Permission.SEND_MESSAGES);
  const podeAnexar = has(bits, Permission.ATTACH_FILES);

  const [respondendo, setRespondendo] = useState<Message | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const controle = useRef<ControleDaLista | null>(null);
  const profundidadeDoArraste = useRef(0);
  const anexos = useAnexosPendentes();

  const responder = useCallback((m: Message) => {
    setEditandoId(null);
    setRespondendo(m);
    campo.current?.focus();
  }, []);

  const editar = useCallback((id: string | null) => {
    setEditandoId(id);
    // Ao sair da edicao, o cursor volta para o compositor.
    if (!id) requestAnimationFrame(() => campo.current?.focus());
  }, []);

  const aoEditarUltima = useCallback(() => {
    const itens = useStore.getState().messages.get(canalId)?.items ?? [];
    for (let i = itens.length - 1; i >= 0; i--) {
      const m = itens[i]!;
      if (m.authorId === euSou && !idsOtimistas.has(m.id)) {
        setEditandoId(m.id);
        return true;
      }
    }
    return false;
  }, [canalId, euSou]);

  // Ctrl+F busca; qualquer letra fora de um campo vai para o compositor.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setBuscando(true);
        return;
      }
      const ativo = document.activeElement;
      if (!escreve(e) || editavel(ativo)) return;
      // Dentro de dialogo, menu ou balao a letra e deles (digitar para pular, busca).
      if (ativo?.closest('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')) return;
      // A lista de mensagens decide sozinha (atalhos de teclado nela).
      if (ativo?.closest('article[data-mensagem]')) return;
      if (!podeEnviar) return;
      campo.current?.focus();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [podeEnviar]);

  function temArquivos(e: DragEvent) {
    return [...e.dataTransfer.types].includes('Files');
  }

  if (!canal) return null;
  const destino = canal.guildId ? `#${canal.name ?? 'canal'}` : `@${useStore.getState().users.get(canal.recipientIds.find((r) => r !== euSou) ?? '')?.displayName ?? 'conversa'}`;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      data-densidade={lateral ? 'compacto' : undefined}
      onDragEnter={(e) => {
        if (!podeAnexar || !temArquivos(e)) return;
        profundidadeDoArraste.current++;
        setArrastando(true);
      }}
      onDragOver={(e) => {
        if (podeAnexar && temArquivos(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        profundidadeDoArraste.current = Math.max(0, profundidadeDoArraste.current - 1);
        if (profundidadeDoArraste.current === 0) setArrastando(false);
      }}
      onDrop={(e) => {
        profundidadeDoArraste.current = 0;
        setArrastando(false);
        if (!podeAnexar || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        anexos.adicionar(e.dataTransfer.files);
        campo.current?.focus();
      }}
    >
      {lateral ? null : (
        <Cabecalho canal={canal} euSou={euSou} aoBuscar={() => setBuscando(true)} podeFixar={permissoes.fixar} extra={extraNoCabecalho} />
      )}
      {topo}
      <ListaDeMensagens
        canalId={canalId}
        guildId={canal.guildId}
        euSou={euSou}
        permissoes={permissoes}
        editandoId={editandoId}
        responder={responder}
        editar={editar}
        campo={campo}
        controle={controle}
        inicio={<Inicio canal={canal} euSou={euSou} />}
        rotulo={`Mensagens em ${destino}`}
      />
      <Digitando canalId={canalId} euSou={euSou} guildId={canal.guildId} />
      <Compositor
        canalId={canalId}
        destino={destino}
        ehDM={ehDM}
        campo={campo}
        respondendo={respondendo}
        aoCancelarResposta={() => setRespondendo(null)}
        aoEnviar={() => {
          setRespondendo(null);
          controle.current?.irParaOFim();
        }}
        aoEditarUltima={aoEditarUltima}
        aoIrParaMensagens={() => controle.current?.focarAtiva() ?? false}
        anexos={anexos}
        podeEnviar={podeEnviar}
        podeAnexar={podeAnexar}
        lateral={lateral}
      />
      <Busca aberto={buscando} aoMudar={setBuscando} canalId={canalId} guildId={canal.guildId} />

      {arrastando ? (
        <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center border border-acento bg-void/85">
          <div className="k-colchetes px-10 py-8 text-center">
            <span className="k-colchetes-extra" aria-hidden />
            <Upload aria-hidden className="mx-auto mb-3 size-8 text-acento" strokeWidth={1.5} />
            <p className="font-display text-20 font-bold uppercase tracking-display">Solte para anexar</p>
            <p className="mt-1 text-13 text-texto-3">em {destino} · até 10 arquivos de 100 MB</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

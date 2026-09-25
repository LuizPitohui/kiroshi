import { useEffect } from 'react';
import type { Channel } from '@kiroshi/shared';
import { selectors, useMembersOfGuild, useStore } from '../../store/index.js';
import { ROTA_INICIAL, escreverRota, navegar, useRota, type Rota } from '../../app/rotas.js';
import { Avatar, Botao, EstadoVazio } from '../../design/primitivos/index.js';
import { BarraDeTitulo } from './BarraDeTitulo.js';
import { BarraDeEstado } from './BarraDeEstado.js';
import { Navegacao } from './Navegacao.js';
import { Identidade, PainelDeVoz } from './PainelDeVoz.js';
import { Trilho } from './Trilho.js';
import { entrarNaVoz } from './acoesDeVoz.js';
import { useVoz } from './useVoz.js';
import { Conversa } from '../conversa/Conversa.js';
import { Ajustes } from '../ajustes/Ajustes.js';
import { useInterface } from '../../app/interface.js';

const CHAVE_DA_ULTIMA_ROTA = 'kiroshi.rota';

/** O primeiro canal de texto de um servidor, pela ordem da lista. */
function primeiroCanalDeTexto(canais: readonly Channel[]): string | null {
  const texto = canais.filter((c) => c.type === 'GUILD_TEXT' || c.type === 'GUILD_ANNOUNCEMENT').sort((a, b) => a.position - b.position);
  return texto[0]?.id ?? null;
}

/**
 * A rota manda no que esta aberto; o store continua sabendo o canal
 * selecionado, porque a logica ja testada dele depende disso (lembrar o
 * ultimo canal de cada servidor, nao notificar o canal que esta na tela).
 * Tambem corrige rotas incompletas ou velhas, sempre substituindo no
 * historico — correcao automatica nao pode virar um passo a mais no "voltar".
 */
function useSincronizarRota(rota: Rota): void {
  const selectGuild = useStore((s) => s.selectGuild);
  const selectChannel = useStore((s) => s.selectChannel);
  const pronto = useStore((s) => s.connection === 'ready');

  useEffect(() => {
    if (rota.tela === 'servidor') {
      selectGuild(rota.guildId);
      if (rota.canalId) selectChannel(rota.canalId);
    } else if (rota.tela === 'dm') {
      selectGuild(null);
      selectChannel(rota.canalId);
    } else if (rota.tela === 'inicio') {
      selectGuild(null);
    }
    try {
      localStorage.setItem(CHAVE_DA_ULTIMA_ROTA, escreverRota(rota));
    } catch {
      // sem armazenamento: so nao lembra onde parou
    }
  }, [rota, selectGuild, selectChannel]);

  // Servidor sem canal escolhido: o ultimo visitado, ou o primeiro de texto.
  const destino = useStore((s) => {
    if (rota.tela !== 'servidor' || rota.canalId) return null;
    return s.lastChannelByGuild.get(rota.guildId) ?? primeiroCanalDeTexto(selectors.channelsOfGuild(s, rota.guildId));
  });
  useEffect(() => {
    if (rota.tela === 'servidor' && !rota.canalId && destino) {
      navegar({ tela: 'servidor', guildId: rota.guildId, canalId: destino }, { substituir: true });
    }
  }, [rota, destino]);

  // Servidor ou canal que nao existe mais (saiu, foi apagado, perdeu acesso): volta ao inicio.
  const existe = useStore((s) => {
    if (rota.tela === 'servidor' || rota.tela === 'ajustes-servidor') {
      if (!s.guilds.has(rota.guildId)) return false;
      if (rota.tela === 'servidor' && rota.canalId) return s.channels.has(rota.canalId);
    }
    if (rota.tela === 'dm') return s.channels.has(rota.canalId);
    return true;
  });
  useEffect(() => {
    if (pronto && !existe) navegar(ROTA_INICIAL, { substituir: true });
  }, [pronto, existe]);
}

/** Na abertura sem endereco, volta para onde a pessoa estava. */
export function restaurarUltimaRota(): void {
  if (location.hash) return;
  try {
    const ultima = localStorage.getItem(CHAVE_DA_ULTIMA_ROTA);
    if (ultima) history.replaceState(history.state, '', ultima);
  } catch {
    // sem armazenamento: comeca no inicio
  }
}

function CanalAberto({ guildId, canalId }: { guildId: string; canalId: string }) {
  const canal = useStore((s) => s.channels.get(canalId));
  const estouAqui = useVoz((v) => v.channelId === canalId && (v.connected || v.connecting));
  if (!canal) return null;

  /*
    Canal de voz: por enquanto a conversa dele na area principal, como a 1.x
    mostrava ao lado do palco. O palco novo (fatia 3) toma a area principal e a
    conversa vai para o painel da direita.
  */
  const chamada =
    canal.type === 'GUILD_VOICE' ? (
      estouAqui ? (
        <span className="mr-2 flex items-center gap-1.5 font-mono text-10 uppercase tracking-rotulo text-ok">
          <span aria-hidden className="size-1.5 bg-ok" />
          Na chamada
        </span>
      ) : (
        <Botao tamanho="sm" variante="primario" onClick={() => void entrarNaVoz(canal.id, guildId)}>
          ▸ Entrar na chamada
        </Botao>
      )
    ) : null;

  // A chave e o canal: estado de um canal (resposta, edicao, anexos, rolagem) nunca vaza para outro.
  return <Conversa key={canal.id} canalId={canal.id} extraNoCabecalho={chamada} />;
}

function AreaPrincipal({ rota }: { rota: Rota }) {
  const amigos = useStore((s) => selectors.friends(s).length);

  switch (rota.tela) {
    case 'servidor':
      return rota.canalId ? <CanalAberto guildId={rota.guildId} canalId={rota.canalId} /> : null;
    case 'dm':
      return <Conversa key={rota.canalId} canalId={rota.canalId} />;
    case 'inicio':
      return (
        <EstadoVazio rotulo="Início" titulo={amigos === 0 ? 'Sua rede começa aqui' : amigos === 1 ? '1 amigo' : `${amigos} amigos`}>
          {amigos === 0
            ? 'Adicione alguém pelo nome de usuário, crie um servidor ou entre por convite.'
            : 'A lista de amigos nova — online, pendentes, bloqueados — chega na fatia 4.'}
        </EstadoVazio>
      );
    case 'ajustes':
      return <Ajustes />;
    case 'ajustes-servidor':
      return (
        <EstadoVazio rotulo="Ajustes do servidor" titulo="Em construção" acao={<Botao onClick={() => history.back()}>Voltar</Botao>}>
          Os ajustes do servidor completos, com cargos que se atribuem, chegam na fatia 6.
        </EstadoVazio>
      );
    case 'convite':
      return (
        <EstadoVazio rotulo="Convite" titulo="Convites por link chegam na fatia 6">
          Código: {rota.codigo}
        </EstadoVazio>
      );
  }
}

/** Membros do servidor, online primeiro. O agrupamento por cargo vem com os cargos (fatia 6). */
function Membros({ guildId }: { guildId: string }) {
  const membros = useMembersOfGuild(guildId);
  const presencas = useStore((s) => s.presences);
  const usuarios = useStore((s) => s.users);
  const online = membros.filter((m) => (presencas.get(m.userId)?.status ?? 'OFFLINE') !== 'OFFLINE');
  const offline = membros.filter((m) => (presencas.get(m.userId)?.status ?? 'OFFLINE') === 'OFFLINE');

  const linha = (userId: string, nick: string | null) => {
    const u = usuarios.get(userId);
    const nome = nick || u?.displayName || u?.username || '?';
    const status = presencas.get(userId)?.status ?? 'OFFLINE';
    return (
      <li key={userId} className={status === 'OFFLINE' ? 'opacity-40' : undefined}>
        <div className="flex h-10 items-center gap-2.5 px-3.5">
          <Avatar nome={nome} id={userId} url={u?.avatarUrl} tamanho={32} status={status} />
          <span className="min-w-0 truncate text-14 font-medium">{nome}</span>
        </div>
      </li>
    );
  };

  return (
    <aside aria-label="Membros" className="k-rolagem w-[300px] shrink-0 overflow-y-auto border-l border-borda bg-deck">
      <div className="flex h-12 items-center border-b border-borda px-3.5">
        <p className="k-rotulo">Membros — {membros.length}</p>
      </div>
      {online.length ? <p className="k-rotulo px-3.5 pb-1 pt-4">Online — {online.length}</p> : null}
      <ul>{online.map((m) => linha(m.userId, m.nickname))}</ul>
      {offline.length ? <p className="k-rotulo px-3.5 pb-1 pt-4">Offline — {offline.length}</p> : null}
      <ul>{offline.map((m) => linha(m.userId, m.nickname))}</ul>
    </aside>
  );
}

/**
 * A janela inteira: barra de titulo, trilho, navegacao (com a voz e a
 * identidade embaixo), area principal, painel da direita e barra de estado.
 */
export function Casca(): React.JSX.Element {
  const rota = useRota();
  useSincronizarRota(rota);
  const membrosVisiveis = useInterface((s) => s.membros);
  const ehTexto = useStore((s) => {
    if (rota.tela !== 'servidor' || !rota.canalId) return false;
    const tipo = s.channels.get(rota.canalId)?.type;
    return tipo === 'GUILD_TEXT' || tipo === 'GUILD_ANNOUNCEMENT';
  });

  return (
    <div className="grid h-full grid-rows-[32px_minmax(0,1fr)_22px]">
      {/* Botao, e nao link `#conteudo`: com rotas por hash, a ancora trocaria a rota. */}
      <button
        type="button"
        onClick={() => document.getElementById('conteudo')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-10 focus:z-[var(--k-z-dialogo)] focus:bg-acento focus:px-3 focus:py-2 focus:font-mono focus:text-11 focus:uppercase focus:text-sobre-acento"
      >
        Pular para o conteúdo
      </button>
      <BarraDeTitulo />
      <div className="flex min-h-0">
        <Trilho />
        <aside aria-label="Navegação" className="flex min-h-0 w-64 shrink-0 flex-col border-r border-borda bg-deck">
          <Navegacao />
          <PainelDeVoz />
          <Identidade />
        </aside>
        <main id="conteudo" tabIndex={-1} className="min-h-0 min-w-0 flex-1 bg-void outline-none">
          <AreaPrincipal rota={rota} />
        </main>
        {rota.tela === 'servidor' && ehTexto && membrosVisiveis ? <Membros guildId={rota.guildId} /> : null}
      </div>
      <BarraDeEstado />
    </div>
  );
}

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
import { Conversa } from '../conversa/Conversa.js';
import { TelaDaChamada } from '../chamada/TelaDaChamada.js';
import { MiniPalco } from '../chamada/MiniPalco.js';
import { ZeladorDaChamada } from '../chamada/ZeladorDaChamada.js';
import { NotificacoesDaJanela } from './NotificacoesDaJanela.js';
import { ChamadasDiretas } from '../chamada/ChamadaRecebida.js';
import { BotoesDeLigar, ChamadaNaConversa } from '../chamada/ChamadaNaConversa.js';
import { Inicio } from '../inicio/Inicio.js';
import { ContextoDaChamada } from '../chamada/fonte.js';
import { fonteAoVivo } from '../chamada/fonteAoVivo.js';
import { Ajustes } from '../ajustes/Ajustes.js';
import { AjustesDoServidor } from '../servidor/AjustesDoServidor.js';
import { EntrarPorConvite } from '../servidor/EntrarPorConvite.js';
import { PainelDeMembros } from '../pessoas/PainelDeMembros.js';
import { JanelasDaPessoa } from '../pessoas/JanelasDaPessoa.js';
import { AvisoDeSenha } from './AvisoDeSenha.js';
import { AvisoDeVersaoNova } from './AvisoDeVersaoNova.js';
import { useInterface } from '../../app/interface.js';
import { useTelaLarga } from '../../app/largura.js';

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
  const tipo = useStore((s) => s.channels.get(canalId)?.type);
  if (!tipo) return null;
  // Canal de voz: o palco na area principal; a conversa dele vai para o painel da direita.
  if (tipo === 'GUILD_VOICE') return <TelaDaChamada key={canalId} canalId={canalId} guildId={guildId} />;
  // A chave e o canal: estado de um canal (resposta, edicao, anexos, rolagem) nunca vaza para outro.
  return <Conversa key={canalId} canalId={canalId} />;
}

/** A conversa do canal de voz, no painel da direita (como no prototipo). */
function ConversaDaChamada({ canalId }: { canalId: string }) {
  return (
    <aside aria-label="Conversa da chamada" className="flex w-[300px] shrink-0 flex-col border-l border-borda bg-deck">
      <div className="flex h-12 shrink-0 items-center border-b border-borda px-3.5">
        <p className="k-rotulo">Conversa da chamada</p>
      </div>
      <div className="min-h-0 flex-1">
        <Conversa key={canalId} canalId={canalId} lateral />
      </div>
    </aside>
  );
}

function AreaPrincipal({ rota }: { rota: Rota }) {
  switch (rota.tela) {
    case 'servidor':
      return rota.canalId ? <CanalAberto guildId={rota.guildId} canalId={rota.canalId} /> : null;
    case 'dm':
      // A chamada da conversa direta abre no topo dela, como no Discord.
      return (
        <Conversa
          key={rota.canalId}
          canalId={rota.canalId}
          topo={<ChamadaNaConversa canalId={rota.canalId} />}
          extraNoCabecalho={<BotoesDeLigar canalId={rota.canalId} />}
        />
      );
    case 'inicio':
      return <Inicio aba={rota.aba} />;
    case 'ajustes':
      return <Ajustes />;
    case 'ajustes-servidor':
      return <AjustesDoServidor guildId={rota.guildId} pagina={rota.pagina} />;
    case 'convite':
      return <EntrarPorConvite key={rota.codigo} codigo={rota.codigo} />;
  }
}

/**
 * A janela inteira: barra de titulo, trilho, navegacao (com a voz e a
 * identidade embaixo), area principal, painel da direita e barra de estado.
 */
export function Casca(): React.JSX.Element {
  const rota = useRota();
  useSincronizarRota(rota);
  const telaLarga = useTelaLarga();
  const membrosVisiveis = useInterface((s) => s.membros);
  const gaveta = useInterface((s) => s.gavetaDeMembros);
  const fecharGaveta = useInterface((s) => s.fecharGaveta);

  // A gaveta e daquela tela: trocar de lugar ou alargar a janela fecha.
  useEffect(() => {
    fecharGaveta();
  }, [rota, telaLarga, fecharGaveta]);
  useEffect(() => {
    if (!gaveta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharGaveta();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [gaveta, fecharGaveta]);
  const tipoDoCanal = useStore((s) => (rota.tela === 'servidor' && rota.canalId ? s.channels.get(rota.canalId)?.type : undefined));
  // O painel da direita: membros ao lado de um canal de texto, a conversa da chamada ao lado do palco.
  const painel =
    rota.tela !== 'servidor' || !rota.canalId ? null : tipoDoCanal === 'GUILD_VOICE' ? (
      <ConversaDaChamada canalId={rota.canalId} />
    ) : tipoDoCanal === 'GUILD_TEXT' || tipoDoCanal === 'GUILD_ANNOUNCEMENT' ? (
      <PainelDeMembros guildId={rota.guildId} />
    ) : null;

  return (
    <ContextoDaChamada.Provider value={fonteAoVivo}>
    <ZeladorDaChamada />
    <NotificacoesDaJanela />
    <JanelasDaPessoa />
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
        <main id="conteudo" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-void outline-none">
          {/* Primeiro no documento: o Tab chega na chamada recebida antes da conversa. */}
          <ChamadasDiretas />
          <AvisoDeVersaoNova />
          <AvisoDeSenha />
          <div className="relative min-h-0 flex-1">
            <AreaPrincipal rota={rota} />
          </div>
          <MiniPalco />
        </main>
        {painel && telaLarga && membrosVisiveis ? painel : null}
        {/* Janela estreita: o painel vira gaveta por cima da conversa (design, secao 3). */}
        {painel && !telaLarga && gaveta ? (
          <div className="fixed inset-x-0 bottom-[22px] top-8 z-[var(--k-z-palco-flutuante)] bg-preto/50" onClick={fecharGaveta}>
            <div className="absolute inset-y-0 right-0 flex shadow-camada" onClick={(e) => e.stopPropagation()}>
              {painel}
            </div>
          </div>
        ) : null}
      </div>
      <BarraDeEstado />
    </div>
    </ContextoDaChamada.Provider>
  );
}

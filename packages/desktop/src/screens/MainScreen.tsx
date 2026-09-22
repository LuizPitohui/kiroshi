import { useEffect, useState } from 'react';
import { useStore } from '../store/index.js';
import { usePushToTalk } from '../hooks/usePushToTalk.js';
import { useChamadaDeFundo } from '../hooks/useChamadaDeFundo.js';
import { useAnunciarChamada } from '../hooks/useAnunciarChamada.js';
import { GlobalRail } from '../components/GlobalRail.js';
import { NavColumn } from '../components/NavColumn.js';
import { Stage } from '../components/Stage.js';
import { VoiceChannelView } from '../components/VoiceChannelView.js';
import { CallDock } from '../components/CallDock.js';
import { CallStatus } from '../components/CallStatus.js';
import { ChatArea } from '../components/ChatArea.js';
import { SocialHome } from '../components/SocialHome.js';
import { PresenceColumn } from '../components/PresenceColumn.js';
import { HudBar } from '../components/HudBar.js';
import { AppShell, useLarguraDaJanela } from '../components/ui/AppShell.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { SettingsScreen } from './SettingsScreen.js';

/**
 * Disposicao geral, e ela muda conforme o tipo de canal aberto.
 *
 *   canal de texto:  global | canais | conversa           | membros
 *   canal de voz:    global | canais | palco (tela cheia) | conversa do canal
 *   ----------------------------------------------------------------------
 *                    barra de estado
 *
 * A primeira coluna (`GlobalRail`, 72px) e so servidores e inicio: responde
 * "onde eu estou". A segunda (`NavColumn`, 256px) e o que existe dentro do que
 * esta selecionado. Elas viviam juntas em uma coluna so, e a separacao custa
 * 72px de largura permanente — paga isso deixando o servidor ativo sempre
 * visivel no mesmo lugar, em vez de em uma tira que rolava lateralmente.
 *
 * Por que sao duas disposicoes e nao uma.
 *
 * Antes o palco dividia a altura com o canal de texto que estivesse aberto, e
 * a coluna de membros ficava sempre la. O resultado era que entrar numa
 * chamada espremia o video entre uma conversa que nao tinha nada a ver com ela
 * e uma lista de gente que ja aparecia dentro do proprio palco. Sobrava pouca
 * altura para a unica coisa que a pessoa foi ver.
 *
 * Agora cada canal manda na tela inteira:
 *
 *   No canal de voz, o palco ocupa o centro todo e a conversa daquele canal
 *   vai para a direita, junto da chamada — e onde se manda um link para quem
 *   esta ali, sem sair do que se esta assistindo.
 *
 *   No canal de texto, a conversa ocupa o centro e a direita volta a ser a
 *   lista de membros, que e onde ela serve: para ver quem esta no servidor.
 *
 * A lista de membros nao some do canal de voz por economia de espaco: quem
 * esta na chamada ja aparece no palco, com nome, camera e anel de quem fala.
 * Repetir isso ao lado seria a mesma informacao duas vezes.
 *
 * O `AppShell` cuida de como isso encolhe. Esta tela so diz QUEM sao as
 * regioes; quando cada uma vira gaveta e decisao de uma camada so.
 */
export function MainScreen() {
  const selectedChannelId = useStore((s) => s.selectedChannelId);
  const selectedGuildId = useStore((s) => s.selectedGuildId);
  const channel = useStore((s) => (selectedChannelId ? s.channels.get(selectedChannelId) : null));

  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const largura = useLarguraDaJanela();

  /*
    O recolhimento do palco menor mora aqui, e nao dentro do palco, porque o
    botao que o aciona esta no dock. Sao dois componentes irmaos: o estado
    precisa ser de quem os monta.
  */
  const chamadaDeFundo = useChamadaDeFundo();
  const [palcoRecolhido, setPalcoRecolhido] = useState(false);

  /*
    A sessao ainda nao chegou.

    `reconnecting` entra aqui junto com `connecting`: para quem esta olhando,
    as duas sao a mesma situacao — os dados na tela nao valem mais. A
    diferenca entre elas aparece no TEXTO, nao em esconder uma das duas.
  */
  const connection = useStore((s) => s.connection);
  const conectando = connection !== 'ready' && connection !== 'failed';

  /*
    O painel comeca aberto so onde cabe sem apertar nada.

    A especificacao e explicita: de 1024 a 1439 o painel direito fica fechado
    por padrao, e a leitura da conversa tem prioridade sobre lista de membros.
    Continua a um clique — fechado nao e removido.
  */
  const [painelAberto, setPainelAberto] = useState(() => largura === 'completa');

  // Ao estreitar, fecha; ao alargar de volta, nao reabre sozinho. Reabrir
  // desfaria uma escolha que a pessoa pode ter feito de proposito.
  useEffect(() => {
    if (largura !== 'completa') setPainelAberto(false);
  }, [largura]);

  usePushToTalk();
  // Vale para a chamada inteira, nao so para o canal aberto: saber que alguem
  // entrou enquanto voce le outro canal e o que se perde sem olhar a tela.
  useAnunciarChamada();

  const ehCanalDeVoz = channel?.type === 'GUILD_VOICE';

  /*
    A `chave` e o que faz o painel lembrar a largura, e ela e diferente para
    cada uso de proposito: quem alargou a conversa da chamada para caber uma
    linha inteira nao quer que a lista de membros herde essa largura — sao
    conteudos de tamanhos diferentes.
  */
  const painel = ehCanalDeVoz
    ? {
        titulo: 'Conversa da chamada',
        chave: 'conversa-da-chamada',
        conteudo: <ChatArea channelId={selectedChannelId} lateral />,
      }
    : channel?.guildId
      ? {
          titulo: 'Membros',
          chave: 'membros',
          conteudo: <PresenceColumn guildId={channel.guildId} visivel />,
        }
      : undefined;

  return (
    <>
      <AppShell
        rail={<GlobalRail />}
        sidebar={{ titulo: 'Canais', conteudo: <NavColumn /> }}
        panel={painel}
        painelAberto={painelAberto && Boolean(painel)}
        aoFecharPainel={() => setPainelAberto(false)}
        dock={<HudBar onOpenSettings={() => setAjustesAbertos(true)} />}
        main={
          /*
            Enquanto a sessao nao chegou, o centro diz isso.

            Antes ficava em branco: entre abrir o aplicativo e o gateway
            responder existe um intervalo de alguns segundos — mais em rede
            ruim — e ali a tela mostrava uma area vazia sem explicacao. Quem
            estivesse com a conexao caindo via exatamente a mesma coisa que
            quem estava conectando normalmente.
          */
          conectando ? (
            <EstadoDeConexao estado={connection} />
          ) : /*
            Sem servidor e sem conversa aberta, o centro e a pagina inicial.

            Antes era um "escolha um canal na barra lateral" ocupando o maior
            espaco da janela — uma instrucao que nao ajuda quem ja sabe e nao
            serve para quem acabou de criar a conta e nao tem canal nenhum
            para escolher.
          */
          !selectedChannelId && !selectedGuildId ? (
            <SocialHome />
          ) : ehCanalDeVoz && selectedChannelId ? (
            <VoiceChannelView channelId={selectedChannelId} guildId={channel?.guildId ?? null} />
          ) : (
            <>
              {/*
                A chamada que continua rodando enquanto se le outra coisa
                aparece de duas formas, e as duas sao necessarias.

                O dock diz ONDE ela e e como voltar — o que faltava, e o que
                fazia falar para o canal errado.

                O palco menor continua mostrando a imagem: sair para ler um
                canal de texto nao pode desligar o video de quem esta
                assistindo alguem jogar.
              */}
              <CallDock
                recolhido={palcoRecolhido}
                aoAlternarRecolhido={() => setPalcoRecolhido((v) => !v)}
              />
              <CallStatus />
              <Stage
                semBarra={chamadaDeFundo}
                recolhido={chamadaDeFundo ? palcoRecolhido : undefined}
                aoAlternarRecolhido={
                  chamadaDeFundo ? () => setPalcoRecolhido((v) => !v) : undefined
                }
              />
              <ChatArea
                channelId={selectedChannelId}
                showMembers={painelAberto}
                onToggleMembers={() => setPainelAberto((v) => !v)}
              />
            </>
          )
        }
      />

      {ajustesAbertos && <SettingsScreen onClose={() => setAjustesAbertos(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * O centro enquanto a sessao nao chega.
 *
 * Esqueleto e nao roda-roda, e a diferenca nao e estetica: o esqueleto mostra
 * a FORMA do que vem, entao quando o conteudo chega ele ocupa o lugar que ja
 * estava desenhado, sem a tela saltar. Um roda-roda centralizado e substituido
 * de uma vez por uma lista, e tudo pula.
 *
 * O texto muda com o estado porque "conectando" e "reconectando" nao sao a
 * mesma noticia. A primeira e o normal de abrir o aplicativo; a segunda quer
 * dizer que algo caiu, e quem esperava uma resposta precisa saber disso.
 */
function EstadoDeConexao({ estado }: { estado: string }) {
  const reconectando = estado === 'reconnecting';

  return (
    <div className="conectando">
      <div className="conectando-aviso" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>
          {reconectando
            ? 'Reconectando ao servidor. Suas mensagens voltam assim que a conexao voltar.'
            : 'Carregando suas conversas...'}
        </span>
      </div>

      {/* A forma do que vem: cabecalho e algumas mensagens. */}
      <div className="conectando-esqueleto" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="conectando-linha">
            <Skeleton forma="circulo" largura={40} altura={40} />
            <div style={{ flex: 1 }}>
              <Skeleton forma="texto" linhas={i % 2 === 0 ? 2 : 1} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { voice } from '../voice/controller.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { useStore } from '../store/index.js';
import { ConnectionStatus, type EstadoDaConexao } from './ui/ConnectionStatus.js';
import { Dialog } from './ui/Dialog.js';

/**
 * Liga o `ConnectionStatus` ao que a chamada esta realmente fazendo.
 *
 * A regra que domina este arquivo e uma so: NAO INCOMODAR SEM MOTIVO. O aviso
 * anterior era um texto solto na barra de baixo que aparecia e ficava —
 * literalmente, ate a pessoa reiniciar o aplicativo. Trocar aquilo por uma
 * caixa maior e mais bonita que aparece com a mesma facilidade seria piorar.
 *
 * Tres decisoes vem disso.
 *
 * "Instavel" precisa DURAR para aparecer. A qualidade que o SFU reporta
 * oscila; um pico de meio segundo e normal em qualquer rede. Um aviso que
 * pisca a cada pico e pior que nenhum, porque ensina a ignorar.
 *
 * Latencia alta sozinha nao e instabilidade. O Varta esta nos Estados Unidos:
 * 150 ms para ele e o normal, nao um defeito. Acusar a conexao dele de ruim a
 * cada chamada seria um aviso permanente sobre algo que nao tem conserto. Por
 * isso o sinal principal e a qualidade medida pelo proprio SFU, e a latencia
 * so entra como reforco em valores que ja sao ruins para qualquer distancia.
 *
 * E todo aviso que nao se resolve sozinho pode ser dispensado.
 */

/** Quanto tempo a qualidade precisa ficar ruim antes de virar aviso. */
const PACIENCIA = 6000;

/** Latencia que e ruim a qualquer distancia, inclusive de outro continente. */
const LATENCIA_RUIM = 400;

type Diagnostico = Awaited<ReturnType<typeof voice.inspectConnection>>;

export function CallStatus() {
  const voz = useVoiceState();
  const canal = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));

  const [instavel, setInstavel] = useState(false);
  const [dispensado, setDispensado] = useState(false);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [medindo, setMedindo] = useState(false);

  const eu = voz.participants.find((p) => p.isLocal);
  const ruimAgora =
    voz.connected &&
    (eu?.connectionQuality === 'poor' || (voz.ping !== null && voz.ping >= LATENCIA_RUIM));

  // So vira aviso se continuar ruim. Sair do estado ruim e imediato: a pessoa
  // nao precisa esperar seis segundos para o aviso sumir depois que melhorou.
  useEffect(() => {
    if (!ruimAgora) {
      setInstavel(false);
      return;
    }
    const relogio = window.setTimeout(() => setInstavel(true), PACIENCIA);
    return () => window.clearTimeout(relogio);
  }, [ruimAgora]);

  // Um aviso dispensado nao volta pelo mesmo motivo. Entrar em outra chamada
  // comeca de novo — e outra situacao.
  useEffect(() => setDispensado(false), [voz.channelId]);

  async function abrirDiagnostico(): Promise<void> {
    setMedindo(true);
    try {
      setDiagnostico(await voice.inspectConnection());
    } finally {
      setMedindo(false);
    }
  }

  const estado: EstadoDaConexao | null = voz.error
    ? 'caiu'
    : voz.connecting && voz.connected
      ? 'reconectando'
      : voz.connecting
        ? 'conectando'
        : instavel
          ? 'instavel'
          : null;

  if (estado === null || dispensado) {
    return diagnostico || medindo ? (
      <JanelaDoDiagnostico
        dados={diagnostico}
        medindo={medindo}
        aoFechar={() => setDiagnostico(null)}
      />
    ) : null;
  }

  function tentarNovamente(): void {
    if (!voz.channelId) return;
    voice.clearError();
    void voice.joinChannel(voz.channelId, canal?.guildId ?? null).catch(() => undefined);
  }

  return (
    <>
      <div className="chamada-estado">
        <ConnectionStatus
          estado={estado}
          detalhe={voz.error}
          aoTentarNovamente={estado === 'caiu' && voz.channelId ? tentarNovamente : undefined}
          aoVerDiagnostico={estado === 'conectando' ? undefined : () => void abrirDiagnostico()}
          aoDispensar={() => {
            // Limpar o erro tambem: sem isso o estado continua 'caiu' e o
            // aviso volta no proximo render, que foi exatamente o defeito do
            // aviso antigo.
            voice.clearError();
            setDispensado(true);
          }}
        />
      </div>

      {(diagnostico || medindo) && (
        <JanelaDoDiagnostico
          dados={diagnostico}
          medindo={medindo}
          aoFechar={() => setDiagnostico(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

const CAMINHO: Record<string, string> = {
  direto: 'Direto, sem intermediario',
  nat: 'Atravessando o NAT',
  relay: 'Por retransmissor (TURN)',
  desconhecido: 'Nao foi possivel determinar',
};

/**
 * O que foi medido, em vez do que se supoe.
 *
 * A especificacao e explicita em nao culpar o IPv6 sem evidencia, e este
 * dialogo e o lugar onde a evidencia mora. Por isso ele mostra o endereco e o
 * protocolo que a midia esta realmente usando: e a diferenca entre "sua rede
 * deve estar bloqueando algo" e "a midia esta passando por 100.x, UDP, 38 ms".
 */
function JanelaDoDiagnostico({
  dados,
  medindo,
  aoFechar,
}: {
  dados: Diagnostico | null;
  medindo: boolean;
  aoFechar: () => void;
}) {
  return (
    <Dialog
      aberto
      aoFechar={aoFechar}
      titulo="Diagnostico da conexao"
      largura={480}
      acoes={
        <button className="btn" onClick={aoFechar}>
          Fechar
        </button>
      }
    >
      {medindo || !dados ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : (
        <dl className="diagnostico">
          <Linha rotulo="Midia" valor={dados.conectado ? 'Conectada' : 'Sem conexao'} />
          <Linha rotulo="Caminho" valor={CAMINHO[dados.caminho] ?? dados.caminho} />
          <Linha rotulo="Endereco do servidor" valor={dados.endereco ?? 'nao disponivel'} mono />
          <Linha rotulo="Protocolo" valor={dados.protocolo?.toUpperCase() ?? 'nao disponivel'} />
          <Linha
            rotulo="Latencia"
            valor={dados.latenciaMs === null ? 'nao disponivel' : `${dados.latenciaMs} ms`}
          />
          <Linha
            rotulo="Perda de pacotes"
            valor={
              dados.perdaPacotes === null ? 'nao disponivel' : `${dados.perdaPacotes.toFixed(1)}%`
            }
          />
          <Linha rotulo="IPv6 disponivel" valor={dados.temIPv6 ? 'sim' : 'nao'} />
          <Linha rotulo="Rede virtual (Tailscale)" valor={dados.naVpn ? 'sim' : 'nao'} />

          {/*
            A leitura, e nao so os numeros. Faltar IPv6 so importa para quem
            tambem esta fora da rede virtual — e esse era exatamente o aviso
            que aparecia antes para quem nao tinha problema nenhum.
          */}
          {!dados.temIPv6 && !dados.naVpn && dados.caminho === 'relay' && (
            <p className="diagnostico-nota">
              Sem IPv6 e fora da rede virtual, a midia esta passando por retransmissor. Entrar na
              rede virtual costuma resolver.
            </p>
          )}
        </dl>
      )}
    </Dialog>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd className={mono ? 'mono' : undefined}>{valor}</dd>
    </>
  );
}

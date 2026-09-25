import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { voice } from '../../voice/controller.js';
import { Botao, avisar } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { Bloco, Linha } from './partes.js';

type Inspecao = Awaited<ReturnType<typeof voice.inspectConnection>>;

const CAMINHOS: Record<Inspecao['caminho'], string> = {
  direto: 'Direto até o servidor (o melhor caso)',
  nat: 'Direto, passando pelo roteador',
  relay: 'Por retransmissão (relay): funciona, com um pouco mais de atraso',
  desconhecido: '—',
};

/**
 * Diagnostico da voz: por onde a midia passa, a latencia e a perda, e se esta
 * maquina tem os caminhos que a chamada usa (IPv6, rede virtual). A qualidade
 * do video de cada pessoa fica no proprio quadro, no palco.
 */
export function PaginaDiagnostico() {
  const [inspecao, setInspecao] = useState<Inspecao | null>(null);
  const [lendo, setLendo] = useState(false);
  const conectado = useVoz((v) => v.connected);

  async function ler() {
    setLendo(true);
    try {
      setInspecao(await voice.inspectConnection());
    } finally {
      setLendo(false);
    }
  }

  useEffect(() => {
    void ler();
  }, [conectado]);

  function copiar() {
    if (!inspecao) return;
    const linhas = [
      `Kiroshi diagnostico ${new Date().toISOString()}`,
      `em chamada: ${inspecao.conectado ? 'sim' : 'nao'}`,
      `caminho: ${inspecao.caminho} ${inspecao.protocolo ?? ''} ${inspecao.endereco ?? ''}`.trim(),
      `latencia: ${inspecao.latenciaMs ?? '-'} ms`,
      `perda: ${inspecao.perdaPacotes ?? '-'}`,
      `IPv6: ${inspecao.temIPv6 ? 'sim' : 'nao'}`,
      `rede virtual: ${inspecao.naVpn ? 'sim' : 'nao'}`,
    ];
    void navigator.clipboard.writeText(linhas.join('\n')).then(() => avisar.ok('Diagnóstico copiado', 'Cole na conversa com quem está ajudando.'));
  }

  return (
    <div className="space-y-8">
      <Bloco titulo="Esta máquina" descricao="Os caminhos que a voz usa até o servidor. Sem nenhum dos dois, a chamada não fecha.">
        <Linha titulo="IPv6" descricao="O caminho direto até o servidor.">
          <span className={inspecao?.temIPv6 ? 'text-ok' : 'text-aviso'}>{inspecao ? (inspecao.temIPv6 ? 'Tem' : 'Não tem') : '…'}</span>
        </Linha>
        <Linha titulo="Rede virtual (Tailscale)" descricao="O segundo caminho, para quem não tem IPv6.">
          <span className={inspecao?.naVpn ? 'text-ok' : 'text-texto-3'}>{inspecao ? (inspecao.naVpn ? 'Conectada' : 'Não conectada') : '…'}</span>
        </Linha>
      </Bloco>
      <Bloco titulo="Na chamada" descricao={conectado ? undefined : 'Entre numa chamada para ver o caminho, a latência e a perda.'}>
        {inspecao?.conectado ? (
          <>
            <Linha titulo="Caminho">
              <span className="text-14 text-texto-2">{CAMINHOS[inspecao.caminho]}</span>
            </Linha>
            <Linha titulo="Latência">
              <span className="font-mono text-13">{inspecao.latenciaMs === null ? '—' : `${inspecao.latenciaMs} ms`}</span>
            </Linha>
            <Linha titulo="Perda de pacotes">
              <span className="font-mono text-13">{inspecao.perdaPacotes === null ? '—' : `${inspecao.perdaPacotes}`}</span>
            </Linha>
          </>
        ) : null}
      </Bloco>
      <div className="flex gap-2">
        <Botao carregando={lendo} onClick={() => void ler()}>
          Medir de novo
        </Botao>
        <Botao icone={<Copy className="size-4" strokeWidth={1.5} />} disabled={!inspecao} onClick={copiar}>
          Copiar o relatório
        </Botao>
      </div>
    </div>
  );
}

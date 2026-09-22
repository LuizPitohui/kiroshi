import { InlineAlert } from './InlineAlert.js';

/**
 * Estado da conexao de voz, com o que fazer a respeito.
 *
 * Substitui um texto solto na barra de baixo que nao tinha nenhuma acao. A
 * diferenca nao e visual: quando a chamada cai, a pessoa precisa de tres
 * respostas — o que aconteceu, o que continua funcionando, e o que ela pode
 * fazer agora. O texto solto respondia so a primeira, e mal.
 *
 * Duas regras da especificacao estao embutidas aqui:
 *
 *   Nao atribuir a falha ao IPv6 sem evidencia. O diagnostico fica atras de
 *   "Ver diagnostico", com os dados medidos, em vez de virar uma acusacao no
 *   texto principal.
 *
 *   Dizer o que CONTINUA funcionando. "A conexao caiu" sozinho soa como o
 *   aplicativo inteiro ter morrido; a conversa por texto segue de pe, e saber
 *   disso muda o que a pessoa faz em seguida.
 */

export type EstadoDaConexao = 'conectando' | 'reconectando' | 'caiu' | 'instavel';

export interface ConnectionStatusProps {
  estado: EstadoDaConexao;
  /** Detalhe tecnico curto, quando houver. Fica abaixo do texto principal. */
  detalhe?: string | null;
  aoTentarNovamente?: () => void;
  aoVerDiagnostico?: () => void;
  aoSair?: () => void;
  aoDispensar?: () => void;
}

const TEXTO: Record<
  EstadoDaConexao,
  { tipo: 'info' | 'aviso' | 'erro'; titulo: string; corpo: string }
> = {
  conectando: {
    tipo: 'info',
    titulo: 'Entrando na chamada...',
    corpo: 'Negociando o caminho da midia com o servidor.',
  },
  reconectando: {
    tipo: 'aviso',
    titulo: 'Reconectando a chamada...',
    corpo: 'A conexao foi interrompida. Suas mensagens de texto continuam disponiveis.',
  },
  caiu: {
    tipo: 'erro',
    titulo: 'A chamada caiu',
    corpo: 'Suas mensagens de texto continuam disponiveis.',
  },
  instavel: {
    tipo: 'aviso',
    titulo: 'Conexao instavel',
    corpo: 'A voz pode falhar. O servidor esta demorando a responder.',
  },
};

export function ConnectionStatus({
  estado,
  detalhe,
  aoTentarNovamente,
  aoVerDiagnostico,
  aoSair,
  aoDispensar,
}: ConnectionStatusProps) {
  const { tipo, titulo, corpo } = TEXTO[estado];

  const temAcoes = aoTentarNovamente ?? aoVerDiagnostico ?? aoSair;

  return (
    <InlineAlert
      tipo={tipo}
      titulo={titulo}
      /*
        Reconectando e conectando nao se dispensam: a camada some sozinha
        quando o estado muda, e um X ali daria a impressao de cancelar.

        Os outros dois SE dispensam, e "instavel" e o que mais importa aqui.
        Ele nao se resolve sozinho: quem esta em outro continente tem latencia
        alta o tempo todo, e um aviso permanente sobre algo sem conserto e a
        definicao do adesivo colado na tela que este componente veio substituir.
      */
      aoDispensar={estado === 'conectando' || estado === 'reconectando' ? undefined : aoDispensar}
      acoes={
        temAcoes ? (
          <>
            {aoTentarNovamente && (
              <button className="btn btn-primary" onClick={aoTentarNovamente}>
                Tentar novamente
              </button>
            )}
            {aoVerDiagnostico && (
              <button className="btn" onClick={aoVerDiagnostico}>
                Ver diagnostico
              </button>
            )}
            {aoSair && (
              <button className="btn" onClick={aoSair}>
                Sair da chamada
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {corpo}
      {detalhe && <div className="conexao-detalhe">{detalhe}</div>}
    </InlineAlert>
  );
}

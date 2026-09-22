import { useEffect, useState } from 'react';
import { useStore } from '../store/index.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { lerElo, lerLatencia, lerVoz, lerRelogio } from '../lib/estado.js';

/**
 * A faixa de estado: uma linha de instrumento no rodape, sempre visivel.
 *
 * POR QUE EXISTE. O aplicativo media latencia, sabia o estado do elo com o
 * servidor e contava quem estava na sala — e nada disso aparecia a menos que
 * voce ja estivesse numa chamada, olhando para o HUD. O momento em que essa
 * informacao vale e justamente o contrario: quando algo parece errado e a
 * pessoa ainda nao sabe o que. "Travou" e "a internet caiu" sao a mesma
 * experiencia ate alguem conseguir ver a diferenca.
 *
 * O QUE ELA MOSTRA E SO O QUE E MEDIDO. Nenhum numero de enfeite. Uma faixa
 * tecnica com dado inventado fica bonita e ensina a ignorar a faixa inteira;
 * ai, no dia em que a latencia estiver em 400ms, ela vai estar escrita num
 * lugar que ninguem mais le.
 *
 * O relogio e a unica coisa que se mexe. Nao e enfeite: instrumento parado e
 * indistinguivel de instrumento quebrado, e o segundo correndo e a prova mais
 * barata de que a interface ainda esta viva.
 */
export function BarraDeEstado() {
  const conexao = useStore((s) => s.connection);
  const voz = useVoiceState();
  const canal = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));

  const [relogio, setRelogio] = useState(() => lerRelogio());

  useEffect(() => {
    /*
      Alinhado ao segundo do relogio, nao a um intervalo de 1000ms solto.

      Um `setInterval(1000)` que comeca em um instante qualquer erra o momento
      da virada por ate um segundo inteiro, e o numero na tela fica
      permanentemente atrasado em relacao ao relogio do sistema. Quem confere a
      hora no canto do Windows ve dois valores diferentes.

      Reagendar para o proximo segundo cheio a cada tique corrige a deriva
      sozinho, inclusive depois de a maquina dormir — que e quando um intervalo
      fixo acumula o pior erro.
    */
    let timer: ReturnType<typeof setTimeout>;

    const tique = () => {
      setRelogio(lerRelogio());
      timer = setTimeout(tique, 1000 - (Date.now() % 1000));
    };

    timer = setTimeout(tique, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, []);

  const elo = lerElo(conexao);
  const latencia = lerLatencia(voz.ping);
  const naChamada = voz.connected;

  return (
    /*
      `role="status"` com `aria-live="off"`.

      A regiao e marcada como estado para quem quiser consultar de proposito,
      mas NAO anuncia sozinha: o relogio muda a cada segundo, e uma regiao viva
      aqui faria o leitor de tela falar a hora sem parar, tornando o aplicativo
      inutilizavel. Quem precisa ser avisado de queda ja e servido pelos
      anuncios de `anunciar.ts`, que falam uma vez e param.
    */
    <div className="faixa" role="status" aria-live="off">
      <div className={`faixa-elo ${elo.grau}`} title={elo.descricao}>
        <span className="faixa-ponto" aria-hidden="true" />
        <span>{elo.rotulo}</span>
      </div>

      <span className="faixa-sep" aria-hidden="true" />

      <div className="faixa-item" title="Latencia ida e volta ate o servidor de voz">
        <span className="faixa-chave">RTT</span>
        <span className={`faixa-valor ${naChamada ? latencia.grau : ''}`}>{latencia.texto}</span>
      </div>

      <div className="faixa-item" title="Pessoas na chamada, voce incluido">
        <span className="faixa-chave">VOZ</span>
        <span className="faixa-valor">{lerVoz(naChamada, voz.participants.length)}</span>
      </div>

      {/*
        O nome da sala so aparece quando ha sala. Um rotulo com traco ao lado
        ocuparia largura permanente para dizer "nada", e a faixa tem largura
        contada.
      */}
      {naChamada && canal && (
        <div className="faixa-item" title="Sala de voz em que voce esta">
          <span className="faixa-chave">SALA</span>
          <span className="faixa-valor">{canal.name}</span>
        </div>
      )}

      {voz.screenSharing && (
        <div className="faixa-item faixa-ativo" title="Voce esta transmitindo a tela">
          <span className="faixa-ponto vivo" aria-hidden="true" />
          <span>TRANSMITINDO</span>
        </div>
      )}

      <div className="faixa-espaco" />

      <span className="faixa-relogio">{relogio}</span>
    </div>
  );
}

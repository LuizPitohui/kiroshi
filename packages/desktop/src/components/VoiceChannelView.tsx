import { useStore, useVoiceMembersOf } from '../store/index.js';
import { gateway } from '../api/gateway.js';
import { voice } from '../voice/controller.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { Stage } from './Stage.js';
import { CallControls } from './CallControls.js';
import { CallStatus } from './CallStatus.js';
import { EmptyState } from './ui/EmptyState.js';
import { Speaker } from './Icons.js';

/**
 * O canal de voz aberto: estado da conexao, palco e controles, nessa ordem.
 *
 * A ordem nao e estetica. O aviso de conexao vem primeiro porque e o unico
 * que tem urgencia — quando a chamada cai, e o que a pessoa precisa ler antes
 * de qualquer outra coisa. Os controles vem por ultimo porque ficam perto da
 * borda de baixo, onde a mao ja esta.
 *
 * Os tres sao irmaos, e nao filhos do palco, por um motivo concreto: o palco
 * devolve `null` quando nao ha ninguem nele. Se os controles morassem la
 * dentro, entrar em um canal vazio — ou os segundos entre clicar e conectar —
 * deixaria a tela sem nenhum botao, inclusive sem o de sair. Foi assim que
 * este arquivo nasceu: a primeira versao colocava tudo dentro do palco e o
 * centro ficava em branco exatamente durante a conexao, que e quando mais se
 * olha para ele.
 */

interface Props {
  channelId: string;
  guildId: string | null;
}

export function VoiceChannelView({ channelId, guildId }: Props) {
  const voz = useVoiceState();
  const canal = useStore((s) => s.channels.get(channelId));
  const presentes = useVoiceMembersOf(channelId);

  // Estar NO canal e estar na chamada DELE sao coisas diferentes: da para
  // abrir o canal para ver quem esta la sem entrar.
  const nesteCanal = voz.channelId === channelId && (voz.connected || voz.connecting);

  function entrar(): void {
    void voice
      .joinChannel(channelId, guildId)
      .then(() => {
        gateway.updateVoiceState({
          guildId,
          channelId,
          selfMute: voice.getState().selfMuted,
          selfDeaf: voice.getState().selfDeafened,
        });
      })
      .catch(() => undefined);
  }

  return (
    <div className="canal-de-voz">
      <CallStatus />

      <Stage preencher />

      {/*
        O vazio tem duas leituras, e dizer a errada faz a pessoa esperar por
        nada. "Ninguem aqui ainda" quando o canal esta realmente vazio;
        "entre para ouvir" quando ha gente e quem esta olhando e que nao
        entrou.
      */}
      {!nesteCanal && (
        <EmptyState
          icone={<Speaker size={28} />}
          titulo={
            presentes.length > 0
              ? `${presentes.length} ${presentes.length === 1 ? 'pessoa' : 'pessoas'} na chamada`
              : `Ninguem em ${canal?.name ?? 'no canal'} ainda`
          }
          descricao={
            presentes.length > 0
              ? 'Entre para ouvir e falar.'
              : 'Entre e espere — quem chegar vai ver que voce esta aqui.'
          }
          acoes={
            <button className="btn btn-primary" onClick={entrar}>
              Entrar na chamada
            </button>
          }
        />
      )}

      {nesteCanal && <CallControls />}
    </div>
  );
}

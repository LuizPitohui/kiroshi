import { useEffect, useRef } from 'react';
import { useStore, selectors } from '../store/index.js';
import { useVoiceState } from './useVoice.js';
import { anunciar } from '../lib/anunciar.js';
import { voice } from '../voice/controller.js';
import { tocarAviso } from '../voice/sons.js';

/**
 * Fala o que acontece na chamada: quem entra, quem sai, e quando ela cai.
 *
 * Vale para a chamada inteira, nao so para o canal aberto — por isso mora no
 * `MainScreen` e nao no palco. Saber que alguem entrou na sua chamada
 * enquanto voce le outro canal e exatamente a informacao que se perde quando
 * nao se esta olhando para a tela.
 *
 * Quem sai e anunciado junto com quem entra, na mesma passada: em uma troca
 * de pessoas os dois acontecem no mesmo instante, e dois anuncios seguidos
 * atropelariam um ao outro.
 *
 * A queda interrompe. E a unica coisa aqui urgente o bastante para cortar a
 * frase que estiver sendo lida: quem esta falando precisa saber AGORA que
 * ninguem mais esta ouvindo.
 */
export function useAnunciarChamada(): void {
  const voz = useVoiceState();
  const store = useStore();

  const anteriores = useRef<Set<string> | null>(null);
  const estavaConectado = useRef(false);
  const erroAnterior = useRef<string | null>(null);

  // Em ref: a funcao de nome depende do estado inteiro, que muda o tempo todo,
  // e nao deve reiniciar a comparacao de participantes.
  const nomeDe = useRef((id: string) => selectors.displayNameOf(store, id, null));
  nomeDe.current = (id: string) => selectors.displayNameOf(store, id, null);

  useEffect(() => {
    const agora = new Set(voz.participants.filter((p) => !p.isLocal).map((p) => p.userId));

    // Primeira leitura depois de entrar: marca quem ja estava, sem anunciar.
    // Anunciar aqui leria a lista inteira de quem ja estava na sala.
    if (anteriores.current === null) {
      if (voz.connected) anteriores.current = agora;
      return;
    }

    if (!voz.connected) {
      anteriores.current = null;
      return;
    }

    const entraram = [...agora].filter((id) => !anteriores.current!.has(id));
    const sairam = [...anteriores.current].filter((id) => !agora.has(id));
    anteriores.current = agora;

    /*
      O som sai daqui, do mesmo lugar que ja compara os participantes.

      Podia ter um efeito proprio escutando a mesma lista, mas ai seriam duas
      comparacoes que precisam concordar para sempre — e no dia em que uma
      mudasse, o leitor de tela diria uma coisa e o som diria outra.

      Entrada e saida tocam mesmo quando varias pessoas se mexem de uma vez:
      um aviso por evento, nao por pessoa. Cinco pessoas entrando nao viram
      cinco bipes.
    */
    if (voice.getSettings().avisosSonoros) {
      if (entraram.length > 0) tocarAviso('entrada');
      if (sairam.length > 0) tocarAviso('saida');
    }

    const partes: string[] = [];
    if (entraram.length === 1) partes.push(`${nomeDe.current(entraram[0]!)} entrou na chamada`);
    else if (entraram.length > 1) partes.push(`${entraram.length} pessoas entraram na chamada`);

    if (sairam.length === 1) partes.push(`${nomeDe.current(sairam[0]!)} saiu da chamada`);
    else if (sairam.length > 1) partes.push(`${sairam.length} pessoas sairam da chamada`);

    if (partes.length > 0) anunciar(partes.join('. '));
  }, [voz.participants, voz.connected]);

  // Entrou e saiu da propria chamada.
  useEffect(() => {
    const comSom = voice.getSettings().avisosSonoros;

    if (voz.connected && !estavaConectado.current) {
      anunciar('Voce entrou na chamada');
      if (comSom) tocarAviso('entrada');
    }
    if (!voz.connected && estavaConectado.current && !voz.error) {
      anunciar('Voce saiu da chamada');
      if (comSom) tocarAviso('saida');
    }
    estavaConectado.current = voz.connected;
  }, [voz.connected, voz.error]);

  // A queda corta o que estiver sendo lido.
  useEffect(() => {
    if (voz.error && voz.error !== erroAnterior.current) {
      anunciar('A chamada caiu. Suas mensagens de texto continuam disponiveis.', 'urgente');
    }
    erroAnterior.current = voz.error;
  }, [voz.error]);
}

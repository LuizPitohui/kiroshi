import { useStore } from '../store/index.js';
import { useVoiceState } from './useVoice.js';

/**
 * A chamada esta rodando em um canal que NAO e o que estou olhando?
 *
 * Duas telas precisam da mesma resposta e precisam concordar: o dock, que so
 * existe nessa situacao, e o palco menor, que nessa situacao esconde a propria
 * barra para nao repetir o que o dock ja diz.
 *
 * Elas concordarem importa mais do que parece. Quando cada uma calculava a
 * condicao por conta propria, o resultado eram duas faixas empilhadas dizendo
 * a mesma coisa — "Geral · 1 na chamada" em cima de "Na chamada · Geral · 1
 * pessoa" — gastando duas linhas de altura para uma informacao so.
 */
export function useChamadaDeFundo(): boolean {
  const voz = useVoiceState();
  const selecionado = useStore((s) => s.selectedChannelId);

  return Boolean((voz.connected || voz.connecting) && voz.channelId && voz.channelId !== selecionado);
}

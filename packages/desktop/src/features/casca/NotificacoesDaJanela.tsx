import { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { silenciado } from '../../lib/notificar.js';
import { assinarPreferenciasDeNotificacao, lerPreferenciasDeNotificacao } from '../../lib/preferenciasDeNotificacao.js';

/**
 * O que a janela faz pelas notificacoes, montado uma vez na casca (sem
 * desenhar nada):
 *
 * - o clique na notificacao do Windows abre a conversa dela — antes so trazia
 *   a janela para a frente, e a pessoa ainda tinha de achar onde era;
 * - o selo de mencoes no icone da barra de tarefas, que nunca tinha sido
 *   ligado (a ponte existia e ninguem chamava). Conversa ou servidor
 *   silenciado nao conta.
 */
export function NotificacoesDaJanela() {
  const [contador, setContador] = useState(() => lerPreferenciasDeNotificacao().contador);
  const total = useStore((s) => {
    const agora = Date.now();
    let soma = 0;
    for (const [channelId, leitura] of s.readStates) {
      if (!leitura.mentionCount) continue;
      const canal = s.channels.get(channelId);
      if (!canal) continue;
      if (silenciado(s.notificacoesDoCanal.get(channelId), agora)) continue;
      if (canal.guildId && silenciado(s.notificacoesDoServidor.get(canal.guildId), agora)) continue;
      soma += leitura.mentionCount;
    }
    return soma;
  });

  useEffect(
    () =>
      window.kiroshi?.notifications.aoAbrir?.((alvo) => {
        if (alvo.startsWith('#/')) location.hash = alvo;
      }),
    [],
  );
  useEffect(() => assinarPreferenciasDeNotificacao(() => setContador(lerPreferenciasDeNotificacao().contador)), []);

  useEffect(() => {
    window.kiroshi?.notifications.setBadge(contador ? total : 0);
  }, [contador, total]);

  return null;
}

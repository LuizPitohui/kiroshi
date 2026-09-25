/**
 * Raiz da interface nova: sessao, gateway, provedores globais (dicas, avisos,
 * regioes faladas) e a escolha entre entrada, casca e vitrine.
 *
 * O caminho de sessao e o mesmo da 1.x, que ja provou que funciona:
 * `installGatewayHandlers` liga os eventos ao store (tem guarda contra
 * dupla instalacao), `onTokensChanged` acompanha login e logout, e o gateway
 * conecta quando ha sessao.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { gateway } from '../api/gateway.js';
import { installGatewayHandlers } from '../api/events.js';
import { useStore } from '../store/index.js';
import { Avisos, ProvedorDeDicas } from '../design/primitivos/index.js';
import { Anunciador } from './Anunciador.js';
import { Casca, restaurarUltimaRota } from '../features/casca/Casca.js';
import { Entrada } from '../features/entrada/Entrada.js';

const Vitrine = lazy(() => import('../features/vitrine/Vitrine.js'));

export function Raiz(): React.JSX.Element {
  const vitrine = typeof location !== 'undefined' && new URLSearchParams(location.search).has('vitrine');
  const [logado, setLogado] = useState(() => api.isAuthenticated());

  useEffect(() => {
    if (vitrine) return undefined;
    installGatewayHandlers();
    restaurarUltimaRota();
    return api.onTokensChanged((tokens) => {
      const agora = tokens !== null;
      setLogado(agora);
      if (!agora) {
        gateway.disconnect();
        useStore.getState().reset();
      }
    });
  }, [vitrine]);

  useEffect(() => {
    if (!vitrine && logado) void gateway.connect();
  }, [vitrine, logado]);

  if (vitrine) {
    return (
      <Suspense fallback={null}>
        <Vitrine />
      </Suspense>
    );
  }

  return (
    <ProvedorDeDicas>
      <Anunciador />
      {logado ? <Casca /> : <Entrada />}
      <Avisos />
    </ProvedorDeDicas>
  );
}

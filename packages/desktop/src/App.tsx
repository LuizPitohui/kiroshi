import { useEffect, useState } from 'react';
import { api } from './api/client.js';
import { gateway } from './api/gateway.js';
import { installGatewayHandlers } from './api/events.js';
import { useStore } from './store/index.js';
import { TitleBar } from './components/TitleBar.js';
import { AvisoDeAtualizacao } from './components/AvisoDeAtualizacao.js';
import { ToastProvider } from './components/ui/Toast.js';
import { Anunciador } from './components/ui/Anunciador.js';
import { VitrineScreen } from './screens/VitrineScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { MainScreen } from './screens/MainScreen.js';

export function App() {
  const [authenticated, setAuthenticated] = useState(() => api.isAuthenticated());
  const connection = useStore((s) => s.connection);
  const reset = useStore((s) => s.reset);

  // Tema escolhido nas preferencias, aplicado no elemento raiz.
  useEffect(() => {
    const theme = localStorage.getItem('kiroshi.theme') ?? 'dark';
    document.documentElement.dataset.theme = theme;
  }, []);

  useEffect(() => {
    installGatewayHandlers();

    return api.onTokensChanged((tokens) => {
      const nowAuthenticated = tokens !== null;
      setAuthenticated(nowAuthenticated);
      if (!nowAuthenticated) {
        gateway.disconnect();
        reset();
      }
    });
  }, [reset]);

  useEffect(() => {
    if (authenticated) void gateway.connect();
  }, [authenticated]);

  /*
    A vitrine dos componentes, aberta por "?vitrine" no endereco.

    Fora do fluxo do produto de proposito: ela existe para ver as pecas juntas
    e para o teste automatizado dirigir todas sem precisar de servidor, conta
    nem dados. Nao aparece em nenhum menu e nao tem link para ela.
  */
  if (typeof location !== 'undefined' && location.search.includes('vitrine')) {
    return (
      <ToastProvider>
        <div className="app">
          <TitleBar connection={connection} />
          {/* Tambem na vitrine: e onde o teste dirige os anuncios sem conta. */}
          <Anunciador />
          <VitrineScreen />
        </div>
      </ToastProvider>
    );
  }

  return (
    <div className="app">
      <TitleBar connection={connection} />
      {/*
        As regioes onde o aplicativo fala, montadas vazias desde o inicio.

        A ordem importa: uma regiao `aria-live` criada junto com o texto nao e
        anunciada — o leitor de tela so observa regioes que ja existiam quando
        o conteudo mudou. Por isso elas vivem aqui, fora de qualquer tela, e
        nunca desmontam.
      */}
      <Anunciador />

      {/*
        Fora da area autenticada de proposito: a atualizacao independe de estar
        logado, e quem parou na tela de entrada tambem deve receber a correcao.
      */}
      <AvisoDeAtualizacao />
      {authenticated ? (
        <MainScreen />
      ) : (
        <AuthScreen onAuthenticated={() => setAuthenticated(true)} />
      )}
    </div>
  );
}

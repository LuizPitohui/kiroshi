import { useSyncExternalStore } from 'react';

/**
 * A janela tem espaco para o painel da direita ao lado da conversa?
 *
 * O design (secao 3): de 1280 px para cima tudo em colunas; abaixo disso o
 * painel da direita vira gaveta. Com o painel fixo numa janela de 960 px a
 * conversa ficava com 340 px e cada mensagem quebrava em tres linhas.
 */
const CONSULTA = '(min-width: 1280px)';

function assinar(avisar: () => void): () => void {
  const m = matchMedia(CONSULTA);
  m.addEventListener('change', avisar);
  return () => m.removeEventListener('change', avisar);
}

export function useTelaLarga(): boolean {
  return useSyncExternalStore(
    assinar,
    () => matchMedia(CONSULTA).matches,
    () => true,
  );
}

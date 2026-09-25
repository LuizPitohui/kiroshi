import { useEffect, useState } from 'react';
import { assinarAnuncios, type Anuncio } from '../lib/anunciar.js';

/**
 * As regioes onde o app FALA para quem usa leitor de tela: uma educada (entrou
 * na chamada, mensagem nova) e uma urgente (a chamada caiu).
 *
 * Montadas vazias desde o inicio e nunca desmontadas: uma regiao `aria-live`
 * criada junto com o texto nao e anunciada, porque o leitor so observa
 * regioes que ja existiam quando o conteudo mudou. A fila e a logica vem da
 * 1.x (`lib/anunciar.ts`), testada.
 */
export function Anunciador(): React.JSX.Element {
  const [educado, setEducado] = useState('');
  const [urgente, setUrgente] = useState('');

  useEffect(
    () =>
      assinarAnuncios((anuncio: Anuncio) => {
        // Caractere invisivel alternado: o mesmo anuncio duas vezes seguidas
        // ("fulano entrou" de novo) muda o conteudo e e falado outra vez.
        const conteudo = anuncio.texto + '​'.repeat(anuncio.id % 2 === 0 ? 1 : 2);
        if (anuncio.urgencia === 'urgente') setUrgente(conteudo);
        else setEducado(conteudo);
      }),
    [],
  );

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {educado}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {urgente}
      </div>
    </>
  );
}

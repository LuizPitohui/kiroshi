import { useEffect, useState } from 'react';
import { assinarAnuncios, type Anuncio } from '../../lib/anunciar.js';

/**
 * As duas regioes onde o aplicativo fala.
 *
 * Invisiveis na tela e presentes na arvore de acessibilidade. Ficam montadas
 * o tempo todo, vazias, e recebem texto quando ha o que dizer — e essa ordem
 * e a parte que quase todo mundo erra: uma regiao `aria-live` criada JUNTO
 * com o texto nao e anunciada, porque o leitor de tela so observa regioes que
 * ja existiam quando o conteudo mudou. Por isso elas nascem com o aplicativo
 * e nunca desmontam.
 *
 * Duas, e nao uma, porque `polite` e `assertive` sao filas diferentes no
 * leitor de tela. A educada espera a frase atual terminar; a assertiva
 * interrompe. Usar uma so obrigaria a escolher entre atrapalhar sempre ou
 * nunca avisar de nada urgente.
 *
 * `aria-atomic` faz o leitor ler a regiao inteira a cada mudanca, em vez de
 * tentar adivinhar qual pedaco e novo. Sem isso, textos que compartilham o
 * comeco — "3 mensagens novas de a" e "4 mensagens novas de a" — saem pela
 * metade.
 */
export function Anunciador() {
  const [educado, setEducado] = useState('');
  const [urgente, setUrgente] = useState('');

  useEffect(() => {
    return assinarAnuncios((anuncio: Anuncio) => {
      /*
        O id vai junto do texto, invisivel.

        Leitor de tela so fala quando o conteudo MUDA. Dois anuncios iguais
        seguidos — "vartaque entrou na chamada" duas vezes — e o segundo
        passaria em silencio, que e justamente o tipo de falha que nao aparece
        em teste nenhum e some do radar de quem enxerga.

        O caractere invisivel resolve sem sujar a leitura: ele nao e falado.
      */
      const conteudo = anuncio.texto + '​'.repeat(anuncio.id % 2 === 0 ? 1 : 2);
      if (anuncio.urgencia === 'urgente') setUrgente(conteudo);
      else setEducado(conteudo);
    });
  }, []);

  return (
    <>
      <div className="visualmente-oculto" role="status" aria-live="polite" aria-atomic="true">
        {educado}
      </div>
      <div className="visualmente-oculto" role="alert" aria-live="assertive" aria-atomic="true">
        {urgente}
      </div>
    </>
  );
}

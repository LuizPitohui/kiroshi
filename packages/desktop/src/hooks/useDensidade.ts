import { useEffect, useState } from 'react';
import { aplicarDensidade, type Densidade } from '../lib/leitura.js';

/**
 * A densidade escolhida, para quem precisa do valor e nao so do estilo.
 *
 * Quase tudo na densidade e CSS, decidido pela marca `data-densidade` no
 * documento. A excecao e o avatar da mensagem, que recebe o tamanho em pixels
 * por propriedade: um numero em JavaScript nao se sobrescreve com uma regra
 * de folha de estilo.
 *
 * Ouve a troca em vez de so ler uma vez, para a mudanca nos ajustes valer na
 * conversa que ja esta aberta. Sem isso a pessoa troca a opcao, volta, e ve a
 * mesma tela de antes.
 */
export function useDensidade(): Densidade {
  const [densidade, setDensidade] = useState<Densidade>(aplicarDensidade.ler);

  useEffect(() => {
    const aoMudar = (e: Event): void => setDensidade((e as CustomEvent<Densidade>).detail);
    window.addEventListener('kiroshi:densidade', aoMudar);
    return () => window.removeEventListener('kiroshi:densidade', aoMudar);
  }, []);

  return densidade;
}

/** O tamanho do avatar de mensagem em cada densidade. */
export function tamanhoDoAvatar(densidade: Densidade): number {
  return densidade === 'compacto' ? 28 : 40;
}

import { useEffect, useRef } from 'react';
import type { Message } from '@kiroshi/shared';
import { compareIds } from '@kiroshi/shared';
import { anunciar, resumirChegadas, type ChegadaParaAnunciar } from '../lib/anunciar.js';

/** Quanto tempo esperar juntando mensagens antes de falar. */
const JANELA = 1200;

/**
 * Fala as mensagens que chegam no canal aberto.
 *
 * Tres regras, e todas existem para o anuncio nao virar barulho.
 *
 * **Nada na primeira carga.** Abrir um canal traz cinquenta mensagens de uma
 * vez; anunciar aquilo seria despejar a conversa inteira em voz alta no
 * momento em que a pessoa acabou de chegar.
 *
 * **As minhas nao contam.** Voce sabe o que escreveu.
 *
 * **Chegadas proximas viram uma frase so.** Em conversa animada chegam cinco
 * mensagens em dois segundos, e cinco anuncios enfileiram meio minuto de fala
 * que nao da para interromper nem pular. O resumo diz o que aconteceu; o
 * conteudo continua na tela para ser lido no ritmo de quem le.
 */
export function useAnunciarMensagens(
  channelId: string | null,
  itens: readonly Message[] | undefined,
  euSou: string | null,
  nomeDe: (userId: string) => string,
): void {
  /** Ate onde ja foi visto. `null` enquanto o canal nao carregou. */
  const visto = useRef<{ canal: string | null; ultimo: string | null }>({
    canal: null,
    ultimo: null,
  });
  const fila = useRef<ChegadaParaAnunciar[]>([]);
  const relogio = useRef<number | null>(null);

  // Em ref porque muda a cada render e nao deve reiniciar o efeito.
  const traduzirNome = useRef(nomeDe);
  traduzirNome.current = nomeDe;

  useEffect(() => {
    return () => {
      if (relogio.current !== null) window.clearTimeout(relogio.current);
    };
  }, []);

  useEffect(() => {
    if (!channelId || !itens || itens.length === 0) return;

    const ultimo = itens[itens.length - 1]!.id;

    // Canal novo: marca onde estamos e nao fala nada desta leva.
    if (visto.current.canal !== channelId) {
      visto.current = { canal: channelId, ultimo };
      fila.current = [];
      return;
    }

    const marca = visto.current.ultimo;
    if (!marca || compareIds(ultimo, marca) <= 0) return;

    const novas = itens.filter(
      (m) => compareIds(m.id, marca) > 0 && m.authorId !== euSou,
    );
    visto.current = { canal: channelId, ultimo };
    if (novas.length === 0) return;

    for (const m of novas) {
      fila.current.push({ autor: traduzirNome.current(m.authorId), texto: m.content ?? '' });
    }

    /*
      Reinicia a contagem a cada chegada.

      Assim uma rajada e falada UMA vez, quando ela termina, em vez de uma vez
      por mensagem. Se alguem esta escrevendo sem parar, a fala espera a pausa
      — que e quando a pessoa tem atencao para ouvir.
    */
    if (relogio.current !== null) window.clearTimeout(relogio.current);
    relogio.current = window.setTimeout(() => {
      const texto = resumirChegadas(fila.current);
      fila.current = [];
      relogio.current = null;
      anunciar(texto);
    }, JANELA);
  }, [channelId, itens, euSou]);
}

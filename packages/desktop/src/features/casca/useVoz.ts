import { useRef, useSyncExternalStore } from 'react';
import { voice, type VoiceState } from '../../voice/controller.js';

/**
 * Um pedaco do estado da voz, re-renderizando so quando ESSE pedaco muda.
 *
 * O motor de voz emite a cada 200 ms (niveis de audio, ping). O
 * `useVoiceState` da interface 1.x entregava o objeto inteiro, e o app todo
 * redesenhava cinco vezes por segundo com uma chamada aberta — custo que
 * disputava CPU com o codificador de quem transmite. Aqui cada componente pede
 * o que usa (`useVoz((v) => v.connected)`) e so acorda quando o valor muda.
 *
 * `igual` compara o valor novo com o anterior; o padrao e `Object.is`. Para
 * listas, passe `rasoIgual` (organizar.ts).
 */
export function useVoz<T>(seletor: (estado: VoiceState) => T, igual: (a: T, b: T) => boolean = Object.is): T {
  const memoria = useRef<{ estado: VoiceState; valor: T } | null>(null);

  const ler = (): T => {
    const estado = voice.getState();
    const anterior = memoria.current;
    if (anterior && anterior.estado === estado) return anterior.valor;
    const valor = seletor(estado);
    if (anterior && igual(anterior.valor, valor)) {
      memoria.current = { estado, valor: anterior.valor };
      return anterior.valor;
    }
    memoria.current = { estado, valor };
    return valor;
  };

  return useSyncExternalStore((avisar) => voice.subscribe(avisar), ler, ler);
}


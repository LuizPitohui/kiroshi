import { useState } from 'react';
import { Play } from 'lucide-react';
import type { SoundboardSound } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { voice } from '../../voice/controller.js';
import { avisar, cx } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { motivo } from '../conversa/acoes.js';

const VAZIO: SoundboardSound[] = [];
/** Um som por vez, e um respiro entre eles: soundboard nao e metralhadora. */
const INTERVALO_MS = 1500;

/**
 * Os sons do servidor, na barra da chamada. A 1.x tinha a biblioteca e
 * nenhuma tela que tocasse um som na chamada (06-auditoria).
 *
 * Tocar manda para todos na chamada (o servidor confere permissao e canal);
 * quem tocou ouve aqui mesmo, na saida da chamada. A setinha toca so para
 * voce, para conhecer o som antes. Como no Discord, com microfone ou som
 * desligados nao se toca para os outros.
 */
export function Soundboard({ canalId, guildId }: { canalId: string; guildId: string | null }) {
  const sons = useStore((s) => (guildId ? (s.guilds.get(guildId)?.sounds ?? VAZIO) : VAZIO));
  const mudo = useVoz((v) => v.selfMuted);
  const surdo = useVoz((v) => v.selfDeafened);
  const [esperando, setEsperando] = useState(false);
  const bloqueado = mudo || surdo;

  async function tocar(som: SoundboardSound) {
    if (bloqueado || esperando) return;
    setEsperando(true);
    setTimeout(() => setEsperando(false), INTERVALO_MS);
    try {
      await api.post(`/channels/${canalId}/soundboard`, { soundId: som.id });
      void voice.playSound(som.url, som.volume);
    } catch (e) {
      avisar.erro('O som não tocou', motivo(e, 'Tente de novo.'));
    }
  }

  return (
    <div className="w-[360px]">
      <p className="k-rotulo border-b border-borda px-4 py-3">Soundboard</p>
      {sons.length === 0 ? (
        <p className="px-4 py-6 text-13 text-texto-3">
          Este servidor ainda não tem sons. Quem tem permissão envia pelos ajustes do servidor.
        </p>
      ) : (
        <>
          {bloqueado ? (
            <p className="border-b border-borda bg-acento-tenue px-4 py-2 text-12 text-texto-2">
              Com o {mudo ? 'microfone' : 'som'} desligado, os sons não tocam para os outros.
            </p>
          ) : null}
          <ul className="k-rolagem grid max-h-[280px] grid-cols-2 gap-1.5 overflow-y-auto p-2">
            {sons.map((som) => (
              <li key={som.id} className="flex">
                <button
                  type="button"
                  disabled={bloqueado || esperando}
                  onClick={() => void tocar(som)}
                  className={cx(
                    'flex h-10 min-w-0 flex-1 items-center gap-2 border border-borda bg-terminal px-2.5 text-left text-13 text-texto',
                    'hover:border-acento disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                >
                  <span aria-hidden className="text-[18px] leading-none">
                    {som.emoji ?? '♪'}
                  </span>
                  <span className="truncate">{som.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Ouvir ${som.name} só para mim`}
                  title="Ouvir só para mim"
                  onClick={() => void voice.playSound(som.url, som.volume)}
                  className="grid w-8 place-items-center border border-l-0 border-borda bg-terminal text-texto-3 hover:text-texto"
                >
                  <Play aria-hidden className="size-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

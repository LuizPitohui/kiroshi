import { useEffect, useMemo, useRef, useState } from 'react';
import { emojiCombina, normalizar } from './emoji-palavras.js';
import { useStore } from '../store/index.js';
import { GRUPOS_DE_EMOJI } from '../lib/emojis.js';

interface Props {
  guildId: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * Seletor de emoji.
 *
 * A lista unicode e embutida em vez de vir de um pacote: sao algumas centenas
 * de caracteres, o que pesa menos que a dependencia e nao exige download em
 * tempo de execucao. Os emojis do servidor aparecem antes, porque sao os que
 * as pessoas mais usam no dia a dia.
 */

export const GROUPS = GRUPOS_DE_EMOJI;

export function EmojiPicker({ guildId, onPick, onClose }: Props) {
  const guilds = useStore((s) => s.guilds);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Emojis do servidor atual primeiro, depois os dos outros servidores.
  const customEmojis = useMemo(() => {
    const current = guildId ? (guilds.get(guildId)?.emojis ?? []) : [];
    const others = [...guilds.values()]
      .filter((g) => g.id !== guildId)
      .flatMap((g) => g.emojis);
    return [...current, ...others];
  }, [guilds, guildId]);

  const busca = normalizar(query.trim());

  const filteredCustom = busca
    ? customEmojis.filter((e) => normalizar(e.name).includes(busca))
    : customEmojis;

  /*
    A busca antes olhava so o nome do grupo, e grupo se chama "Rostos" ou
    "Gestos" — entao digitar "feliz" ou "coracao" nao achava nada e a caixa de
    busca parecia quebrada. Agora cada emoji tem palavras proprias; o nome do
    grupo continua valendo para quem digita "festa" e quer a secao inteira.

    Grupos que ficam sem nenhum resultado somem, senao a tela enche de titulos
    vazios e esconde o que de fato casou.
  */
  const filteredGroups = busca
    ? GROUPS.map((group) => ({
        ...group,
        emojis: normalizar(group.name).includes(busca)
          ? group.emojis
          : group.emojis.filter((e) => emojiCombina(e, busca)),
      })).filter((group) => group.emojis.length > 0)
    : GROUPS;

  const nadaEncontrado =
    busca.length > 0 && filteredCustom.length === 0 && filteredGroups.length === 0;

  return (
    <div
      ref={ref}
      className="menu"
      style={{
        width: 340,
        maxHeight: 400,
        overflowY: 'auto',
        right: 16,
        bottom: 80,
        padding: 10,
      }}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar emoji"
        autoFocus
        style={{ marginBottom: 10, fontSize: 13, padding: '7px 9px' }}
      />

      {filteredCustom.length > 0 && (
        <>
          <div className="settings-group" style={{ padding: '4px 2px' }}>
            Deste servidor
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 8 }}>
            {filteredCustom.slice(0, 60).map((emoji) => (
              <button
                key={emoji.id}
                onClick={() => onPick(`<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`)}
                title={`:${emoji.name}:`}
                style={{
                  width: 34,
                  height: 34,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 4,
                }}
              >
                <img src={emoji.url} alt={emoji.name} style={{ width: 24, height: 24 }} />
              </button>
            ))}
          </div>
        </>
      )}

      {nadaEncontrado && (
        <div
          style={{
            padding: '18px 8px',
            textAlign: 'center',
            color: 'var(--text-faint)',
            fontSize: 13,
          }}
        >
          Nada para “{query.trim()}”.
          <div style={{ marginTop: 4, fontSize: 12 }}>
            Tente o que o desenho mostra: risada, coracao, fogo, joia.
          </div>
        </div>
      )}

      {filteredGroups.map((group) => (
        <div key={group.name}>
          <div className="settings-group" style={{ padding: '4px 2px' }}>
            {group.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 8 }}>
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onPick(emoji)}
                style={{
                  width: 34,
                  height: 34,
                  fontSize: 22,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 4,
                  lineHeight: 1,
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

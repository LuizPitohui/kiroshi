import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { LIMITS, type Emoji } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { Botao, BotaoIcone, Confirmacao, EstadoVazio, avisar } from '../../design/primitivos/index.js';
import { lerImagem } from '../../lib/arquivos.js';
import { apagarEmoji, enviarEmoji, renomearEmoji } from './acoes.js';

const VAZIA: Emoji[] = [];

/** O nome do emoji a partir do arquivo, no formato que o servidor aceita. */
function nomeDoArquivo(arquivo: File, usados: Set<string>): string {
  const base = arquivo.name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  let nome = base.length >= 2 ? base : 'emoji';
  for (let n = 2; usados.has(nome); n++) nome = `${base.slice(0, 29) || 'emoji'}_${n}`;
  return nome;
}

function LinhaDoEmoji({ guildId, emoji }: { guildId: string; emoji: Emoji }) {
  const autor = useStore((s) => (emoji.creatorId ? selectors.displayNameOf(s, emoji.creatorId, guildId) : null));
  const [nome, setNome] = useState(emoji.name);
  const [apagando, setApagando] = useState(false);
  const valido = /^[a-zA-Z0-9_]{2,32}$/.test(nome);

  return (
    <li className="flex items-center gap-3 border-b border-borda px-3 py-2 last:border-b-0">
      <img src={emoji.url} alt="" className="size-8 shrink-0 object-contain" />
      <label className="flex min-w-0 flex-1 items-center font-mono text-13 text-texto-3">
        :
        <input
          value={nome}
          aria-label={`Nome do emoji ${emoji.name}`}
          aria-invalid={!valido}
          maxLength={32}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => {
            if (!valido || nome === emoji.name) return setNome(emoji.name);
            void renomearEmoji(guildId, emoji.id, nome).then((ok) => !ok && setNome(emoji.name));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="min-w-0 flex-1 bg-transparente text-texto outline-none focus:bg-terminal"
        />
        :
      </label>
      <span className="hidden truncate text-12 text-texto-3 sm:block">{autor ? `por ${autor}` : ''}</span>
      <BotaoIcone rotulo={`Apagar :${emoji.name}:`} tamanho="sm" icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={() => setApagando(true)} />
      <Confirmacao
        aberto={apagando}
        aoMudar={setApagando}
        titulo={`Apagar :${emoji.name}:?`}
        descricao="Some das mensagens e das reações em que foi usado."
        confirmar="Apagar"
        perigo
        aoConfirmar={() => apagarEmoji(guildId, emoji.id)}
      />
    </li>
  );
}

/** Emojis do servidor: enviar varios de uma vez, renomear no lugar, apagar. */
export function PaginaEmojis({ guildId }: { guildId: string }) {
  const emojis = useStore((s) => s.guilds.get(guildId)?.emojis ?? VAZIA);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);

  async function enviar(arquivos: File[]) {
    const usados = new Set(emojis.map((e) => e.name));
    setEnviando(arquivos.length);
    for (const arquivo of arquivos) {
      try {
        const imagem = await lerImagem(arquivo, LIMITS.emojiBytes);
        const nome = nomeDoArquivo(arquivo, usados);
        usados.add(nome);
        await enviarEmoji(guildId, nome, imagem);
      } catch (erro) {
        avisar.erro(`Não deu para usar ${arquivo.name}`, erro instanceof Error ? erro.message : undefined);
      }
      setEnviando((n) => n - 1);
    }
  }

  const ordenados = [...emojis].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-13 text-texto-3">
          {emojis.length} de {LIMITS.emojisPerGuild}. PNG, JPG, GIF ou WebP até {LIMITS.emojiBytes / 1024} KB; o nome do arquivo vira o nome do emoji.
        </p>
        <Botao
          variante="primario"
          carregando={enviando > 0}
          disabled={emojis.length >= LIMITS.emojisPerGuild}
          icone={<ImagePlus className="size-4" strokeWidth={1.5} />}
          onClick={() => entrada.current?.click()}
        >
          Enviar emoji
        </Botao>
        <input
          ref={entrada}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const arquivos = [...(e.target.files ?? [])];
            e.target.value = '';
            if (arquivos.length) void enviar(arquivos);
          }}
        />
      </div>
      {ordenados.length ? (
        <ul className="border border-borda bg-deck">
          {ordenados.map((e) => (
            <LinhaDoEmoji key={e.id} guildId={guildId} emoji={e} />
          ))}
        </ul>
      ) : (
        <div className="h-64 border border-borda">
          <EstadoVazio rotulo="emojis" titulo="Nenhum emoji ainda">
            Os emojis do servidor aparecem no seletor e nas reações de todo mundo daqui.
          </EstadoVazio>
        </div>
      )}
    </div>
  );
}

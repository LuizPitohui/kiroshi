import { useRef, useState } from 'react';
import { Music, Play, Trash2 } from 'lucide-react';
import { LIMITS, type SoundboardSound } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { Botao, BotaoIcone, Confirmacao, Deslizante, EstadoVazio, avisar } from '../../design/primitivos/index.js';
import { lerSom } from '../../lib/arquivos.js';
import { voice } from '../../voice/controller.js';
import { apagarSom, editarSom, enviarSom } from './acoes.js';

const VAZIA: SoundboardSound[] = [];
const segundos = (s: number) => (s > 0 ? `${s.toFixed(1).replace('.', ',')} s` : '—');

function nomeDoArquivo(arquivo: File, usados: Set<string>): string {
  const base = arquivo.name.replace(/\.[^.]+$/, '').trim().slice(0, 32) || 'som';
  let nome = base.length >= 2 ? base : `${base}_som`;
  for (let n = 2; usados.has(nome); n++) nome = `${base.slice(0, 28)} ${n}`;
  return nome;
}

function LinhaDoSom({ guildId, som }: { guildId: string; som: SoundboardSound }) {
  const autor = useStore((s) => (som.creatorId ? selectors.displayNameOf(s, som.creatorId, guildId) : null));
  const [nome, setNome] = useState(som.name);
  const [emoji, setEmoji] = useState(som.emoji ?? '');
  const [volume, setVolume] = useState(Math.round(som.volume * 100));
  const [apagando, setApagando] = useState(false);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_160px_auto] items-center gap-3 border-b border-borda px-3 py-2 last:border-b-0">
      <input
        value={emoji}
        aria-label={`Emoji do som ${som.name}`}
        placeholder="🔊"
        maxLength={8}
        onChange={(e) => setEmoji(e.target.value)}
        onBlur={() => {
          if (emoji.trim() !== (som.emoji ?? '')) void editarSom(guildId, som.id, { emoji: emoji.trim() || null });
        }}
        className="size-9 border border-borda bg-terminal text-center text-18 outline-none focus:border-acento"
      />
      <div className="min-w-0">
        <input
          value={nome}
          aria-label={`Nome do som ${som.name}`}
          maxLength={32}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => {
            const limpo = nome.trim();
            if (limpo.length < 2 || limpo === som.name) return setNome(som.name);
            void editarSom(guildId, som.id, { name: limpo }).then((ok) => !ok && setNome(som.name));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-full bg-transparente text-14 text-texto outline-none focus:bg-terminal"
        />
        <p className="truncate font-mono text-11 text-texto-3">
          {segundos(som.durationSecs)}
          {autor ? ` · por ${autor}` : ''}
        </p>
      </div>
      <Deslizante
        rotulo="Volume"
        valor={volume}
        min={0}
        max={100}
        passo={5}
        formatar={(v) => `${Math.round(v)}%`}
        aoMudar={setVolume}
        aoSoltar={(v) => void editarSom(guildId, som.id, { volume: v / 100 })}
      />
      <div className="flex gap-1">
        <BotaoIcone rotulo={`Ouvir ${som.name}`} tamanho="sm" icone={<Play className="size-4" strokeWidth={1.5} />} onClick={() => void voice.playSound(som.url, volume / 100)} />
        <BotaoIcone rotulo={`Apagar ${som.name}`} tamanho="sm" icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={() => setApagando(true)} />
      </div>
      <Confirmacao
        aberto={apagando}
        aoMudar={setApagando}
        titulo={`Apagar ${som.name}?`}
        descricao="Sai do soundboard de todo mundo deste servidor."
        confirmar="Apagar"
        perigo
        aoConfirmar={() => apagarSom(guildId, som.id)}
      />
    </li>
  );
}

/**
 * Sons do soundboard: enviar (MP3, OGG, WAV ou WebM, ate 5 s — a duracao e
 * medida aqui, decodificando), renomear, emoji, volume, ouvir e apagar.
 */
export function PaginaSons({ guildId }: { guildId: string }) {
  const sons = useStore((s) => s.guilds.get(guildId)?.sounds ?? VAZIA);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);

  async function enviar(arquivos: File[]) {
    const usados = new Set(sons.map((s) => s.name));
    setEnviando(arquivos.length);
    for (const arquivo of arquivos) {
      try {
        const { dataUrl, duracao } = await lerSom(arquivo);
        const nome = nomeDoArquivo(arquivo, usados);
        usados.add(nome);
        await enviarSom(guildId, { name: nome, audio: dataUrl, durationSecs: Math.round(duracao * 100) / 100 });
      } catch (erro) {
        avisar.erro(`Não deu para usar ${arquivo.name}`, erro instanceof Error ? erro.message : undefined);
      }
      setEnviando((n) => n - 1);
    }
  }

  const ordenados = [...sons].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-13 text-texto-3">
          {sons.length} de {LIMITS.soundsPerGuild}. MP3, OGG, WAV ou WebM, até {LIMITS.soundDurationSecs} segundos e {LIMITS.soundBytes / 1024 / 1024} MB.
        </p>
        <Botao
          variante="primario"
          carregando={enviando > 0}
          disabled={sons.length >= LIMITS.soundsPerGuild}
          icone={<Music className="size-4" strokeWidth={1.5} />}
          onClick={() => entrada.current?.click()}
        >
          Enviar som
        </Botao>
        <input
          ref={entrada}
          type="file"
          multiple
          accept="audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/webm"
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
          {ordenados.map((s) => (
            <LinhaDoSom key={s.id} guildId={guildId} som={s} />
          ))}
        </ul>
      ) : (
        <div className="h-64 border border-borda">
          <EstadoVazio rotulo="soundboard" titulo="Nenhum som ainda">
            Quem está na chamada toca os sons pelo botão SONS da barra. Cada som para em {LIMITS.soundDurationSecs} segundos.
          </EstadoVazio>
        </div>
      )}
    </div>
  );
}

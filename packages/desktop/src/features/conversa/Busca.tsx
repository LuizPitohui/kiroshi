import { useEffect, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { Hash, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { selectors, useStore } from '../../store/index.js';
import { navegar } from '../../app/rotas.js';
import { Abas, Avatar, Aviso, Botao, Carregando, Dialogo } from '../../design/primitivos/index.js';
import { Conteudo } from './Conteudo.js';
import { motivo } from './acoes.js';
import { horaCurta, rotuloDoDia } from './linhas.js';
import { pedirSalto } from './salto.js';

const POR_PAGINA = 25;

interface Resultado {
  messages: Message[];
  total: number;
}

function Achado({ mensagem, aoAbrir }: { mensagem: Message; aoAbrir: () => void }) {
  const nome = useStore((s) => selectors.displayNameOf(s, mensagem.authorId, mensagem.guildId));
  const canal = useStore((s) => s.channels.get(mensagem.channelId)?.name ?? null);
  return (
    <li>
      <button type="button" onClick={aoAbrir} className="block w-full border border-borda bg-terminal p-3 text-left hover:border-borda-2 focus-visible:border-acento">
        <span className="flex items-center gap-2">
          <Avatar nome={nome} id={mensagem.authorId} url={mensagem.author.avatarUrl} tamanho={20} />
          <span className="truncate text-14 font-semibold">{nome}</span>
          {canal ? (
            <span className="flex items-center gap-0.5 font-mono text-10 text-texto-3">
              <Hash aria-hidden className="size-3" strokeWidth={1.5} />
              {canal}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-10 text-mudo">
            {rotuloDoDia(mensagem.createdAt)} {horaCurta(mensagem.createdAt)}
          </span>
        </span>
        <span className="mt-1 line-clamp-4 block">
          <Conteudo conteudo={mensagem.content || '[anexo]'} guildId={mensagem.guildId} />
        </span>
      </button>
    </li>
  );
}

/**
 * Busca no canal ou no servidor inteiro. Espera a pessoa parar de digitar
 * (300 ms) e cancela a busca anterior: digitar rapido nao dispara um pedido
 * por tecla, e a resposta velha nunca sobrescreve a nova.
 */
export function Busca({ aberto, aoMudar, canalId, guildId }: { aberto: boolean; aoMudar: (a: boolean) => void; canalId: string; guildId: string | null }) {
  const [termo, setTermo] = useState('');
  const [escopo, setEscopo] = useState<'servidor' | 'canal'>(guildId ? 'servidor' : 'canal');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef<AbortController | null>(null);

  function buscar(deslocamento: number) {
    const q = termo.trim();
    pedido.current?.abort();
    const controle = new AbortController();
    pedido.current = controle;
    setBuscando(true);
    setErro(null);
    const base = escopo === 'servidor' && guildId ? `/guilds/${guildId}/messages/search` : `/channels/${canalId}/messages/search`;
    api
      .get<Resultado>(`${base}?query=${encodeURIComponent(q)}&limit=${POR_PAGINA}&offset=${deslocamento}`, { signal: controle.signal })
      .then((r) => {
        setResultado((antes) => (deslocamento > 0 && antes ? { total: r.total, messages: [...antes.messages, ...r.messages] } : r));
        setBuscando(false);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setErro(motivo(e, 'A busca falhou.'));
        setBuscando(false);
      });
  }

  useEffect(() => {
    if (!aberto) return;
    if (termo.trim().length < 2) {
      pedido.current?.abort();
      setResultado(null);
      setBuscando(false);
      return;
    }
    const t = setTimeout(() => buscar(0), 300);
    return () => clearTimeout(t);
    // buscar() le termo e escopo deste mesmo render.
  }, [termo, escopo, aberto]);

  useEffect(() => () => pedido.current?.abort(), []);

  function abrir(m: Message) {
    aoMudar(false);
    const canal = useStore.getState().channels.get(m.channelId);
    if (canal?.guildId) navegar({ tela: 'servidor', guildId: canal.guildId, canalId: canal.id });
    else navegar({ tela: 'dm', canalId: m.channelId });
    pedirSalto(m.channelId, m.id);
  }

  return (
    <Dialogo aberto={aberto} aoMudar={aoMudar} titulo="Buscar mensagens" rotulo="Busca" largura="lg">
      <label className="flex h-10 items-center gap-2 border border-borda-2 bg-terminal px-3 focus-within:border-acento">
        <Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />
        <input
          autoFocus
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="O que você procura?"
          aria-label="Termo da busca"
          className="h-full min-w-0 flex-1 bg-transparente text-14 text-texto outline-none placeholder:text-mudo"
        />
      </label>
      {guildId ? (
        <div className="mt-3">
          <Abas
            rotulo="Onde buscar"
            valor={escopo}
            aoMudar={(v) => setEscopo(v as 'servidor' | 'canal')}
            abas={[
              { valor: 'servidor', rotulo: 'Servidor inteiro' },
              { valor: 'canal', rotulo: 'Só neste canal' },
            ]}
          >
            {null}
          </Abas>
        </div>
      ) : null}
      <div className="mt-3 min-h-[120px]" aria-live="polite" aria-busy={buscando}>
        {erro ? (
          <Aviso tipo="erro" titulo="A busca falhou">
            {erro}
          </Aviso>
        ) : buscando && !resultado ? (
          <div className="py-8">
            <Carregando texto="Buscando…" />
          </div>
        ) : resultado ? (
          <>
            <p className="k-rotulo mb-2">
              {resultado.total === 0 ? 'Nada encontrado' : resultado.total === 1 ? '1 resultado' : `${resultado.total} resultados`}
            </p>
            <ul className="space-y-2">
              {resultado.messages.map((m) => (
                <Achado key={m.id} mensagem={m} aoAbrir={() => abrir(m)} />
              ))}
            </ul>
            {resultado.messages.length < resultado.total ? (
              <div className="mt-3 flex justify-center">
                <Botao tamanho="sm" variante="secundario" carregando={buscando} onClick={() => buscar(resultado.messages.length)}>
                  Mais resultados
                </Botao>
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-8 text-center text-13 text-texto-3">Digite pelo menos duas letras.</p>
        )}
      </div>
    </Dialogo>
  );
}

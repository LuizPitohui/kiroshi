import { useRef, useState } from 'react';
import { ImagePlus, Link2, Plus } from 'lucide-react';
import { LIMITS, type GuildWithState } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { navegar } from '../../app/rotas.js';
import { useStore } from '../../store/index.js';
import { Botao, Campo, Dialogo } from '../../design/primitivos/index.js';
import { lerImagem } from '../../lib/arquivos.js';
import { motivo } from '../conversa/acoes.js';
import { codigoDe } from './regrasDoConvite.js';

type Modo = 'escolher' | 'criar' | 'entrar';

/**
 * O `+` do trilho: criar um servidor ou entrar com um convite (o codigo, ou o
 * link inteiro colado de qualquer lugar).
 */
export function JanelaDeServidorNovo({ aberto, aoMudar }: { aberto: boolean; aoMudar: (v: boolean) => void }) {
  const [modo, setModo] = useState<Modo>('escolher');
  const [nome, setNome] = useState('');
  const [icone, setIcone] = useState<string | null>(null);
  const [convite, setConvite] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const eu = useStore((s) => s.user?.displayName ?? '');

  function fechar(v: boolean) {
    aoMudar(v);
    if (!v) {
      setModo('escolher');
      setNome('');
      setIcone(null);
      setConvite('');
      setErro(null);
    }
  }

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      const guild = await api.post<GuildWithState>('/guilds', { name: nome.trim(), ...(icone ? { iconUrl: icone } : {}), withDefaultChannels: true });
      useStore.getState().upsertGuild(guild);
      fechar(false);
      navegar({ tela: 'servidor', guildId: guild.id, canalId: null });
    } catch (e) {
      setErro(motivo(e, 'Não consegui criar o servidor.'));
    } finally {
      setOcupado(false);
    }
  }

  function entrar() {
    const codigo = codigoDe(convite);
    if (!codigo) return setErro('Isso não parece um convite. Cole o link inteiro ou só o código.');
    fechar(false);
    navegar({ tela: 'convite', codigo });
  }

  const titulo = modo === 'criar' ? 'Criar servidor' : modo === 'entrar' ? 'Entrar com convite' : 'Seu servidor';
  const acoes =
    modo === 'criar' ? (
      <>
        <Botao variante="fantasma" disabled={ocupado} onClick={() => setModo('escolher')}>
          Voltar
        </Botao>
        <Botao variante="primario" carregando={ocupado} disabled={nome.trim().length < LIMITS.guildName.min} onClick={() => void criar()}>
          Criar
        </Botao>
      </>
    ) : modo === 'entrar' ? (
      <>
        <Botao variante="fantasma" onClick={() => setModo('escolher')}>
          Voltar
        </Botao>
        <Botao variante="primario" disabled={!convite.trim()} onClick={entrar}>
          Ver o convite
        </Botao>
      </>
    ) : undefined;

  return (
    <Dialogo aberto={aberto} aoMudar={fechar} rotulo="servidores" titulo={titulo} largura="sm" acoes={acoes}>
      {modo === 'escolher' ? (
        <div className="grid gap-2">
          <button type="button" onClick={() => setModo('criar')} className="flex items-center gap-3 border border-borda bg-terminal px-4 py-3 text-left hover:border-acento">
            <Plus aria-hidden className="size-5 text-acento" strokeWidth={1.5} />
            <span>
              <span className="block text-14 font-medium text-texto">Criar um servidor</span>
              <span className="block text-12 text-texto-3">Com um canal de texto e um de voz para começar.</span>
            </span>
          </button>
          <button type="button" onClick={() => setModo('entrar')} className="flex items-center gap-3 border border-borda bg-terminal px-4 py-3 text-left hover:border-acento">
            <Link2 aria-hidden className="size-5 text-acento" strokeWidth={1.5} />
            <span>
              <span className="block text-14 font-medium text-texto">Entrar com um convite</span>
              <span className="block text-12 text-texto-3">Cole o link que te mandaram.</span>
            </span>
          </button>
        </div>
      ) : modo === 'criar' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim().length >= LIMITS.guildName.min) void criar();
          }}
        >
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              aria-label="Escolher o ícone"
              className="k-chanfro grid size-16 shrink-0 place-items-center overflow-hidden border border-dashed border-borda-2 bg-terminal text-texto-3 hover:border-acento"
            >
              {icone ? <img src={icone} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5" strokeWidth={1.5} />}
            </button>
            <p className="text-12 text-texto-3">O ícone é opcional; dá para trocar depois nos ajustes.</p>
            <input
              ref={entrada}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = '';
                if (arquivo) lerImagem(arquivo).then(setIcone, (falha: unknown) => setErro(falha instanceof Error ? falha.message : null));
              }}
            />
          </div>
          <Campo
            rotulo="Nome do servidor"
            value={nome}
            autoFocus
            maxLength={LIMITS.guildName.max}
            placeholder={eu ? `Servidor de ${eu}` : 'Nome'}
            erro={erro}
            onChange={(e) => setNome(e.target.value)}
          />
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            entrar();
          }}
        >
          <Campo
            rotulo="Convite"
            value={convite}
            autoFocus
            placeholder="https://order.arasaka.fun/convite/…"
            erro={erro}
            dica="O link inteiro ou só o código."
            onChange={(e) => {
              setConvite(e.target.value);
              setErro(null);
            }}
          />
        </form>
      )}
    </Dialogo>
  );
}

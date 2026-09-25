import { useEffect, useState } from 'react';
import { Check, Copy, Search, Send } from 'lucide-react';
import { Permission, has, type Invite } from '@kiroshi/shared';
import { useRelationships, useStore } from '../../store/index.js';
import { usePoder } from './poder.js';
import { Avatar, Aviso, Botao, Carregando, Campo, Dialogo, Selecao } from '../../design/primitivos/index.js';
import { convidarPorDm, criarConvite, linkDoConvite } from './acoes.js';
import { USOS, USOS_PADRAO, VALIDADES, VALIDADE_PADRAO, quandoExpira, valido } from './regrasDoConvite.js';

/*
  O convite que esta janela ja criou, por servidor e opcoes. Abrir a janela de
  novo reaproveita o mesmo link enquanto ele valer: a 1.x criava um convite a
  cada abertura, e a lista enchia de codigos que ninguem usou.
*/
const jaCriados = new Map<string, Invite>();
const chave = (guildId: string, validade: number, usos: number, canal: string | null) => `${guildId}:${validade}:${usos}:${canal ?? ''}`;

function useUsuarioDoAmigo(userId: string) {
  return useStore((s) => s.users.get(userId));
}

function LinhaDeAmigo({ userId, jaMembro, link }: { userId: string; jaMembro: boolean; link: string | null }) {
  const usuario = useUsuarioDoAmigo(userId);
  const [estado, setEstado] = useState<'livre' | 'enviando' | 'enviado'>('livre');
  const nome = usuario?.displayName || usuario?.username || '?';

  return (
    <li className="flex items-center gap-3 px-1 py-1.5">
      <Avatar nome={nome} id={userId} url={usuario?.avatarUrl} tamanho={32} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-14 text-texto">{nome}</span>
        <span className="block truncate font-mono text-11 text-texto-3">@{usuario?.username}</span>
      </span>
      {jaMembro ? (
        <span className="font-mono text-10 uppercase tracking-rotulo text-mudo">Já está aqui</span>
      ) : (
        <Botao
          tamanho="sm"
          variante={estado === 'enviado' ? 'fantasma' : 'secundario'}
          carregando={estado === 'enviando'}
          disabled={!link || estado === 'enviado'}
          icone={estado === 'enviado' ? <Check className="size-3.5" strokeWidth={1.75} /> : <Send className="size-3.5" strokeWidth={1.5} />}
          onClick={async () => {
            if (!link) return;
            setEstado('enviando');
            setEstado((await convidarPorDm(userId, link)) ? 'enviado' : 'livre');
          }}
        >
          {estado === 'enviado' ? 'Enviado' : 'Convidar'}
        </Botao>
      )}
    </li>
  );
}

/**
 * Convidar pessoas (10-front-end-novo.md 4.8): o link, com validade e usos
 * como no Discord, e os amigos com o botao que manda o link pela DM.
 */
export function JanelaDeConvite({ guildId, canalId, aberto, aoMudar }: { guildId: string; canalId: string | null; aberto: boolean; aoMudar: (v: boolean) => void }) {
  const nomeDoServidor = useStore((s) => s.guilds.get(guildId)?.name ?? '');
  const poder = usePoder(guildId);
  // A lista vem do hook com comparacao item a item; um filtro no seletor criaria array novo a cada leitura.
  const amigos = useRelationships().filter((r) => r.type === 'FRIEND');
  const membros = useStore((s) => s.members);
  const [validade, setValidade] = useState(VALIDADE_PADRAO);
  const [usos, setUsos] = useState(USOS_PADRAO);
  const [convite, setConvite] = useState<Invite | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [busca, setBusca] = useState('');
  const podeCriar = Boolean(poder && has(poder.permissoes, Permission.CREATE_INVITE));

  useEffect(() => {
    if (!aberto || !podeCriar) return;
    const k = chave(guildId, validade, usos, canalId);
    const guardado = jaCriados.get(k);
    if (guardado && valido(guardado, Date.now())) {
      setConvite(guardado);
      return;
    }
    let vivo = true;
    setGerando(true);
    setConvite(null);
    void criarConvite(guildId, { maxAgeSecs: validade, maxUses: usos, channelId: canalId }).then((novo) => {
      if (!vivo) return;
      setGerando(false);
      if (novo) {
        jaCriados.set(k, novo);
        setConvite(novo);
      }
    });
    return () => {
      vivo = false;
    };
  }, [aberto, podeCriar, guildId, validade, usos, canalId]);

  useEffect(() => {
    if (!aberto) {
      setCopiado(false);
      setBusca('');
    }
  }, [aberto]);

  const link = convite ? linkDoConvite(convite.code) : null;
  const termo = busca.trim().toLowerCase();
  const lista = amigos
    .map((a) => a.user)
    .filter((u) => !termo || u.displayName.toLowerCase().includes(termo) || u.username.includes(termo))
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, 'pt-BR'));

  async function copiar() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <Dialogo aberto={aberto} aoMudar={aoMudar} rotulo="convite" titulo={`Convidar para ${nomeDoServidor}`} largura="md">
      {!podeCriar ? (
        <Aviso tipo="aviso">Seu cargo não pode criar convites neste servidor.</Aviso>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-end gap-2">
              <Campo
                rotulo="Link do convite"
                readOnly
                value={link ?? (gerando ? 'Gerando…' : '')}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1"
              />
              <Botao variante="primario" disabled={!link} icone={copiado ? <Check className="size-4" strokeWidth={1.75} /> : <Copy className="size-4" strokeWidth={1.5} />} onClick={() => void copiar()}>
                {copiado ? 'Copiado' : 'Copiar'}
              </Botao>
            </div>
            <p className="mt-1.5 text-12 text-texto-3">
              {convite ? `O link ${quandoExpira(convite.expiresAt, Date.now())}${convite.maxUses ? ` e vale ${convite.maxUses} ${convite.maxUses === 1 ? 'vez' : 'vezes'}` : ''}. ` : ''}
              Abre o Kiroshi direto no convite; sem o app, mostra o servidor e o instalador.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Selecao
              rotulo="Expira em"
              valor={String(validade)}
              aoMudar={(v) => setValidade(Number(v))}
              opcoes={VALIDADES.map((v) => ({ valor: String(v.segundos), rotulo: v.rotulo }))}
            />
            <Selecao rotulo="Usos" valor={String(usos)} aoMudar={(v) => setUsos(Number(v))} opcoes={USOS.map((u) => ({ valor: String(u.usos), rotulo: u.rotulo }))} />
          </div>
          <section className="border-t border-borda pt-4">
            <h3 className="k-rotulo mb-2">Mandar para amigos</h3>
            {amigos.length === 0 ? (
              <p className="text-13 text-texto-3">Sem amigos no Kiroshi ainda: mande o link por onde preferir.</p>
            ) : (
              <>
                {amigos.length > 6 ? (
                  <Campo
                    rotulo="Procurar amigo"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    prefixo={<Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />}
                    className="mb-2"
                  />
                ) : null}
                {gerando && !link ? <Carregando texto="Gerando o link" /> : null}
                <ul className="k-rolagem max-h-64 overflow-y-auto">
                  {lista.map((u) => (
                    <LinhaDeAmigo key={u.id} userId={u.id} jaMembro={membros.has(`${guildId}:${u.id}`)} link={link} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </Dialogo>
  );
}

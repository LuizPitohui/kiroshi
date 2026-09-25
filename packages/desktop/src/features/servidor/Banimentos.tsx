import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { GuildBan } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { Avatar, Aviso, Botao, Campo, Carregando, EstadoVazio, avisar } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';
import { desbanir, listarBanimentos } from './acoes.js';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

function LinhaDoBanimento({ guildId, ban, aoTirar }: { guildId: string; ban: GuildBan; aoTirar: () => void }) {
  const quem = useStore((s) => selectors.displayNameOf(s, ban.bannedBy, guildId));
  const nome = ban.user?.displayName ?? 'Conta apagada';
  const [tirando, setTirando] = useState(false);

  return (
    <li className="flex items-center gap-3 border-b border-borda px-3 py-3 last:border-b-0">
      <Avatar nome={nome} id={ban.userId} url={ban.user?.avatarUrl} tamanho={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-14 text-texto">
          {nome} {ban.user ? <span className="font-mono text-11 text-texto-3">@{ban.user.username}</span> : null}
        </p>
        <p className="truncate text-12 text-texto-3">
          Banido por {quem} em {data(ban.createdAt)}
          {ban.reason ? ` · ${ban.reason}` : ''}
        </p>
      </div>
      <Botao
        tamanho="sm"
        carregando={tirando}
        onClick={async () => {
          setTirando(true);
          if (await desbanir(guildId, ban.userId)) aoTirar();
          else setTirando(false);
        }}
      >
        Tirar banimento
      </Botao>
    </li>
  );
}

/** Quem esta banido, por quem e por que. Tirar o banimento nao traz a pessoa de volta: ela precisa de convite. */
export function PaginaBanimentos({ guildId }: { guildId: string }) {
  const [bans, setBans] = useState<GuildBan[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(() => {
    setErro(null);
    listarBanimentos(guildId)
      .then(setBans)
      .catch((e: unknown) => setErro(motivo(e, 'Não consegui carregar os banimentos.')));
  }, [guildId]);
  useEffect(carregar, [carregar]);

  const termo = busca.trim().toLowerCase();
  const lista = (bans ?? []).filter(
    (b) => !termo || b.user?.displayName.toLowerCase().includes(termo) || b.user?.username.includes(termo) || b.reason?.toLowerCase().includes(termo),
  );

  if (erro) {
    return (
      <Aviso tipo="erro" titulo="Não deu para ver os banimentos" acao={<Botao tamanho="sm" onClick={carregar}>Tentar de novo</Botao>}>
        {erro}
      </Aviso>
    );
  }
  if (bans === null) {
    return (
      <div className="py-10">
        <Carregando texto="Lendo os banimentos" />
      </div>
    );
  }
  if (bans.length === 0) {
    return (
      <div className="h-64 border border-borda">
        <EstadoVazio rotulo="banimentos" titulo="Ninguém banido">
          Quem for banido aparece aqui, com o motivo, e sai daqui quando o banimento for tirado.
        </EstadoVazio>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-13 text-texto-3">Tirar o banimento não traz a pessoa de volta: ela só pode entrar de novo com um convite.</p>
      {bans.length > 5 ? (
        <Campo rotulo="Procurar" value={busca} onChange={(e) => setBusca(e.target.value)} prefixo={<Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />} />
      ) : null}
      <ul className="border border-borda bg-deck">
        {lista.map((b) => (
          <LinhaDoBanimento
            key={b.userId}
            guildId={guildId}
            ban={b}
            aoTirar={() => {
              setBans((atual) => atual?.filter((x) => x.userId !== b.userId) ?? null);
              avisar.ok('Banimento tirado', `${b.user?.displayName ?? 'A pessoa'} pode voltar com um convite.`);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

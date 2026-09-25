import { memo, useMemo, useState } from 'react';
import { Crown, MoreHorizontal, Search } from 'lucide-react';
import { selectors, useMembersOfGuild, useRolesOfGuild, useStore } from '../../store/index.js';
import { Avatar, BotaoIcone, Campo, Menu, MenuConteudo, MenuGatilho, Selecao } from '../../design/primitivos/index.js';
import { CargosDaPessoa } from '../pessoas/CargosDaPessoa.js';
import { ItensDaPessoaNoMenu } from '../pessoas/MenuDaPessoa.js';
import { cargosEmOrdem } from './hierarquia.js';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const LinhaDeMembro = memo(function LinhaDeMembro({ guildId, userId }: { guildId: string; userId: string }) {
  const nome = useStore((s) => selectors.displayNameOf(s, userId, guildId));
  const cor = useStore((s) => selectors.colorOf(s, userId, guildId));
  const usuario = useStore((s) => s.users.get(userId));
  const entrou = useStore((s) => s.members.get(`${guildId}:${userId}`)?.joinedAt);
  const dono = useStore((s) => s.guilds.get(guildId)?.ownerId === userId);

  return (
    <li className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto] items-center gap-4 border-b border-borda px-2 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar nome={nome} id={userId} url={usuario?.avatarUrl} tamanho={40} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-14 font-medium" style={cor ? { color: cor } : undefined}>
            <span className="truncate">{nome}</span>
            {dono ? <Crown aria-label="dono do servidor" className="size-3.5 shrink-0 text-aviso" strokeWidth={1.75} /> : null}
          </p>
          <p className="truncate font-mono text-11 text-texto-3">
            @{usuario?.username}
            {entrou ? <span className="text-mudo"> · desde {data(entrou)}</span> : null}
          </p>
        </div>
      </div>
      <CargosDaPessoa guildId={guildId} userId={userId} />
      <Menu>
        <MenuGatilho asChild>
          <BotaoIcone rotulo={`Ações para ${nome}`} icone={<MoreHorizontal className="size-4" strokeWidth={1.5} />} tamanho="sm" />
        </MenuGatilho>
        <MenuConteudo alinhar="end">
          <ItensDaPessoaNoMenu guildId={guildId} userId={userId} />
        </MenuConteudo>
      </Menu>
    </li>
  );
});

/** Todos os membros, com os cargos de cada um e as acoes de moderacao. */
export function PaginaMembros({ guildId }: { guildId: string }) {
  const membros = useMembersOfGuild(guildId);
  const todos = useRolesOfGuild(guildId);
  const nomes = useStore((s) => s.members);
  const [busca, setBusca] = useState('');
  const [cargo, setCargo] = useState('todos');

  const cargos = useMemo(() => cargosEmOrdem(todos, guildId), [todos, guildId]);
  const nomeDe = (userId: string) => {
    const m = nomes.get(`${guildId}:${userId}`);
    return m?.nickname || m?.user.displayName || m?.user.username || '';
  };
  const termo = busca.trim().toLowerCase();
  const lista = membros
    .filter((m) => cargo === 'todos' || m.roleIds.includes(cargo))
    .filter((m) => !termo || nomeDe(m.userId).toLowerCase().includes(termo) || m.user.username.includes(termo))
    .sort((a, b) => nomeDe(a.userId).localeCompare(nomeDe(b.userId), 'pt-BR', { sensitivity: 'base' }));

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <Campo
          rotulo="Procurar"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome ou @usuário"
          prefixo={<Search aria-hidden className="size-4 text-texto-3" strokeWidth={1.5} />}
          className="flex-1"
        />
        <Selecao
          rotulo="Cargo"
          valor={cargo}
          aoMudar={setCargo}
          opcoes={[{ valor: 'todos', rotulo: 'Todos os cargos' }, ...cargos.map((c) => ({ valor: c.id, rotulo: c.name }))]}
          className="w-56"
        />
      </div>
      <p className="font-mono text-11 uppercase tracking-rotulo text-texto-3">
        {lista.length} de {membros.length} {membros.length === 1 ? 'membro' : 'membros'}
      </p>
      {lista.length ? (
        <ul className="border border-borda bg-deck">
          {lista.map((m) => (
            <LinhaDeMembro key={m.userId} guildId={guildId} userId={m.userId} />
          ))}
        </ul>
      ) : (
        <p className="border border-borda bg-deck px-4 py-6 text-center text-13 text-texto-3">Ninguém com esse nome ou cargo.</p>
      )}
    </div>
  );
}

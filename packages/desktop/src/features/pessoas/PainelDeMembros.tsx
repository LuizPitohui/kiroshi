import { memo, useMemo, useState } from 'react';
import { Crown } from 'lucide-react';
import { selectors, useMembersOfGuild, useRolesOfGuild, useStore } from '../../store/index.js';
import { Avatar, MenuDeContexto, MenuDeContextoConteudo, MenuDeContextoGatilho, cx } from '../../design/primitivos/index.js';
import { agruparMembros } from './agrupar.js';
import { CartaoDePerfil } from './CartaoDePerfil.js';
import { ItensDaPessoa } from './MenuDaPessoa.js';

const LinhaDoMembro = memo(function LinhaDoMembro({ guildId, userId }: { guildId: string; userId: string }) {
  const nome = useStore((s) => selectors.displayNameOf(s, userId, guildId));
  const cor = useStore((s) => selectors.colorOf(s, userId, guildId));
  const avatar = useStore((s) => s.users.get(userId)?.avatarUrl ?? null);
  const status = useStore((s) => s.presences.get(userId)?.status ?? 'OFFLINE');
  const frase = useStore((s) => s.presences.get(userId)?.customStatus ?? null);
  const dono = useStore((s) => s.guilds.get(guildId)?.ownerId === userId);
  const [perfil, setPerfil] = useState(false);

  return (
    <li className={status === 'OFFLINE' ? 'opacity-40 hover:opacity-100 focus-within:opacity-100' : undefined}>
      <MenuDeContexto>
        <CartaoDePerfil userId={userId} guildId={guildId} aberto={perfil} aoMudar={setPerfil}>
          <MenuDeContextoGatilho asChild>
            <button
              type="button"
              onClick={() => setPerfil(true)}
              className={cx('flex h-10 w-full items-center gap-2.5 px-3.5 text-left hover:bg-terminal', perfil && 'bg-terminal')}
            >
              <Avatar nome={nome} id={userId} url={avatar} tamanho={32} status={status} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-14 font-medium" style={cor ? { color: cor } : undefined}>
                    {nome}
                  </span>
                  {dono ? <Crown aria-label="dono do servidor" className="size-3.5 shrink-0 text-aviso" strokeWidth={1.75} /> : null}
                </span>
                {frase && status !== 'OFFLINE' ? <span className="block truncate text-11 text-texto-3">{frase}</span> : null}
              </span>
            </button>
          </MenuDeContextoGatilho>
        </CartaoDePerfil>
        <MenuDeContextoConteudo>
          <ItensDaPessoa guildId={guildId} userId={userId} aoVerPerfil={() => setPerfil(true)} />
        </MenuDeContextoConteudo>
      </MenuDeContexto>
    </li>
  );
});

/**
 * Membros do servidor ao lado do canal de texto: agrupados pelo cargo
 * destacado mais alto, depois online e offline (`agruparMembros`). Clique abre
 * o perfil; o direito, as acoes (cargos, apelido, moderacao).
 */
export function PainelDeMembros({ guildId }: { guildId: string }) {
  const membros = useMembersOfGuild(guildId);
  const cargos = useRolesOfGuild(guildId);
  const presencas = useStore((s) => s.presences);
  const nomes = useStore((s) => s.members);

  const grupos = useMemo(
    () =>
      agruparMembros(
        membros,
        cargos,
        (id) => presencas.get(id)?.status ?? 'OFFLINE',
        (m) => nomes.get(`${guildId}:${m.userId}`)?.nickname || m.user.displayName || m.user.username,
      ),
    [membros, cargos, presencas, nomes, guildId],
  );

  return (
    <aside aria-label="Membros" className="k-rolagem w-[300px] shrink-0 overflow-y-auto border-l border-borda bg-deck">
      <div className="flex h-12 items-center border-b border-borda px-3.5">
        <p className="k-rotulo">Membros — {membros.length}</p>
      </div>
      {grupos.map((g) => (
        <section key={g.id} aria-label={`${g.nome}, ${g.membros.length}`}>
          <p className="k-rotulo px-3.5 pb-1 pt-4">
            {g.cor ? <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: g.cor }} /> : null}
            {g.nome} — {g.membros.length}
          </p>
          <ul>
            {g.membros.map((m) => (
              <LinhaDoMembro key={m.userId} guildId={guildId} userId={m.userId} />
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

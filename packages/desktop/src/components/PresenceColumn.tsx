import { useMemo, useRef, useState } from 'react';
import type { GuildMember, Role } from '@kiroshi/shared';
import { selectors, useMembersOfGuild, useRolesOfGuild, useStore } from '../store/index.js';
import { Avatar } from './Avatar.js';
import { MemberCard } from './MemberCard.js';
import { CartaoDePessoa } from './CartaoDePessoa.js';

interface Props {
  guildId: string;
  /** Fechada, a coluna sai de cena pela margem em vez de desmontar: so assim
   *  da para animar a saida. */
  visivel: boolean;
}

/**
 * Quem esta no servidor, agrupado por cargo.
 *
 * Cargos marcados para exibir separadamente viram secoes proprias, na ordem
 * da hierarquia. Quem nao esta em nenhum deles cai em "Online", e quem esta
 * offline fica por ultimo e esmaecido — presente na lista, mas sem disputar
 * atencao com quem da para chamar agora.
 */
export function PresenceColumn({ guildId, visivel }: Props) {
  const estado = useStore();
  const membros = useMembersOfGuild(guildId);
  const cargos = useRolesOfGuild(guildId);
  const presencas = useStore((s) => s.presences);

  const [selecionado, setSelecionado] = useState<string | null>(null);

  // Cartao do botao direito: volumes e pedido de amizade, o mesmo do palco.
  const ancoraDoCartao = useRef<HTMLElement | null>(null);
  const [pessoaNoCartao, setPessoaNoCartao] = useState<string | null>(null);

  const secoes = useMemo(() => {
    const destacados = cargos.filter((r) => r.hoist && r.id !== guildId);

    const online: GuildMember[] = [];
    const offline: GuildMember[] = [];
    const porCargo = new Map<string, GuildMember[]>();

    for (const membro of membros) {
      const status = presencas.get(membro.userId)?.status ?? 'OFFLINE';
      if (status === 'OFFLINE') {
        offline.push(membro);
        continue;
      }

      const cargo = destacados.find((r) => membro.roleIds.includes(r.id));
      if (cargo) {
        const lista = porCargo.get(cargo.id) ?? [];
        lista.push(membro);
        porCargo.set(cargo.id, lista);
      } else {
        online.push(membro);
      }
    }

    const porNome = (a: GuildMember, b: GuildMember): number =>
      (a.nickname ?? a.user.displayName).localeCompare(b.nickname ?? b.user.displayName);

    const saida: { chave: string; rotulo: string; cargo: Role | null; membros: GuildMember[] }[] =
      [];

    for (const cargo of destacados) {
      const lista = porCargo.get(cargo.id);
      if (!lista?.length) continue;
      saida.push({ chave: cargo.id, rotulo: cargo.name, cargo, membros: lista.sort(porNome) });
    }
    if (online.length > 0) {
      saida.push({ chave: 'online', rotulo: 'Online', cargo: null, membros: online.sort(porNome) });
    }
    if (offline.length > 0) {
      saida.push({
        chave: 'offline',
        rotulo: 'Offline',
        cargo: null,
        membros: offline.sort(porNome),
      });
    }

    return saida;
  }, [membros, cargos, presencas, guildId]);

  return (
    <aside
      className={`presence-col ${visivel ? "" : "hidden"}`}
      aria-label="Membros"
      aria-hidden={!visivel}
    >
      {secoes.map((secao) => (
        <div key={secao.chave}>
          <div className="presence-group">
            <span>{secao.rotulo}</span>
            <span className="n">{secao.membros.length}</span>
          </div>
          {secao.membros.map((membro) => {
            const status = presencas.get(membro.userId)?.status ?? 'OFFLINE';
            const recado = presencas.get(membro.userId)?.customStatus;
            const cor = selectors.colorOf(estado, membro.userId, guildId);

            return (
              <div
                key={membro.userId}
                className={`member ${secao.chave === 'offline' ? 'offline' : ''}`}
                onClick={() => setSelecionado(membro.userId)}
                /*
                  Botao direito abre o cartao com os volumes e o pedido de
                  amizade — o mesmo que no palco. Esta lista e o outro lugar
                  onde se ve uma pessoa, e ter dois gestos diferentes para a
                  mesma coisa em duas listas seria pior que nao ter um deles.
                */
                onContextMenu={(e) => {
                  e.preventDefault();
                  ancoraDoCartao.current = e.currentTarget as HTMLElement;
                  setPessoaNoCartao(membro.userId);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelecionado(membro.userId);
                  /*
                    Menu de contexto pelo teclado.

                    Shift+F10 e a tecla de menu sao como se abre menu de
                    contexto sem mouse no Windows. Sem isto o cartao — e com
                    ele o volume e o pedido de amizade — ficaria so para quem
                    tem mouse.
                  */
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    ancoraDoCartao.current = e.currentTarget as HTMLElement;
                    setPessoaNoCartao(membro.userId);
                  }
                }}
              >
                <Avatar
                  url={membro.user.avatarUrl}
                  name={membro.nickname ?? membro.user.displayName}
                  size={28}
                  status={status}
                />
                <div className="member-text">
                  <div className="member-name" style={cor ? { color: cor } : undefined}>
                    {membro.nickname ?? membro.user.displayName}
                  </div>
                  {recado && <div className="member-status">{recado}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {selecionado && (
        <MemberCard
          guildId={guildId}
          userId={selecionado}
          onClose={() => setSelecionado(null)}
        />
      )}

      {pessoaNoCartao && (
        <CartaoDePessoa
          userId={pessoaNoCartao}
          guildId={guildId}
          ancora={ancoraDoCartao}
          aberto
          aoFechar={() => setPessoaNoCartao(null)}
        />
      )}
    </aside>
  );
}

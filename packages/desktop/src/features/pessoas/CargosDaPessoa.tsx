import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useRolesOfGuild, useStore } from '../../store/index.js';
import { Balao, BalaoConteudo, BalaoGatilho, SeloCargo, cx } from '../../design/primitivos/index.js';
import { cargosEmOrdem, podeAgirSobre, podeDarCargo, podeTirarCargo } from '../servidor/hierarquia.js';
import { useContextoDe, usePoder } from '../servidor/poder.js';
import { darCargo, tirarCargo } from '../servidor/acoes.js';

/**
 * Os cargos de uma pessoa, com o `+` para dar e o x (na bolinha) para tirar —
 * o jeito do Discord no perfil. So aparece o que o servidor aceitaria: cargo
 * abaixo do meu, sem permissao que eu nao tenho, em quem esta abaixo de mim.
 *
 * Foi a queixa que abriu a fatia 6: nao havia tela nenhuma para dar cargo, e
 * por isso o ADM nunca foi dado a ninguem.
 */
export function CargosDaPessoa({ guildId, userId, className }: { guildId: string; userId: string; className?: string }) {
  const todos = useRolesOfGuild(guildId);
  const roleIds = useStore((s) => s.members.get(`${guildId}:${userId}`)?.roleIds);
  const poder = usePoder(guildId);
  const alvo = useContextoDe(guildId, userId);
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');

  const ordem = useMemo(() => cargosEmOrdem(todos, guildId), [todos, guildId]);
  const dela = ordem.filter((c) => roleIds?.includes(c.id));
  const possoMexer = Boolean(poder && podeAgirSobre(poder, alvo));
  const paraDar = possoMexer && poder ? ordem.filter((c) => !roleIds?.includes(c.id) && podeDarCargo(poder, c)) : [];
  const filtrados = busca.trim() ? paraDar.filter((c) => c.name.toLowerCase().includes(busca.trim().toLowerCase())) : paraDar;

  if (!roleIds) return null;

  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {dela.map((c) => (
        <SeloCargo
          key={c.id}
          nome={c.name}
          cor={c.color}
          aoTirar={possoMexer && poder && podeTirarCargo(poder, c) ? () => void tirarCargo(guildId, userId, c.id) : undefined}
        />
      ))}
      {dela.length === 0 && paraDar.length === 0 ? <span className="text-12 text-texto-3">Sem cargos.</span> : null}
      {paraDar.length > 0 ? (
        <Balao
          open={aberto}
          onOpenChange={(v) => {
            setAberto(v);
            if (!v) setBusca('');
          }}
        >
          <BalaoGatilho asChild>
            <button
              type="button"
              aria-label="Dar um cargo"
              title="Dar um cargo"
              className="grid size-[22px] place-items-center border border-dashed border-borda-2 text-texto-3 hover:border-acento hover:text-texto"
            >
              <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
            </button>
          </BalaoGatilho>
          <BalaoConteudo rotulo="Dar um cargo" lado="bottom" alinhar="start" className="w-64 p-1">
            {paraDar.length > 6 ? (
              <label className="mb-1 flex items-center gap-2 border-b border-borda px-2 py-1.5">
                <Search aria-hidden className="size-3.5 text-texto-3" strokeWidth={1.5} />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Procurar cargo"
                  aria-label="Procurar cargo"
                  className="min-w-0 flex-1 bg-transparente text-13 text-texto outline-none placeholder:text-mudo"
                />
              </label>
            ) : null}
            <ul className="k-rolagem max-h-64 overflow-y-auto">
              {filtrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void darCargo(guildId, userId, c.id);
                      setAberto(false);
                      setBusca('');
                    }}
                    className="flex h-8 w-full items-center gap-2 px-2 text-left text-13 text-texto-2 hover:bg-realce hover:text-texto"
                  >
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--k-texto-3)' }} />
                    <span className="truncate">{c.name}</span>
                  </button>
                </li>
              ))}
              {filtrados.length === 0 ? <li className="px-2 py-2 text-12 text-texto-3">Nenhum cargo com esse nome.</li> : null}
            </ul>
          </BalaoConteudo>
        </Balao>
      ) : null}
    </div>
  );
}

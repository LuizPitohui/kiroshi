import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditLogEntry } from '@kiroshi/shared';
import { selectors, useMembersOfGuild, useStore } from '../../store/index.js';
import { Avatar, Aviso, Botao, Carregando, EstadoVazio, Selecao } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';
import { ACOES, NOMES_DOS_GRUPOS, descrever, type GrupoDeAcao, type Nomes } from './frasesDaAuditoria.js';
import { lerAuditoria } from './acoes.js';

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function LinhaDaAuditoria({ entrada, nomes, guildId }: { entrada: AuditLogEntry; nomes: Nomes; guildId: string }) {
  const nomeDoAutor = useStore((s) => (s.members.has(`${guildId}:${entrada.actor.id}`) ? selectors.displayNameOf(s, entrada.actor.id, guildId) : entrada.actor.displayName));
  const frase = descrever(entrada, nomes);
  return (
    <li className="flex gap-3 border-b border-borda px-3 py-3 last:border-b-0">
      <Avatar nome={nomeDoAutor} id={entrada.actor.id} url={entrada.actor.avatarUrl} tamanho={32} />
      <div className="min-w-0 flex-1">
        <p className="text-14 text-texto-2">
          <strong className="font-semibold text-texto">{nomeDoAutor}</strong> {frase.texto}
        </p>
        {frase.detalhes.map((d) => (
          <p key={d} className="break-words text-12 text-texto-3">
            {d}
          </p>
        ))}
      </div>
      <time dateTime={entrada.createdAt} className="shrink-0 font-mono text-11 text-mudo">
        {quando(entrada.createdAt)}
      </time>
    </li>
  );
}

/**
 * Quem fez o que: filtro por pessoa e por acao, 50 de cada vez. O servidor
 * guarda 90 dias.
 */
export function PaginaAuditoria({ guildId }: { guildId: string }) {
  const membros = useMembersOfGuild(guildId);
  const cargos = useStore((s) => s.roles);
  const canais = useStore((s) => s.channels);
  const pessoas = useStore((s) => s.members);
  const [pessoa, setPessoa] = useState('todas');
  const [acao, setAcao] = useState('todas');
  const [entradas, setEntradas] = useState<AuditLogEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const filtro = useMemo(() => ({ pessoa: pessoa === 'todas' ? undefined : pessoa, acao: acao === 'todas' ? undefined : acao }), [pessoa, acao]);

  const carregar = useCallback(
    async (antesDe?: string) => {
      setCarregando(true);
      setErro(null);
      try {
        const pagina = await lerAuditoria(guildId, { ...filtro, antesDe });
        setEntradas((atual) => (antesDe ? [...(atual ?? []), ...pagina] : pagina));
        setTemMais(pagina.length === 50);
      } catch (e) {
        setErro(motivo(e, 'Não consegui ler o registro.'));
      } finally {
        setCarregando(false);
      }
    },
    [guildId, filtro],
  );

  useEffect(() => {
    setEntradas(null);
    void carregar();
  }, [carregar]);

  const nomes: Nomes = useMemo(
    () => ({
      pessoa: (id) => {
        const m = pessoas.get(`${guildId}:${id}`);
        return m ? m.nickname || m.user.displayName : null;
      },
      cargo: (id) => (id === guildId ? '@everyone' : (cargos.get(id)?.name ?? null)),
      canal: (id) => canais.get(id)?.name ?? null,
    }),
    [pessoas, cargos, canais, guildId],
  );

  const grupos = Object.entries(ACOES).reduce<Record<GrupoDeAcao, { valor: string; rotulo: string }[]>>(
    (acc, [valor, a]) => {
      acc[a.grupo].push({ valor, rotulo: `${NOMES_DOS_GRUPOS[a.grupo]} · ${a.rotulo}` });
      return acc;
    },
    { servidor: [], pessoas: [], cargos: [], voz: [], convites: [], canais: [], expressoes: [] },
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Selecao
          rotulo="Quem fez"
          valor={pessoa}
          aoMudar={setPessoa}
          opcoes={[
            { valor: 'todas', rotulo: 'Todo mundo' },
            ...membros
              .map((m) => ({ valor: m.userId, rotulo: m.nickname || m.user.displayName }))
              .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
          ]}
        />
        <Selecao rotulo="Ação" valor={acao} aoMudar={setAcao} opcoes={[{ valor: 'todas', rotulo: 'Todas as ações' }, ...Object.values(grupos).flat()]} />
      </div>
      {erro ? (
        <Aviso tipo="erro" titulo="Não deu para ler o registro" acao={<Botao tamanho="sm" onClick={() => void carregar()}>Tentar de novo</Botao>}>
          {erro}
        </Aviso>
      ) : null}
      {entradas === null ? (
        !erro ? (
          <div className="py-10">
            <Carregando texto="Lendo o registro" />
          </div>
        ) : null
      ) : entradas.length === 0 ? (
        <div className="h-64 border border-borda">
          <EstadoVazio rotulo="auditoria" titulo="Nada por aqui">
            {filtro.pessoa || filtro.acao ? 'Nenhuma ação com esse filtro nos últimos 90 dias.' : 'Mudanças de cargo, moderação, convites e canais aparecem aqui, com quem fez.'}
          </EstadoVazio>
        </div>
      ) : (
        <>
          <ul className="border border-borda bg-deck">
            {entradas.map((e) => (
              <LinhaDaAuditoria key={e.id} entrada={e} nomes={nomes} guildId={guildId} />
            ))}
          </ul>
          {temMais ? (
            <div className="flex justify-center">
              <Botao carregando={carregando} onClick={() => void carregar(entradas.at(-1)?.id)}>
                Carregar mais
              </Botao>
            </div>
          ) : (
            <p className="text-center text-12 text-texto-3">O registro guarda os últimos 90 dias.</p>
          )}
        </>
      )}
    </div>
  );
}

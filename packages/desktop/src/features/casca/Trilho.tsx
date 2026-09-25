import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { selectors, useGuildList, useStore } from '../../store/index.js';
import { navegar, useRota } from '../../app/rotas.js';
import { Contador, Dica, cx } from '../../design/primitivos/index.js';
import { Marca } from './Marca.js';
import { iniciaisDe } from './organizar.js';

interface PropsDoItem {
  rotulo: string;
  ativo: boolean;
  naoLido?: boolean;
  mencoes?: number;
  aoAbrir: () => void;
  children: ReactNode;
}

function ItemDoTrilho({ rotulo, ativo, naoLido = false, mencoes = 0, aoAbrir, children }: PropsDoItem) {
  return (
    <div className="relative">
      {/* Barra lateral: ativo = alta e vermelha; nao lido = curta e clara. */}
      {ativo ? (
        <span aria-hidden className="absolute -left-[14px] top-2 h-7 w-[3px] bg-acento shadow-brilho" />
      ) : naoLido ? (
        <span aria-hidden className="absolute -left-[14px] top-[18px] h-2 w-[3px] bg-texto-2" />
      ) : null}
      <Dica texto={rotulo} lado="right">
        <button
          type="button"
          onClick={aoAbrir}
          aria-label={mencoes > 0 ? `${rotulo}, ${mencoes} menções` : rotulo}
          aria-current={ativo ? 'page' : undefined}
          className={cx(
            'k-chanfro grid size-11 place-items-center border font-display text-15 font-bold tracking-[0.06em]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-acento',
            ativo ? 'border-acento bg-acento-tenue text-texto' : 'border-borda bg-terminal text-texto-2 hover:border-borda-2 hover:text-texto',
          )}
        >
          {children}
        </button>
      </Dica>
      {mencoes > 0 ? (
        <span className="pointer-events-none absolute -bottom-1 -right-1.5 border-2 border-void">
          <Contador valor={mencoes} rotulo="menções" />
        </span>
      ) : null}
    </div>
  );
}

function ServidorNoTrilho({ id, ativo }: { id: string; ativo: boolean }) {
  const nome = useStore((s) => s.guilds.get(id)?.name ?? '');
  const icone = useStore((s) => s.guilds.get(id)?.iconUrl ?? null);
  const mencoes = useStore((s) => selectors.guildMentionCount(s, id));
  const naoLido = useStore((s) => {
    const guild = s.guilds.get(id);
    return guild ? guild.channelIds.some((c) => selectors.unreadCount(s, c) > 0) : false;
  });
  const ultimoCanal = useStore((s) => s.lastChannelByGuild.get(id) ?? null);

  return (
    <ItemDoTrilho
      rotulo={nome}
      ativo={ativo}
      naoLido={naoLido}
      mencoes={mencoes}
      aoAbrir={() => navegar({ tela: 'servidor', guildId: id, canalId: ultimoCanal })}
    >
      {icone ? <img src={icone} alt="" draggable={false} className="size-full object-cover" /> : iniciaisDe(nome)}
    </ItemDoTrilho>
  );
}

/** Coluna de servidores: inicio (as conversas diretas), cada servidor, criar/entrar. */
export function Trilho(): React.JSX.Element {
  const rota = useRota();
  const servidores = useGuildList();
  const mencoesDiretas = useStore((s) =>
    selectors.privateChannels(s).reduce((soma, c) => soma + selectors.mentionCount(s, c.id), 0),
  );
  const guildAtual = rota.tela === 'servidor' || rota.tela === 'ajustes-servidor' ? rota.guildId : null;

  return (
    <nav aria-label="Servidores" className="k-rolagem flex w-[72px] shrink-0 flex-col items-center gap-2.5 overflow-y-auto border-r border-borda bg-void py-3">
      <ItemDoTrilho
        rotulo="Início"
        ativo={rota.tela === 'inicio' || rota.tela === 'dm'}
        mencoes={mencoesDiretas}
        aoAbrir={() => navegar({ tela: 'inicio', aba: 'online' })}
      >
        <Marca tamanho={24} />
      </ItemDoTrilho>
      <span aria-hidden className="h-px w-7 shrink-0 bg-borda" />
      {servidores.map((g) => (
        <ServidorNoTrilho key={g.id} id={g.id} ativo={guildAtual === g.id} />
      ))}
      <Dica texto="Criar ou entrar num servidor (em breve)" lado="right">
        <button
          type="button"
          disabled
          aria-label="Criar ou entrar num servidor (em breve)"
          className="grid size-11 shrink-0 place-items-center border border-dashed border-borda-2 text-texto-3 disabled:opacity-40"
        >
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      </Dica>
    </nav>
  );
}

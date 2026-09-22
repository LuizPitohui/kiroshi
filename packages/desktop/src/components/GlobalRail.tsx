import { useState } from 'react';
import { selectors, useGuildList, useStore } from '../store/index.js';
import { CreateGuildModal } from './modals/CreateGuildModal.js';
import { Plus, Users } from './Icons.js';

/**
 * Barra global: a coluna mais externa, sempre visivel.
 *
 * Ela e a resposta para "onde eu estou": inicio, um servidor, ou outro. Antes
 * os servidores viviam em uma tira horizontal de 38px no topo da mesma coluna
 * dos canais, para economizar largura. Economizava, e custava o principal —
 * com alguns servidores a tira rolava lateralmente, o destaque do ativo
 * disputava espaco com o nome do servidor logo abaixo, e nao havia lugar fixo
 * para o que e global.
 *
 * Separar custa 72px permanentes de largura. Paga isso deixando evidente, o
 * tempo todo e no mesmo pixel, em que comunidade a pessoa esta.
 *
 * O servidor ativo e marcado por FORMA e POSICAO, nao so por cor: um tracinho
 * colado na borda esquerda, que aparece tambem para quem nao distingue o
 * ciano do cinza.
 *
 * Perfil e ajustes nao ficam aqui de proposito: eles ja tem lugar fixo na
 * barra de baixo, junto do estado da conexao. Repetir seria dar dois caminhos
 * para a mesma coisa e gastar a base da coluna com isso.
 */
export function GlobalRail() {
  const guilds = useGuildList();
  const selectedGuildId = useStore((s) => s.selectedGuildId);
  const selectGuild = useStore((s) => s.selectGuild);
  const estado = useStore();

  const [criandoServidor, setCriandoServidor] = useState(false);

  return (
    <nav className="rail" aria-label="Servidores">
      <div
        className={`rail-slot ${selectedGuildId === null ? 'active' : ''}`}
        onClick={() => selectGuild(null)}
      >
        <button
          className="rail-btn rail-home"
          title="Inicio e mensagens diretas"
          aria-label="Inicio e mensagens diretas"
          aria-current={selectedGuildId === null ? 'page' : undefined}
        >
          <Users size={19} />
        </button>
      </div>

      <div className="rail-divider" />

      <div className="rail-lista">
        {guilds.map((g) => {
          const mencoes = selectors.guildMentionCount(estado, g.id);
          const naoLido = g.channelIds.some((id) => selectors.unreadCount(estado, id) > 0);
          const ativo = selectedGuildId === g.id;

          return (
            <div
              key={g.id}
              className={['rail-slot', ativo ? 'active' : '', naoLido ? 'unread' : '']
                .filter(Boolean)
                .join(' ')}
              // Distingue um servidor de verdade do atalho de inicio e do
              // botao de criar, que dividem a mesma classe de posicionamento.
              data-guild={g.id}
              onClick={() => selectGuild(g.id)}
            >
              <button
                className="rail-btn rail-server"
                title={g.name}
                aria-label={g.name}
                aria-current={ativo ? 'page' : undefined}
              >
                {g.iconUrl ? <img src={g.iconUrl} alt="" draggable={false} /> : iniciais(g.name)}
              </button>
              {mencoes > 0 && <span className="rail-badge">{mencoes > 99 ? '99' : mencoes}</span>}
            </div>
          );
        })}
      </div>

      {/*
        O clique fica no proprio botao.

        Antes morava no `div` em volta, e so funcionava por sorte: o clique do
        botao subia ate ele. Pelo teclado tambem subia, entao nao era um
        defeito visivel — era um que esperava alguem mudar a propagacao para
        aparecer.
      */}
      <div className="rail-slot">
        <button
          className="rail-btn rail-add"
          onClick={() => setCriandoServidor(true)}
          title="Criar servidor"
          aria-label="Criar servidor"
        >
          <Plus size={17} />
        </button>
      </div>

      {criandoServidor && <CreateGuildModal onClose={() => setCriandoServidor(false)} />}
    </nav>
  );
}

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

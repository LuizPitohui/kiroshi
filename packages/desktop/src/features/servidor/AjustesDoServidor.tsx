import { useState, type ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import { navegar, useRota, type PaginaDeAjusteDoServidor } from '../../app/rotas.js';
import { useStore } from '../../store/index.js';
import { BotaoIcone, EstadoVazio, cx } from '../../design/primitivos/index.js';
import { podeVerPagina, usePoder } from './poder.js';
import { PaginaVisaoGeral } from './VisaoGeral.js';
import { PaginaMembros } from './Membros.js';
import { PaginaCargos } from './Cargos.js';
import { PaginaConvites } from './Convites.js';
import { PaginaBanimentos } from './Banimentos.js';
import { PaginaCanais } from './Canais.js';
import { PaginaEmojis } from './Emojis.js';
import { PaginaSons } from './Sons.js';
import { PaginaAuditoria } from './Auditoria.js';
import { JanelaDeExcluirServidor } from './ExcluirServidor.js';

const GRUPOS: { rotulo: string; paginas: { pagina: PaginaDeAjusteDoServidor; nome: string }[] }[] = [
  { rotulo: 'Servidor', paginas: [{ pagina: 'visao-geral', nome: 'Visão geral' }] },
  {
    rotulo: 'Pessoas',
    paginas: [
      { pagina: 'membros', nome: 'Membros' },
      { pagina: 'cargos', nome: 'Cargos' },
      { pagina: 'convites', nome: 'Convites' },
      { pagina: 'banimentos', nome: 'Banimentos' },
    ],
  },
  {
    rotulo: 'Conteúdo',
    paginas: [
      { pagina: 'canais', nome: 'Canais' },
      { pagina: 'emojis', nome: 'Emojis' },
      { pagina: 'soundboard', nome: 'Soundboard' },
    ],
  },
  { rotulo: 'Moderação', paginas: [{ pagina: 'auditoria', nome: 'Registro de auditoria' }] },
];

const NOMES = Object.fromEntries(GRUPOS.flatMap((g) => g.paginas.map((p) => [p.pagina, p.nome]))) as Record<PaginaDeAjusteDoServidor, string>;

function Pagina({ pagina, guildId }: { pagina: PaginaDeAjusteDoServidor; guildId: string }): ReactNode {
  switch (pagina) {
    case 'visao-geral':
      return <PaginaVisaoGeral guildId={guildId} />;
    case 'membros':
      return <PaginaMembros guildId={guildId} />;
    case 'cargos':
      return <PaginaCargos guildId={guildId} />;
    case 'convites':
      return <PaginaConvites guildId={guildId} />;
    case 'banimentos':
      return <PaginaBanimentos guildId={guildId} />;
    case 'canais':
      return <PaginaCanais guildId={guildId} />;
    case 'emojis':
      return <PaginaEmojis guildId={guildId} />;
    case 'soundboard':
      return <PaginaSons guildId={guildId} />;
    case 'auditoria':
      return <PaginaAuditoria guildId={guildId} />;
  }
}

/**
 * Ajustes do servidor (10-front-end-novo.md 4.7), organizados como o Discord.
 * Cada pagina aparece so para quem tem a permissao que o servidor pede para
 * ela — a 1.x mostrava as abas a quem tivesse MANAGE_GUILD e deixava o resto
 * falhar em silencio.
 */
export function AjustesDoServidor({ guildId, pagina }: { guildId: string; pagina: PaginaDeAjusteDoServidor }) {
  const rota = useRota();
  const nome = useStore((s) => s.guilds.get(guildId)?.name ?? '');
  const poder = usePoder(guildId);
  const [excluindo, setExcluindo] = useState(false);
  const fechar = () =>
    history.length > 1 ? history.back() : navegar({ tela: 'servidor', guildId, canalId: null });

  const largura = pagina === 'cargos' || pagina === 'canais' ? 'max-w-[1040px]' : 'max-w-[760px]';

  return (
    <div
      className="flex h-full min-h-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) fechar();
      }}
    >
      <nav aria-label="Páginas dos ajustes do servidor" className="k-rolagem flex w-56 shrink-0 flex-col overflow-y-auto border-r border-borda bg-deck px-3 py-6">
        <p className="mb-4 truncate px-2 font-display text-16 font-bold uppercase tracking-[0.1em] text-texto">{nome}</p>
        {GRUPOS.map((grupo) => {
          const visiveis = grupo.paginas.filter((p) => podeVerPagina(poder, p.pagina));
          if (visiveis.length === 0) return null;
          return (
            <div key={grupo.rotulo} className="mb-4">
              <p className="k-rotulo px-2 pb-1.5">{grupo.rotulo}</p>
              <ul>
                {visiveis.map((p) => {
                  const ativa = p.pagina === pagina;
                  return (
                    <li key={p.pagina}>
                      <button
                        type="button"
                        aria-current={ativa ? 'page' : undefined}
                        onClick={() => navegar({ tela: 'ajustes-servidor', guildId, pagina: p.pagina }, { substituir: true })}
                        className={cx(
                          'relative flex h-8 w-full items-center px-2 text-left text-14',
                          ativa ? 'bg-elevado text-texto' : 'text-texto-2 hover:bg-terminal hover:text-texto',
                        )}
                      >
                        {ativa ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" /> : null}
                        {p.nome}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {poder?.dono ? (
          <button
            type="button"
            onClick={() => setExcluindo(true)}
            className="mt-auto flex h-8 items-center gap-2 px-2 text-left text-14 text-perigo hover:bg-terminal"
          >
            <Trash2 aria-hidden className="size-4" strokeWidth={1.5} />
            Excluir servidor
          </button>
        ) : null}
      </nav>
      <section aria-labelledby="titulo-ajustes-servidor" className="k-rolagem min-w-0 flex-1 overflow-y-auto">
        <div className={cx('mx-auto px-8 py-8', largura)}>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="k-rotulo mb-1">Ajustes do servidor</p>
              <h1 id="titulo-ajustes-servidor" className="font-display text-28 font-bold uppercase tracking-display">
                {NOMES[pagina]}
              </h1>
            </div>
            <BotaoIcone rotulo="Fechar" atalho="Esc" onClick={fechar} icone={<X className="size-5" strokeWidth={1.5} />} tamanho="lg" />
          </div>
          {!poder ? null : podeVerPagina(poder, pagina) ? (
            <Pagina key={`${guildId}:${pagina}`} pagina={pagina} guildId={guildId} />
          ) : (
            <EstadoVazio rotulo="sem acesso" titulo="Esta página não é para o seu cargo">
              Quem administra o servidor pode dar a permissão que ela pede.
            </EstadoVazio>
          )}
        </div>
      </section>
      {excluindo && rota.tela === 'ajustes-servidor' ? <JanelaDeExcluirServidor guildId={guildId} aoFechar={() => setExcluindo(false)} /> : null}
    </div>
  );
}

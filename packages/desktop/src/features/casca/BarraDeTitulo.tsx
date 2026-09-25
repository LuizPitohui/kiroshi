import { Hash, Minus, Square, Volume2, X } from 'lucide-react';
import { useStore } from '../../store/index.js';
import { useRota } from '../../app/rotas.js';
import { Marca } from './Marca.js';

/**
 * Barra de titulo propria (a janela nao tem moldura): marca, onde a pessoa
 * esta, e os botoes da janela. A barra inteira arrasta a janela; os botoes
 * nao.
 */
export function BarraDeTitulo(): React.JSX.Element {
  const rota = useRota();
  const servidor = useStore((s) => (rota.tela === 'servidor' || rota.tela === 'ajustes-servidor' ? s.guilds.get(rota.guildId)?.name : undefined));
  const canal = useStore((s) => {
    if (rota.tela === 'servidor' && rota.canalId) return s.channels.get(rota.canalId);
    return undefined;
  });

  return (
    <header className="flex h-8 shrink-0 items-center gap-4 border-b border-borda bg-void pl-3 [-webkit-app-region:drag]">
      <div className="flex items-center gap-2">
        <Marca tamanho={20} />
        <span className="font-display text-16 font-bold tracking-[0.16em] text-texto">KIROSHI</span>
      </div>

      <nav aria-label="Onde você está" className="flex min-w-0 items-center gap-2 font-mono text-11 uppercase tracking-rotulo text-texto-3">
        {rota.tela === 'inicio' || rota.tela === 'dm' ? <span>Início</span> : null}
        {rota.tela === 'ajustes' ? <span className="text-texto">Configurações</span> : null}
        {servidor ? <span className="truncate">{servidor}</span> : null}
        {rota.tela === 'ajustes-servidor' ? (
          <>
            <span className="text-mudo">›</span>
            <span className="text-texto">Ajustes do servidor</span>
          </>
        ) : null}
        {canal ? (
          <>
            <span className="text-mudo">›</span>
            <span className="flex items-center gap-1.5 truncate text-texto">
              {canal.type === 'GUILD_VOICE' ? (
                <Volume2 aria-hidden className="size-3.5" strokeWidth={1.5} />
              ) : (
                <Hash aria-hidden className="size-3.5" strokeWidth={1.5} />
              )}
              {canal.name}
            </span>
          </>
        ) : null}
      </nav>

      <div className="ml-auto flex h-full [-webkit-app-region:no-drag]">
        <button
          type="button"
          aria-label="Minimizar"
          onClick={() => window.kiroshi.window.minimize()}
          className="grid h-full w-11 place-items-center text-texto-3 hover:bg-elevado hover:text-texto"
        >
          <Minus className="size-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Maximizar ou restaurar"
          onClick={() => window.kiroshi.window.maximize()}
          className="grid h-full w-11 place-items-center text-texto-3 hover:bg-elevado hover:text-texto"
        >
          <Square className="size-3" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Fechar (continua na bandeja)"
          onClick={() => window.kiroshi.window.close()}
          className="grid h-full w-11 place-items-center text-texto-3 hover:bg-vivo hover:text-branco"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

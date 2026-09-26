import { useEffect } from 'react';
import { Download, Hash, Minus, Square, Volume2, X } from 'lucide-react';
import { useStore } from '../../store/index.js';
import { useRota } from '../../app/rotas.js';
import { usePreferenciasDoApp } from '../../app/preferenciasDoApp.js';
import { ouvirAtualizacao, prontaParaReiniciar, useAtualizacao } from '../../app/atualizacao.js';
import { Marca } from './Marca.js';

/**
 * Barra de titulo propria (a janela nao tem moldura): marca, onde a pessoa
 * esta, e os botoes da janela. A barra inteira arrasta a janela; os botoes
 * nao.
 */
export function BarraDeTitulo(): React.JSX.Element {
  const rota = useRota();
  // O X diz o que faz: esconde na bandeja ou fecha de vez (Configuracoes > Windows).
  const fecharParaBandeja = usePreferenciasDoApp((s) => s.preferencias?.fecharParaBandeja ?? true);
  // Versao nova pronta: o selo fica aqui mesmo depois do "Depois" do aviso.
  const pronta = useAtualizacao((s) => prontaParaReiniciar(s.atualizacao));
  const aoSairDaChamada = useAtualizacao((s) => s.aoSairDaChamada);
  useEffect(() => {
    void usePreferenciasDoApp.getState().carregar();
    ouvirAtualizacao();
  }, []);
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
        {pronta ? (
          <button
            type="button"
            onClick={() => useAtualizacao.getState().mostrar()}
            title={aoSairDaChamada ? 'O Kiroshi reinicia sozinho quando você sair da chamada' : 'Versão nova pronta: reiniciar para atualizar'}
            className="mr-2 flex items-center gap-1.5 self-center border border-acento/60 bg-acento/15 px-2 py-0.5 font-mono text-10 uppercase tracking-rotulo text-texto hover:bg-acento hover:text-sobre-acento"
          >
            <Download aria-hidden className="size-3" strokeWidth={1.75} />
            {aoSairDaChamada ? 'Reinicia ao sair da chamada' : 'Atualização pronta'}
          </button>
        ) : null}
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
          aria-label={fecharParaBandeja ? 'Fechar (continua na bandeja)' : 'Fechar o Kiroshi'}
          title={fecharParaBandeja ? 'Fechar (continua na bandeja)' : 'Fechar o Kiroshi'}
          onClick={() => window.kiroshi.window.close()}
          className="grid h-full w-11 place-items-center text-texto-3 hover:bg-vivo hover:text-branco"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

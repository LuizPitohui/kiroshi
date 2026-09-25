import type { ReactNode } from 'react';
import { LogOut, X } from 'lucide-react';
import { ROTA_INICIAL, navegar, useRota, type PaginaDeAjuste } from '../../app/rotas.js';
import { BotaoIcone, cx } from '../../design/primitivos/index.js';
import { Aparencia } from './Aparencia.js';
import { PaginaWindows } from './Windows.js';
import { PaginaSobre } from './Sobre.js';
import { PaginaAtalhos } from './Atalhos.js';
import { PaginaTransmissao } from './Transmissao.js';
import { PaginaVozEVideo } from './VozEVideo.js';
import { PaginaNotificacoes } from './Notificacoes.js';
import { PaginaPerfil } from './Perfil.js';
import { PaginaConta, sairDaConta } from './Conta.js';
import { PaginaDiagnostico } from './Diagnostico.js';

const GRUPOS: { rotulo: string; paginas: { pagina: PaginaDeAjuste; nome: string }[] }[] = [
  {
    rotulo: 'Conta',
    paginas: [
      { pagina: 'perfil', nome: 'Meu perfil' },
      { pagina: 'conta', nome: 'Conta e segurança' },
    ],
  },
  {
    rotulo: 'Comunicação',
    paginas: [
      { pagina: 'voz-e-video', nome: 'Voz e vídeo' },
      { pagina: 'transmissao', nome: 'Transmissão' },
      { pagina: 'notificacoes', nome: 'Notificações' },
      { pagina: 'atalhos', nome: 'Atalhos' },
    ],
  },
  {
    rotulo: 'Aplicativo',
    paginas: [
      { pagina: 'aparencia', nome: 'Aparência' },
      { pagina: 'windows', nome: 'Windows' },
      { pagina: 'sobre', nome: 'Sobre e atualizações' },
      { pagina: 'diagnostico', nome: 'Diagnóstico' },
    ],
  },
];

const NOMES: Record<PaginaDeAjuste, string> = Object.fromEntries(
  GRUPOS.flatMap((g) => g.paginas.map((p) => [p.pagina, p.nome])),
) as Record<PaginaDeAjuste, string>;

function Pagina({ pagina }: { pagina: PaginaDeAjuste }): ReactNode {
  switch (pagina) {
    case 'perfil':
      return <PaginaPerfil />;
    case 'conta':
      return <PaginaConta />;
    case 'voz-e-video':
      return <PaginaVozEVideo />;
    case 'transmissao':
      return <PaginaTransmissao />;
    case 'notificacoes':
      return <PaginaNotificacoes />;
    case 'atalhos':
      return <PaginaAtalhos />;
    case 'aparencia':
      return <Aparencia />;
    case 'windows':
      return <PaginaWindows />;
    case 'sobre':
      return <PaginaSobre />;
    case 'diagnostico':
      return <PaginaDiagnostico />;
  }
}

/**
 * Configuracoes (10-front-end-novo.md 4.6), em tres grupos. So o que funciona
 * aparece: cada controle daqui muda alguma coisa de verdade.
 */
export function Ajustes() {
  const rota = useRota();
  const pagina: PaginaDeAjuste = rota.tela === 'ajustes' ? rota.pagina : 'perfil';
  const fechar = () => (history.length > 1 ? history.back() : navegar(ROTA_INICIAL));

  return (
    <div
      className="flex h-full min-h-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) fechar();
      }}
    >
      <nav aria-label="Páginas de configuração" className="k-rolagem flex w-56 shrink-0 flex-col overflow-y-auto border-r border-borda bg-deck px-3 py-6">
        {GRUPOS.map((grupo) => (
          <div key={grupo.rotulo} className="mb-4">
            <p className="k-rotulo px-2 pb-1.5">{grupo.rotulo}</p>
            <ul>
              {grupo.paginas.map((p) => {
                const ativa = p.pagina === pagina;
                return (
                  <li key={p.pagina}>
                    <button
                      type="button"
                      aria-current={ativa ? 'page' : undefined}
                      onClick={() => navegar({ tela: 'ajustes', pagina: p.pagina }, { substituir: true })}
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
        ))}
        <button
          type="button"
          onClick={() => void sairDaConta()}
          className="mt-auto flex h-8 items-center gap-2 px-2 text-left text-14 text-perigo hover:bg-terminal"
        >
          <LogOut aria-hidden className="size-4" strokeWidth={1.5} />
          Sair da conta
        </button>
      </nav>
      <section aria-labelledby="titulo-ajustes" className="k-rolagem min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 py-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="k-rotulo mb-1">Configurações</p>
              <h1 id="titulo-ajustes" className="font-display text-28 font-bold uppercase tracking-display">
                {NOMES[pagina]}
              </h1>
            </div>
            <BotaoIcone rotulo="Fechar" atalho="Esc" onClick={fechar} icone={<X className="size-5" strokeWidth={1.5} />} tamanho="lg" />
          </div>
          <Pagina pagina={pagina} />
        </div>
      </section>
    </div>
  );
}

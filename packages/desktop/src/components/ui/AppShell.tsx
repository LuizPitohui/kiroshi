import { useEffect, useState, type ReactNode } from 'react';
import { Drawer } from './Drawer.js';
import { ContextPanel } from './ContextPanel.js';
import { Users, Chevron } from '../Icons.js';
import { BarraDeEstado } from '../BarraDeEstado.js';

/**
 * A casca: as regioes da aplicacao e como elas cedem espaco.
 *
 * Existe para que a regra de responsividade fique em UM lugar. Sem isso cada
 * tela decide sozinha quando esconder a coluna da direita, e o resultado sao
 * larguras diferentes escondendo coisas diferentes na mesma janela.
 *
 * Uma prioridade manda em tudo: a AREA PRINCIPAL nunca encolhe por causa de
 * painel auxiliar. Quando o espaco aperta, quem sai e o auxiliar — e sair aqui
 * quer dizer virar gaveta, nunca desaparecer. Uma coluna que some sem deixar
 * como abri-la e uma funcao perdida, nao uma adaptacao.
 *
 *   >= 1440   barra | canais | conteudo | painel
 *   >= 1024   barra | canais | conteudo          painel em gaveta
 *   >=  768   barra | conteudo                   canais e painel em gaveta
 *    <  768   conteudo                           tudo em gaveta
 *
 * A medida e do ESPACO DISPONIVEL, nao do nome do aparelho. Isso importa em
 * zoom: a 200% uma janela de 1920px tem 960px efetivos e precisa se comportar
 * como uma janela de 960px — que e o que a especificacao pede ao dizer para
 * reduzir colunas antes de comprimir texto.
 */

export type Largura = 'compacta' | 'media' | 'grande' | 'completa';

function medir(): Largura {
  // `clientWidth` do elemento raiz, e nao `innerWidth`: ele ja vem em pixels
  // de CSS, entao o zoom do navegador aparece na conta.
  const w = document.documentElement.clientWidth;
  if (w >= 1440) return 'completa';
  if (w >= 1024) return 'grande';
  if (w >= 768) return 'media';
  return 'compacta';
}

export function useLarguraDaJanela(): Largura {
  const [largura, setLargura] = useState<Largura>(medir);

  useEffect(() => {
    const aoMudar = (): void => setLargura(medir());
    window.addEventListener('resize', aoMudar);
    return () => window.removeEventListener('resize', aoMudar);
  }, []);

  return largura;
}

export interface RegiaoLateral {
  titulo: string;
  conteudo: ReactNode;
  /**
   * Onde guardar a largura escolhida para esta regiao.
   *
   * Sem chave o painel abre sempre no mesmo tamanho. Cada uso tem a sua: a
   * conversa da chamada e a lista de membros querem larguras diferentes, e
   * herdar uma da outra desfaz o ajuste toda vez que se troca de canal.
   */
  chave?: string;
}

export interface AppShellProps {
  /** Barra global, 72px. Sai so na largura compacta. */
  rail: ReactNode;
  /** Navegacao contextual. Vira gaveta a partir da largura media. */
  sidebar: RegiaoLateral;
  /** Conteudo. Nunca cede espaco para os outros. */
  main: ReactNode;
  /** Painel da direita. O primeiro a virar gaveta quando aperta. */
  panel?: RegiaoLateral;
  /** Se o painel esta aberto. Quem decide e a tela, nao a casca. */
  painelAberto?: boolean;
  aoFecharPainel?: () => void;
  /** Barra de baixo, sempre presente. */
  dock?: ReactNode;
}

export function AppShell({
  rail,
  sidebar,
  main,
  panel,
  painelAberto = false,
  aoFecharPainel,
  dock,
}: AppShellProps) {
  const largura = useLarguraDaJanela();
  const [gavetaDeCanais, setGavetaDeCanais] = useState(false);

  const railVisivel = largura !== 'compacta';
  const canaisEmColuna = largura === 'completa' || largura === 'grande';
  const painelEmColuna = largura === 'completa';

  /*
    Fechar a gaveta quando a coluna volta a caber.

    Sem isso, alargar a janela com a gaveta aberta deixa as duas na tela: a
    coluna de canais atras e a mesma coluna por cima, em gaveta.
  */
  useEffect(() => {
    if (canaisEmColuna) setGavetaDeCanais(false);
  }, [canaisEmColuna]);

  return (
    <>
      {/*
        O primeiro item da ordem de tabulacao, escondido ate receber foco.

        Sem ele, chegar na conversa pelo teclado exige atravessar a barra de
        servidores e a lista inteira de canais — toda vez que a janela abre, e
        de novo a cada recarga. Com dez canais ja sao dez Tabs antes da
        primeira mensagem.
      */}
      <a className="pular-para-conteudo" href="#conteudo">
        Pular para a conversa
      </a>

      <div className={`app-body largura-${largura}`}>
        {railVisivel && rail}

        {canaisEmColuna ? (
          sidebar.conteudo
        ) : (
          /*
            O botao que devolve o acesso a navegacao.

            E o que impede a adaptacao de virar perda: a coluna saiu da tela,
            mas continua a um clique — e a um Tab, porque e um botao de
            verdade e nao um gesto.
          */
          <button
            className="abrir-canais"
            onClick={() => setGavetaDeCanais(true)}
            aria-label={`Abrir ${sidebar.titulo}`}
            title={sidebar.titulo}
          >
            <Chevron size={16} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        )}

        {/*
          `main`, e nao `div`.

          E o marco que leitor de tela usa para saltar direto ao conteudo, e o
          aplicativo nao tinha nenhum: a arvore era uma pilha de `div` sem
          nome, e navegar por marcos — que e como se anda rapido numa pagina —
          nao levava a lugar nenhum. O `tabIndex={-1}` deixa o atalho acima
          mover o foco para ca sem por a regiao inteira na ordem de tabulacao.
        */}
        <main className="center" id="conteudo" tabIndex={-1} aria-label="Conversa">
          {main}
        </main>

        {/*
          Em coluna o painel vem dentro do `ContextPanel`, que da a ele o
          cabecalho, o botao de fechar e a alca de largura. Em gaveta nao:
          a gaveta ja tem cabecalho proprio e largura fixa, e ali nao ha do
          que roubar espaco — ela cobre, nao divide.
        */}
        {panel && painelEmColuna && painelAberto && (
          <ContextPanel titulo={panel.titulo} chave={panel.chave} aoFechar={aoFecharPainel}>
            {panel.conteudo}
          </ContextPanel>
        )}
      </div>

      {dock}

      {/*
        A faixa vai ABAIXO do dock, encostada no fim da janela.

        O dock e onde se AGE — microfone, camera, sair da chamada. A faixa e
        onde se LE. Empilhar as duas mantem cada uma com um proposito so, e a
        de baixo nunca recebe um clique por acidente porque nao ha nada
        clicavel nela.
      */}
      <BarraDeEstado />

      {/* As gavetas ficam fora do fluxo: elas cobrem, nao empurram. */}
      {!canaisEmColuna && (
        <Drawer
          aberto={gavetaDeCanais}
          aoFechar={() => setGavetaDeCanais(false)}
          titulo={sidebar.titulo}
          lado="esquerda"
          largura={280}
        >
          {sidebar.conteudo}
        </Drawer>
      )}

      {panel && !painelEmColuna && (
        <Drawer
          aberto={painelAberto}
          aoFechar={() => aoFecharPainel?.()}
          titulo={panel.titulo}
          largura={320}
        >
          {panel.conteudo}
        </Drawer>
      )}
    </>
  );
}

/** Icone do botao de membros, reexportado para quem monta o painel. */
export { Users as IconeDeMembros };

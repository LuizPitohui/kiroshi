import { useEffect, useRef } from 'react';

/**
 * O comportamento que toda camada sobreposta precisa ter.
 *
 * Dialogo, gaveta, balao e menu de contexto sao coisas diferentes na tela e a
 * mesma coisa no teclado: abrem por cima, prendem o foco enquanto estao
 * abertos, fecham no Esc e devolvem o foco para quem os abriu. Escrever isso
 * quatro vezes garante quatro versoes ligeiramente diferentes, e a que
 * esquecer de devolver o foco so aparece para quem usa leitor de tela.
 *
 * O que este gancho garante:
 *
 *   Esc fecha, e so a camada mais alta responde. Um dialogo aberto sobre um
 *   balao nao pode fechar os dois com uma tecla.
 *
 *   O foco entra na camada ao abrir e nao sai dela por Tab. Sem isso o Tab
 *   passeia pela tela atras, que esta inerte e invisivel para quem enxerga.
 *
 *   O foco volta exatamente para o elemento que abriu, ao fechar. E o que
 *   permite continuar a navegacao de onde parou.
 *
 *   Clique fora fecha, quando a camada permite. Menu e balao sim; dialogo com
 *   formulario preenchido, nao — perder o que foi digitado por um clique
 *   errado e pior do que um passo a mais para sair.
 */

/** Pilha de camadas abertas. O Esc so chega na do topo. */
const pilha: symbol[] = [];

/**
 * Quem abriu a camada, registrado no CLIQUE.
 *
 * Duas tentativas anteriores falharam, e o motivo de cada uma vale ficar
 * escrito porque as duas parecem corretas no papel.
 *
 * A primeira capturava `document.activeElement` quando a camada abre. Chega
 * tarde: um campo com `autoFocus` dentro do dialogo ja recebeu o foco nesse
 * momento, entao o que se guardava como "quem abriu" era o proprio campo, que
 * some junto com o dialogo. O foco terminava no `body`.
 *
 * A segunda ouvia `focusin` para guardar o ultimo foco de fora. Nao funciona
 * quando a JANELA nao tem o foco do sistema: o Chromium muda o
 * `activeElement` e nao emite evento de foco nenhum. Medido em teste
 * automatizado, onde a janela roda em segundo plano — o registro ficava vazio
 * e caia de volta no defeito anterior.
 *
 * O clique resolve os dois casos: dispara com a janela em qualquer estado, em
 * fase de captura chega antes do React, e o alvo e literalmente o controle que
 * abriu a camada. Teclado tambem passa por aqui — Enter e Espaco em um botao
 * geram um evento de clique.
 */
let ultimoGatilho: HTMLElement | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const alvo = e.target;
      if (!(alvo instanceof HTMLElement)) return;

      // O que esta dentro de uma camada nao foi quem a abriu.
      if (alvo.closest('[role="dialog"], [role="menu"]')) return;

      // O controle, e nao o icone dentro dele: um <svg> nao recebe foco.
      ultimoGatilho = alvo.closest<HTMLElement>('button, a[href], [tabindex]') ?? alvo;
    },
    true,
  );
}

/** O que o navegador considera focavel, em ordem de tabulacao. */
const FOCAVEIS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface OpcoesDaCamada {
  /** Fechar ao clicar fora. Menu e balao sim; dialogo com formulario, nao. */
  fecharAoClicarFora?: boolean;
  /**
   * Prender o foco dentro da camada.
   *
   * Um balao que so mostra texto nao precisa prender; um dialogo com campos,
   * sim. Prender onde nao ha nada focavel deixaria a pessoa presa sem saida.
   */
  prenderFoco?: boolean;
}

/**
 * Liga o comportamento de camada a um elemento.
 *
 * Devolve a referencia que deve ir no elemento raiz da camada.
 */
export function useCamada<T extends HTMLElement>(
  aberto: boolean,
  aoFechar: () => void,
  opcoes: OpcoesDaCamada = {},
): React.RefObject<T | null> {
  const { fecharAoClicarFora = true, prenderFoco = true } = opcoes;

  const caixa = useRef<T>(null);
  const quemAbriu = useRef<HTMLElement | null>(null);

  // `aoFechar` costuma ser uma funcao nova a cada render. Guardar em ref evita
  // religar os ouvintes a cada passagem, que e o que faz um clique de abertura
  // ser ouvido pelo proprio ouvinte de "clique fora" e fechar na hora.
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;

    const marca = Symbol('camada');

    /*
      Captura ANTES de entrar na pilha, e prefere o registro externo.

      O que esta focado agora pode ja ser um campo desta camada, por causa de
      `autoFocus`. O registro externo guarda o ultimo foco de fora, que e o
      que se quer devolver.
    */
    const atual = document.activeElement;
    quemAbriu.current = ultimoGatilho ?? (atual instanceof HTMLElement ? atual : null);

    pilha.push(marca);

    // O foco vai para o primeiro elemento util, ou para a propria caixa
    // quando nao ha nenhum — nunca fica no elemento de tras.
    const primeiro = caixa.current?.querySelector<HTMLElement>(FOCAVEIS);
    (primeiro ?? caixa.current)?.focus?.();

    const naTecla = (e: KeyboardEvent): void => {
      if (pilha[pilha.length - 1] !== marca) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        fechar.current();
        return;
      }

      if (e.key !== 'Tab' || !prenderFoco) return;

      const alvos = [...(caixa.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])];
      if (alvos.length === 0) return;

      const primeiroAlvo = alvos[0]!;
      const ultimo = alvos[alvos.length - 1]!;
      const atual = document.activeElement;

      // Circula: do ultimo volta ao primeiro, e do primeiro com Shift vai ao
      // ultimo. Sem isso o Tab escapa para a pagina de tras.
      if (e.shiftKey && (atual === primeiroAlvo || !caixa.current?.contains(atual))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault();
        primeiroAlvo.focus();
      }
    };

    const noPonteiro = (e: MouseEvent): void => {
      if (!fecharAoClicarFora) return;
      if (pilha[pilha.length - 1] !== marca) return;
      if (caixa.current?.contains(e.target as Node)) return;
      fechar.current();
    };

    document.addEventListener('keydown', naTecla, true);
    // `mousedown` e nao `click`: fechar no clique deixaria o alvo de tras
    // receber o clique tambem, ativando o que estava embaixo da camada.
    document.addEventListener('mousedown', noPonteiro, true);

    return () => {
      document.removeEventListener('keydown', naTecla, true);
      document.removeEventListener('mousedown', noPonteiro, true);

      const i = pilha.indexOf(marca);
      if (i >= 0) pilha.splice(i, 1);

      /*
        Devolve o foco, com duas ressalvas.

        Nao devolve se o foco ja foi para outro lugar de proposito — roubar de
        volta atrapalharia quem clicou adiante enquanto a camada fechava.

        E nao tenta devolver para quem saiu da tela. Acontece de verdade: um
        item de menu que abre um dialogo e desaparece junto com o menu. Chamar
        `focus()` num elemento fora do documento nao faz nada, e o silencio
        aqui e proposital — nao ha para onde voltar.
      */
      const alvo = quemAbriu.current;
      const foiEmbora = !alvo || !document.contains(alvo);
      const aindaNaCamada = caixa.current?.contains(document.activeElement);

      if (!foiEmbora && (aindaNaCamada || document.activeElement === document.body)) {
        alvo.focus?.();
      }
    };
  }, [aberto, fecharAoClicarFora, prenderFoco]);

  return caixa;
}

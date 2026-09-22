import { useEffect } from 'react';
import { Warning } from '../Icons.js';

/**
 * A barra que aparece quando ha alteracao nao salva.
 *
 * Substitui um botao "Salvar alteracoes" que ficava sempre la, sempre igual,
 * no fim da coluna. Dois problemas com aquilo, e o segundo e o grave.
 *
 * O primeiro: um botao sempre visivel nao informa nada. Nao da para saber, de
 * relance, se ha algo pendente ou se ja esta tudo salvo.
 *
 * O segundo: nada avisava ao sair. Trocar de secao ou fechar os ajustes com o
 * nome pela metade descartava tudo em silencio. O trabalho perdido era
 * pequeno — uma linha de biografia — e o jeito de perder era o pior possivel:
 * sem aviso, sem desfazer, sem sinal de que algo tinha acontecido.
 *
 * Por isso ela fica presa embaixo e sobrepoe o conteudo em vez de empurra-lo.
 * Uma barra que entra no fluxo desloca a coluna inteira toda vez que alguem
 * digita a primeira letra.
 */

export interface UnsavedBarProps {
  /** Ha algo para salvar. Quando falso, a barra nao existe. */
  visivel: boolean;
  aoSalvar: () => void;
  aoDescartar: () => void;
  salvando?: boolean;
  /** Mensagem de erro da ultima tentativa, no lugar do texto normal. */
  erro?: string | null;
  texto?: string;
  /**
   * Avisar antes de fechar a janela. Ligado, que e o que o produto quer.
   *
   * Existe para poder ser DESLIGADO na vitrine. La a barra aparece como
   * demonstracao, sem nada de verdade para perder — e o guarda de saida, que
   * nao sabe disso, travava o recarregamento da pagina inteira. Custou uma
   * hora de investigacao achando que o empacotador e que estava servindo
   * codigo velho.
   */
  avisarAoSair?: boolean;
}

export function UnsavedBar({
  visivel,
  aoSalvar,
  aoDescartar,
  salvando = false,
  erro,
  texto = 'Voce tem alteracoes nao salvas.',
  avisarAoSair = true,
}: UnsavedBarProps) {
  /*
    Avisa antes de fechar a janela com algo pendente.

    O aviso do navegador e feio e nao da para escrever o texto dele, mas e a
    unica coisa que alcanca o botao de fechar da janela. Sem ele, fechar o
    aplicativo com o perfil pela metade perde tudo sem uma palavra.
  */
  useEffect(() => {
    if (!visivel || !avisarAoSair) return;
    const aoSair = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
  }, [visivel, avisarAoSair]);

  if (!visivel) return null;

  return (
    <div
      className={`barra-nao-salvo ${erro ? 'com-erro' : ''}`}
      // Anuncia sozinha: quem usa leitor de tela nao ve a barra entrar, e
      // "assertive" porque o aviso perde o sentido depois de a pessoa sair.
      role="alert"
      aria-live="assertive"
    >
      <Warning size={16} className="barra-icone" aria-hidden="true" />
      <span className="barra-texto">{erro ?? texto}</span>

      <button className="btn" onClick={aoDescartar} disabled={salvando}>
        Descartar
      </button>
      <button className="btn btn-primary" onClick={aoSalvar} disabled={salvando}>
        {salvando ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  );
}

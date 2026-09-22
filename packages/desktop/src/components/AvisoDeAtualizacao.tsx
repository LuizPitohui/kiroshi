import { useEffect, useState } from 'react';
import type { AtualizacaoEstado } from '../../electron/preload.js';

/**
 * Aviso de que ha uma versao nova pronta.
 *
 * A regra que define esta tela: ela nunca pede para a pessoa baixar nada. O
 * download ja aconteceu sozinho, em segundo plano; aqui so se oferece o
 * reinicio, que leva segundos. Quem ignorar recebe a versao nova no proximo
 * fechamento do aplicativo de qualquer jeito.
 *
 * Por isso tambem nao aparece nada durante o download. Uma barra de progresso
 * para algo que a pessoa nao pediu e que nao a impede de nada e so ruido — e
 * pior, sugere que ela precisa esperar.
 *
 * Falha de atualizacao tambem nao aparece: o aplicativo continua funcionando
 * igual, e a proxima verificacao tenta de novo sozinha. Avisar so transferiria
 * uma preocupacao que nao tem acao do outro lado.
 */
export function AvisoDeAtualizacao() {
  const [estado, setEstado] = useState<AtualizacaoEstado | null>(null);
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    // Pergunta o estado ao abrir: a versao pode ter ficado pronta enquanto a
    // janela estava escondida na bandeja, e o aviso daquele momento se perdeu.
    void window.kiroshi.atualizacao.estado().then(setEstado);
    return window.kiroshi.atualizacao.aoMudar(setEstado);
  }, []);

  if (dispensado) return null;
  if (estado?.fase !== 'pronta') return null;

  return (
    <div className="atualizacao" role="status">
      <span className="atualizacao-texto">
        Versao {estado.versao} pronta. Reiniciar leva alguns segundos.
      </span>

      <button
        className="atualizacao-acao"
        onClick={() => window.kiroshi.atualizacao.instalarEReiniciar()}
      >
        Reiniciar agora
      </button>

      <button
        className="atualizacao-depois"
        onClick={() => setDispensado(true)}
        aria-label="Fechar aviso; a atualizacao entra ao fechar o aplicativo"
      >
        Depois
      </button>
    </div>
  );
}

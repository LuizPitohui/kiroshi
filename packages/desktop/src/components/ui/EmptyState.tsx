import type { ReactNode } from 'react';

/**
 * Estado vazio: o que a tela diz quando nao ha nada para mostrar.
 *
 * A regra que este componente carrega: vazio NAO e ausencia de conteudo, e um
 * conteudo. "Nenhuma conversa aberta" sozinho deixa a pessoa parada; a mesma
 * frase com "Escolha um canal na barra lateral" diz o proximo passo, e com um
 * botao ela nem precisa procurar.
 *
 * Por isso `descricao` e obrigatoria e `acoes` e fortemente esperada. Um vazio
 * sem saida e uma tela quebrada que ninguem chamou de quebrada.
 */

export interface EmptyStateProps {
  /** Um icone grande e apagado, opcional. Nunca substitui o texto. */
  icone?: ReactNode;
  titulo: string;
  /** O proximo passo, em uma frase. Obrigatoria de proposito. */
  descricao: string;
  /** Botoes que executam esse proximo passo. */
  acoes?: ReactNode;
  /** Versao menor, para dentro de uma coluna estreita ou de um cartao. */
  compacto?: boolean;
}

export function EmptyState({ icone, titulo, descricao, acoes, compacto = false }: EmptyStateProps) {
  return (
    <div className={`vazio ${compacto ? 'vazio-compacto' : ''}`}>
      {icone && (
        <div className="vazio-icone" aria-hidden="true">
          {icone}
        </div>
      )}
      <h3 className="vazio-titulo">{titulo}</h3>
      <p className="vazio-descricao">{descricao}</p>
      {acoes && <div className="vazio-acoes">{acoes}</div>}
    </div>
  );
}

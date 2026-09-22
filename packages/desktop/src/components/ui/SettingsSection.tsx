import type { ReactNode } from 'react';

/**
 * Um grupo de ajustes, com titulo e explicacao.
 *
 * A tela de ajustes era uma sequencia de linhas sem agrupamento: dispositivo
 * de audio, limiar de voz, tema e notificacoes na mesma pilha, cada um
 * indistinguivel do seguinte. Isto da a cada bloco um titulo e, quando
 * precisa, uma frase dizendo o que o bloco decide.
 *
 * `<section>` com `aria-labelledby` e nao um `div`: quem navega por titulos
 * pula de grupo em grupo em vez de percorrer trinta controles em fila.
 */

export interface SettingsSectionProps {
  titulo: string;
  /** Uma frase sobre o que este grupo decide. */
  descricao?: string;
  /** Acao do grupo inteiro, alinhada ao titulo. */
  acao?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ titulo, descricao, acao, children }: SettingsSectionProps) {
  const id = `secao-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section className="secao" aria-labelledby={id}>
      <header className="secao-topo">
        <div>
          <h3 className="secao-titulo" id={id}>
            {titulo}
          </h3>
          {descricao && <p className="secao-descricao">{descricao}</p>}
        </div>
        {acao}
      </header>
      <div className="secao-corpo">{children}</div>
    </section>
  );
}

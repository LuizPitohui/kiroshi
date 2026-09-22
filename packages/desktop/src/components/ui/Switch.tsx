import { useId } from 'react';

/**
 * Interruptor de duas posicoes, com rotulo e explicacao.
 *
 * E um `input[type=checkbox]` de verdade por baixo, so que escondido
 * visualmente. Isso nao e detalhe: um `div` com `onClick` e um estilo de
 * chave nao recebe foco por Tab, nao alterna com Espaco, e o leitor de tela
 * nao anuncia se esta ligado ou desligado. Quem tentou reproduzir isso a mao
 * quase sempre esquece um dos tres.
 *
 * A descricao e ligada por `aria-describedby`, entao "Cancelamento de eco" vem
 * acompanhado do motivo, e nao so do nome.
 */

export interface SwitchProps {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  rotulo: string;
  /** Uma linha explicando o efeito de ligar. */
  descricao?: string;
  desabilitado?: boolean;
  /** Por que esta desabilitado. Um controle cinza sem motivo e um enigma. */
  motivo?: string;
}

export function Switch({
  ligado,
  aoMudar,
  rotulo,
  descricao,
  desabilitado = false,
  motivo,
}: SwitchProps) {
  const id = useId();
  const idDescricao = `${id}-descricao`;

  return (
    <div className={`chave-linha ${desabilitado ? 'desabilitada' : ''}`} title={motivo}>
      <div className="chave-texto">
        <label className="chave-rotulo" htmlFor={id}>
          {rotulo}
        </label>
        {descricao && (
          <div className="chave-descricao" id={idDescricao}>
            {descricao}
          </div>
        )}
      </div>

      <input
        id={id}
        type="checkbox"
        className="chave-entrada"
        checked={ligado}
        disabled={desabilitado}
        aria-describedby={descricao ? idDescricao : undefined}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      {/* O desenho da chave. `aria-hidden` porque quem anuncia e o input. */}
      <span className="chave" aria-hidden="true" />
    </div>
  );
}

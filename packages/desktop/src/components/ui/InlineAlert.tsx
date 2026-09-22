import type { ReactNode } from 'react';
import { Check, Close, ErroCirculo, Info, Warning } from '../Icons.js';

/**
 * Aviso preso ao lugar onde o problema esta.
 *
 * Duas regras moldam este componente.
 *
 * A primeira vem da especificacao: erro nao pode depender so do vermelho.
 * Cada tipo tem um ICONE diferente — circulo com X para erro, triangulo para
 * aviso, visto para sucesso, circulo com "i" para informacao. Quem nao
 * distingue as cores continua distinguindo as formas.
 *
 * A segunda vem de um defeito real deste aplicativo: um aviso sem saida vira
 * mobilia. A mensagem de queda de voz ficava na barra de baixo sem nenhum
 * botao de fechar, e permanecia la depois do problema ter passado, dizendo
 * que a internet nao tinha IPv6 para alguem que estava conversando
 * normalmente. Por isso `aoDispensar` existe e aparece como um X de verdade.
 *
 * Aviso passageiro e `Toast`. Este fica onde o problema esta, e so sai quando
 * o problema sai — ou quando a pessoa fecha.
 */

export type TipoDeAviso = 'info' | 'sucesso' | 'aviso' | 'erro';

const ICONE = { info: Info, sucesso: Check, aviso: Warning, erro: ErroCirculo } as const;

/** Prefixo que o leitor de tela anuncia; a cor nao chega ate ele. */
const NOME = { info: 'Informacao', sucesso: 'Sucesso', aviso: 'Atencao', erro: 'Erro' } as const;

export interface InlineAlertProps {
  tipo?: TipoDeAviso;
  titulo?: string;
  children: ReactNode;
  /** Botoes de recuperacao: tentar de novo, ver detalhes, desfazer. */
  acoes?: ReactNode;
  aoDispensar?: () => void;
}

export function InlineAlert({
  tipo = 'info',
  titulo,
  children,
  acoes,
  aoDispensar,
}: InlineAlertProps) {
  const Icone = ICONE[tipo];

  return (
    <div
      className={`aviso aviso-${tipo}`}
      // Erro interrompe a leitura; o resto espera a vez. Um "salvo com
      // sucesso" que corta a frase do leitor de tela atrapalha mais do que
      // informa.
      role={tipo === 'erro' ? 'alert' : 'status'}
    >
      <Icone size={16} className="aviso-icone" />

      <div className="aviso-texto">
        <span className="visualmente-oculto">{NOME[tipo]}: </span>
        {titulo && <div className="aviso-titulo">{titulo}</div>}
        <div className="aviso-corpo">{children}</div>
        {acoes && <div className="aviso-acoes">{acoes}</div>}
      </div>

      {aoDispensar && (
        <button className="aviso-fechar" onClick={aoDispensar} aria-label="Dispensar o aviso">
          <Close size={13} />
        </button>
      )}
    </div>
  );
}

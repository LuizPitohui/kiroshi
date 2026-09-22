import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from '../Icons.js';

/**
 * Campo de texto com rotulo, dica, erro e contador.
 *
 * Existe porque os campos estavam escritos a mao em cada tela, e cada um
 * resolvia uma parte: a tela de entrada tinha erro mas nao contador, o perfil
 * tinha contador mas o erro aparecia solto no fim do formulario, e em nenhum
 * deles o erro estava ligado ao campo para leitor de tela.
 *
 * O que vem junto e nao e opcional:
 *
 *   `htmlFor` de verdade, com id gerado. Clicar no rotulo foca o campo, e o
 *   leitor de tela anuncia o nome junto com o valor.
 *
 *   Erro ligado por `aria-describedby` e `aria-invalid`. Sem isso quem nao ve
 *   a cor vermelha nao sabe que ha erro, so que o envio nao aconteceu.
 *
 *   Mostrar senha, quando for senha. E o que a especificacao pede na tela de
 *   entrada, e digitar senha as cegas e a principal causa de erro repetido.
 *
 *   Contador so quando ha limite, e so quando ja passou de 70% dele — antes
 *   disso e ruido que nao ajuda ninguem.
 */

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>;

export interface TextFieldProps extends Base {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  /** Mensagem de erro. Presente = campo em estado invalido. */
  erro?: string | null;
  /** Explicacao abaixo do campo, quando o rotulo nao basta. */
  dica?: string;
  /** Varias linhas, para biografia e descricao. */
  multilinha?: boolean;
  linhas?: number;
}

export function TextField({
  rotulo,
  valor,
  aoMudar,
  erro,
  dica,
  multilinha = false,
  linhas = 4,
  type = 'text',
  maxLength,
  ...resto
}: TextFieldProps) {
  const id = useId();
  const [senhaVisivel, setSenhaVisivel] = useState(false);

  const ehSenha = type === 'password';
  const tipoReal = ehSenha && senhaVisivel ? 'text' : type;

  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;
  const descrito =
    [erro ? idErro : null, dica ? idDica : null].filter(Boolean).join(' ') || undefined;

  // Contador so perto do limite: numero fixo na tela vira mobilia.
  const mostrarContador = maxLength != null && valor.length >= maxLength * 0.7;

  const comuns = {
    id,
    value: valor,
    'aria-invalid': erro ? (true as const) : undefined,
    'aria-describedby': descrito,
    maxLength,
    onChange: (e: { target: { value: string } }) => aoMudar(e.target.value),
  };

  return (
    <div className={`campo ${erro ? 'campo-invalido' : ''}`}>
      <label className="campo-rotulo" htmlFor={id}>
        {rotulo}
      </label>

      <div className="campo-caixa">
        {multilinha ? (
          <textarea {...comuns} rows={linhas} {...(resto as object)} />
        ) : (
          <input {...comuns} type={tipoReal} {...resto} />
        )}

        {ehSenha && (
          <button
            type="button"
            className="campo-olho"
            onClick={() => setSenhaVisivel((v) => !v)}
            aria-label={senhaVisivel ? 'Esconder senha' : 'Mostrar senha'}
            title={senhaVisivel ? 'Esconder senha' : 'Mostrar senha'}
          >
            {senhaVisivel ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>

      <div className="campo-rodape">
        {erro ? (
          // `role="alert"` faz o leitor de tela anunciar na hora, sem esperar
          // a pessoa navegar ate o campo.
          <span className="campo-erro" id={idErro} role="alert">
            {erro}
          </span>
        ) : dica ? (
          <span className="campo-dica" id={idDica}>
            {dica}
          </span>
        ) : (
          <span />
        )}
        {mostrarContador && (
          <span className="campo-contador">
            {valor.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

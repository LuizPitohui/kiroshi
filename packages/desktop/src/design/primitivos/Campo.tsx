import { useId, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from './cx.js';

interface Moldura {
  rotulo: string;
  /** Texto de ajuda sob o campo. */
  dica?: ReactNode;
  /** Mensagem de erro; troca a dica e marca o campo como invalido. */
  erro?: string | null;
  /** Mostra "n/max" quando ha `maxLength` e valor controlado. */
  contador?: boolean;
  className?: string;
}

const CAIXA =
  'flex items-center gap-2 border border-borda bg-terminal px-3 text-texto ' +
  'focus-within:border-acento focus-within:shadow-brilho ' +
  'animado:transition-[border-color,box-shadow] animado:duration-[120ms]';

const INPUT =
  'min-w-0 flex-1 bg-transparente py-2 text-14 text-texto outline-none placeholder:text-mudo ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function Rodape({ idAjuda, dica, erro, contagem }: { idAjuda: string; dica?: ReactNode; erro?: string | null; contagem?: string }) {
  if (!dica && !erro && !contagem) return null;
  return (
    <div className="mt-1 flex items-start justify-between gap-3 text-12">
      <p id={idAjuda} className={erro ? 'text-perigo' : 'text-texto-3'} role={erro ? 'alert' : undefined}>
        {erro ? (
          <>
            <span className="font-mono">[!] </span>
            {erro}
          </>
        ) : (
          dica
        )}
      </p>
      {contagem ? <span className="shrink-0 font-mono text-11 text-texto-3">{contagem}</span> : null}
    </div>
  );
}

function RotuloDoCampo({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
      <span className="text-mudo">// </span>
      {children}
    </label>
  );
}

type PropsDeCampo = Moldura & Omit<ComponentPropsWithRef<'input'>, 'className'> & {
  /** Algo antes do texto (icone de busca, por exemplo). */
  prefixo?: ReactNode;
  /** Algo depois do texto (botao de mostrar senha, por exemplo). */
  sufixo?: ReactNode;
};

/** Campo de texto com rotulo `// NOME`, ajuda e erro ligados por `aria-describedby`. */
export function Campo({ rotulo, dica, erro, contador, className, prefixo, sufixo, id, maxLength, value, ...resto }: PropsDeCampo): React.JSX.Element {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const idAjuda = `${idCampo}-ajuda`;
  const contagem =
    contador && maxLength && typeof value === 'string' ? `${value.length}/${maxLength}` : undefined;

  return (
    <div className={className}>
      <RotuloDoCampo htmlFor={idCampo}>{rotulo}</RotuloDoCampo>
      <div className={cx(CAIXA, erro && 'border-perigo')}>
        {prefixo}
        <input
          id={idCampo}
          className={INPUT}
          aria-invalid={erro ? true : undefined}
          aria-describedby={dica || erro || contagem ? idAjuda : undefined}
          maxLength={maxLength}
          value={value}
          {...resto}
        />
        {sufixo}
      </div>
      <Rodape idAjuda={idAjuda} dica={dica} erro={erro} contagem={contagem} />
    </div>
  );
}

/** Senha com o botao de mostrar/esconder (o estado e anunciado). */
export function CampoSenha(props: Omit<PropsDeCampo, 'type' | 'sufixo'>): React.JSX.Element {
  const [visivel, setVisivel] = useState(false);
  return (
    <Campo
      {...props}
      type={visivel ? 'text' : 'password'}
      autoComplete={props.autoComplete ?? 'current-password'}
      sufixo={
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? 'Esconder senha' : 'Mostrar senha'}
          aria-pressed={visivel}
          className="grid size-7 shrink-0 place-items-center text-texto-3 hover:text-texto"
        >
          {visivel ? <EyeOff className="size-4" strokeWidth={1.5} /> : <Eye className="size-4" strokeWidth={1.5} />}
        </button>
      }
    />
  );
}

type PropsDeArea = Moldura & Omit<ComponentPropsWithRef<'textarea'>, 'className'>;

/** Texto de varias linhas, com o mesmo rotulo, ajuda e contador. */
export function AreaDeTexto({ rotulo, dica, erro, contador, className, id, maxLength, value, ...resto }: PropsDeArea): React.JSX.Element {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const idAjuda = `${idCampo}-ajuda`;
  const contagem =
    contador && maxLength && typeof value === 'string' ? `${value.length}/${maxLength}` : undefined;

  return (
    <div className={className}>
      <RotuloDoCampo htmlFor={idCampo}>{rotulo}</RotuloDoCampo>
      <div className={cx(CAIXA, 'items-stretch', erro && 'border-perigo')}>
        <textarea
          id={idCampo}
          className={cx(INPUT, 'min-h-20 resize-y')}
          aria-invalid={erro ? true : undefined}
          aria-describedby={dica || erro || contagem ? idAjuda : undefined}
          maxLength={maxLength}
          value={value}
          {...resto}
        />
      </div>
      <Rodape idAjuda={idAjuda} dica={dica} erro={erro} contagem={contagem} />
    </div>
  );
}

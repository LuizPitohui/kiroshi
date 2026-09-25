import type { ReactNode } from 'react';

/** Um bloco da pagina: o rotulo, a explicacao curta e o conteudo. */
export function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-borda pt-6 first:border-t-0 first:pt-0">
      <h2 className="k-rotulo">{titulo}</h2>
      {descricao ? <p className="mt-1 text-13 text-texto-3">{descricao}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** O nome e a explicacao a esquerda, o controle a direita. */
export function Linha({ titulo, descricao, children }: { titulo: string; descricao?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-14 font-medium text-texto">{titulo}</p>
        {descricao ? <p className="mt-0.5 text-13 text-texto-3">{descricao}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Aviso de que algo so vale no aplicativo instalado (a vitrine e o navegador nao tem Windows por tras). */
export function SoNoAplicativo() {
  return <p className="text-12 text-texto-3">Só no aplicativo instalado: aqui, no navegador, não há Windows por trás.</p>;
}

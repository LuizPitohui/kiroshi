/**
 * Esqueleto: a forma do conteudo enquanto ele nao chegou.
 *
 * Serve para uma coisa so, e nao e "mostrar que esta carregando" — para isso
 * bastaria um texto. Serve para RESERVAR O ESPACO que o conteudo vai ocupar,
 * e isso e o que impede a tela de pular quando ele chega.
 *
 * Por isso as medidas sao obrigatoriamente parecidas com as reais. Um
 * esqueleto de altura arbitraria e pior que nenhum: alem de nao reservar o
 * espaco certo, promete uma forma que nao vai aparecer.
 *
 * A animacao respeita movimento reduzido — isso esta no CSS, junto com a
 * regra global, e nao em cada uso.
 */

export interface SkeletonProps {
  /** Linha de texto, bloco retangular ou circulo de avatar. */
  forma?: 'texto' | 'bloco' | 'circulo';
  /** Em pixels, ou porcentagem como texto. */
  largura?: number | string;
  altura?: number;
  /** Quantas linhas, para `forma="texto"`. A ultima sai mais curta. */
  linhas?: number;
  className?: string;
}

export function Skeleton({
  forma = 'texto',
  largura,
  altura,
  linhas = 1,
  className,
}: SkeletonProps) {
  if (forma === 'texto' && linhas > 1) {
    return (
      <div className={`esqueleto-grupo ${className ?? ''}`} aria-hidden="true">
        {Array.from({ length: linhas }, (_, i) => (
          <span
            key={i}
            className="esqueleto esqueleto-texto"
            // A ultima linha mais curta imita paragrafo de verdade; todas do
            // mesmo tamanho parecem uma tabela.
            style={{ width: i === linhas - 1 ? '60%' : (largura ?? '100%') }}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      className={`esqueleto esqueleto-${forma} ${className ?? ''}`}
      style={{ width: largura, height: altura }}
      aria-hidden="true"
    />
  );
}

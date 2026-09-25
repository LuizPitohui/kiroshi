/**
 * Raiz da interface nova: decide entre a vitrine (catalogo de componentes,
 * `?vitrine`) e o app. Provedores globais (dicas, avisos) moram aqui.
 */
import { lazy, Suspense } from 'react';

const Vitrine = lazy(() => import('../features/vitrine/Vitrine.js'));

export function Raiz(): React.JSX.Element {
  const vitrine = typeof location !== 'undefined' && new URLSearchParams(location.search).has('vitrine');

  if (vitrine) {
    return (
      <Suspense fallback={null}>
        <Vitrine />
      </Suspense>
    );
  }

  return (
    <main className="k-grade grid h-full place-items-center bg-void font-mono text-12 text-texto-2">
      <p>
        <span className="k-rotulo">Kiroshi</span> casca em construção — veja <code>?nova&amp;vitrine</code>
      </p>
    </main>
  );
}

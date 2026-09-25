/**
 * A marca do Kiroshi: um olho-optica geometrico (amendoa angulosa, pupila em
 * losango, fendas laterais), no vermelho Arasaka. Mesma do prototipo.
 */
export function Marca({ tamanho = 22, className }: { tamanho?: number; className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 32"
      className={className}
      style={{ color: 'var(--k-acento)' }}
    >
      <path d="M2 16 L9 8.5 H23 L30 16 L23 23.5 H9 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />
      <path d="M16 11.5 L20.5 16 L16 20.5 L11.5 16 Z" fill="currentColor" />
      <path d="M5.5 16 H10.5 M21.5 16 H26.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

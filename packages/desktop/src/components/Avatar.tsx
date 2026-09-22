import type { PresenceStatus } from '@kiroshi/shared';

interface Props {
  url?: string | null;
  name: string;
  size?: number;
  status?: PresenceStatus | null;
  className?: string;
  onClick?: () => void;
}

/** Cor estavel derivada do nome, para quem nao tem foto. */
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 42% 38%)`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function Avatar({ url, name, size = 32, status, className = '', onClick }: Props) {
  return (
    <div
      className={`avatar ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <div
          className="avatar-fallback"
          style={{ background: colorFor(name), fontSize: Math.max(10, size * 0.38) }}
        >
          {initials(name)}
        </div>
      )}
      {status && <span className={`presence ${status}`} />}
    </div>
  );
}

/** Icones em SVG inline: sem fonte de icones para baixar, sem dependencia. */

import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  /** Permite colorir o icone conforme o estado, sem criar uma variante nova. */
  style?: CSSProperties;
}

const base = (size: number, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style,
});

export const Hash = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
);

export const Speaker = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

export const Megaphone = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

export const Folder = ({ size = 12, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const Mic = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

export const MicOff = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

export const Headphones = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

export const HeadphonesOff = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M3 18v-6a9 9 0 0 1 13.5-7.8" />
    <path d="M21 16v2M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

export const Video = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

export const VideoOff = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
  </svg>
);

export const ScreenShare = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <polyline points="9 10 12 7 15 10" />
    <line x1="12" y1="7" x2="12" y2="13" />
  </svg>
);

export const PhoneOff = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="23" y1="1" x2="1" y2="23" />
  </svg>
);

export const Settings = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const Plus = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const Close = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const Minimize = ({ size = 14, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const Maximize = ({ size = 13, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
  </svg>
);

export const Restore = ({ size = 13, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <rect x="3" y="7" width="14" height="14" rx="1" />
    <path d="M7 7V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3" />
  </svg>
);

export const Users = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const Pin = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M9 2h6l-1 8 4 3v2H6v-2l4-3z" />
  </svg>
);

export const Search = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const Smile = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
);

export const Paperclip = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export const Reply = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);

export const Edit = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);

export const Trash = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const Download = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const File = ({ size = 20, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

export const Logout = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const Shield = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const Bell = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const Link = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const Monitor = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export const Window = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
  </svg>
);

export const Music = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export const Wifi = ({ size = 14, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

/** Seta para baixo. Girada por CSS quando a secao esta fechada. */
export const Chevron = ({ size = 12, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Medidor de sinal, para telemetria. */
export const Signal = ({ size = 14, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <line x1="4" y1="20" x2="4" y2="16" />
    <line x1="10" y1="20" x2="10" y2="12" />
    <line x1="16" y1="20" x2="16" y2="8" />
    <line x1="22" y1="20" x2="22" y2="4" />
  </svg>
);

/** Ponto cheio: presenca, estado ativo. */
export const Dot = ({ size = 8, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className} fill="currentColor" stroke="none">
    <circle cx="12" cy="12" r="6" />
  </svg>
);

export const Expand = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export const Collapse = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="14 10 20 10 20 4" />
    <polyline points="10 14 4 14 4 20" />
    <line x1="20" y1="4" x2="14" y2="10" />
    <line x1="4" y1="20" x2="10" y2="14" />
  </svg>
);

/** Alvo de mira: promover um quadro a principal. */
export const Focus = ({ size = 16, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    <circle cx="12" cy="12" r="8.4" opacity="0.45" />
  </svg>
);

// ---------------------------------------------------------------------------
// Icones dos componentes compartilhados
// ---------------------------------------------------------------------------

/** Mostrar senha. Sem isto a pessoa digita as cegas e erra de novo. */
export const Eye = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOff = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/*
  Os tres icones de estado abaixo existem por uma regra da especificacao: erro
  nao pode depender so do vermelho. Quem nao distingue vermelho de cinza
  precisa da FORMA para saber que aquilo e um erro e nao um aviso comum.
*/

/** Sucesso. */
export const Check = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** Aviso: triangulo, a forma universal de atencao. */
export const Warning = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/** Erro: circulo com X, distinto do triangulo de aviso mesmo sem cor. */
export const ErroCirculo = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

/** Informacao. */
export const Info = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

/** Tentar de novo. */
export const Retry = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

/**
 * A marca do login com Google, no traco desta casa.
 *
 * Nao e o "G" colorido oficial de proposito: reproduzir a marca de outra
 * empresa de memoria acaba em marca errada, e marca errada e pior do que
 * marca nenhuma. Quem le o botao le "Entrar com Google" ao lado — o icone
 * acompanha, nao carrega sozinho a identificacao.
 */
export const Google = ({ size = 18, className, style }: IconProps) => (
  <svg {...base(size, style)} className={className}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M21 12h-8" />
  </svg>
);

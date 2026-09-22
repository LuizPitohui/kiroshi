/** Limites do produto. Servidor e cliente validam contra os mesmos numeros. */

export const LIMITS = {
  username: { min: 2, max: 32 },
  displayName: { min: 1, max: 32 },
  password: { min: 8, max: 128 },
  bio: { max: 190 },
  pronouns: { max: 40 },
  customStatus: { max: 128 },

  guildName: { min: 2, max: 100 },
  guildDescription: { max: 300 },
  channelName: { min: 1, max: 100 },
  channelTopic: { max: 1024 },
  roleName: { min: 1, max: 100 },
  nickname: { max: 32 },

  messageContent: { max: 4000 },
  attachmentsPerMessage: 10,
  /** 100 MB por arquivo. */
  attachmentBytes: 100 * 1024 * 1024,
  /** 8 MB para imagens de perfil e icones. */
  imageBytes: 8 * 1024 * 1024,
  /** 512 KB por emoji. */
  emojiBytes: 512 * 1024,
  /** 2 MB por som do soundboard. */
  soundBytes: 2 * 1024 * 1024,
  soundDurationSecs: 5,

  emojisPerGuild: 200,
  stickersPerGuild: 100,
  soundsPerGuild: 100,
  rolesPerGuild: 250,
  channelsPerGuild: 500,
  groupDmRecipients: 10,

  /** Mensagens por pagina no historico. */
  messagesPerFetch: { default: 50, max: 100 },
  reactionsPerMessage: 20,
  pinsPerChannel: 50,
  rateLimitPerUserMax: 21_600,
} as const;

/** Tipos aceitos em upload de imagem. */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
] as const;

/** Extensoes que nunca aceitamos como anexo, por risco de execucao. */
export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'msi', 'msp', 'cpl',
  'jar', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1',
  'sh', 'bash', 'lnk', 'reg', 'hta', 'dll', 'sys', 'app', 'dmg',
] as const;

export const BITRATE = {
  min: 8_000,
  default: 64_000,
  max: 128_000,
} as const;

/** Nome de usuario: letras minusculas, numeros, ponto e underscore. */
export const USERNAME_PATTERN = /^[a-z0-9._]{2,32}$/;

/** Codigo de convite. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

export const RATE_LIMITS = {
  /** Por usuario, por canal. */
  sendMessage: { points: 10, windowMs: 10_000 },
  editMessage: { points: 10, windowMs: 10_000 },
  addReaction: { points: 20, windowMs: 10_000 },
  /** Por IP. */
  login: { points: 8, windowMs: 300_000 },
  register: { points: 4, windowMs: 3_600_000 },
  /** Por usuario, global. */
  createGuild: { points: 5, windowMs: 3_600_000 },
  uploadFile: { points: 30, windowMs: 60_000 },
  global: { points: 120, windowMs: 60_000 },
  /** Mensagens por segundo no gateway, por conexao. */
  gateway: { points: 120, windowMs: 60_000 },
} as const;

export const TOKEN_TTL = {
  /** Token de acesso curto, renovado pelo refresh. */
  accessSecs: 15 * 60,
  /** Sessao longa do app desktop. */
  refreshSecs: 60 * 24 * 60 * 60,
  /** Token do SFU, renovado a cada entrada em canal de voz. */
  voiceSecs: 6 * 60 * 60,
  /** Janela para concluir o 2FA depois da senha correta. */
  mfaChallengeSecs: 5 * 60,
} as const;

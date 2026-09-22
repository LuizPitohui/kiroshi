/**
 * Erros da API. Tudo que o cliente precisa entender vira um ApiError com
 * codigo estavel; qualquer outra excecao sai como 500 sem detalhe, para nao
 * vazar interno.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'INVALID_MFA_CODE'
  | 'FORBIDDEN'
  | 'MISSING_PERMISSIONS'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'ALREADY_MEMBER'
  | 'BANNED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'REGISTRATION_CLOSED'
  | 'INVITE_INVALID'
  | 'VOICE_UNAVAILABLE'
  | 'GOOGLE_UNAVAILABLE'
  | 'GOOGLE_STATE_INVALID'
  | 'GOOGLE_REJECTED'
  | 'GOOGLE_NOT_LINKED'
  | 'GOOGLE_ALREADY_LINKED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  MFA_REQUIRED: 401,
  INVALID_MFA_CODE: 401,
  FORBIDDEN: 403,
  MISSING_PERMISSIONS: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  USERNAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  ALREADY_MEMBER: 409,
  BANNED: 403,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  REGISTRATION_CLOSED: 403,
  INVITE_INVALID: 404,
  VOICE_UNAVAILABLE: 503,
  GOOGLE_UNAVAILABLE: 503,
  GOOGLE_STATE_INVALID: 400,
  GOOGLE_REJECTED: 401,
  // 404 e nao 401: a conta do Google e valida, so nao ha Kiroshi ligado a ela.
  GOOGLE_NOT_LINKED: 404,
  GOOGLE_ALREADY_LINKED: 409,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError('BAD_REQUEST', message, details);

export const unauthorized = (message = 'Faca login para continuar.') =>
  new ApiError('UNAUTHORIZED', message);

export const forbidden = (message = 'Voce nao tem acesso a isto.') =>
  new ApiError('FORBIDDEN', message);

export const missingPermissions = (missing: string[]) =>
  new ApiError('MISSING_PERMISSIONS', 'Voce nao tem permissao para isto.', { missing });

export const notFound = (what = 'Recurso') => new ApiError('NOT_FOUND', `${what} nao encontrado.`);

export const conflict = (message: string) => new ApiError('CONFLICT', message);

export const internal = (message = 'Algo deu errado do nosso lado.') =>
  new ApiError('INTERNAL', message);

/**
 * Cliente REST.
 *
 * Cuida de tres coisas que nao deveriam se espalhar pelo codigo da interface:
 * anexar o token, renovar o token quando ele expira, e transformar o corpo de
 * erro do servidor em uma excecao com codigo estavel.
 */

import { sessaoMorreu } from './sessao.js';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Momento em que o access token expira, em ms. */
  expiresAt: number;
}

const STORAGE_KEY = 'kiroshi.session';
const BASE_URL_KEY = 'kiroshi.baseUrl';

/** Renova com folga, para nao correr o risco de um pedido sair com token morto. */
const REFRESH_MARGIN_MS = 60_000;

type Listener = (tokens: Tokens | null) => void;

class ApiClient {
  private tokens: Tokens | null = null;
  private baseUrl: string;
  private refreshing: Promise<Tokens | null> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor() {
    // Ordem: o que a pessoa escolheu na tela de login, senao o servidor que
    // veio embutido no build, senao o de desenvolvimento local.
    this.baseUrl =
      localStorage.getItem(BASE_URL_KEY) ??
      (import.meta.env.VITE_KIROSHI_SERVER as string | undefined) ??
      'http://localhost:4000';
    this.tokens = this.readStoredTokens();
  }

  private readStoredTokens(): Tokens | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Tokens;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
    localStorage.setItem(BASE_URL_KEY, this.baseUrl);
  }

  /** URL do gateway derivada da base: http vira ws, https vira wss. */
  getGatewayUrl(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/gateway`;
  }

  getTokens(): Tokens | null {
    return this.tokens;
  }

  getAccessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  /**
   * Um access token VALIDO, renovando se o atual ja venceu.
   *
   * O gateway precisa disto, e nao de `getAccessToken`, porque ele abre a
   * conexao em momentos que ninguem escolheu: ao voltar de uma queda de
   * internet, por exemplo. Nessa hora o token em cache costuma estar vencido —
   * ele vive quinze minutos — e identificar-se com ele faz o servidor recusar.
   *
   * Devolve null so quando nao ha sessao, ou quando a renovacao foi recusada
   * pelo servidor. Falha de rede nao devolve null: o token velho continua
   * sendo a melhor aposta para quando a rede voltar.
   */
  async accessTokenValido(forcar = false): Promise<string | null> {
    if (!forcar) return this.ensureFreshToken();

    /*
      Renovacao FORCADA, mesmo com o token parecendo novo.

      Serve para quando o servidor recusa um token que o relogio local ainda
      considera valido — sessao encerrada de outro aparelho, por exemplo. Sem
      isto, `ensureFreshToken` devolveria o mesmo token recusado e o gateway
      ficaria reconectando para sempre contra uma porta fechada.
    */
    if (!this.tokens) return null;
    this.refreshing ??= this.performRefresh().finally(() => {
      this.refreshing = null;
    });
    const renovado = await this.refreshing;
    return renovado?.accessToken ?? null;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  setTokens(tokens: { accessToken: string; refreshToken: string; expiresIn: number } | null): void {
    if (!tokens) {
      this.tokens = null;
      localStorage.removeItem(STORAGE_KEY);
    } else {
      this.tokens = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tokens));
    }
    for (const listener of this.listeners) listener(this.tokens);
  }

  onTokensChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Garante um access token valido. Chamadas simultaneas compartilham a mesma
   * renovacao: sem isso, dez pedidos em paralelo dispararia dez refreshes e
   * a rotacao do refresh token invalidaria uns aos outros.
   */
  private async ensureFreshToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }

    this.refreshing ??= this.performRefresh().finally(() => {
      this.refreshing = null;
    });

    const refreshed = await this.refreshing;
    return refreshed?.accessToken ?? null;
  }

  private async performRefresh(): Promise<Tokens | null> {
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        /*
          So recusa de IDENTIDADE mata a sessao.

          Antes era `if (!response.ok)` seco, e isso incluia o 502 que o tunel
          devolve nos segundos em que o servidor esta reiniciando: um deploy
          deslogava quem estivesse renovando naquele instante. Agora o token
          velho fica, e a proxima tentativa reencontra o servidor de pe.
        */
        if (sessaoMorreu(response.status)) {
          this.setTokens(null);
          return null;
        }
        return this.tokens;
      }

      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      this.setTokens(data);
      return this.tokens;
    } catch {
      // Falha de rede nao invalida a sessao: o token velho pode voltar a
      // funcionar quando a conexao voltar.
      return this.tokens;
    }
  }

  async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { body, auth = true, signal } = options;

    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';

    if (auth) {
      const token = await this.ensureFreshToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });

    // 401 com sessao ativa: tenta renovar uma vez e repete o pedido.
    if (response.status === 401 && auth && this.tokens) {
      const refreshed = await this.performRefresh();
      if (refreshed) {
        return this.request<T>(method, path, { ...options, auth: true });
      }
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const errorBody = (data as { error?: ApiErrorBody } | null)?.error ?? {
        code: 'UNKNOWN',
        message: 'Falha na comunicacao com o servidor.',
      };
      throw new ApiRequestError(response.status, errorBody);
    }

    return data as T;
  }

  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: { auth?: boolean }): Promise<T> {
    return this.request<T>('POST', path, { body, ...options });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, { body });
  }

  /** Upload multipart, fora do caminho JSON. */
  async upload(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<{ id: string; url: string; filename: string; size: number }> {
    const token = await this.ensureFreshToken();

    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file, file.name);

      // XMLHttpRequest em vez de fetch porque so ele reporta progresso de envio.
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/uploads`);
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const body = JSON.parse(xhr.responseText) as { error?: ApiErrorBody };
            reject(
              new ApiRequestError(
                xhr.status,
                body.error ?? { code: 'UNKNOWN', message: 'Falha no envio.' },
              ),
            );
          } catch {
            reject(new ApiRequestError(xhr.status, { code: 'UNKNOWN', message: 'Falha no envio.' }));
          }
        }
      });

      xhr.addEventListener('error', () =>
        reject(new ApiRequestError(0, { code: 'NETWORK', message: 'Sem conexao com o servidor.' })),
      );

      xhr.send(form);
    });
  }

  /** Checa se ha um servidor Kiroshi no endereco informado. */
  async probe(baseUrl: string): Promise<{ name: string; voiceEnabled: boolean; openRegistration: boolean }> {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/info`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Servidor nao respondeu.');
    return response.json() as Promise<{
      name: string;
      voiceEnabled: boolean;
      openRegistration: boolean;
    }>;
  }
}

export const api = new ApiClient();

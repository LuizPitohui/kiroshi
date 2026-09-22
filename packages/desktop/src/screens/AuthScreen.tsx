import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import { Mark } from '../components/Mark.js';
import { Google } from '../components/Icons.js';
import {
  GoogleCancelado,
  conversarComGoogle,
  googleDisponivel,
  registrarComGoogle,
} from '../api/google.js';

/** `google` e a etapa de escolher nome de usuario depois que o Google
 *  confirmou quem e, mas nao ha conta aqui ainda. */
type Mode = 'login' | 'register' | 'mfa' | 'google';

interface Props {
  onAuthenticated: () => void;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [serverUrl, setServerUrl] = useState(api.getBaseUrl());
  const [serverInfo, setServerInfo] = useState<{ name: string; openRegistration: boolean } | null>(
    null,
  );
  const [editingServer, setEditingServer] = useState(false);

  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Login com Google: o botao so aparece se o servidor tiver isso ligado.
  const [temGoogle, setTemGoogle] = useState(false);
  const [provaDoGoogle, setProvaDoGoogle] = useState('');
  const [emailDoGoogle, setEmailDoGoogle] = useState<string | null>(null);

  /*
    Pergunta ao servidor se ele tem login com Google.

    Refaz a cada troca de endereco: cada servidor decide por si, e um botao
    que aparece para um servidor e some para outro e melhor do que um botao
    que erra quando a pessoa clica.
  */
  useEffect(() => {
    let cancelado = false;
    setTemGoogle(false);
    void googleDisponivel().then((tem) => {
      if (!cancelado) setTemGoogle(tem);
    });
    return () => {
      cancelado = true;
    };
  }, [serverUrl]);

  // Confere o endereco do servidor assim que a tela abre, para avisar cedo se
  // ele estiver fora do ar em vez de falhar so no login.
  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);

    api
      .probe(serverUrl)
      .then((info) => {
        if (cancelled) return;
        setServerInfo(info);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setServerInfo(null);
        setError('Nao consegui falar com este servidor. Confira o endereco.');
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  function applyServerUrl(): void {
    const normalized = serverUrl.trim().replace(/\/+$/, '');
    if (!normalized) return;
    api.setBaseUrl(normalized);
    setServerUrl(normalized);
    setEditingServer(false);
  }

  /**
   * Entrar pelo Google.
   *
   * Quatro desfechos possiveis, e a interface trata os quatro: entra direto,
   * pede o segundo fator, oferece criar conta, ou explica o que deu errado.
   * Cancelar no Google nao e defeito — vira recado, nao erro vermelho.
   */
  async function entrarPeloGoogle(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const desfecho = await conversarComGoogle('entrar');

      if (desfecho.tipo === 'sessao') {
        api.setTokens(desfecho);
        onAuthenticated();
        return;
      }

      if (desfecho.tipo === 'mfa') {
        // A conta tem 2FA, e o Google nao dispensa o segundo fator.
        setMfaToken(desfecho.mfaToken);
        setMode('mfa');
        return;
      }

      if (desfecho.tipo === 'sem-conta') {
        setProvaDoGoogle(desfecho.prova);
        setEmailDoGoogle(desfecho.email);
        // Sugere um nome a partir do email, que a pessoa pode trocar.
        if (!username && desfecho.email) {
          setUsername(desfecho.email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') ?? '');
        }
        setMode('google');
        return;
      }

      setError('Nao consegui concluir o login com Google.');
    } catch (err) {
      if (err instanceof GoogleCancelado) setError(err.message);
      else if (err instanceof ApiRequestError) setError(err.message);
      else setError('Nao consegui falar com o Google.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === 'google') {
        const resposta = await registrarComGoogle({
          prova: provaDoGoogle,
          username: username.trim().toLowerCase(),
          ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
        });
        api.setTokens(resposta);
        onAuthenticated();
        return;
      }

      if (mode === 'register') {
        const response = await api.post<AuthResponse>(
          '/auth/register',
          {
            email: email.trim(),
            username: username.trim().toLowerCase(),
            password,
            ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
          },
          { auth: false },
        );
        api.setTokens(response);
        onAuthenticated();
        return;
      }

      if (mode === 'mfa') {
        const response = await api.post<AuthResponse>(
          '/auth/login/mfa',
          {
            mfaToken,
            ...(useBackupCode ? { backupCode: mfaCode.trim() } : { totpCode: mfaCode.trim() }),
          },
          { auth: false },
        );
        api.setTokens(response);
        onAuthenticated();
        return;
      }

      const response = await api.post<AuthResponse>(
        '/auth/login',
        { login: login.trim(), password },
        { auth: false },
      );
      api.setTokens(response);
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Senha correta mas falta o segundo fator: segue para a etapa do codigo.
        if (err.code === 'MFA_REQUIRED') {
          const details = err.details as { mfaToken?: string } | undefined;
          setMfaToken(details?.mfaToken ?? '');
          setMode('mfa');
          setError(null);
          return;
        }
        setError(err.message);
      } else {
        setError('Nao consegui completar a acao. Tente de novo.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-mark">
          <Mark size={52} />
        </div>
        <div className="auth-logo">Kiroshi</div>
        <div className="auth-sub">
          {mode === 'register'
            ? 'Crie sua conta'
            : mode === 'mfa'
              ? 'Verificacao em duas etapas'
              : mode === 'google'
                ? 'Escolha seu nome aqui'
                : 'Que bom te ver de novo'}
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'login' && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="login">
                  Email ou nome de usuario
                </label>
                <input
                  id="login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="password">
                  Senha
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          )}

          {mode === 'register' && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="username">
                  Nome de usuario
                </label>
                <input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username"
                  pattern="[a-z0-9._]{2,32}"
                  required
                />
                <div className="field-hint">
                  Letras minusculas, numeros, ponto ou _. E assim que seus amigos vao te achar.
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="new-password">
                  Senha
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <div className="field-hint">Pelo menos 8 caracteres.</div>
              </div>
              {serverInfo && !serverInfo.openRegistration && (
                <div className="field">
                  <label className="field-label" htmlFor="invite">
                    Codigo de convite
                  </label>
                  <input
                    id="invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    required
                  />
                  <div className="field-hint">Este servidor so aceita cadastro com convite.</div>
                </div>
              )}
            </>
          )}

          {mode === 'mfa' && (
            <div className="field">
              <label className="field-label" htmlFor="mfa">
                {useBackupCode ? 'Codigo de recuperacao' : 'Codigo do app autenticador'}
              </label>
              <input
                id="mfa"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                inputMode={useBackupCode ? 'text' : 'numeric'}
                placeholder={useBackupCode ? 'abcd-efgh' : '000000'}
                autoFocus
                required
              />
              <div className="field-hint">
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    setUseBackupCode(!useBackupCode);
                    setMfaCode('');
                  }}
                >
                  {useBackupCode
                    ? 'Usar o app autenticador'
                    : 'Perdi o celular, usar codigo de recuperacao'}
                </button>
              </div>
            </div>
          )}

          {mode === 'google' && (
            <>
              {/*
                O Google ja disse quem a pessoa e; falta so como ela vai
                aparecer aqui. Mostrar de qual conta veio evita o engano de
                quem tem duas e escolheu a errada na tela do Google.
              */}
              {emailDoGoogle && (
                <div className="auth-nota">
                  Confirmado pelo Google como <strong>{emailDoGoogle}</strong>.
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor="google-username">
                  Nome de usuario
                </label>
                <input
                  id="google-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              {serverInfo && !serverInfo.openRegistration && (
                <div className="field">
                  <label className="field-label" htmlFor="google-invite">
                    Codigo de convite
                  </label>
                  <input
                    id="google-invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy || (!serverInfo && mode !== 'mfa')}
          >
            {busy
              ? 'Aguarde...'
              : mode === 'register'
                ? 'Criar conta'
                : mode === 'mfa'
                  ? 'Verificar'
                  : mode === 'google'
                    ? 'Criar conta'
                    : 'Entrar'}
          </button>
        </form>

        {/*
          O botao do Google fica FORA do formulario de proposito: ele nao envia
          nada, abre o navegador. Dentro do form, Enter no campo de senha
          dispararia o caminho errado.

          So aparece em login e cadastro: no meio do 2FA ou escolhendo nome de
          usuario, comecar outra conversa com o Google jogaria fora o que ja
          foi feito.
        */}
        {temGoogle && (mode === 'login' || mode === 'register') && (
          <>
            <div className="auth-ou">
              <span>ou</span>
            </div>
            <button
              type="button"
              className="btn btn-block btn-google"
              onClick={() => void entrarPeloGoogle()}
              disabled={busy || !serverInfo}
            >
              <Google size={16} />
              Entrar com Google
            </button>
          </>
        )}

        {mode !== 'mfa' && (
          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                Ainda nao tem conta?{' '}
                <button
                  className="btn-quiet"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                >
                  Criar uma
                </button>
              </>
            ) : (
              <>
                Ja tem conta?{' '}
                <button
                  className="btn-quiet"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                >
                  Entrar
                </button>
              </>
            )}
          </div>
        )}

        <div className="divider" />

        {editingServer ? (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="server">
              Endereco do servidor
            </label>
            <input
              id="server"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyServerUrl();
              }}
              placeholder="https://order.arasaka.fun"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={applyServerUrl}>
                Usar este
              </button>
              <button className="btn btn-quiet" onClick={() => setEditingServer(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
              color: 'var(--text-faint)',
            }}
          >
            <span>
              {serverInfo ? (
                <>
                  Conectado a <strong style={{ color: 'var(--text-dim)' }}>{serverUrl}</strong>
                </>
              ) : (
                <>Servidor: {serverUrl}</>
              )}
            </span>
            <button className="btn-quiet" onClick={() => setEditingServer(true)}>
              trocar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

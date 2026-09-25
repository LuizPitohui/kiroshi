import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../../api/client.js';
import { Aviso, Botao, Campo, CampoSenha } from '../../design/primitivos/index.js';
import { Marca } from '../casca/Marca.js';

interface RespostaDeSessao {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Entrada num "terminal seguro" (a moldura do login do Nexus, com a marca do
 * Kiroshi). Nesta fatia: entrar com email ou usuario e senha, e o segundo
 * fator. Criar conta sem convite, Google e recuperar senha chegam na fatia 7 —
 * ate la, pelo Kiroshi normal.
 *
 * Os pedidos sao os mesmos da tela 1.x (`/auth/login`, `/auth/login/mfa`).
 */
export function Entrada(): React.JSX.Element {
  const [etapa, setEtapa] = useState<'senha' | 'codigo'>('senha');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [recuperacao, setRecuperacao] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [servidor, setServidor] = useState(api.getBaseUrl());
  const [trocando, setTrocando] = useState(false);
  const [novoServidor, setNovoServidor] = useState(api.getBaseUrl());
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const resposta =
        etapa === 'codigo'
          ? await api.post<RespostaDeSessao>(
              '/auth/login/mfa',
              { mfaToken, ...(recuperacao ? { backupCode: codigo.trim() } : { totpCode: codigo.trim() }) },
              { auth: false },
            )
          : await api.post<RespostaDeSessao>('/auth/login', { login: login.trim(), password: senha }, { auth: false });
      // A Raiz ouve a troca de sessao e abre a casca.
      api.setTokens(resposta);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'MFA_REQUIRED') {
        const detalhes = e.details as { mfaToken?: string } | undefined;
        setMfaToken(detalhes?.mfaToken ?? '');
        setEtapa('codigo');
      } else {
        setErro(e instanceof ApiRequestError ? e.message : 'Não consegui falar com o servidor. Tente de novo.');
      }
    } finally {
      setOcupado(false);
    }
  }

  async function usarServidor() {
    setErroDoServidor(null);
    const url = novoServidor.trim().replace(/\/+$/, '');
    try {
      await api.probe(url);
      api.setBaseUrl(url);
      setServidor(url);
      setTrocando(false);
    } catch {
      setErroDoServidor('Não encontrei um servidor Kiroshi nesse endereço.');
    }
  }

  return (
    <main className="k-grade grid h-full place-items-center overflow-y-auto bg-void px-4 py-10">
      <section aria-labelledby="entrada-titulo" className="k-colchetes relative w-full max-w-[420px] border border-borda-2 bg-deck">
        <span className="k-colchetes-extra" aria-hidden />
        <div className="flex items-center justify-between border-b border-borda px-4 py-2">
          <span className="k-rotulo">Terminal seguro</span>
          <span aria-hidden className="k-anima k-pulso size-1.5 rounded-full bg-acento" />
        </div>

        <div className="px-7 pb-7 pt-8">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <Marca tamanho={44} />
            <h1 id="entrada-titulo" className="font-display text-36 font-bold uppercase leading-none tracking-display">
              Kiroshi
            </h1>
            <p className="k-rotulo">Módulo de comunicação</p>
          </div>

          <form onSubmit={(e) => void entrar(e)} className="flex flex-col gap-4">
            {etapa === 'senha' ? (
              <>
                <Campo rotulo="Email ou usuário" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
                <CampoSenha rotulo="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
              </>
            ) : (
              <>
                <Aviso tipo="info">Falta o segundo fator. {recuperacao ? 'Use um dos códigos de recuperação.' : 'Digite o código do app autenticador.'}</Aviso>
                <Campo
                  rotulo={recuperacao ? 'Código de recuperação' : 'Código de 6 dígitos'}
                  autoComplete="one-time-code"
                  inputMode={recuperacao ? 'text' : 'numeric'}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  required
                  autoFocus
                />
                <button type="button" onClick={() => setRecuperacao((v) => !v)} className="self-start text-12 text-texto-3 underline hover:text-texto">
                  {recuperacao ? 'Usar o app autenticador' : 'Perdi o celular: usar código de recuperação'}
                </button>
              </>
            )}

            {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

            <Botao type="submit" variante="primario" carregando={ocupado} className="mt-1 w-full">
              ▸ {etapa === 'senha' ? 'Entrar' : 'Confirmar'}
            </Botao>
          </form>

          <p className="mt-6 text-center text-12 text-texto-3">
            Criar conta, entrar com Google e recuperar a senha: por enquanto no Kiroshi normal.
          </p>
        </div>

        <footer className="border-t border-borda px-4 py-3 font-mono text-10 uppercase tracking-rotulo text-mudo">
          {trocando ? (
            <div className="flex flex-col gap-2 normal-case tracking-normal">
              <Campo rotulo="Endereço do servidor" value={novoServidor} onChange={(e) => setNovoServidor(e.target.value)} erro={erroDoServidor} />
              <div className="flex justify-end gap-2">
                <Botao tamanho="sm" variante="fantasma" onClick={() => { setTrocando(false); setNovoServidor(servidor); setErroDoServidor(null); }}>
                  Cancelar
                </Botao>
                <Botao tamanho="sm" onClick={() => void usarServidor()}>
                  Usar este
                </Botao>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">
                Servidor <span className="text-texto-3 normal-case">{servidor.replace(/^https?:\/\//, '')}</span>
              </span>
              <button type="button" onClick={() => setTrocando(true)} className="text-texto-3 hover:text-texto">
                Trocar
              </button>
            </div>
          )}
        </footer>
      </section>
    </main>
  );
}

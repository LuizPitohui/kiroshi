import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS, type InvitePreview } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import {
  GoogleCancelado,
  conversarComGoogle,
  googleDisponivel,
  recuperarComGoogle,
  registrarComGoogle,
} from '../../api/google.js';
import { isElectron } from '../../lib/bridge.js';
import { navegar, useRota } from '../../app/rotas.js';
import { Aviso, Botao, Campo, CampoSenha, avisar } from '../../design/primitivos/index.js';
import { Marca } from '../casca/Marca.js';
import { problemaNoUsername, sugerirUsername } from './sugestao.js';

interface RespostaDeSessao {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** No cadastro com convite: o servidor em que a conta ja nasceu. */
  guildId?: string | null;
}

type Etapa = 'entrar' | 'criar' | 'codigo' | 'google-novo' | 'recuperar' | 'nova-senha';

const TITULOS: Record<Etapa, string> = {
  entrar: 'Entrar',
  criar: 'Criar conta',
  codigo: 'Segundo fator',
  'google-novo': 'Conta nova pelo Google',
  recuperar: 'Esqueci a senha',
  'nova-senha': 'Senha nova',
};

function mensagem(e: unknown, padrao: string): string {
  if (e instanceof GoogleCancelado) return e.message;
  if (e instanceof ApiRequestError) {
    // O limite de cadastro e de uma hora: "em instantes" enganaria quem espera.
    const espera = (e.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
    if (e.code === 'RATE_LIMITED' && espera && espera > 60_000) {
      return `Muitas tentativas daqui em pouco tempo. Tente de novo em ${Math.ceil(espera / 60_000)} min.`;
    }
    return e.message;
  }
  return padrao;
}

/** O convite da rota (`#/convite/<codigo>`), quando a pessoa chegou por um link sem estar logada. */
function useConviteDaRota(): { codigo: string; preview: InvitePreview | null } | null {
  const rota = useRota();
  const codigo = rota.tela === 'convite' ? rota.codigo : null;
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!codigo) return;
    let vivo = true;
    api
      .get<InvitePreview>(`/invites/${codigo}`)
      .then((p) => vivo && setPreview(p))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [codigo]);
  return codigo ? { codigo, preview } : null;
}

function Separador() {
  return (
    <div className="flex items-center gap-3 font-mono text-10 uppercase tracking-rotulo text-mudo" aria-hidden>
      <span className="h-px flex-1 bg-borda" />
      ou
      <span className="h-px flex-1 bg-borda" />
    </div>
  );
}

function Link({ children, aoClicar }: { children: ReactNode; aoClicar: () => void }) {
  return (
    <button type="button" onClick={aoClicar} className="text-12 text-texto-3 underline underline-offset-2 hover:text-texto">
      {children}
    </button>
  );
}

/**
 * Entrada num "terminal seguro" (10-front-end-novo.md 4.1): entrar com email
 * ou usuario e senha, criar conta, continuar com o Google (cria ou entra),
 * esqueci a senha (pelo Google vinculado — decisao do dono, o servidor nao
 * manda email) e o segundo fator, que vale para os tres caminhos.
 *
 * Chegando por um link de convite, a conta nova ja nasce dentro do servidor.
 */
export function Entrada(): React.JSX.Element {
  const [etapa, setEtapa] = useState<Etapa>('entrar');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [nome, setNome] = useState('');
  const [conviteDigitado, setConviteDigitado] = useState('');
  const [codigo, setCodigo] = useState('');
  const [recuperacao, setRecuperacao] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [prova, setProva] = useState('');
  const [emailDoGoogle, setEmailDoGoogle] = useState<string | null>(null);
  const [contaRecuperada, setContaRecuperada] = useState<{ username: string; displayName: string } | null>(null);

  const [servidor, setServidor] = useState(api.getBaseUrl());
  const [trocando, setTrocando] = useState(false);
  const [novoServidor, setNovoServidor] = useState(api.getBaseUrl());
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [aberto, setAberto] = useState<boolean | null>(null);
  const [comGoogle, setComGoogle] = useState(false);

  const convite = useConviteDaRota();
  const codigoDoConvite = convite?.codigo ?? (conviteDigitado.trim() || undefined);

  // O que este servidor permite: cadastro aberto ou por convite, e se tem Google.
  useEffect(() => {
    let vivo = true;
    setAberto(null);
    api
      .probe(servidor)
      .then((info) => vivo && setAberto(info.openRegistration))
      .catch(() => vivo && setAberto(null));
    // Google so no aplicativo: o navegador nao levanta a porta local da volta.
    if (isElectron()) void googleDisponivel().then((d) => vivo && setComGoogle(d));
    return () => {
      vivo = false;
    };
  }, [servidor]);

  function irPara(nova: Etapa) {
    setErro(null);
    setAviso(null);
    setEtapa(nova);
  }

  /** Entrou: com o servidor do convite, abre direto nele. */
  function abrirSessao(resposta: RespostaDeSessao) {
    if (resposta.guildId) navegar({ tela: 'servidor', guildId: resposta.guildId, canalId: null }, { substituir: true });
    // A Raiz ouve a troca de sessao e abre a casca.
    api.setTokens(resposta);
  }

  async function fazer(acao: () => Promise<void>, padrao: string) {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'MFA_REQUIRED') {
        const detalhes = e.details as { mfaToken?: string } | undefined;
        setMfaToken(detalhes?.mfaToken ?? '');
        setCodigo('');
        irPara('codigo');
      } else {
        setErro(mensagem(e, padrao));
      }
    } finally {
      setOcupado(false);
    }
  }

  // ---- os pedidos ----

  const entrar = () =>
    fazer(async () => {
      abrirSessao(await api.post<RespostaDeSessao>('/auth/login', { login: login.trim(), password: senha }, { auth: false }));
    }, 'Não consegui falar com o servidor. Tente de novo.');

  const confirmarCodigo = () =>
    fazer(async () => {
      abrirSessao(
        await api.post<RespostaDeSessao>(
          '/auth/login/mfa',
          { mfaToken, ...(recuperacao ? { backupCode: codigo.trim() } : { totpCode: codigo.trim() }) },
          { auth: false },
        ),
      );
    }, 'Não consegui confirmar o código.');

  const criarConta = () =>
    fazer(async () => {
      abrirSessao(
        await api.post<RespostaDeSessao>(
          '/auth/register',
          {
            email: email.trim(),
            username: username.trim(),
            ...(nome.trim() ? { displayName: nome.trim() } : {}),
            password: senha,
            ...(codigoDoConvite ? { inviteCode: codigoDoConvite } : {}),
          },
          { auth: false },
        ),
      );
    }, 'Não consegui criar a conta. Tente de novo.');

  const entrarComGoogle = () =>
    fazer(async () => {
      const desfecho = await conversarComGoogle('entrar');
      if (desfecho.tipo === 'sessao') return abrirSessao(desfecho);
      if (desfecho.tipo === 'mfa') {
        setMfaToken(desfecho.mfaToken);
        setCodigo('');
        return irPara('codigo');
      }
      if (desfecho.tipo === 'sem-conta') {
        // Ninguem aqui usa este Google: oferece criar a conta, com um nome ja sugerido.
        setProva(desfecho.prova);
        setEmailDoGoogle(desfecho.email);
        setUsername(sugerirUsername(desfecho.email, desfecho.nome));
        setNome(desfecho.nome ?? '');
        return irPara('google-novo');
      }
      throw new Error('desfecho inesperado');
    }, 'Não consegui concluir o login com o Google.');

  const criarComGoogle = () =>
    fazer(async () => {
      abrirSessao(
        await registrarComGoogle({
          prova,
          username: username.trim(),
          ...(nome.trim() ? { displayName: nome.trim() } : {}),
          ...(codigoDoConvite ? { inviteCode: codigoDoConvite } : {}),
        }),
      );
    }, 'Não consegui criar a conta com o Google.');

  const recuperar = () =>
    fazer(async () => {
      const desfecho = await conversarComGoogle('recuperar');
      if (desfecho.tipo !== 'prova-de-recuperacao') throw new Error('desfecho inesperado');
      setProva(desfecho.prova);
      setContaRecuperada({ username: desfecho.username, displayName: desfecho.displayName });
      setSenha('');
      setConfirmacao('');
      irPara('nova-senha');
    }, 'Não consegui confirmar pelo Google.');

  const gravarSenhaNova = () =>
    fazer(async () => {
      const desfecho = await recuperarComGoogle(prova, senha);
      if (desfecho.tipo === 'sessao') {
        avisar.ok('Senha trocada', 'Os outros aparelhos saíram da conta.');
        return abrirSessao(desfecho);
      }
      // 2FA ligado: a senha ja mudou, falta o codigo do app para entrar.
      setMfaToken(desfecho.mfaToken);
      setCodigo('');
      irPara('codigo');
      setAviso('Senha trocada. Falta o código do app autenticador para entrar.');
    }, 'Não consegui trocar a senha.');

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

  // ---- validacao antes de pedir ----

  const problemaDoUsername = username ? problemaNoUsername(username.trim()) : null;
  const senhaCurta = senha.length > 0 && senha.length < LIMITS.password.min;
  const senhasDiferentes = confirmacao.length > 0 && confirmacao !== senha;
  const pedeConvite = aberto === false && !convite;
  const podeCriar =
    email.trim().includes('@') &&
    username.trim().length > 0 &&
    !problemaDoUsername &&
    senha.length >= LIMITS.password.min &&
    confirmacao === senha &&
    (!pedeConvite || conviteDigitado.trim().length > 0);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (etapa === 'entrar') void entrar();
    else if (etapa === 'codigo') void confirmarCodigo();
    else if (etapa === 'criar' && podeCriar) void criarConta();
    else if (etapa === 'google-novo' && !problemaDoUsername) void criarComGoogle();
    else if (etapa === 'nova-senha' && senha.length >= LIMITS.password.min && senha === confirmacao) void gravarSenhaNova();
  }

  const botaoDoGoogle = (rotulo: string, aoClicar: () => void) =>
    comGoogle ? (
      <Botao variante="secundario" className="w-full" disabled={ocupado} onClick={aoClicar} icone={<LetraG />}>
        {rotulo}
      </Botao>
    ) : null;

  const campoDeConvite = pedeConvite ? (
    <Campo
      rotulo="Código de convite"
      value={conviteDigitado}
      onChange={(e) => setConviteDigitado(e.target.value)}
      dica="Este servidor só aceita conta nova com convite de quem já está dentro."
      required
    />
  ) : null;

  return (
    <main className="k-grade grid h-full place-items-center overflow-y-auto bg-void px-4 py-10">
      <section aria-labelledby="entrada-titulo" className="k-colchetes relative w-full max-w-[420px] border border-borda-2 bg-deck">
        <span className="k-colchetes-extra" aria-hidden />
        <div className="flex items-center justify-between border-b border-borda px-4 py-2">
          <span className="k-rotulo">Terminal seguro</span>
          <span aria-hidden className="k-anima k-pulso size-1.5 rounded-full bg-acento" />
        </div>

        <div className="px-7 pb-7 pt-8">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Marca tamanho={44} />
            <h1 id="entrada-titulo" className="font-display text-36 font-bold uppercase leading-none tracking-display">
              Kiroshi
            </h1>
            <p className="k-rotulo">{etapa === 'entrar' ? 'Módulo de comunicação' : TITULOS[etapa]}</p>
          </div>

          {convite ? (
            <div className="mb-5">
              <Aviso tipo="info" titulo={convite.preview ? `Convite para ${convite.preview.guild.name}` : 'Convite'}>
                {etapa === 'criar' || etapa === 'google-novo'
                  ? 'A conta nova já nasce dentro do servidor.'
                  : 'Entre ou crie uma conta para aceitar.'}
              </Aviso>
            </div>
          ) : null}

          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            {etapa === 'entrar' ? (
              <>
                <Campo rotulo="Email ou usuário" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
                <CampoSenha rotulo="Senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
              </>
            ) : null}

            {etapa === 'criar' ? (
              <>
                <Campo rotulo="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                <Campo
                  rotulo="Nome de usuário"
                  autoComplete="username"
                  value={username}
                  maxLength={LIMITS.username.max}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  erro={problemaDoUsername}
                  dica="Como te acham para pedir amizade. Letras minúsculas, números, ponto ou _."
                  required
                />
                <Campo
                  rotulo="Nome de exibição (opcional)"
                  value={nome}
                  maxLength={LIMITS.displayName.max}
                  onChange={(e) => setNome(e.target.value)}
                  dica="O nome em cima das suas mensagens. Dá para trocar depois."
                />
                <CampoSenha
                  rotulo="Senha"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  erro={senhaCurta ? `Pelo menos ${LIMITS.password.min} caracteres.` : null}
                  required
                />
                <CampoSenha
                  rotulo="Repita a senha"
                  autoComplete="new-password"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  erro={senhasDiferentes ? 'As duas senhas não batem.' : null}
                  required
                />
                {campoDeConvite}
              </>
            ) : null}

            {etapa === 'google-novo' ? (
              <>
                <Aviso tipo="info">
                  Nenhuma conta do Kiroshi usa {emailDoGoogle ?? 'este Google'} ainda. Escolha como te chamar para criar uma. Depois,
                  dá para definir uma senha e entrar também com email.
                </Aviso>
                <Campo
                  rotulo="Nome de usuário"
                  autoComplete="username"
                  value={username}
                  maxLength={LIMITS.username.max}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  erro={problemaDoUsername}
                  dica="Como te acham para pedir amizade."
                  autoFocus
                />
                <Campo rotulo="Nome de exibição" value={nome} maxLength={LIMITS.displayName.max} onChange={(e) => setNome(e.target.value)} />
                {campoDeConvite}
              </>
            ) : null}

            {etapa === 'codigo' ? (
              <>
                {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
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
                <div>
                  <Link aoClicar={() => setRecuperacao((v) => !v)}>
                    {recuperacao ? 'Usar o app autenticador' : 'Perdi o celular: usar código de recuperação'}
                  </Link>
                </div>
              </>
            ) : null}

            {etapa === 'recuperar' ? (
              <Aviso tipo="info" titulo="A recuperação é pelo Google">
                {comGoogle
                  ? 'Se a sua conta tem o Google vinculado, confirme por ele e escolha uma senha nova. Sem o Google vinculado, só quem administra o servidor consegue ajudar.'
                  : 'Se a sua conta tem o Google vinculado, abra o aplicativo instalado e confirme por lá. Sem o Google vinculado, só quem administra o servidor consegue ajudar.'}
              </Aviso>
            ) : null}

            {etapa === 'nova-senha' ? (
              <>
                {contaRecuperada ? (
                  <Aviso tipo="ok" titulo={`Conta ${contaRecuperada.displayName}`}>
                    @{contaRecuperada.username}. Escolha a senha nova: os aparelhos conectados saem da conta.
                  </Aviso>
                ) : null}
                <CampoSenha
                  rotulo="Senha nova"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  erro={senhaCurta ? `Pelo menos ${LIMITS.password.min} caracteres.` : null}
                  autoFocus
                />
                <CampoSenha
                  rotulo="Repita a senha nova"
                  autoComplete="new-password"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  erro={senhasDiferentes ? 'As duas senhas não batem.' : null}
                />
              </>
            ) : null}

            {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

            {etapa === 'entrar' ? (
              <>
                <Botao type="submit" variante="primario" carregando={ocupado} className="mt-1 w-full">
                  ▸ Entrar
                </Botao>
                <div className="flex justify-between">
                  <Link aoClicar={() => irPara('recuperar')}>Esqueci a senha</Link>
                  <Link aoClicar={() => irPara('criar')}>Criar conta</Link>
                </div>
                {comGoogle ? <Separador /> : null}
                {botaoDoGoogle('Continuar com Google', () => void entrarComGoogle())}
              </>
            ) : null}

            {etapa === 'criar' ? (
              <>
                <Botao type="submit" variante="primario" carregando={ocupado} disabled={!podeCriar} className="mt-1 w-full">
                  ▸ Criar conta
                </Botao>
                {comGoogle ? <Separador /> : null}
                {botaoDoGoogle('Criar com o Google', () => void entrarComGoogle())}
                <div className="text-center">
                  <Link aoClicar={() => irPara('entrar')}>Já tenho conta</Link>
                </div>
              </>
            ) : null}

            {etapa === 'google-novo' ? (
              <>
                <Botao type="submit" variante="primario" carregando={ocupado} disabled={Boolean(problemaDoUsername) || !username || (pedeConvite && !conviteDigitado.trim())} className="mt-1 w-full">
                  ▸ Criar a conta
                </Botao>
                <div className="text-center">
                  <Link aoClicar={() => irPara('entrar')}>Voltar</Link>
                </div>
              </>
            ) : null}

            {etapa === 'codigo' ? (
              <>
                <Botao type="submit" variante="primario" carregando={ocupado} className="mt-1 w-full">
                  ▸ Confirmar
                </Botao>
                <div className="text-center">
                  <Link aoClicar={() => irPara('entrar')}>Voltar</Link>
                </div>
              </>
            ) : null}

            {etapa === 'recuperar' ? (
              <>
                {botaoDoGoogle('Confirmar pelo Google', () => void recuperar())}
                <div className="text-center">
                  <Link aoClicar={() => irPara('entrar')}>Voltar</Link>
                </div>
              </>
            ) : null}

            {etapa === 'nova-senha' ? (
              <>
                <Botao
                  type="submit"
                  variante="primario"
                  carregando={ocupado}
                  disabled={senha.length < LIMITS.password.min || senha !== confirmacao}
                  className="mt-1 w-full"
                >
                  ▸ Trocar a senha e entrar
                </Botao>
                <div className="text-center">
                  <Link aoClicar={() => irPara('entrar')}>Cancelar</Link>
                </div>
              </>
            ) : null}
          </form>
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
                {aberto === false ? <span className="normal-case"> · cadastro por convite</span> : null}
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

/** O "G" do Google em traco, sem as cores da marca (o botao e da nossa identidade). */
function LetraG() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
      <path d="M20 12h-7" strokeLinecap="round" />
    </svg>
  );
}

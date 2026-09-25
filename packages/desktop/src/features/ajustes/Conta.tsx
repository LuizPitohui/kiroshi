import { useEffect, useState, type FormEvent } from 'react';
import { Copy, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { gateway } from '../../api/gateway.js';
import { conversarComGoogle, desvincularGoogle, estadoDoVinculo, GoogleCancelado, type EstadoDoVinculo } from '../../api/google.js';
import { useStore } from '../../store/index.js';
import { voice } from '../../voice/controller.js';
import { Aviso, Botao, Campo, CampoSenha, Confirmacao, Dialogo, avisar } from '../../design/primitivos/index.js';
import { sairDaVoz } from '../casca/acoesDeVoz.js';
import { motivo } from '../conversa/acoes.js';
import { descreverAparelho, vistoHa } from './aparelhos.js';
import { Bloco, Linha } from './partes.js';

/**
 * Sair de verdade: sai da chamada, encerra a sessao no servidor e esquece o
 * token. A 1.x so esquecia o token — a sessao seguia valendo no servidor — e
 * nao saia da chamada.
 */
export async function sairDaConta(): Promise<void> {
  if (voice.getState().channelId) sairDaVoz();
  await api.post('/auth/logout').catch(() => undefined);
  gateway.disconnect();
  api.setTokens(null);
  useStore.getState().reset();
}

interface Seguranca {
  hasPassword: boolean;
  totpEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

function SecaoSenha({ temSenha, aoDefinir }: { temSenha: boolean; aoDefinir: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const diferentes = confirmacao.length > 0 && nova !== confirmacao;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (nova !== confirmacao) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.post('/auth/password', { ...(temSenha ? { currentPassword: atual } : {}), newPassword: nova });
      setAtual('');
      setNova('');
      setConfirmacao('');
      avisar.ok(temSenha ? 'Senha trocada' : 'Senha definida', 'Os outros aparelhos foram desconectados; este continua.');
      aoDefinir();
    } catch (falha) {
      setErro(motivo(falha, 'Não consegui trocar a senha.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Bloco
      titulo={temSenha ? 'Senha' : 'Definir uma senha'}
      descricao={temSenha ? 'Trocar a senha desconecta os outros aparelhos.' : 'Sua conta entra só pelo Google. Com uma senha, dá para entrar também com email ou usuário.'}
    >
      <form onSubmit={(e) => void salvar(e)} className="max-w-[420px] space-y-3">
        {temSenha ? <CampoSenha rotulo="Senha atual" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} /> : null}
        <CampoSenha rotulo="Senha nova" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} dica="Pelo menos 8 caracteres." />
        <CampoSenha
          rotulo="Repita a senha nova"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          erro={diferentes ? 'As duas não são iguais.' : erro}
        />
        <Botao type="submit" variante="primario" carregando={salvando} disabled={!nova || diferentes || (temSenha && !atual)}>
          {temSenha ? 'Trocar a senha' : 'Definir a senha'}
        </Botao>
      </form>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Verificacao em duas etapas
// ---------------------------------------------------------------------------

function CodigosDeReserva({ codigos, aoFechar }: { codigos: string[]; aoFechar: () => void }) {
  return (
    <div className="space-y-3 border border-borda bg-terminal p-4">
      <p className="text-14 font-medium">Guarde estes códigos de reserva</p>
      <p className="text-13 text-texto-3">Cada um entra uma vez, se o celular sumir. Eles não aparecem de novo.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-14">
        {codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Botao tamanho="sm" icone={<Copy className="size-4" strokeWidth={1.5} />} onClick={() => void navigator.clipboard.writeText(codigos.join('\n'))}>
          Copiar
        </Botao>
        <Botao tamanho="sm" variante="primario" onClick={aoFechar}>
          Já guardei
        </Botao>
      </div>
    </div>
  );
}

function SecaoDuasEtapas({ ativa, temSenha }: { ativa: boolean; temSenha: boolean }) {
  const [configurando, setConfigurando] = useState<{ qrCode: string; secret: string } | null>(null);
  const [pedindo, setPedindo] = useState<'desativar' | 'novos' | null>(null);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Perdeu o celular: desativar com um codigo de recuperacao (so no desativar).
  const [comReserva, setComReserva] = useState(false);

  function limpar() {
    setCodigo('');
    setSenha('');
    setErro(null);
    setComReserva(false);
  }

  async function comecar() {
    setOcupado(true);
    setErro(null);
    try {
      setConfigurando(await api.post<{ qrCode: string; secret: string }>('/auth/totp/setup', {}));
    } catch (falha) {
      setErro(motivo(falha, 'Não consegui começar.'));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(caminho: string) {
    setOcupado(true);
    setErro(null);
    try {
      const usarReserva = comReserva && caminho === '/auth/totp/disable';
      const r = await api.post<{ backupCodes?: string[] }>(caminho, {
        ...(usarReserva ? { backupCode: codigo.trim() } : { code: codigo.trim() }),
        ...(temSenha ? { password: senha } : {}),
      });
      if (r.backupCodes) setCodigos(r.backupCodes);
      setConfigurando(null);
      setPedindo(null);
      limpar();
    } catch (falha) {
      setErro(motivo(falha, 'Não deu certo.'));
    } finally {
      setOcupado(false);
    }
  }

  const campos = (
    <>
      <Campo
        rotulo={comReserva ? 'Código de recuperação' : 'Código do aplicativo'}
        inputMode={comReserva ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        className="max-w-[200px]"
      />
      {pedindo === 'desativar' ? (
        <button type="button" onClick={() => (setComReserva((v) => !v), setCodigo(''))} className="text-12 text-texto-3 underline hover:text-texto">
          {comReserva ? 'Usar o código do aplicativo' : 'Perdi o celular: usar um código de recuperação'}
        </button>
      ) : null}
      {temSenha ? <CampoSenha rotulo="Sua senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} className="max-w-[320px]" /> : null}
    </>
  );

  return (
    <Bloco titulo="Verificação em duas etapas" descricao="Além da senha, um código do celular (Google Authenticator, Authy, 2FAS) na hora de entrar.">
      {codigos ? <CodigosDeReserva codigos={codigos} aoFechar={() => setCodigos(null)} /> : null}
      {ativa ? (
        <>
          <p className="flex items-center gap-2 text-14 text-ok">
            <ShieldCheck aria-hidden className="size-4" strokeWidth={1.5} />
            Ativa nesta conta.
          </p>
          {pedindo ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void confirmar(pedindo === 'desativar' ? '/auth/totp/disable' : '/auth/totp/backup-codes');
              }}
            >
              {campos}
              {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
              <div className="flex gap-2">
                <Botao type="submit" variante={pedindo === 'desativar' ? 'perigo' : 'primario'} carregando={ocupado} disabled={!codigo}>
                  {pedindo === 'desativar' ? 'Desativar' : 'Gerar códigos novos'}
                </Botao>
                <Botao variante="fantasma" onClick={() => (setPedindo(null), limpar())}>
                  Cancelar
                </Botao>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Botao onClick={() => setPedindo('novos')}>Códigos de reserva novos</Botao>
              <Botao variante="perigo" onClick={() => setPedindo('desativar')}>
                Desativar
              </Botao>
            </div>
          )}
        </>
      ) : configurando ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar('/auth/totp/enable');
          }}
        >
          <p className="text-13 text-texto-3">Leia o código com o aplicativo do celular e digite os 6 números que aparecerem.</p>
          <div className="flex flex-wrap items-start gap-4">
            <img src={configurando.qrCode} alt="Código QR da verificação em duas etapas" className="size-40 bg-branco p-2" />
            <div className="space-y-1">
              <p className="text-12 text-texto-3">Sem câmera? Digite a chave:</p>
              <p className="select-all break-all font-mono text-13">{configurando.secret}</p>
            </div>
          </div>
          {campos}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <div className="flex gap-2">
            <Botao type="submit" variante="primario" carregando={ocupado} disabled={!codigo}>
              Ativar
            </Botao>
            <Botao variante="fantasma" onClick={() => (setConfigurando(null), limpar())}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : (
        <>
          <Botao variante="primario" carregando={ocupado} onClick={() => void comecar()}>
            Ativar
          </Botao>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </>
      )}
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

function SecaoGoogle({ temSenha }: { temSenha: boolean }) {
  const [estado, setEstado] = useState<EstadoDoVinculo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    void estadoDoVinculo()
      .then(setEstado)
      .catch(() => setEstado(null));
  }, []);

  // Servidor sem Google configurado: a secao nem aparece.
  if (!estado?.disponivel) return null;

  async function vincular() {
    setOcupado(true);
    try {
      await conversarComGoogle('vincular');
      setEstado(await estadoDoVinculo());
      avisar.ok('Google vinculado', 'Agora dá para entrar com ele também.');
    } catch (falha) {
      if (!(falha instanceof GoogleCancelado)) avisar.erro('Não consegui vincular', motivo(falha, 'Tente de novo.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Bloco titulo="Google">
      <Linha titulo={estado.vinculado ? `Vinculado a ${estado.email ?? 'uma conta Google'}` : 'Não vinculado'} descricao="Entrar com o Google, sem digitar senha.">
        {estado.vinculado ? (
          <Botao variante="perigo" disabled={!temSenha} onClick={() => setConfirmando(true)}>
            Desvincular
          </Botao>
        ) : (
          <Botao carregando={ocupado} onClick={() => void vincular()}>
            Vincular
          </Botao>
        )}
      </Linha>
      {estado.vinculado && !temSenha ? <p className="text-12 text-texto-3">Para desvincular, defina uma senha antes: sem ela, você ficaria sem como entrar.</p> : null}
      <Confirmacao
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Desvincular o Google?"
        descricao="Você passa a entrar só com email ou usuário e senha."
        confirmar="Desvincular"
        perigo
        aoConfirmar={async () => {
          await desvincularGoogle();
          setEstado(await estadoDoVinculo());
        }}
      />
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Aparelhos conectados
// ---------------------------------------------------------------------------

interface Sessao {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function SecaoAparelhos() {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const carregar = () =>
    void api
      .get<Sessao[]>('/auth/sessions')
      .then(setSessoes)
      .catch(() => setSessoes([]));
  useEffect(carregar, []);

  async function encerrar(id: string) {
    try {
      await api.delete(`/auth/sessions/${id}`);
      carregar();
    } catch (falha) {
      avisar.erro('Não consegui desconectar o aparelho', motivo(falha, 'Tente de novo.'));
    }
  }

  const outras = (sessoes ?? []).filter((s) => !s.current);

  return (
    <Bloco titulo="Aparelhos conectados" descricao="Onde sua conta está aberta. Não reconhece algum? Desconecte e troque a senha.">
      {sessoes === null ? (
        <p className="text-13 text-texto-3">Carregando…</p>
      ) : (
        <ul>
          {sessoes.map((s) => (
            <li key={s.id} className="flex items-center gap-3 border-t border-borda py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-14 font-medium">
                  {descreverAparelho(s.userAgent)}
                  {s.current ? <span className="ml-2 font-mono text-10 uppercase tracking-rotulo text-ok">este aparelho</span> : null}
                </p>
                <p className="truncate font-mono text-11 text-texto-3">
                  {s.ipAddress ?? 'IP desconhecido'} · visto {s.current ? 'agora' : vistoHa(s.lastUsedAt)}
                </p>
              </div>
              {s.current ? null : (
                <Botao tamanho="sm" onClick={() => void encerrar(s.id)}>
                  Desconectar
                </Botao>
              )}
            </li>
          ))}
        </ul>
      )}
      {outras.length > 1 ? (
        <Botao variante="perigo" onClick={() => setConfirmando(true)}>
          Desconectar todos os outros
        </Botao>
      ) : null}
      <Confirmacao
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Desconectar os outros aparelhos?"
        descricao={`${outras.length} aparelhos saem da conta na hora. Este continua conectado.`}
        confirmar="Desconectar todos"
        perigo
        aoConfirmar={async () => {
          for (const s of outras) await api.delete(`/auth/sessions/${s.id}`);
          carregar();
        }}
      />
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Excluir a conta
// ---------------------------------------------------------------------------

function SecaoExcluir({ usuario }: { usuario: string }) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function excluir() {
    setOcupado(true);
    setErro(null);
    try {
      await api.delete('/users/@me');
      gateway.disconnect();
      api.setTokens(null);
      useStore.getState().reset();
    } catch (falha) {
      setErro(motivo(falha, 'Não consegui excluir a conta.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Bloco titulo="Excluir a conta" descricao="Some o perfil e o acesso. As mensagens ficam nas conversas, como de 'Conta apagada'. Não tem volta.">
      <Botao variante="perigo" onClick={() => setAberto(true)}>
        Excluir minha conta
      </Botao>
      <Dialogo aberto={aberto} aoMudar={(v) => (setAberto(v), setDigitado(''), setErro(null))} titulo="Excluir a conta?">
        <div className="space-y-4">
          <p className="text-14 text-texto-2">
            Para confirmar, digite seu nome de usuário: <span className="font-mono text-texto">{usuario}</span>
          </p>
          <Campo rotulo="Nome de usuário" value={digitado} onChange={(e) => setDigitado(e.target.value)} autoComplete="off" spellCheck={false} erro={erro} />
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao variante="perigo" carregando={ocupado} disabled={digitado.trim() !== usuario} onClick={() => void excluir()}>
              Excluir para sempre
            </Botao>
          </div>
        </div>
      </Dialogo>
    </Bloco>
  );
}

/**
 * Conta e seguranca: email, senha, verificacao em duas etapas, Google,
 * aparelhos conectados, sair e excluir.
 */
export function PaginaConta() {
  const eu = useStore((s) => s.user);
  const [seguranca, setSeguranca] = useState<Seguranca | null>(null);

  const carregar = () =>
    void api
      .get<Seguranca>('/users/@me/security')
      .then(setSeguranca)
      .catch(() => setSeguranca({ hasPassword: true, totpEnabled: eu?.totpEnabled ?? false }));
  // A troca de 2FA chega pelo gateway (USER_UPDATE): recarrega junto.
  useEffect(carregar, [eu?.totpEnabled]);

  if (!eu || !seguranca) return <p className="text-13 text-texto-3">Carregando…</p>;

  return (
    <div className="space-y-8">
      <Bloco titulo="Entrada">
        <Linha titulo="Email">
          <span className="font-mono text-13 text-texto-2">{eu.email}</span>
        </Linha>
        <Linha titulo="Nome de usuário">
          <span className="font-mono text-13 text-texto-2">@{eu.username}</span>
        </Linha>
      </Bloco>
      <SecaoSenha temSenha={seguranca.hasPassword} aoDefinir={carregar} />
      <SecaoDuasEtapas ativa={eu.totpEnabled} temSenha={seguranca.hasPassword} />
      <SecaoGoogle temSenha={seguranca.hasPassword} />
      <SecaoAparelhos />
      <Bloco titulo="Sair">
        <Botao icone={<LogOut className="size-4" strokeWidth={1.5} />} onClick={() => void sairDaConta()}>
          Sair da conta neste aparelho
        </Botao>
      </Bloco>
      <SecaoExcluir usuario={eu.username} />
    </div>
  );
}

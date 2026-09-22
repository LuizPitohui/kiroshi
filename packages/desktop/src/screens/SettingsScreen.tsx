import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import { gateway } from '../api/gateway.js';
import { useStore } from '../store/index.js';
import { voice, type InputMode } from '../voice/controller.js';
import { tocarAviso } from '../voice/sons.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { ProfileCard } from '../components/ui/ProfileCard.js';
import { UnsavedBar } from '../components/ui/UnsavedBar.js';
import { Close } from '../components/Icons.js';
import {
  GoogleCancelado,
  conversarComGoogle,
  definirSenhaComGoogle,
  desvincularGoogle,
  estadoDoVinculo,
  type EstadoDoVinculo,
} from '../api/google.js';
import { aplicarMovimento } from '../lib/movimento.js';
import { aplicarDensidade, aplicarEnvio } from '../lib/leitura.js';
import type { AtualizacaoEstado } from '../../electron/preload.js';

interface Props {
  onClose: () => void;
}

type Section =
  | 'profile'
  | 'security'
  | 'voice'
  | 'messages'
  | 'appearance'
  | 'notifications'
  | 'about';

export function SettingsScreen({ onClose }: Props) {
  const [section, setSection] = useState<Section>('profile');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="settings">
      <nav className="settings-nav">
        <div className="settings-group">Conta</div>
        <button
          className={`settings-item ${section === 'profile' ? 'active' : ''}`}
          onClick={() => setSection('profile')}
        >
          Meu perfil
        </button>
        <button
          className={`settings-item ${section === 'security' ? 'active' : ''}`}
          onClick={() => setSection('security')}
        >
          Seguranca
        </button>

        {/*
          Quatro grupos, e a divisa entre eles e "sobre o que voce mexe",
          nao "onde o codigo mora".

          Antes eram tres, e um deles chamava "Aplicativo" e continha tudo —
          microfone, conversas, tema e notificacoes na mesma lista de quatro
          itens. Achar qualquer coisa ali exigia ler os quatro, porque o titulo
          do grupo nao ajudava a descartar nenhum.

          Agora: Comunicacao e o que sai de voce para os outros; Experiencia e
          como o aplicativo se comporta para voce; Aplicativo e o programa em
          si, que e onde "Sobre" e "atualizacoes" sempre pertenceram.
        */}
        <div className="settings-group">Comunicacao</div>
        <button
          className={`settings-item ${section === 'voice' ? 'active' : ''}`}
          onClick={() => setSection('voice')}
        >
          Voz e video
        </button>
        <button
          className={`settings-item ${section === 'messages' ? 'active' : ''}`}
          onClick={() => setSection('messages')}
        >
          Conversas
        </button>
        <button
          className={`settings-item ${section === 'notifications' ? 'active' : ''}`}
          onClick={() => setSection('notifications')}
        >
          Notificacoes
        </button>

        <div className="settings-group">Experiencia</div>
        <button
          className={`settings-item ${section === 'appearance' ? 'active' : ''}`}
          onClick={() => setSection('appearance')}
        >
          Aparencia e movimento
        </button>

        <div className="settings-group">Aplicativo</div>
        <button
          className={`settings-item ${section === 'about' ? 'active' : ''}`}
          onClick={() => setSection('about')}
        >
          Sobre e atualizacoes
        </button>

        <div className="divider" />
        <button
          className="settings-item"
          style={{ color: 'var(--red)' }}
          onClick={() => {
            gateway.disconnect();
            api.setTokens(null);
          }}
        >
          Sair da conta
        </button>
      </nav>

      <div className="settings-content">
        {section === 'profile' && <ProfileSection />}
        {section === 'security' && <SecuritySection />}
        {section === 'voice' && <VoiceSection />}
        {section === 'messages' && <MessagesSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'notifications' && <NotificationsSection />}
        {section === 'about' && <AboutSection />}
      </div>

      <button className="settings-close" onClick={onClose} aria-label="Fechar ajustes">
        <Close size={18} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Meu perfil: os campos a esquerda, a previa a direita.
 *
 * A previa e a mudanca que importa aqui. Editar perfil em coluna de
 * formulario e adivinhar: os campos ficam em ordem vertical e nada mostra
 * como eles se juntam no cartao que as outras pessoas veem. Uma biografia de
 * 190 caracteres parece curta no campo de quatro linhas e ocupa o cartao
 * inteiro quando alguem clica no seu nome.
 *
 * E o botao de salvar virou barra. O botao ficava sempre no fim da coluna,
 * sempre igual, sem dizer se havia algo pendente — e trocar de secao com o
 * nome pela metade descartava tudo em silencio.
 */
function ProfileSection() {
  const user = useStore((s) => s.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Recarrega os campos quando o perfil salvo muda por fora.

    Acontece de verdade: o avatar sobe por outro caminho e volta pelo gateway,
    e sem isto o estado local ficaria preso no que foi digitado antes, fazendo
    a barra de nao salvo aparecer sozinha logo depois de salvar.
  */
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setBio(user.bio ?? '');
    setPronouns(user.pronouns ?? '');
  }, [user?.displayName, user?.bio, user?.pronouns]);

  if (!user) return null;

  // Compara com o que esta salvo, campo a campo. Um booleano "mexeu em algo"
  // acenderia a barra para quem digitou e apagou de volta.
  const pendente =
    displayName.trim() !== user.displayName ||
    bio.trim() !== (user.bio ?? '') ||
    pronouns.trim() !== (user.pronouns ?? '');

  function descartar(): void {
    if (!user) return;
    setDisplayName(user.displayName);
    setBio(user.bio ?? '');
    setPronouns(user.pronouns ?? '');
    setError(null);
  }

  async function uploadAvatar(file: File): Promise<void> {
    if (file.size > 8 * 1024 * 1024) {
      setError('A imagem passa de 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      await api
        .patch('/users/@me', { avatarUrl: reader.result as string })
        .catch(() => setError('Nao consegui enviar a imagem.'));
    };
    reader.readAsDataURL(file);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.patch('/users/@me', {
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        pronouns: pronouns.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="settings-title">Meu perfil</h2>

      <div className="perfil-colunas">
        <div className="perfil-campos">
          <div className="field">
            <label className="field-label" htmlFor="display-name">
              Nome de exibicao
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pronouns">
              Pronomes
            </label>
            <input
              id="pronouns"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              maxLength={40}
              placeholder="ele/dele, ela/dela, elu/delu..."
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="bio">
              Sobre mim
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={190}
              rows={4}
              style={{ resize: 'vertical' }}
            />
            <div className="field-hint">{bio.length}/190</div>
          </div>

          <label className="perfil-trocar-foto">
            <span>Trocar foto</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </label>
        </div>

        {/*
          A previa recebe o que esta sendo DIGITADO, nao o que esta salvo: ela
          responde "como vai ficar", que e a pergunta de quem esta editando.
          Mostrar o salvo transformaria a previa em um espelho inutil.
        */}
        <aside className="perfil-previa" data-perfil="previa">
          <span className="perfil-previa-rotulo">Como os outros te veem</span>
          <ProfileCard
            displayName={displayName.trim() || user.displayName}
            username={user.username}
            avatarUrl={user.avatarUrl}
            bannerUrl={user.bannerUrl}
            bio={bio.trim() || null}
            pronouns={pronouns.trim() || null}
            accentColor={user.accentColor}
            status={user.status}
          />
        </aside>
      </div>

      <UnsavedBar
        visivel={pendente || Boolean(error)}
        salvando={saving}
        erro={error}
        aoSalvar={() => void save()}
        aoDescartar={descartar}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function SecuritySection() {
  const user = useStore((s) => s.user);
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  // Conta do Google vinculada.
  const [vinculo, setVinculo] = useState<EstadoDoVinculo | null>(null);

  useEffect(() => {
    void estadoDoVinculo()
      .then(setVinculo)
      .catch(() => setVinculo(null));
  }, []);

  async function vincular(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const desfecho = await conversarComGoogle('vincular');
      if (desfecho.tipo === 'vinculado') {
        setVinculo(await estadoDoVinculo());
      } else {
        setError('Nao consegui vincular.');
      }
    } catch (err) {
      if (err instanceof GoogleCancelado) setError(err.message);
      else setError(err instanceof ApiRequestError ? err.message : 'Nao consegui vincular.');
    } finally {
      setBusy(false);
    }
  }

  /*
    Redefinir a senha provando pelo Google, sem saber a antiga.

    Existe porque quem esquece a senha nao tem por onde voltar: nao ha e-mail
    de recuperacao neste servidor. A prova vale cinco minutos e serve so para
    esta acao — nao abre mais nada.
  */
  const [provaDeSenha, setProvaDeSenha] = useState<string | null>(null);

  async function provarPeloGoogle(): Promise<void> {
    setError(null);
    setPasswordMessage(null);
    setBusy(true);
    try {
      const desfecho = await conversarComGoogle('senha');
      if (desfecho.tipo === 'prova-de-senha') {
        setProvaDeSenha(desfecho.prova);
        setCurrentPassword('');
      } else {
        setError('Nao consegui confirmar pelo Google.');
      }
    } catch (err) {
      if (err instanceof GoogleCancelado) setError(err.message);
      else setError(err instanceof ApiRequestError ? err.message : 'Nao consegui falar com o Google.');
    } finally {
      setBusy(false);
    }
  }

  async function definirSenhaPelaProva(): Promise<void> {
    if (!provaDeSenha) return;
    setError(null);
    setBusy(true);
    try {
      await definirSenhaComGoogle(provaDeSenha, newPassword);
      setProvaDeSenha(null);
      setNewPassword('');
      setPasswordMessage('Senha definida. Voce vai precisar entrar de novo em todos os aparelhos.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui definir a senha.');
    } finally {
      setBusy(false);
    }
  }

  async function desvincular(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await desvincularGoogle();
      setVinculo(await estadoDoVinculo());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui desvincular.');
    } finally {
      setBusy(false);
    }
  }

  async function startSetup(): Promise<void> {
    setError(null);
    try {
      const data = await api.post<{ qrCode: string; secret: string }>('/auth/totp/setup');
      setSetup(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui iniciar o 2FA.');
    }
  }

  async function enable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ backupCodes: string[] }>('/auth/totp/enable', {
        code: code.trim(),
        password,
      });
      setBackupCodes(result.backupCodes);
      setSetup(null);
      setCode('');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Codigo ou senha incorretos.');
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/totp/disable', { code: code.trim(), password });
      setCode('');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Codigo ou senha incorretos.');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(): Promise<void> {
    setPasswordMessage(null);
    try {
      await api.post('/auth/password', { currentPassword, newPassword });
      setPasswordMessage('Senha trocada. Os outros dispositivos foram desconectados.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordMessage(
        err instanceof ApiRequestError ? err.message : 'Nao consegui trocar a senha.',
      );
    }
  }

  return (
    <>
      <h2 className="settings-title">Seguranca</h2>

      {/*
        Conta do Google.

        So aparece se o servidor tiver isso ligado — cada servidor decide, e um
        botao que existe sem funcionar e pior do que botao nenhum.
      */}
      {vinculo?.disponivel && (
        <div className="row">
          <div className="row-text">
            <div className="row-title">Conta do Google</div>
            <div className="row-desc">
              {vinculo.vinculado
                ? `Vinculada a ${vinculo.email ?? 'sua conta do Google'}. Da para entrar por ela.`
                : 'Vincule para entrar com um clique, sem digitar a senha.'}
            </div>
          </div>
          {vinculo.vinculado ? (
            <button className="btn" onClick={() => void desvincular()} disabled={busy}>
              Desvincular
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void vincular()} disabled={busy}>
              Vincular
            </button>
          )}
        </div>
      )}

      <div className="row">
        <div className="row-text">
          <div className="row-title">Verificacao em duas etapas</div>
          <div className="row-desc">
            {user?.totpEnabled
              ? 'Ativa. Voce precisa do codigo do app ao entrar.'
              : 'Um codigo do celular alem da senha. Recomendado.'}
          </div>
        </div>
        {!user?.totpEnabled && !setup && (
          <button className="btn btn-primary" onClick={() => void startSetup()}>
            Ativar
          </button>
        )}
      </div>

      {setup && (
        <div style={{ padding: 16, background: 'var(--raised)', borderRadius: 8, marginTop: 12 }}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            Leia o codigo com o Google Authenticator, Authy, 1Password ou qualquer app de TOTP.
          </p>
          <img
            src={setup.qrCode}
            alt="Codigo QR para o app autenticador"
            style={{ borderRadius: 8, marginBottom: 12 }}
          />
          <div className="field">
            <label className="field-label">Ou digite a chave manualmente</label>
            <input
              readOnly
              value={setup.secret}
              className="selectable"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="totp-code">
              Codigo de 6 digitos
            </label>
            <input
              id="totp-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="confirm-password">
              Sua senha
            </label>
            <input
              id="confirm-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="field-error">{error}</div>}
          <button
            className="btn btn-primary"
            onClick={() => void enable()}
            disabled={busy || code.length !== 6 || !password}
          >
            Confirmar
          </button>
        </div>
      )}

      {backupCodes && (
        <div
          style={{
            padding: 16,
            background: 'var(--raised)',
            borderRadius: 8,
            marginTop: 12,
            border: '1px solid var(--optic)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Guarde estes codigos agora</div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
            Cada um funciona uma vez, para entrar se voce perder o celular. Eles nao aparecem de
            novo.
          </p>
          <div
            className="selectable"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
            }}
          >
            {backupCodes.map((backupCode) => (
              <div key={backupCode}>{backupCode}</div>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() => {
              void navigator.clipboard.writeText(backupCodes.join('\n'));
            }}
          >
            Copiar todos
          </button>
        </div>
      )}

      {user?.totpEnabled && (
        <div style={{ marginTop: 16 }}>
          <div className="field">
            <label className="field-label">Codigo do app</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <div className="field">
            <label className="field-label">Sua senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="field-error">{error}</div>}
          <button
            className="btn btn-danger"
            onClick={() => void disable()}
            disabled={busy || code.length !== 6 || !password}
          >
            Desativar 2FA
          </button>
        </div>
      )}

      <div className="divider" />

      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Trocar senha</h3>
      {provaDeSenha ? (
        /*
          Com a prova em maos, a senha atual deixa de ser pedida. O aviso e
          explicito porque esta troca derruba TODAS as sessoes, inclusive esta:
          se a conta tiver sido tomada, quem tomou cai junto.
        */
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Confirmado pelo Google. Escolha a senha nova abaixo — ao salvar, todos
          os aparelhos serao desconectados, inclusive este.
        </div>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor="current-password">
            Senha atual
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          {vinculo?.vinculado && (
            <button
              className="btn-quiet"
              style={{ marginTop: 8 }}
              onClick={() => void provarPeloGoogle()}
              disabled={busy}
            >
              Esqueci a senha atual — confirmar pelo Google
            </button>
          )}
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="next-password">
          Nova senha
        </label>
        <input
          id="next-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
        />
      </div>
      {passwordMessage && <div className="field-hint">{passwordMessage}</div>}
      {provaDeSenha ? (
        <button
          className="btn btn-primary"
          onClick={() => void definirSenhaPelaProva()}
          disabled={busy || newPassword.length < 8}
        >
          Definir senha nova
        </button>
      ) : (
        <button
          className="btn btn-ghost"
          onClick={() => void changePassword()}
          disabled={!currentPassword || newPassword.length < 8}
        >
          Trocar senha
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function VoiceSection() {
  const voiceState = useVoiceState();
  const [settings, setSettings] = useState(voice.getSettings());
  const [devices, setDevices] = useState<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
  }>({ inputs: [], outputs: [], cameras: [] });

  const [testing, setTesting] = useState(false);

  /*
    O que a maquina REALMENTE aplicou, e nao o que pedimos.

    Existe porque "a supressao de ruido nao funciona" e uma frase impossivel de
    responder sem dado: pedir uma limpeza e conseguir a limpeza sao coisas
    diferentes, e so o navegador sabe qual das duas aconteceu. Sem isto, a
    conversa vira opiniao contra opiniao.
  */
  const [aplicado, setAplicado] = useState<MediaTrackSettings | null>(null);
  const [level, setLevel] = useState(0);
  // Retorno de voz: ouvir a si mesmo e a unica forma de ter certeza de que o
  // microfone certo esta captando, e com que volume.
  const [monitoring, setMonitoring] = useState(false);
  const [pttKey, setPttKey] = useState(localStorage.getItem('kiroshi.ptt.key') ?? 'F8');
  const [capturingKey, setCapturingKey] = useState(false);

  useEffect(() => {
    void voice.listDevices().then(setDevices);
  }, []);

  async function update(patch: Partial<typeof settings>): Promise<void> {
    await voice.updateSettings(patch);
    setSettings(voice.getSettings());
  }

  /**
   * Teste de microfone.
   *
   * Duas coisas ao mesmo tempo: a barra, que mostra que o sinal chega, e o
   * retorno opcional, que devolve a propria voz no fone. A barra sozinha nao
   * responde a pergunta que a pessoa realmente tem, que e "como eu soo para os
   * outros" — so ouvindo dá para notar microfone abafado, longe demais, ou o
   * dispositivo errado selecionado.
   *
   * Nada disso passa pela sala: e tudo local, ninguem mais escuta.
   */
  useEffect(() => {
    if (!testing) return;

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let retorno: HTMLAudioElement | null = null;
    let raf = 0;

    void navigator.mediaDevices
      .getUserMedia({
        /*
          EXATAMENTE o que a chamada pede, nem mais nem menos.

          Antes faltava `voiceIsolation` aqui: o teste entregava um
          processamento mais fraco que o da chamada real, e quem testasse
          concluiria que a limpeza nao funciona quando na chamada ela funciona.
          Um teste que mente sobre o produto e pior do que nao ter teste.
        */
        audio: {
          deviceId: settings.inputDeviceId ?? undefined,
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
          voiceIsolation: settings.voiceIsolation,
        },
      })
      .then(async (mediaStream) => {
        stream = mediaStream;
        // O navegador so diz o que aplicou DEPOIS de abrir a faixa.
        setAplicado(mediaStream.getAudioTracks()[0]?.getSettings() ?? null);
        context = new AudioContext();
        const source = context.createMediaStreamSource(mediaStream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        if (monitoring) {
          // Elemento de audio, e nao ligacao direta no destino do AudioContext,
          // porque so o elemento aceita escolher o dispositivo de saida.
          retorno = new Audio();
          retorno.srcObject = mediaStream;
          retorno.volume = settings.outputVolume;

          if (settings.outputDeviceId && 'setSinkId' in retorno) {
            await (retorno as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
              .setSinkId(settings.outputDeviceId)
              .catch(() => undefined);
          }
          await retorno.play().catch(() => undefined);
        }

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = (): void => {
          analyser.getByteTimeDomainData(data);
          // Valor eficaz do sinal: mede volume melhor que o pico.
          let sum = 0;
          for (const value of data) {
            const centered = (value - 128) / 128;
            sum += centered * centered;
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setTesting(false));

    return () => {
      setAplicado(null);
      cancelAnimationFrame(raf);
      if (retorno) {
        retorno.pause();
        retorno.srcObject = null;
      }
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      setLevel(0);
    };
  }, [
    testing,
    monitoring,
    settings.inputDeviceId,
    settings.outputDeviceId,
    settings.outputVolume,
    settings.noiseSuppression,
    settings.echoCancellation,
    settings.autoGainControl,
  ]);

  // Captura a proxima tecla para usar como push-to-talk.
  useEffect(() => {
    if (!capturingKey) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      const key = event.code || event.key;
      setPttKey(key);
      localStorage.setItem('kiroshi.ptt.key', key);
      setCapturingKey(false);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [capturingKey]);

  return (
    <>
      <h2 className="settings-title">Voz e video</h2>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Microfone</div>
        </div>
        <select
          value={settings.inputDeviceId ?? ''}
          onChange={(e) => void update({ inputDeviceId: e.target.value || null })}
        >
          <option value="">Padrao do sistema</option>
          {devices.inputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Microfone'}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Saida de audio</div>
        </div>
        <select
          value={settings.outputDeviceId ?? ''}
          onChange={(e) => void update({ outputDeviceId: e.target.value || null })}
        >
          <option value="">Padrao do sistema</option>
          {devices.outputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Saida'}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Testar microfone</div>
          <div className="row-desc">
            Fale e veja a barra se mexer. Ligue o retorno para ouvir como voce soa.
          </div>
          {testing && (
            <>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${level * 100}%` }} />
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 10,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <button
                  className={`switch ${monitoring ? 'on' : ''}`}
                  onClick={() => setMonitoring((v) => !v)}
                  aria-pressed={monitoring}
                  aria-label="Ouvir minha voz"
                  style={{ width: 34, height: 20 }}
                />
                <span>Ouvir minha voz</span>
              </label>
              {monitoring && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--away)',
                    marginTop: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  Use fone. Na caixa de som, o microfone capta o proprio retorno e apita.
                </div>
              )}

              {/*
                O que a maquina REALMENTE ligou.

                Pedir uma limpeza e conseguir a limpeza sao coisas diferentes:
                o navegador aceita o pedido e pode entregar menos, calado,
                dependendo do driver e do aparelho. Sem esta linha, "a
                supressao nao funciona" e opiniao contra opiniao — com ela, e
                um dado que a pessoa le na tela e manda.
              */}
              {aplicado && <LimpezaAtiva aplicado={aplicado} />}
            </>
          )}
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const proximo = !testing;
            setTesting(proximo);
            // Parar o teste desliga o retorno junto, para nao voltar ligado
            // sem querer na proxima vez.
            if (!proximo) setMonitoring(false);
          }}
        >
          {testing ? 'Parar' : 'Testar'}
        </button>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Volume geral</div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.outputVolume * 100}
          onChange={(e) => void update({ outputVolume: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="divider" />

      <div className="row">
        <div className="row-text">
          <div className="row-title">Modo de entrada</div>
          <div className="row-desc">
            Por voz abre o microfone quando voce fala; apertar para falar so abre com a tecla.
          </div>
        </div>
        <select
          value={settings.inputMode}
          onChange={(e) => void update({ inputMode: e.target.value as InputMode })}
        >
          <option value="voice-activity">Por atividade de voz</option>
          <option value="push-to-talk">Apertar para falar</option>
        </select>
      </div>

      {settings.inputMode === 'push-to-talk' && (
        <div className="row">
          <div className="row-text">
            <div className="row-title">Tecla</div>
            <div className="row-desc">
              Funciona com a janela do Kiroshi em foco. Com um jogo na frente, a mesma tecla alterna
              o microfone.
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => setCapturingKey(true)}
            style={{ minWidth: 140 }}
          >
            {capturingKey ? 'Aperte uma tecla...' : pttKey}
          </button>
        </div>
      )}

      <div className="divider" />

      {/*
        Fica ANTES dos ajustes de captura de proposito: e o unico aqui que
        muda o que voce ouve, nao o que os outros ouvem de voce. Misturar com
        supressao de ruido e cancelamento de eco confundiria as duas coisas.
      */}
      <div className="row">
        <div className="row-text">
          <div className="row-title">Aviso sonoro de entrada e saida</div>
          <div className="row-desc">
            Um som curto quando alguem entra ou sai da chamada. Sobe para quem
            chega, desce para quem sai.
          </div>
        </div>
        <button
          className={`switch ${settings.avisosSonoros ? 'on' : ''}`}
          onClick={() => {
            const ligando = !settings.avisosSonoros;
            void update({ avisosSonoros: ligando });
            // Toca ao ligar: mostra o som em vez de descreve-lo.
            if (ligando) tocarAviso('entrada');
          }}
          aria-pressed={settings.avisosSonoros}
          aria-label="Aviso sonoro de entrada e saida"
        />
      </div>

      {/*
        Vem ANTES da supressao de ruido porque e o mais forte dos dois, e
        porque a descricao de um explica o outro: quem ler os dois em ordem
        entende por que existem separados.
      */}
      <div className="row">
        <div className="row-text">
          <div className="row-title">Isolamento de voz</div>
          <div className="row-desc">
            Mantem so a sua voz e descarta o resto: teclado, televisao, gente
            falando no mesmo comodo. Bem mais forte que a supressao de ruido.
          </div>
        </div>
        <button
          className={`switch ${settings.voiceIsolation ? 'on' : ''}`}
          onClick={() => void update({ voiceIsolation: !settings.voiceIsolation })}
          aria-pressed={settings.voiceIsolation}
          aria-label="Isolamento de voz"
        />
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Supressao de ruido</div>
          <div className="row-desc">
            Corta ruido constante: ventilador, chiado, ar-condicionado. Nao
            pega som que aparece e some, como teclado — isso e com o
            isolamento de voz.
          </div>
        </div>
        <button
          className={`switch ${settings.noiseSuppression ? 'on' : ''}`}
          onClick={() => void update({ noiseSuppression: !settings.noiseSuppression })}
          aria-pressed={settings.noiseSuppression}
          aria-label="Supressao de ruido"
        />
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Cancelamento de eco</div>
          <div className="row-desc">Necessario se voce usa caixas de som.</div>
        </div>
        <button
          className={`switch ${settings.echoCancellation ? 'on' : ''}`}
          onClick={() => void update({ echoCancellation: !settings.echoCancellation })}
          aria-pressed={settings.echoCancellation}
          aria-label="Cancelamento de eco"
        />
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Ganho automatico</div>
          <div className="row-desc">Equilibra o volume da sua voz.</div>
        </div>
        <button
          className={`switch ${settings.autoGainControl ? 'on' : ''}`}
          onClick={() => void update({ autoGainControl: !settings.autoGainControl })}
          aria-pressed={settings.autoGainControl}
          aria-label="Ganho automatico"
        />
      </div>

      {voiceState.connected && (
        <div className="field-hint" style={{ marginTop: 16 }}>
          Voce esta em uma chamada. Trocar o microfone reconecta a faixa de audio.
        </div>
      )}

      <div className="divider" />
      <ConnectionDiagnostic connected={voiceState.connected} />
    </>
  );
}

/**
 * Diagnostico da conexao de voz.
 *
 * A voz depende de um caminho direto ate o servidor. Quando alguem nao
 * consegue ouvir ninguem, a pergunta e sempre "e a minha internet?". Isto
 * responde com o que o WebRTC realmente negociou, em vez de deixar a pessoa
 * adivinhando.
 */
function ConnectionDiagnostic({ connected }: { connected: boolean }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof voice.inspectConnection>> | null>(
    null,
  );
  const [checking, setChecking] = useState(false);

  async function check(): Promise<void> {
    setChecking(true);
    setResult(await voice.inspectConnection());
    setChecking(false);
  }

  const descricao: Record<string, string> = {
    direto: 'Conexao direta com o servidor. E o melhor caso.',
    nat: 'Direta, atravessando o seu roteador. Funciona bem.',
    relay: 'Passando por um servidor de retransmissao. Funciona, mas com mais atraso.',
    desconhecido: 'Nao consegui identificar o caminho.',
  };

  return (
    <>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Diagnostico</h3>
      <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 12 }}>
        Se a voz nao estiver funcionando, entre em um canal e rode isto. O resultado diz se o
        problema esta no caminho da rede.
      </p>

      {/* Sem exigir chamada: a checagem de IPv6 e justamente a que importa
          quando a pessoa nao consegue entrar em nenhuma. */}
      <button className="btn btn-ghost" onClick={() => void check()} disabled={checking}>
        {checking ? 'Verificando...' : 'Verificar conexao'}
      </button>

      {!connected && (
        <div className="field-hint">
          Fora de uma chamada da para conferir so a rede. Entre em um canal de voz para ver tambem a
          latencia e a perda de pacotes.
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            background: 'var(--raised)',
            borderRadius: 'var(--r-md)',
            fontSize: 14,
          }}
        >
          {/*
            Os caminhos ate o servidor vem primeiro, e em vermelho quando nao
            sobra nenhum.

            A midia nao passa pelo tunel: ela vai direto ao servidor, por IPv6
            ou pela rede virtual. Sem nenhum dos dois a pessoa entra no canal,
            aparece na lista e nao ouve ninguem — um sintoma que parece bug do
            aplicativo e nao e.

            O que muda em relacao a versao anterior desta tela: antes ela
            olhava so o IPv6 e mandava avisar o dono do servidor. Hoje existe o
            segundo caminho, e ele se resolve do lado de ca — entao a tela diz
            o que fazer em vez de mandar esperar.
          */}
          <div
            style={{
              fontWeight: 600,
              marginBottom: 8,
              color: result.temIPv6 || result.naVpn ? undefined : 'var(--red)',
            }}
          >
            {result.temIPv6
              ? 'Sua internet tem IPv6: a voz vai pelo caminho direto.'
              : result.naVpn
                ? 'Sua internet nao tem IPv6, mas a rede virtual esta ligada — a voz vai por ela.'
                : 'Sua internet nao tem IPv6 e a rede virtual esta desligada — a voz nao conecta.'}
          </div>

          {!result.temIPv6 && !result.naVpn && (
            <div style={{ color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 8 }}>
              O chat funciona normalmente; so a voz depende disso. Para resolver: instale o
              Tailscale, aceite o convite que o dono do servidor mandou e deixe o icone dele como
              &quot;Connected&quot;. Depois entre no canal de voz de novo.
            </div>
          )}

          {!result.temIPv6 && result.naVpn && !result.conectado && (
            <div style={{ color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 8 }}>
              A rede virtual esta ligada aqui. Se mesmo assim a voz nao fechar, confira no Tailscale
              se o servidor aparece na lista de maquinas.
            </div>
          )}

          {result.conectado && (
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {descricao[result.caminho] ?? descricao.desconhecido}
            </div>
          )}
          <div style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            {result.endereco && (
              <div>
                Servidor: <code>{result.endereco}</code>
                {result.protocolo ? ` (${result.protocolo.toUpperCase()})` : ''}
              </div>
            )}
            {result.latenciaMs !== null && <div>Latencia: {result.latenciaMs} ms</div>}
            {result.perdaPacotes !== null && (
              <div>
                Perda de pacotes: {result.perdaPacotes}%
                {result.perdaPacotes > 3 ? ' — alta, pode picotar o audio' : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Como as conversas se comportam para voce.
 *
 * Densidade e a tecla Enter ficam juntas porque sao a mesma pergunta pelos
 * dois lados — ler e escrever — e porque a alternativa era espalhar uma em
 * "Aparencia" e deixar a outra sem secao.
 */
function MessagesSection() {
  const [densidade, setDensidade] = useState(aplicarDensidade.ler);
  const [envio, setEnvio] = useState(aplicarEnvio.ler);

  return (
    <>
      <h2 className="settings-title">Conversas</h2>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Densidade</div>
          <div className="row-desc">
            Confortavel separa as mensagens, o que ajuda a acompanhar quem falou o que quando
            varias pessoas conversam ao mesmo tempo. Compacto cabe mais na tela — util em janela
            estreita, como a conversa ao lado de uma chamada.
          </div>
        </div>
        <select
          value={densidade}
          onChange={(e) => setDensidade(aplicarDensidade.escrever(e.target.value))}
        >
          <option value="confortavel">Confortavel</option>
          <option value="compacto">Compacto</option>
        </select>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">A tecla Enter</div>
          <div className="row-desc">
            {envio === 'enter'
              ? 'Enter envia e Shift+Enter quebra a linha.'
              : 'Enter quebra a linha e Ctrl+Enter envia. Para quem escreve mensagens longas e ja mandou alguma pela metade sem querer.'}
          </div>
        </div>
        <select value={envio} onChange={(e) => setEnvio(aplicarEnvio.escrever(e.target.value))}>
          <option value="enter">Enter envia</option>
          <option value="ctrl-enter">Ctrl+Enter envia</option>
        </select>
      </div>
    </>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState(localStorage.getItem('kiroshi.theme') ?? 'dark');
  const [movimento, setMovimento] = useState(aplicarMovimento.ler);

  // Se o Windows ja esta com os efeitos de animacao desligados, a opcao
  // "seguir o sistema" nao anima nada — e util dizer isso na hora, em vez de
  // deixar a pessoa achando que a configuracao nao funcionou.
  const sistemaReduz =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function aplicarTema(next: string): void {
    setTheme(next);
    localStorage.setItem('kiroshi.theme', next);
    document.documentElement.dataset.theme = next;
  }

  function trocarMovimento(next: string): void {
    setMovimento(aplicarMovimento.escrever(next));
  }

  return (
    <>
      <h2 className="settings-title">Aparencia</h2>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Tema</div>
          <div className="row-desc">O escuro e o padrao, pensado para uso noturno.</div>
        </div>
        <select value={theme} onChange={(e) => aplicarTema(e.target.value)}>
          <option value="dark">Escuro</option>
          <option value="light">Claro</option>
        </select>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Movimento</div>
          <div className="row-desc">
            {sistemaReduz
              ? 'O Windows esta com os efeitos de animacao desligados, entao "seguir o sistema" deixa a interface sem movimento. Escolha "completo" para anima-la so aqui.'
              : 'Transicoes curtas ao trocar de canal, abrir paineis e receber mensagem. Movimento na tela incomoda algumas pessoas; da para desligar.'}
          </div>
        </div>
        <select value={movimento} onChange={(e) => trocarMovimento(e.target.value)}>
          <option value="sistema">Seguir o sistema</option>
          <option value="completo">Completo</option>
          <option value="reduzido">Sem movimento</option>
        </select>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function NotificationsSection() {
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    void window.kiroshi.autostart.get().then(setAutostart);
  }, []);

  return (
    <>
      <h2 className="settings-title">Notificacoes</h2>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Abrir junto com o computador</div>
          <div className="row-desc">
            O Kiroshi inicia minimizado na bandeja e ja fica conectado.
          </div>
        </div>
        <button
          className={`switch ${autostart ? 'on' : ''}`}
          onClick={() => {
            const next = !autostart;
            setAutostart(next);
            void window.kiroshi.autostart.set(next);
          }}
          aria-pressed={autostart}
          aria-label="Abrir junto com o computador"
        />
      </div>

      <div className="field-hint" style={{ marginTop: 16 }}>
        As notificacoes na tela aparecem quando alguem te menciona ou manda uma mensagem direta, e
        so quando a janela nao esta na frente.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function AboutSection() {
  const [version, setVersion] = useState('');
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    void window.kiroshi.app.version().then(setVersion);
    void window.kiroshi.app.platform().then(setPlatform);
  }, []);

  return (
    <>
      <h2 className="settings-title">Kiroshi</h2>
      <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
        Voz, video e conversa auto-hospedados. Seus dados ficam no seu servidor.
      </p>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Versao</div>
        </div>
        <span style={{ color: 'var(--text-faint)' }}>{version}</span>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Plataforma</div>
        </div>
        <span style={{ color: 'var(--text-faint)' }}>{platform}</span>
      </div>

      <div className="row">
        <div className="row-text">
          <div className="row-title">Servidor</div>
        </div>
        <span style={{ color: 'var(--text-faint)' }}>{api.getBaseUrl()}</span>
      </div>

      <LinhaDeAtualizacao />
    </>
  );
}

/**
 * Procurar atualizacao na mao, e ver em que pe ela esta.
 *
 * O aplicativo ja procura sozinho, e continua procurando. Este botao existe
 * por dois motivos concretos:
 *
 * Primeiro, controle. Quem acabou de ouvir "ja publiquei a correcao" nao quer
 * esperar o proximo ciclo nem adivinhar se ja chegou — quer olhar e ver.
 *
 * Segundo, resposta. A faixa no topo so aparece quando ha versao pronta, o que
 * e o certo para nao virar ruido, mas significa que na ausencia dela nao da
 * para distinguir "estou atualizado" de "a verificacao esta quebrada". Aqui o
 * estado e dito por extenso, inclusive o erro.
 */
function LinhaDeAtualizacao() {
  const [estado, setEstado] = useState<AtualizacaoEstado | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [semNovidade, setSemNovidade] = useState(false);

  useEffect(() => {
    void window.kiroshi.atualizacao.estado().then(setEstado);
    return window.kiroshi.atualizacao.aoMudar(setEstado);
  }, []);

  async function procurar(): Promise<void> {
    setProcurando(true);
    setSemNovidade(false);
    try {
      const novo = await window.kiroshi.atualizacao.procurar();
      setEstado(novo);
      // "Nada novo" e uma resposta, e precisa aparecer: sem ela o botao parece
      // nao ter feito nada.
      if (novo.fase === 'ocioso') setSemNovidade(true);
    } finally {
      setProcurando(false);
    }
  }

  const fase = estado?.fase ?? 'ocioso';

  const descricao =
    fase === 'pronta'
      ? `Versao ${estado?.versao} baixada e pronta.`
      : fase === 'baixando'
        ? `Baixando a versao ${estado?.versao}... ${estado?.progresso}%`
        : fase === 'erro'
          ? `Nao consegui verificar: ${estado?.erro}`
          : semNovidade
            ? 'Voce ja esta na versao mais recente.'
            : 'O aplicativo procura sozinho a cada dez minutos.';

  return (
    <div className="row">
      <div className="row-text">
        <div className="row-title">Atualizacao</div>
        <div className="row-desc" style={fase === 'erro' ? { color: 'var(--red)' } : undefined}>
          {descricao}
        </div>
      </div>

      {fase === 'pronta' ? (
        <button
          className="btn btn-primary"
          onClick={() => window.kiroshi.atualizacao.instalarEReiniciar()}
        >
          Reiniciar agora
        </button>
      ) : (
        <button
          className="btn"
          onClick={() => void procurar()}
          disabled={procurando || fase === 'baixando'}
        >
          {procurando ? 'Procurando...' : 'Verificar'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * O que o navegador ligou de verdade neste microfone.
 *
 * Mostra o APLICADO, nao o pedido. A diferenca entre os dois e justamente o
 * que ninguem consegue ver sem isto: o navegador aceita `noiseSuppression:
 * true` e pode entregar `false`, sem erro e sem aviso, dependendo do driver
 * e do aparelho.
 */
function LimpezaAtiva({ aplicado }: { aplicado: MediaTrackSettings }) {
  const itens: { rotulo: string; ligado: boolean | undefined }[] = [
    { rotulo: 'Isolamento de voz', ligado: aplicado.voiceIsolation },
    { rotulo: 'Supressao de ruido', ligado: aplicado.noiseSuppression },
    { rotulo: 'Cancelamento de eco', ligado: aplicado.echoCancellation },
    { rotulo: 'Ganho automatico', ligado: aplicado.autoGainControl },
  ];

  return (
    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
      <div style={{ marginBottom: 4 }}>Ativo neste microfone agora:</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {itens.map((i) => (
          <span key={i.rotulo}>
            {/*
              Tres estados, nao dois: ligado, desligado, e "o aparelho nem
              conhece esse ajuste". O terceiro e informacao util — significa
              que nao adianta insistir nele nesta maquina.
            */}
            {i.ligado === undefined ? '—' : i.ligado ? 'sim' : 'NAO'} &middot; {i.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

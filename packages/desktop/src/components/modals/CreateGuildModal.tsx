import { useState } from 'react';
import { Dialog } from '../ui/Dialog.js';
import { InlineAlert } from '../ui/InlineAlert.js';
import type { GuildWithState } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { useStore } from '../../store/index.js';

interface Props {
  onClose: () => void;
}

type Mode = 'choose' | 'create' | 'join';

export function CreateGuildModal({ onClose }: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upsertGuild = useStore((s) => s.upsertGuild);
  const selectGuild = useStore((s) => s.selectGuild);

  async function readIcon(file: File): Promise<void> {
    if (file.size > 8 * 1024 * 1024) {
      setError('A imagem passa de 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIconDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function create(): Promise<void> {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const guild = await api.post<GuildWithState>('/guilds', {
        name: name.trim(),
        ...(iconDataUrl ? { iconUrl: iconDataUrl } : {}),
        withDefaultChannels: true,
      });
      upsertGuild(guild);
      selectGuild(guild.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui criar o servidor.');
      setBusy(false);
    }
  }

  async function join(): Promise<void> {
    // Aceita tanto o codigo puro quanto um link colado inteiro.
    const code = inviteCode.trim().split('/').pop() ?? '';
    if (!code) return;

    setBusy(true);
    setError(null);

    try {
      const result = await api.post<{ guild: GuildWithState }>(`/invites/${code}`);
      upsertGuild(result.guild);
      selectGuild(result.guild.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Nao consegui entrar com este convite.',
      );
      setBusy(false);
    }
  }

  /*
    Um dialogo so, tres modos.

    Antes cada modo desenhava o proprio cabecalho e rodape dentro da mesma
    caixa, entao a estrutura do modal aparecia tres vezes no arquivo. O titulo
    e a descricao agora sao dados, e o Dialog e um.
  */
  const cabecalho = {
    choose: {
      titulo: 'Seu servidor',
      descricao: 'Crie um espaco novo ou entre em um que ja existe.',
    },
    create: { titulo: 'Criar servidor', descricao: 'Da para mudar o nome e o icone depois.' },
    join: { titulo: 'Entrar em um servidor', descricao: 'Cole o convite que te mandaram.' },
  }[mode];

  const acoes =
    mode === 'choose' ? undefined : mode === 'create' ? (
      <>
        <button className="btn" onClick={() => setMode('choose')}>
          Voltar
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void create()}
          disabled={busy || name.trim().length < 2}
        >
          {busy ? 'Criando...' : 'Criar'}
        </button>
      </>
    ) : (
      <>
        <button className="btn" onClick={() => setMode('choose')}>
          Voltar
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void join()}
          disabled={busy || inviteCode.trim().length < 4}
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </>
    );

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo={cabecalho.titulo}
      descricao={cabecalho.descricao}
      acoes={acoes}
    >
      {mode === 'choose' && (
        <>
          <button
            className="btn btn-primary btn-block"
            style={{ marginBottom: 10 }}
            onClick={() => setMode('create')}
          >
            Criar um servidor
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setMode('join')}>
            Entrar com um convite
          </button>
        </>
      )}

      {mode === 'create' && (
        <>
          <div className="field" style={{ textAlign: 'center' }}>
            <label
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 90,
                height: 90,
                borderRadius: 45,
                border: '2px dashed var(--line-strong)',
                cursor: 'pointer',
                overflow: 'hidden',
                color: 'var(--text-faint)',
                fontSize: 12,
              }}
            >
              {iconDataUrl ? (
                <img
                  src={iconDataUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                'Icone'
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readIcon(file);
                }}
              />
            </label>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="guild-name">
              Nome do servidor
            </label>
            <input
              id="guild-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
              maxLength={100}
              autoFocus
            />
          </div>

          {error && <InlineAlert tipo="erro">{error}</InlineAlert>}
        </>
      )}

      {mode === 'join' && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="invite-code">
              Convite
            </label>
            <input
              id="invite-code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join();
              }}
              placeholder="aBcD1234"
              autoFocus
            />
          </div>
          {error && <InlineAlert tipo="erro">{error}</InlineAlert>}
        </>
      )}
    </Dialog>
  );
}

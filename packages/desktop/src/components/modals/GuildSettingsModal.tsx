import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog.js';
import type { Emoji, Role, SoundboardSound } from '@kiroshi/shared';
import {
  ALL_PERMISSION_NAMES,
  Permission,
  deserialize,
  fromNames,
  hasExact,
  serialize,
  toNames,
  type PermissionName,
} from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useRolesOfGuild } from '../../store/index.js';

/** Lista vazia estavel: evita criar array novo a cada render. */
const EMPTY: never[] = [];
import { Close, Trash } from '../Icons.js';

interface Props {
  guildId: string;
  onClose: () => void;
}

type Tab = 'overview' | 'roles' | 'emojis' | 'sounds';

/** Rotulos legiveis para cada permissao, agrupados como a interface mostra. */
const PERMISSION_LABELS: Record<PermissionName, { label: string; group: string }> = {
  ADMINISTRATOR: { label: 'Administrador', group: 'Geral' },
  VIEW_CHANNEL: { label: 'Ver canais', group: 'Geral' },
  MANAGE_CHANNELS: { label: 'Gerenciar canais', group: 'Geral' },
  MANAGE_ROLES: { label: 'Gerenciar cargos', group: 'Geral' },
  MANAGE_GUILD: { label: 'Gerenciar servidor', group: 'Geral' },
  VIEW_AUDIT_LOG: { label: 'Ver registro de auditoria', group: 'Geral' },
  CREATE_INVITE: { label: 'Criar convite', group: 'Membros' },
  KICK_MEMBERS: { label: 'Expulsar membros', group: 'Membros' },
  BAN_MEMBERS: { label: 'Banir membros', group: 'Membros' },
  CHANGE_NICKNAME: { label: 'Mudar o proprio apelido', group: 'Membros' },
  MANAGE_NICKNAMES: { label: 'Gerenciar apelidos', group: 'Membros' },
  SEND_MESSAGES: { label: 'Enviar mensagens', group: 'Texto' },
  READ_MESSAGE_HISTORY: { label: 'Ler o historico', group: 'Texto' },
  MANAGE_MESSAGES: { label: 'Gerenciar mensagens', group: 'Texto' },
  EMBED_LINKS: { label: 'Cartoes de link', group: 'Texto' },
  ATTACH_FILES: { label: 'Anexar arquivos', group: 'Texto' },
  ADD_REACTIONS: { label: 'Adicionar reacoes', group: 'Texto' },
  MENTION_EVERYONE: { label: 'Mencionar everyone', group: 'Texto' },
  USE_EXTERNAL_EMOJIS: { label: 'Usar emojis de fora', group: 'Texto' },
  CONNECT: { label: 'Entrar em canais de voz', group: 'Voz' },
  SPEAK: { label: 'Falar', group: 'Voz' },
  STREAM: { label: 'Camera e tela', group: 'Voz' },
  USE_VAD: { label: 'Usar deteccao de voz', group: 'Voz' },
  PRIORITY_SPEAKER: { label: 'Voz prioritaria', group: 'Voz' },
  MUTE_MEMBERS: { label: 'Silenciar membros', group: 'Voz' },
  DEAFEN_MEMBERS: { label: 'Ensurdecer membros', group: 'Voz' },
  MOVE_MEMBERS: { label: 'Mover membros', group: 'Voz' },
  MANAGE_EMOJIS: { label: 'Gerenciar emojis', group: 'Expressoes' },
  USE_SOUNDBOARD: { label: 'Usar o soundboard', group: 'Expressoes' },
  MANAGE_SOUNDBOARD: { label: 'Gerenciar o soundboard', group: 'Expressoes' },
  MANAGE_WEBHOOKS: { label: 'Gerenciar webhooks', group: 'Avancado' },
};

export function GuildSettingsModal({ guildId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Ajustes do servidor"
      largura={720}
      // Altura fixa: com abas de tamanhos diferentes, o quadro mudaria de
      // tamanho a cada clique e o botao de fechar andaria pela tela.
      altura="82vh"
      acoes={
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <>
        {/*
          `role="tablist"` e a ligacao entre aba e painel nao sao enfeite: sem
          eles, um leitor de tela le quatro botoes soltos e nao sabe dizer qual
          esta ativo nem que o conteudo abaixo pertence a ele.
        */}
        <div className="tabs" role="tablist" aria-label="Secoes dos ajustes">
          {(
            [
              ['overview', 'Visao geral'],
              ['roles', 'Cargos'],
              ['emojis', 'Emojis'],
              ['sounds', 'Soundboard'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              role="tab"
              id={`aba-${key}`}
              aria-selected={tab === key}
              aria-controls={`painel-${key}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`painel-${tab}`} aria-labelledby={`aba-${tab}`}>
          {tab === 'overview' && <OverviewTab guildId={guildId} />}
          {tab === 'roles' && <RolesTab guildId={guildId} />}
          {tab === 'emojis' && <EmojisTab guildId={guildId} />}
          {tab === 'sounds' && <SoundsTab guildId={guildId} />}
        </div>
      </>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds.get(guildId));
  const [name, setName] = useState(guild?.name ?? '');
  const [description, setDescription] = useState(guild?.description ?? '');
  const [message, setMessage] = useState<string | null>(null);

  async function save(): Promise<void> {
    try {
      await api.patch(`/guilds/${guildId}`, {
        name: name.trim(),
        description: description.trim() || null,
      });
      setMessage('Salvo.');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Nao consegui salvar.');
    }
  }

  async function uploadIcon(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = async () => {
      await api
        .patch(`/guilds/${guildId}`, { iconUrl: reader.result as string })
        .catch(() => setMessage('Nao consegui enviar o icone.'));
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <div className="field">
        <span className="field-label">Icone</span>
        <label style={{ display: 'inline-block', cursor: 'pointer' }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              background: 'var(--active)',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              fontSize: 12,
              color: 'var(--text-faint)',
            }}
          >
            {guild?.iconUrl ? (
              <img
                src={guild.iconUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              'Trocar'
            )}
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadIcon(file);
            }}
          />
        </label>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="guild-settings-name">
          Nome
        </label>
        <input
          id="guild-settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="guild-settings-desc">
          Descricao
        </label>
        <textarea
          id="guild-settings-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          rows={3}
          style={{ resize: 'vertical' }}
        />
      </div>

      {message && <div className="field-hint">{message}</div>}

      <button className="btn btn-primary" onClick={() => void save()}>
        Salvar
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function RolesTab({ guildId }: { guildId: string }) {
  const roles = useRolesOfGuild(guildId);
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);

  const role = roles.find((r) => r.id === selectedId) ?? null;

  async function createRole(): Promise<void> {
    const created = await api
      .post<Role>(`/guilds/${guildId}/roles`, { name: 'novo cargo' })
      .catch(() => null);
    if (created) setSelectedId(created.id);
  }

  async function updateRole(patch: Record<string, unknown>): Promise<void> {
    if (!role) return;
    try {
      await api.patch(`/guilds/${guildId}/roles/${role.id}`, patch);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Nao consegui salvar.');
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function removeRole(): Promise<void> {
    if (!role || role.managed) return;
    await api.delete(`/guilds/${guildId}/roles/${role.id}`).catch(() => undefined);
    setSelectedId(roles.find((r) => r.id !== role.id)?.id ?? null);
  }

  const permissions = role ? deserialize(role.permissions) : 0n;
  const enabled = new Set(toNames(permissions));

  // Agrupa as permissoes para a lista nao virar um paredao de checkboxes.
  const groups = new Map<string, PermissionName[]>();
  for (const name of ALL_PERMISSION_NAMES) {
    const group = PERMISSION_LABELS[name].group;
    const list = groups.get(group) ?? [];
    list.push(name);
    groups.set(group, list);
  }

  function togglePermission(name: PermissionName): void {
    if (!role) return;
    const next = new Set(enabled);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    void updateRole({ permissions: serialize(fromNames([...next])) });
  }

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 360 }}>
      <div style={{ width: 190, flexShrink: 0 }}>
        <button className="btn btn-primary btn-block" onClick={() => void createRole()}>
          Criar cargo
        </button>
        <div style={{ marginTop: 10 }}>
          {roles.map((r) => (
            <button
              key={r.id}
              className={`settings-item ${selectedId === r.id ? 'active' : ''}`}
              onClick={() => setSelectedId(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span className="chip-dot" style={r.color ? { background: r.color } : undefined} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.id === guildId ? 'everyone' : r.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!role ? (
          <div className="empty">
            <p>Escolha um cargo para editar.</p>
          </div>
        ) : (
          <>
            {role.id !== guildId && (
              <>
                <div className="field">
                  <label className="field-label">Nome</label>
                  <input
                    key={role.id}
                    defaultValue={role.name}
                    onBlur={(e) => void updateRole({ name: e.target.value.trim() })}
                    maxLength={100}
                  />
                </div>

                <div className="field">
                  <label className="field-label">Cor</label>
                  <input
                    type="color"
                    defaultValue={role.color ?? '#99aab5'}
                    onBlur={(e) => void updateRole({ color: e.target.value })}
                    style={{ width: 64, height: 36, padding: 2 }}
                  />
                </div>

                <div className="row">
                  <div className="row-text">
                    <div className="row-title">Exibir separadamente</div>
                    <div className="row-desc">
                      Os membros aparecem em uma secao propria na lista lateral.
                    </div>
                  </div>
                  <button
                    className={`switch ${role.hoist ? 'on' : ''}`}
                    onClick={() => void updateRole({ hoist: !role.hoist })}
                    aria-pressed={role.hoist}
                    aria-label="Exibir separadamente"
                  />
                </div>

                <div className="row">
                  <div className="row-text">
                    <div className="row-title">Pode ser mencionado</div>
                  </div>
                  <button
                    className={`switch ${role.mentionable ? 'on' : ''}`}
                    onClick={() => void updateRole({ mentionable: !role.mentionable })}
                    aria-pressed={role.mentionable}
                    aria-label="Pode ser mencionado"
                  />
                </div>
              </>
            )}

            <div className="divider" />

            {[...groups].map(([group, names]) => (
              <div key={group}>
                <div className="settings-group" style={{ paddingLeft: 0 }}>
                  {group}
                </div>
                {names.map((name) => (
                  <div className="row" key={name}>
                    <div className="row-text">
                      <div className="row-title">{PERMISSION_LABELS[name].label}</div>
                      {name === 'ADMINISTRATOR' && (
                        <div className="row-desc">
                          Concede tudo e ignora restricoes de canal. Use com cuidado.
                        </div>
                      )}
                    </div>
                    <button
                      className={`switch ${enabled.has(name) ? 'on' : ''}`}
                      onClick={() => togglePermission(name)}
                      aria-pressed={enabled.has(name)}
                      aria-label={PERMISSION_LABELS[name].label}
                    />
                  </div>
                ))}
              </div>
            ))}

            {message && <div className="field-error">{message}</div>}

            {!role.managed && role.id !== guildId && (
              <button
                className="btn btn-danger"
                style={{ marginTop: 16 }}
                onClick={() => void removeRole()}
              >
                Apagar cargo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmojisTab({ guildId }: { guildId: string }) {
  const emojis = useStore(useShallow((s) => s.guilds.get(guildId)?.emojis ?? EMPTY));
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setError(null);
    if (file.size > 512 * 1024) {
      setError('O emoji precisa ter menos de 512 KB.');
      return;
    }

    // O nome vem do arquivo, limpo para o formato aceito.
    const name = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 32);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post<Emoji>(`/guilds/${guildId}/emojis`, {
          name: name.length >= 2 ? name : `emoji_${Date.now().toString(36)}`,
          image: reader.result as string,
        });
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Nao consegui enviar o emoji.');
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
        Ate 200 emojis por servidor, 512 KB cada. O nome do arquivo vira o nome do emoji.
      </p>

      <label className="btn btn-primary" style={{ display: 'inline-block' }}>
        Enviar emoji
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          multiple
          onChange={(e) => {
            for (const file of e.target.files ?? []) void upload(file);
            e.target.value = '';
          }}
        />
      </label>

      {error && <div className="field-error">{error}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
          marginTop: 16,
        }}
      >
        {emojis.map((emoji) => (
          <div
            key={emoji.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              background: 'var(--raised)',
              borderRadius: 'var(--r)',
            }}
          >
            <img src={emoji.url} alt="" style={{ width: 28, height: 28 }} />
            <span
              style={{
                flex: 1,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              :{emoji.name}:
            </span>
            <button
              className="act"
              style={{ width: 24, height: 24 }}
              onClick={() =>
                void api.delete(`/guilds/${guildId}/emojis/${emoji.id}`).catch(() => undefined)
              }
              aria-label={`Apagar ${emoji.name}`}
            >
              <Trash size={14} />
            </button>
          </div>
        ))}
      </div>

      {emojis.length === 0 && (
        <div className="empty" style={{ padding: 24 }}>
          <p>Nenhum emoji ainda.</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SoundsTab({ guildId }: { guildId: string }) {
  const sounds = useStore(useShallow((s) => s.guilds.get(guildId)?.sounds ?? EMPTY));
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError('O som precisa ter menos de 2 MB.');
      return;
    }

    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post<SoundboardSound>(`/guilds/${guildId}/sounds`, {
          name: name.length >= 2 ? name : `som_${Date.now().toString(36)}`,
          audio: reader.result as string,
          volume: 1,
        });
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Nao consegui enviar o som.');
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
        Sons curtos para tocar na chamada. Ate 2 MB cada.
      </p>

      <label className="btn btn-primary" style={{ display: 'inline-block' }}>
        Enviar som
        <input
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/webm"
          hidden
          multiple
          onChange={(e) => {
            for (const file of e.target.files ?? []) void upload(file);
            e.target.value = '';
          }}
        />
      </label>

      {error && <div className="field-error">{error}</div>}

      <div style={{ marginTop: 16 }}>
        {sounds.map((sound) => (
          <div className="row" key={sound.id}>
            <div className="row-text">
              <div className="row-title">{sound.name}</div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => void new Audio(sound.url).play().catch(() => undefined)}
            >
              Ouvir
            </button>
            <button
              className="act"
              onClick={() =>
                void api.delete(`/guilds/${guildId}/sounds/${sound.id}`).catch(() => undefined)
              }
              aria-label={`Apagar ${sound.name}`}
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>

      {sounds.length === 0 && (
        <div className="empty" style={{ padding: 24 }}>
          <p>Nenhum som ainda.</p>
        </div>
      )}
    </>
  );
}

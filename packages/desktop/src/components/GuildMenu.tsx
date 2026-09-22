import { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui/Dialog.js';
import { Permission } from '@kiroshi/shared';
import { api } from '../api/client.js';
import { useStore } from '../store/index.js';
import { useGuildPermissions } from '../hooks/usePermissions.js';
import { has } from '@kiroshi/shared';
import { InviteModal } from './modals/InviteModal.js';
import { GuildSettingsModal } from './modals/GuildSettingsModal.js';

interface Props {
  guildId: string;
  onClose: () => void;
}

export function GuildMenu({ guildId, onClose }: Props) {
  const guild = useStore((s) => s.guilds.get(guildId));
  const selfId = useStore((s) => s.user?.id);
  const permissions = useGuildPermissions(guildId);

  const [inviting, setInviting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  if (!guild) return null;

  const isOwner = guild.ownerId === selfId;

  async function leave(): Promise<void> {
    await api.post(`/guilds/${guildId}/leave`).catch(() => undefined);
    onClose();
  }

  async function remove(): Promise<void> {
    await api.delete(`/guilds/${guildId}`).catch(() => undefined);
    onClose();
  }

  return (
    <>
      {!inviting && !settingsOpen && !confirmLeave && (
        <div ref={ref} className="menu" style={{ top: 88, left: 80, width: 216 }}>
          {has(permissions, Permission.CREATE_INVITE) && (
            <button
              className="menu-item"
              onClick={() => setInviting(true)}
              style={{ color: 'var(--link)' }}
            >
              Convidar pessoas
            </button>
          )}
          {has(permissions, Permission.MANAGE_GUILD) && (
            <button className="menu-item" onClick={() => setSettingsOpen(true)}>
              Ajustes do servidor
            </button>
          )}
          <div className="menu-sep" />
          {isOwner ? (
            <button className="menu-item danger" onClick={() => setConfirmLeave(true)}>
              Apagar servidor
            </button>
          ) : (
            <button className="menu-item danger" onClick={() => setConfirmLeave(true)}>
              Sair do servidor
            </button>
          )}
        </div>
      )}

      {inviting && <InviteModal guildId={guildId} onClose={onClose} />}
      {settingsOpen && <GuildSettingsModal guildId={guildId} onClose={onClose} />}

      {/*
        Confirmacao destrutiva.

        A consequencia vem por extenso na descricao, nao so no titulo: "Apagar
        o servidor?" nao diz que as mensagens de todo mundo somem. E agora ela
        fecha no Esc e devolve o foco, como as outras — antes era o unico
        lugar do aplicativo onde uma acao irreversivel ficava numa caixa sem
        saida por teclado.
      */}
      {confirmLeave && (
        <Dialog
          aberto
          aoFechar={onClose}
          titulo={isOwner ? `Apagar ${guild.name}?` : `Sair de ${guild.name}?`}
          descricao={
            isOwner
              ? 'Todos os canais e mensagens somem para todo mundo. Nao da para desfazer.'
              : 'Voce vai precisar de um convite novo para voltar.'
          }
          acoes={
            <>
              <button className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void (isOwner ? remove() : leave())}
              >
                {isOwner ? 'Apagar' : 'Sair'}
              </button>
            </>
          }
        />
      )}
    </>
  );
}

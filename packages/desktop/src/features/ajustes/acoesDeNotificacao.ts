import type { ChannelSettings, GuildSettings, NotificationLevel } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { avisar } from '../../design/primitivos/index.js';
import { prazoDoSilencio } from '../../lib/notificar.js';
import { motivo } from '../conversa/acoes.js';

/** Os prazos de silencio oferecidos, como no Discord. `null` = ate reativar. */
export const PRAZOS_DE_SILENCIO: { minutos: number | null; rotulo: string }[] = [
  { minutos: 15, rotulo: 'Por 15 minutos' },
  { minutos: 60, rotulo: 'Por 1 hora' },
  { minutos: 8 * 60, rotulo: 'Por 8 horas' },
  { minutos: 24 * 60, rotulo: 'Por 24 horas' },
  { minutos: null, rotulo: 'Até eu reativar' },
];

export const NOMES_DOS_NIVEIS: Record<NotificationLevel, string> = {
  ALL: 'Todas as mensagens',
  MENTIONS: 'Só menções',
  NOTHING: 'Nada',
};

type PatchDeServidor = Partial<Pick<GuildSettings, 'muted' | 'mutedUntil' | 'notificationLevel'>>;
type PatchDeCanal = Partial<Pick<ChannelSettings, 'muted' | 'mutedUntil' | 'notificationLevel'>>;

/** Ajusta o servidor; o proprio aparelho atualiza pela resposta, os outros pelo gateway. */
export async function ajustarServidor(guildId: string, patch: PatchDeServidor): Promise<void> {
  try {
    const ajuste = await api.patch<GuildSettings>(`/users/@me/guilds/${guildId}/settings`, patch);
    useStore.getState().setGuildSettings(ajuste);
  } catch (erro) {
    avisar.erro('Não consegui salvar a notificação do servidor', motivo(erro, 'Tente de novo.'));
  }
}

export async function ajustarCanal(channelId: string, patch: PatchDeCanal): Promise<void> {
  try {
    const ajuste = await api.patch<ChannelSettings>(`/users/@me/channels/${channelId}/settings`, patch);
    useStore.getState().setChannelSettings(ajuste);
  } catch (erro) {
    avisar.erro('Não consegui salvar a notificação', motivo(erro, 'Tente de novo.'));
  }
}

export const silenciarServidor = (guildId: string, minutos: number | null) =>
  ajustarServidor(guildId, { muted: true, mutedUntil: prazoDoSilencio(minutos, Date.now()) });

export const silenciarCanal = (channelId: string, minutos: number | null) =>
  ajustarCanal(channelId, { muted: true, mutedUntil: prazoDoSilencio(minutos, Date.now()) });

/** "até 14:32", "até amanhã, 09:10", ou "até reativar". */
export function descreverSilencio(mutedUntil: string | null, agora = Date.now()): string {
  if (!mutedUntil) return 'até você reativar';
  const ate = new Date(mutedUntil);
  const hora = ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date(agora);
  const mesmoDia = ate.toDateString() === hoje.toDateString();
  return mesmoDia ? `até ${hora}` : `até ${ate.toLocaleDateString('pt-BR', { weekday: 'long' })}, ${hora}`;
}

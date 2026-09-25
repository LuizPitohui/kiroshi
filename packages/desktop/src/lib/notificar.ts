import type { ChannelSettings, GuildSettings, Message, NotificationLevel, PresenceStatus } from '@kiroshi/shared';

/*
  Quando uma mensagem vira notificacao do Windows. Puro e testado: as regras
  tem bordas (silencio com prazo vencido, canal herdando do servidor, DM sem
  servidor) que so aparecem em situacoes chatas de reproduzir.
*/

/** Silenciado agora: sem prazo, ou com um prazo que ainda nao venceu. */
export function silenciado(ajuste: Pick<GuildSettings, 'muted' | 'mutedUntil'> | undefined, agora: number): boolean {
  if (!ajuste?.muted) return false;
  if (!ajuste.mutedUntil) return true;
  const ate = Date.parse(ajuste.mutedUntil);
  return Number.isNaN(ate) || ate > agora;
}

/**
 * O nivel que vale num canal: o do canal, se ele tiver; senao o do servidor;
 * numa DM sem ajuste, todas — conversa direta existe para ser avisada.
 */
export function nivelDoCanal(ajusteDoCanal: ChannelSettings | undefined, ajusteDoServidor: GuildSettings | undefined, ehDm: boolean): NotificationLevel {
  if (ajusteDoCanal?.notificationLevel) return ajusteDoCanal.notificationLevel;
  if (ehDm) return 'ALL';
  return ajusteDoServidor?.notificationLevel ?? 'ALL';
}

export interface EntradaDaNotificacao {
  mensagem: Pick<Message, 'authorId' | 'channelId' | 'type' | 'mentionedUserIds' | 'mentionedRoleIds' | 'mentionsEveryone'>;
  euSou: string;
  /** O canal da mensagem; sem ele (canal que o app nao conhece), nao notifica. */
  canal: { guildId: string | null } | undefined;
  meusCargos: readonly string[];
  ajusteDoServidor: GuildSettings | undefined;
  ajusteDoCanal: ChannelSettings | undefined;
  meuStatus: PresenceStatus;
  /** A pessoa esta olhando esta conversa agora (janela em foco, conversa aberta). */
  olhandoAConversa: boolean;
  notificacoesLigadas: boolean;
  agora: number;
}

/**
 * Notifica ou nao.
 *
 * - Nao: a propria mensagem; chamada (o cartao de chamada tem o seu aviso);
 *   notificacoes desligadas; Nao perturbe (a 1.x prometia e nao silenciava);
 *   a conversa que a pessoa esta olhando; canal ou servidor silenciados.
 * - Pelo nivel: todas, so mencoes (a pessoa, um cargo dela, @everyone) ou nada.
 */
export function deveNotificar(e: EntradaDaNotificacao): boolean {
  const { mensagem } = e;
  if (mensagem.authorId === e.euSou || mensagem.type === 'CALL') return false;
  if (!e.canal || !e.notificacoesLigadas || e.meuStatus === 'DND' || e.olhandoAConversa) return false;
  if (silenciado(e.ajusteDoCanal, e.agora)) return false;
  const ehDm = !e.canal.guildId;
  if (!ehDm && silenciado(e.ajusteDoServidor, e.agora)) return false;

  const nivel = nivelDoCanal(e.ajusteDoCanal, e.ajusteDoServidor, ehDm);
  if (nivel === 'NOTHING') return false;
  if (nivel === 'ALL') return true;
  return (
    mensagem.mentionedUserIds.includes(e.euSou) ||
    mensagem.mentionsEveryone ||
    mensagem.mentionedRoleIds.some((id) => e.meusCargos.includes(id))
  );
}

/** O prazo de um silencio escolhido na lista, em ISO (null = ate reativar). */
export function prazoDoSilencio(minutos: number | null, agora: number): string | null {
  return minutos === null ? null : new Date(agora + minutos * 60_000).toISOString();
}

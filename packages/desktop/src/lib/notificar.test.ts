import { describe, expect, it } from 'vitest';
import type { ChannelSettings, GuildSettings } from '@kiroshi/shared';
import { deveNotificar, nivelDoCanal, prazoDoSilencio, silenciado, type EntradaDaNotificacao } from './notificar.js';

const agora = Date.parse('2026-09-25T12:00:00.000Z');
const servidor = (p: Partial<GuildSettings> = {}): GuildSettings => ({ guildId: 'g', muted: false, mutedUntil: null, notificationLevel: 'ALL', ...p });
const canal = (p: Partial<ChannelSettings> = {}): ChannelSettings => ({ channelId: 'c', muted: false, mutedUntil: null, notificationLevel: null, ...p });

function entrada(p: Partial<EntradaDaNotificacao> = {}, mensagem: Partial<EntradaDaNotificacao['mensagem']> = {}): EntradaDaNotificacao {
  return {
    mensagem: { authorId: 'outro', channelId: 'c', type: 'DEFAULT', mentionedUserIds: [], mentionedRoleIds: [], mentionsEveryone: false, ...mensagem },
    euSou: 'eu',
    canal: { guildId: 'g' },
    meusCargos: ['cargo-1'],
    ajusteDoServidor: undefined,
    ajusteDoCanal: undefined,
    meuStatus: 'ONLINE',
    olhandoAConversa: false,
    notificacoesLigadas: true,
    agora,
    ...p,
  };
}

describe('silenciado', () => {
  it('sem prazo vale ate reativar; com prazo, ate a hora', () => {
    expect(silenciado({ muted: true, mutedUntil: null }, agora)).toBe(true);
    expect(silenciado({ muted: true, mutedUntil: '2026-09-25T12:30:00.000Z' }, agora)).toBe(true);
    expect(silenciado({ muted: true, mutedUntil: '2026-09-25T11:59:00.000Z' }, agora)).toBe(false);
    expect(silenciado({ muted: false, mutedUntil: null }, agora)).toBe(false);
    expect(silenciado(undefined, agora)).toBe(false);
  });
});

describe('nivelDoCanal', () => {
  it('o canal vence o servidor; sem nada, todas', () => {
    expect(nivelDoCanal(canal({ notificationLevel: 'NOTHING' }), servidor({ notificationLevel: 'ALL' }), false)).toBe('NOTHING');
    expect(nivelDoCanal(canal(), servidor({ notificationLevel: 'MENTIONS' }), false)).toBe('MENTIONS');
    expect(nivelDoCanal(undefined, undefined, false)).toBe('ALL');
  });
  it('DM sem ajuste proprio e todas, qualquer que seja o servidor', () => {
    expect(nivelDoCanal(undefined, servidor({ notificationLevel: 'NOTHING' }), true)).toBe('ALL');
  });
});

describe('deveNotificar', () => {
  it('mensagem comum de servidor notifica (o pedido do dono: como o Discord)', () => {
    expect(deveNotificar(entrada())).toBe(true);
  });
  it('a propria mensagem e a de chamada nao', () => {
    expect(deveNotificar(entrada({}, { authorId: 'eu' }))).toBe(false);
    expect(deveNotificar(entrada({}, { type: 'CALL' }))).toBe(false);
  });
  it('Nao perturbe silencia (a 1.x prometia e nao cumpria)', () => {
    expect(deveNotificar(entrada({ meuStatus: 'DND' }))).toBe(false);
  });
  it('a conversa que se esta olhando, as notificacoes desligadas e o canal desconhecido nao', () => {
    expect(deveNotificar(entrada({ olhandoAConversa: true }))).toBe(false);
    expect(deveNotificar(entrada({ notificacoesLigadas: false }))).toBe(false);
    expect(deveNotificar(entrada({ canal: undefined }))).toBe(false);
  });
  it('servidor silenciado cala os canais dele, mas nao as DMs', () => {
    expect(deveNotificar(entrada({ ajusteDoServidor: servidor({ muted: true }) }))).toBe(false);
    expect(deveNotificar(entrada({ canal: { guildId: null }, ajusteDoServidor: servidor({ muted: true }) }))).toBe(true);
  });
  it('silencio com prazo vencido volta a notificar', () => {
    expect(deveNotificar(entrada({ ajusteDoCanal: canal({ muted: true, mutedUntil: '2026-09-25T11:00:00.000Z' }) }))).toBe(true);
  });
  it('so mencoes: a pessoa, um cargo dela ou @everyone', () => {
    const soMencoes = { ajusteDoServidor: servidor({ notificationLevel: 'MENTIONS' as const }) };
    expect(deveNotificar(entrada(soMencoes))).toBe(false);
    expect(deveNotificar(entrada(soMencoes, { mentionedUserIds: ['eu'] }))).toBe(true);
    expect(deveNotificar(entrada(soMencoes, { mentionedRoleIds: ['cargo-1'] }))).toBe(true);
    expect(deveNotificar(entrada(soMencoes, { mentionsEveryone: true }))).toBe(true);
  });
  it('nada: nem mencao', () => {
    expect(deveNotificar(entrada({ ajusteDoCanal: canal({ notificationLevel: 'NOTHING' }) }, { mentionedUserIds: ['eu'] }))).toBe(false);
  });
});

describe('prazoDoSilencio', () => {
  it('minutos a partir de agora; sem minutos, sem prazo', () => {
    expect(prazoDoSilencio(60, agora)).toBe('2026-09-25T13:00:00.000Z');
    expect(prazoDoSilencio(null, agora)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { GuildMember, PresenceStatus, Role } from '@kiroshi/shared';
import { agruparMembros } from './agrupar.js';

const cargo = (id: string, position: number, hoist: boolean): Role => ({
  id,
  guildId: 'g',
  name: id.toUpperCase(),
  color: hoist ? '#dc2626' : null,
  position,
  permissions: '0',
  hoist,
  mentionable: false,
  managed: false,
});

const membro = (userId: string, roleIds: string[] = []): GuildMember => ({
  userId,
  guildId: 'g',
  user: { id: userId, username: userId, displayName: userId, avatarUrl: null, bannerUrl: null, bio: null, pronouns: null, accentColor: null, bot: false, createdAt: '' },
  nickname: null,
  roleIds,
  joinedAt: '',
  serverMuted: false,
  serverDeafened: false,
});

const status: Record<string, PresenceStatus> = { ana: 'ONLINE', bia: 'IDLE', caio: 'DND', davi: 'OFFLINE', eva: 'ONLINE' };
const grupos = (membros: GuildMember[], cargos: Role[]) =>
  agruparMembros(membros, cargos, (id) => status[id] ?? 'OFFLINE', (m) => m.userId).map((g) => [g.id, g.membros.map((m) => m.userId)]);

describe('agruparMembros', () => {
  it('sem cargo destacado: online e offline', () => {
    expect(grupos([membro('eva'), membro('davi'), membro('ana')], [])).toEqual([
      ['online', ['ana', 'eva']],
      ['offline', ['davi']],
    ]);
  });

  it('cada um sob o cargo destacado mais alto que tem', () => {
    const adm = cargo('adm', 3, true);
    const mod = cargo('mod', 2, true);
    const vip = cargo('vip', 1, false);
    expect(grupos([membro('ana', ['mod', 'adm']), membro('bia', ['mod']), membro('caio', ['vip']), membro('eva')], [adm, mod, vip])).toEqual([
      ['adm', ['ana']],
      ['mod', ['bia']],
      ['online', ['caio', 'eva']],
    ]);
  });

  it('offline ignora o cargo e grupo vazio nao aparece', () => {
    const adm = cargo('adm', 3, true);
    expect(grupos([membro('davi', ['adm']), membro('ana')], [adm])).toEqual([
      ['online', ['ana']],
      ['offline', ['davi']],
    ]);
  });
});

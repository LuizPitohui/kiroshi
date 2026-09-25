/**
 * Quem enxerga um canal, a partir de membros, cargos e sobrescritas.
 *
 * O que estes testes protegem: o filtro dos eventos do gateway. Se a conta
 * aqui errar para mais, mensagem de canal privado volta a chegar a quem nao
 * devia; se errar para menos, alguem para de receber o canal que le pelo REST.
 */

import { describe, it, expect } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@kiroshi/shared';
import {
  canaisComPermissao,
  contextoDoMembro,
  membrosComPermissao,
  type CanalDoRetrato,
  type RetratoDaGuild,
} from './visibilidade.js';

const GUILD = '100';
const DONO = '1';
const ADMIN = '2';
const MOD = '3';
const COMUM = '4';
const OUTRO = '5';

const CARGO_ADMIN = '200';
const CARGO_MOD = '201';

const VER = Permission.VIEW_CHANNEL;
const LER = Permission.READ_MESSAGE_HISTORY;

function negar(alvo: string, bits: bigint, tipo: 'ROLE' | 'MEMBER' = 'ROLE') {
  return { targetId: alvo, targetType: tipo, allow: 0n, deny: bits };
}

function liberar(alvo: string, bits: bigint, tipo: 'ROLE' | 'MEMBER' = 'ROLE') {
  return { targetId: alvo, targetType: tipo, allow: bits, deny: 0n };
}

function canal(id: string, overwrites: CanalDoRetrato['overwrites'] = [], parentId: string | null = null) {
  return { id, parentId, overwrites };
}

function retrato(channels: CanalDoRetrato[], extra: Partial<RetratoDaGuild> = {}): RetratoDaGuild {
  return {
    guildId: GUILD,
    ownerId: DONO,
    roles: [
      { id: GUILD, position: 0, permissions: DEFAULT_EVERYONE_PERMISSIONS },
      { id: CARGO_MOD, position: 5, permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.MANAGE_MESSAGES },
      { id: CARGO_ADMIN, position: 10, permissions: Permission.ADMINISTRATOR },
    ],
    members: [
      { userId: DONO, roleIds: [] },
      { userId: ADMIN, roleIds: [CARGO_ADMIN] },
      { userId: MOD, roleIds: [CARGO_MOD] },
      { userId: COMUM, roleIds: [] },
    ],
    channels,
    ...extra,
  };
}

const ordenado = (s: Set<string>) => [...s].sort();

describe('canal sem sobrescrita', () => {
  it('todo membro ve, porque o everyone tem VIEW_CHANNEL por padrao', () => {
    const r = retrato([canal('10')]);
    expect(ordenado(membrosComPermissao(r, '10'))).toEqual([DONO, ADMIN, MOD, COMUM]);
  });

  it('quem nao e membro nao ve nada, nem canal aberto', () => {
    const r = retrato([canal('10')]);
    expect(membrosComPermissao(r, '10').has(OUTRO)).toBe(false);
    expect(canaisComPermissao(r, OUTRO).size).toBe(0);
  });

  it('canal que nao e deste servidor nao entrega a ninguem', () => {
    const r = retrato([canal('10')]);
    expect(membrosComPermissao(r, '999').size).toBe(0);
  });
});

describe('canal privado', () => {
  const privado = canal('11', [negar(GUILD, VER)]);

  it('negar VIEW ao everyone esconde o canal de quem so tem o everyone', () => {
    const r = retrato([privado]);
    const quem = membrosComPermissao(r, '11');
    expect(quem.has(COMUM)).toBe(false);
    expect(quem.has(MOD)).toBe(false);
  });

  it('dono e administrador enxergam mesmo assim', () => {
    const r = retrato([privado]);
    expect(ordenado(membrosComPermissao(r, '11'))).toEqual([DONO, ADMIN]);
  });

  it('um cargo liberado volta a ver', () => {
    const r = retrato([canal('11', [negar(GUILD, VER), liberar(CARGO_MOD, VER)])]);
    expect(ordenado(membrosComPermissao(r, '11'))).toEqual([DONO, ADMIN, MOD]);
  });

  it('sobrescrita de membro liberando vale para aquela pessoa so', () => {
    const r = retrato([canal('11', [negar(GUILD, VER), liberar(COMUM, VER, 'MEMBER')])]);
    expect(ordenado(membrosComPermissao(r, '11'))).toEqual([DONO, ADMIN, COMUM]);
  });

  it('sobrescrita de membro negando tira quem o cargo deixava ver', () => {
    const r = retrato([canal('11', [liberar(CARGO_MOD, VER), negar(MOD, VER, 'MEMBER')])]);
    expect(membrosComPermissao(r, '11').has(MOD)).toBe(false);
  });
});

describe('heranca da categoria', () => {
  it('canal sem sobrescrita propria herda o deny da categoria', () => {
    const r = retrato([canal('20', [negar(GUILD, VER)]), canal('21', [], '20')]);
    expect(ordenado(membrosComPermissao(r, '21'))).toEqual([DONO, ADMIN]);
  });

  it('a categoria de fora do servidor tambem empresta sobrescritas', () => {
    // Reproduz resolveChannelPermissions, que busca o pai so pelo id.
    const r = retrato([canal('21', [], '900')], { paisDeFora: [canal('900', [negar(GUILD, VER)])] });
    expect(membrosComPermissao(r, '21').has(COMUM)).toBe(false);
  });

  it('a categoria de fora nunca aparece como canal visivel', () => {
    const r = retrato([canal('21', [], '900')], { paisDeFora: [canal('900')] });
    expect([...canaisComPermissao(r, COMUM)]).toEqual(['21']);
  });
});

describe('outras permissoes alem de ver', () => {
  it('ver sem poder ler o historico nao conta para READ_MESSAGE_HISTORY', () => {
    const r = retrato([canal('30', [negar(GUILD, LER)])]);
    expect(membrosComPermissao(r, '30').has(COMUM)).toBe(true);
    expect(membrosComPermissao(r, '30', LER).has(COMUM)).toBe(false);
    expect(canaisComPermissao(r, COMUM, LER).has('30')).toBe(false);
  });

  it('sem VIEW_CHANNEL nenhuma outra permissao vale, como no normalize', () => {
    const r = retrato([canal('31', [negar(GUILD, VER), liberar(COMUM, LER, 'MEMBER')])]);
    expect(membrosComPermissao(r, '31', LER).has(COMUM)).toBe(false);
  });
});

describe('as duas contas concordam', () => {
  it('membrosComPermissao e canaisComPermissao dao o mesmo par membro x canal', () => {
    const r = retrato([
      canal('40'),
      canal('41', [negar(GUILD, VER)]),
      canal('42', [negar(GUILD, VER), liberar(CARGO_MOD, VER)]),
      canal('43', [], '41'),
      canal('44', [liberar(COMUM, VER, 'MEMBER')], '41'),
    ]);

    for (const membro of r.members) {
      const porMembro = canaisComPermissao(r, membro.userId);
      for (const c of r.channels) {
        expect(membrosComPermissao(r, c.id).has(membro.userId)).toBe(porMembro.has(c.id));
      }
    }
  });
});

describe('contexto do membro', () => {
  it('o everyone entra mesmo sem linha em MemberRole', () => {
    const r = retrato([]);
    const ctx = contextoDoMembro(r, { userId: COMUM, roleIds: [] });
    expect(ctx.roles.map((role) => role.id)).toEqual([GUILD]);
  });

  it('cargo que nao existe mais e ignorado', () => {
    const r = retrato([]);
    const ctx = contextoDoMembro(r, { userId: COMUM, roleIds: ['apagado', CARGO_MOD] });
    expect(ctx.roles.map((role) => role.id).sort()).toEqual([GUILD, CARGO_MOD].sort());
  });

  it('o dono recebe tudo pela regra do shared', () => {
    const r = retrato([canal('50', [negar(DONO, ALL_PERMISSIONS, 'MEMBER')])]);
    expect(membrosComPermissao(r, '50').has(DONO)).toBe(true);
  });
});

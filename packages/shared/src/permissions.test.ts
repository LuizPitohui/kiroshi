import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  canActOn,
  computeBasePermissions,
  computeChannelPermissions,
  deserialize,
  fromNames,
  has,
  hasExact,
  highestRolePosition,
  mesclarSobrescritas,
  normalizeChannelPermissions,
  Permission,
  serialize,
  toNames,
  type MemberContext,
} from './permissions.js';

const GUILD = '1';
const OWNER = 'owner';
const MEMBER = 'member';

function ctx(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: MEMBER,
    guildOwnerId: OWNER,
    everyoneRoleId: GUILD,
    roles: [{ id: GUILD, position: 0, permissions: 0n }],
    ...overrides,
  };
}

describe('has', () => {
  it('reconhece uma permissao presente', () => {
    expect(has(Permission.SEND_MESSAGES, Permission.SEND_MESSAGES)).toBe(true);
  });

  it('nega uma permissao ausente', () => {
    expect(has(Permission.SEND_MESSAGES, Permission.BAN_MEMBERS)).toBe(false);
  });

  it('ADMINISTRATOR concede qualquer permissao', () => {
    expect(has(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(true);
  });

  it('hasExact ignora o atalho de ADMINISTRATOR', () => {
    expect(hasExact(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(false);
  });

  it('exige todos os bits quando recebe uma combinacao', () => {
    const combo = Permission.SEND_MESSAGES | Permission.ATTACH_FILES;
    expect(has(Permission.SEND_MESSAGES, combo)).toBe(false);
    expect(has(combo, combo)).toBe(true);
  });
});

describe('computeBasePermissions', () => {
  it('dono recebe tudo mesmo sem cargo', () => {
    const permissions = computeBasePermissions(ctx({ userId: OWNER, roles: [] }));
    expect(permissions).toBe(ALL_PERMISSIONS);
  });

  it('soma as permissoes de todos os cargos', () => {
    const permissions = computeBasePermissions(
      ctx({
        roles: [
          { id: GUILD, position: 0, permissions: Permission.VIEW_CHANNEL },
          { id: 'r1', position: 1, permissions: Permission.SEND_MESSAGES },
          { id: 'r2', position: 2, permissions: Permission.ATTACH_FILES },
        ],
      }),
    );
    expect(has(permissions, Permission.VIEW_CHANNEL)).toBe(true);
    expect(has(permissions, Permission.SEND_MESSAGES)).toBe(true);
    expect(has(permissions, Permission.ATTACH_FILES)).toBe(true);
    expect(hasExact(permissions, Permission.BAN_MEMBERS)).toBe(false);
  });

  it('ADMINISTRATOR em qualquer cargo expande para tudo', () => {
    const permissions = computeBasePermissions(
      ctx({ roles: [{ id: 'r1', position: 1, permissions: Permission.ADMINISTRATOR }] }),
    );
    expect(permissions).toBe(ALL_PERMISSIONS);
  });
});

describe('computeChannelPermissions', () => {
  it('overwrite de everyone nega para todo mundo', () => {
    const permissions = computeChannelPermissions(
      ctx({ roles: [{ id: GUILD, position: 0, permissions: Permission.SEND_MESSAGES }] }),
      [{ targetId: GUILD, targetType: 'ROLE', allow: 0n, deny: Permission.SEND_MESSAGES }],
    );
    expect(hasExact(permissions, Permission.SEND_MESSAGES)).toBe(false);
  });

  it('allow de cargo sobrepoe o deny de everyone', () => {
    const permissions = computeChannelPermissions(
      ctx({
        roles: [
          { id: GUILD, position: 0, permissions: 0n },
          { id: 'mods', position: 5, permissions: 0n },
        ],
      }),
      [
        { targetId: GUILD, targetType: 'ROLE', allow: 0n, deny: Permission.VIEW_CHANNEL },
        { targetId: 'mods', targetType: 'ROLE', allow: Permission.VIEW_CHANNEL, deny: 0n },
      ],
    );
    expect(has(permissions, Permission.VIEW_CHANNEL)).toBe(true);
  });

  it('deny de cargo nao apaga allow de outro cargo, porque allow vem depois', () => {
    const permissions = computeChannelPermissions(
      ctx({
        roles: [
          { id: GUILD, position: 0, permissions: 0n },
          { id: 'a', position: 1, permissions: 0n },
          { id: 'b', position: 2, permissions: 0n },
        ],
      }),
      [
        { targetId: 'a', targetType: 'ROLE', allow: 0n, deny: Permission.SEND_MESSAGES },
        { targetId: 'b', targetType: 'ROLE', allow: Permission.SEND_MESSAGES, deny: 0n },
      ],
    );
    expect(has(permissions, Permission.SEND_MESSAGES)).toBe(true);
  });

  it('overwrite de membro tem a ultima palavra sobre os cargos', () => {
    const permissions = computeChannelPermissions(
      ctx({ roles: [{ id: GUILD, position: 0, permissions: Permission.SEND_MESSAGES }] }),
      [
        { targetId: GUILD, targetType: 'ROLE', allow: Permission.SEND_MESSAGES, deny: 0n },
        { targetId: MEMBER, targetType: 'MEMBER', allow: 0n, deny: Permission.SEND_MESSAGES },
      ],
    );
    expect(hasExact(permissions, Permission.SEND_MESSAGES)).toBe(false);
  });

  it('ignora overwrites de cargos que o membro nao tem', () => {
    const permissions = computeChannelPermissions(
      ctx({ roles: [{ id: GUILD, position: 0, permissions: Permission.VIEW_CHANNEL }] }),
      [{ targetId: 'outro-cargo', targetType: 'ROLE', allow: 0n, deny: Permission.VIEW_CHANNEL }],
    );
    expect(has(permissions, Permission.VIEW_CHANNEL)).toBe(true);
  });

  it('administrador ignora qualquer deny de canal', () => {
    const permissions = computeChannelPermissions(
      ctx({ roles: [{ id: GUILD, position: 0, permissions: Permission.ADMINISTRATOR }] }),
      [{ targetId: GUILD, targetType: 'ROLE', allow: 0n, deny: ALL_PERMISSIONS }],
    );
    expect(permissions).toBe(ALL_PERMISSIONS);
  });

  it('dono ignora qualquer deny de canal', () => {
    const permissions = computeChannelPermissions(
      ctx({ userId: OWNER }),
      [{ targetId: OWNER, targetType: 'MEMBER', allow: 0n, deny: ALL_PERMISSIONS }],
    );
    expect(permissions).toBe(ALL_PERMISSIONS);
  });
});

describe('mesclarSobrescritas', () => {
  const V = Permission.VIEW_CHANNEL;
  const S = Permission.SEND_MESSAGES;
  const everyone = (allow: bigint, deny: bigint) => ({ targetId: GUILD, targetType: 'ROLE' as const, allow, deny });
  const base = ctx({ roles: [{ id: GUILD, position: 0, permissions: V | S }] });
  const noCanal = (categoria: ReturnType<typeof everyone>[], canal: ReturnType<typeof everyone>[]) =>
    normalizeChannelPermissions(computeChannelPermissions(base, mesclarSobrescritas(categoria, canal)));

  it('canal sem nada proprio fica como a categoria deixou', () => {
    expect(noCanal([everyone(0n, V)], [])).toBe(0n);
  });

  it('o allow do canal vence o deny da categoria para o mesmo alvo', () => {
    // Era o defeito: a sobrescrita da categoria chegava primeiro e valia ela.
    expect(has(noCanal([everyone(0n, V)], [everyone(V, 0n)]), V)).toBe(true);
  });

  it('o deny do canal vence o allow da categoria', () => {
    expect(has(noCanal([everyone(S, 0n)], [everyone(0n, S)]), S)).toBe(false);
  });

  it('bit que o canal nao menciona continua herdado', () => {
    // O canal so nega enviar; a categoria privada continua escondendo o canal.
    expect(noCanal([everyone(0n, V)], [everyone(0n, S)])).toBe(0n);
  });

  it('cargo: o allow do canal desfaz o deny da categoria para o mesmo cargo', () => {
    const membro = ctx({
      roles: [
        { id: GUILD, position: 0, permissions: V | S },
        { id: 'mod', position: 1, permissions: 0n },
      ],
    });
    const mod = (allow: bigint, deny: bigint) => ({ targetId: 'mod', targetType: 'ROLE' as const, allow, deny });
    const efetivas = computeChannelPermissions(membro, mesclarSobrescritas([mod(0n, S)], [mod(S, 0n)]));
    expect(has(efetivas, S)).toBe(true);
  });

  it('alvos diferentes somam, cada um com a sua', () => {
    const mesclada = mesclarSobrescritas([everyone(0n, V)], [{ targetId: MEMBER, targetType: 'MEMBER', allow: V, deny: 0n }]);
    expect(mesclada).toHaveLength(2);
    expect(has(computeChannelPermissions(base, mesclada), V)).toBe(true);
  });

  it('nao altera as listas recebidas', () => {
    const categoria = [everyone(0n, V)];
    mesclarSobrescritas(categoria, [everyone(V, 0n)]);
    expect(categoria[0]).toEqual(everyone(0n, V));
  });
});

describe('normalizeChannelPermissions', () => {
  it('zera tudo quando VIEW_CHANNEL esta ausente', () => {
    const permissions = Permission.SEND_MESSAGES | Permission.CONNECT;
    expect(normalizeChannelPermissions(permissions)).toBe(0n);
  });

  it('mantem as permissoes quando VIEW_CHANNEL esta presente', () => {
    const permissions = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.READ_MESSAGE_HISTORY;
    expect(normalizeChannelPermissions(permissions)).toBe(permissions);
  });

  it('remove MANAGE_MESSAGES sem READ_MESSAGE_HISTORY', () => {
    const permissions = Permission.VIEW_CHANNEL | Permission.MANAGE_MESSAGES;
    const result = normalizeChannelPermissions(permissions);
    expect(hasExact(result, Permission.MANAGE_MESSAGES)).toBe(false);
    expect(hasExact(result, Permission.VIEW_CHANNEL)).toBe(true);
  });
});

describe('hierarquia', () => {
  it('dono age sobre qualquer um', () => {
    const owner = ctx({ userId: OWNER });
    const target = ctx({ roles: [{ id: 'r', position: 99, permissions: 0n }] });
    expect(canActOn(owner, target)).toBe(true);
  });

  it('ninguem age sobre o dono', () => {
    const admin = ctx({ roles: [{ id: 'r', position: 99, permissions: Permission.ADMINISTRATOR }] });
    const owner = ctx({ userId: OWNER });
    expect(canActOn(admin, owner)).toBe(false);
  });

  it('cargo mais alto age sobre o mais baixo', () => {
    const high = ctx({ userId: 'a', roles: [{ id: 'r1', position: 5, permissions: 0n }] });
    const low = ctx({ userId: 'b', roles: [{ id: 'r2', position: 2, permissions: 0n }] });
    expect(canActOn(high, low)).toBe(true);
    expect(canActOn(low, high)).toBe(false);
  });

  it('cargos de mesma posicao nao podem agir entre si', () => {
    const a = ctx({ userId: 'a', roles: [{ id: 'r1', position: 5, permissions: 0n }] });
    const b = ctx({ userId: 'b', roles: [{ id: 'r2', position: 5, permissions: 0n }] });
    expect(canActOn(a, b)).toBe(false);
  });

  it('dono tem posicao infinita', () => {
    expect(highestRolePosition(ctx({ userId: OWNER }))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('serializacao', () => {
  it('ida e volta preserva o valor', () => {
    const permissions = Permission.ADMINISTRATOR | Permission.MANAGE_WEBHOOKS;
    expect(deserialize(serialize(permissions))).toBe(permissions);
  });

  it('entrada invalida vira zero em vez de lancar', () => {
    expect(deserialize('nao-e-numero')).toBe(0n);
    expect(deserialize(null)).toBe(0n);
    expect(deserialize(undefined)).toBe(0n);
  });

  it('nomes vao e voltam', () => {
    const names = ['SEND_MESSAGES', 'CONNECT', 'SPEAK'] as const;
    const bits = fromNames(names);
    expect(toNames(bits).sort()).toEqual([...names].sort());
  });

  it('sobrevive ao maior bit usado', () => {
    expect(deserialize(serialize(ALL_PERMISSIONS))).toBe(ALL_PERMISSIONS);
  });
});

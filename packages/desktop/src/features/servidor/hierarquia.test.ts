import { describe, expect, it } from 'vitest';
import { Permission, serialize, type MemberContext, type Role } from '@kiroshi/shared';
import {
  bitsQueEuMudo,
  cargosEmOrdem,
  meuPoder,
  moverCargo,
  podeAgirSobre,
  podeDarCargo,
  podeEditarCargo,
  podeMoverPara,
  podeTirarCargo,
} from './hierarquia.js';

const G = 'g';
const cargo = (id: string, position: number, permissoes = 0n): Role => ({
  id,
  guildId: G,
  name: id,
  color: null,
  position,
  permissions: serialize(permissoes),
  hoist: false,
  mentionable: false,
  managed: id === G,
});
const everyone = cargo(G, 0, Permission.VIEW_CHANNEL);
const adm = cargo('adm', 3, Permission.ADMINISTRATOR);
const mod = cargo('mod', 2, Permission.MANAGE_ROLES | Permission.KICK_MEMBERS);
const vip = cargo('vip', 1, Permission.BAN_MEMBERS);

function ctx(userId: string, cargos: Role[], dono = 'dono'): MemberContext {
  return {
    userId,
    guildOwnerId: dono,
    everyoneRoleId: G,
    roles: [everyone, ...cargos].map((c) => ({ id: c.id, position: c.position, permissions: BigInt(c.permissions) })),
  };
}

const moderador = meuPoder(ctx('m', [mod]));
const dono = meuPoder(ctx('dono', []));

describe('quem mexe em qual cargo', () => {
  it('o dono mexe em tudo', () => {
    expect(podeEditarCargo(dono, adm)).toBe(true);
    expect(podeDarCargo(dono, adm)).toBe(true);
  });

  it('moderador mexe so abaixo dele', () => {
    expect(podeEditarCargo(moderador, vip)).toBe(true);
    expect(podeEditarCargo(moderador, mod)).toBe(false);
    expect(podeEditarCargo(moderador, adm)).toBe(false);
  });

  it('nao da cargo com permissao que nao tem, mas pode tirar', () => {
    expect(podeDarCargo(moderador, vip)).toBe(false);
    expect(podeTirarCargo(moderador, vip)).toBe(true);
    const ajudante = cargo('aj', 1, Permission.KICK_MEMBERS);
    expect(podeDarCargo(moderador, ajudante)).toBe(true);
  });

  it('o everyone nunca se da nem se tira', () => {
    expect(podeDarCargo(dono, everyone)).toBe(false);
    expect(podeTirarCargo(dono, everyone)).toBe(false);
  });

  it('sem MANAGE_ROLES nao mexe em nada', () => {
    const comum = meuPoder(ctx('c', [cargo('x', 5)]));
    expect(podeEditarCargo(comum, vip)).toBe(false);
  });

  it('administrador pode ligar qualquer bit, moderador so os dele', () => {
    const admin = meuPoder(ctx('a', [adm]));
    expect(bitsQueEuMudo(admin) & Permission.BAN_MEMBERS).toBe(Permission.BAN_MEMBERS);
    expect(bitsQueEuMudo(moderador) & Permission.BAN_MEMBERS).toBe(0n);
  });
});

describe('agir sobre pessoas', () => {
  it('so sobre quem esta abaixo, e sempre sobre si', () => {
    expect(podeAgirSobre(moderador, ctx('v', [vip]))).toBe(true);
    expect(podeAgirSobre(moderador, ctx('a', [adm]))).toBe(false);
    expect(podeAgirSobre(moderador, ctx('m', [mod]))).toBe(true);
    expect(podeAgirSobre(moderador, ctx('dono', []))).toBe(false);
    expect(podeAgirSobre(moderador, null)).toBe(false);
  });
});

describe('reordenar', () => {
  const lista = cargosEmOrdem([vip, everyone, adm, mod], G);

  it('lista de cima para baixo sem o everyone', () => {
    expect(lista.map((c) => c.id)).toEqual(['adm', 'mod', 'vip']);
  });

  it('mover devolve a lista inteira renumerada, o de cima com o maior numero', () => {
    expect(moverCargo(lista, 2, 0)).toEqual([
      { id: 'vip', position: 3 },
      { id: 'adm', position: 2 },
      { id: 'mod', position: 1 },
    ]);
  });

  it('o moderador so move abaixo do proprio cargo', () => {
    const m3 = cargo('mod', 3, Permission.MANAGE_ROLES);
    const quatro = cargosEmOrdem([cargo('adm', 4), m3, cargo('vip', 2), cargo('aj', 1)], G);
    const eu = meuPoder(ctx('m', [m3]));
    expect(podeMoverPara(eu, quatro, 3, 2)).toBe(true);
    expect(podeMoverPara(eu, quatro, 2, 1)).toBe(false);
    expect(podeMoverPara(eu, quatro, 1, 2)).toBe(false);
    expect(podeMoverPara(dono, quatro, 3, 0)).toBe(true);
  });

  it('nao move para o mesmo lugar nem para fora da lista', () => {
    expect(podeMoverPara(dono, lista, 1, 1)).toBe(false);
    expect(podeMoverPara(dono, lista, 1, 3)).toBe(false);
  });
});

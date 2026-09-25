import {
  ALL_PERMISSIONS,
  Permission,
  canActOn,
  computeBasePermissions,
  deserialize,
  has,
  highestRolePosition,
  type MemberContext,
  type Role,
} from '@kiroshi/shared';

/**
 * O que a pessoa pode fazer com cada cargo, pela mesma regra do servidor.
 *
 * So decide o que MOSTRAR: o servidor confere tudo de novo a cada pedido.
 * Mas mostrar certo e o que resolve as queixas da fatia 6 — a 1.x deixava
 * clicar em "Criar cargo" e engolia o 403, e ninguem sabia por que nao dava.
 */

export interface MeuPoder {
  ctx: MemberContext;
  permissoes: bigint;
  dono: boolean;
  /** Posicao do meu cargo mais alto; infinita para o dono. */
  topo: number;
}

export function meuPoder(ctx: MemberContext): MeuPoder {
  return {
    ctx,
    permissoes: computeBasePermissions(ctx),
    dono: ctx.userId === ctx.guildOwnerId,
    topo: highestRolePosition(ctx),
  };
}

/** Nome, cor, permissoes, apagar: com MANAGE_ROLES e estritamente acima do cargo. */
export function podeEditarCargo(p: MeuPoder, cargo: Pick<Role, 'position'>): boolean {
  if (p.dono) return true;
  return has(p.permissoes, Permission.MANAGE_ROLES) && cargo.position < p.topo;
}

/** Os bits que eu posso ligar ou desligar num cargo: os que eu tenho. */
export function bitsQueEuMudo(p: MeuPoder): bigint {
  if (p.dono || has(p.permissoes, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return p.permissoes;
}

/** Dar o cargo a alguem: alem de estar acima dele, nao se entrega permissao que nao se tem. */
export function podeDarCargo(p: MeuPoder, cargo: Role): boolean {
  if (cargo.id === p.ctx.everyoneRoleId) return false;
  if (!podeEditarCargo(p, cargo)) return false;
  return (deserialize(cargo.permissions) & ~bitsQueEuMudo(p)) === 0n;
}

/** Tirar so tira permissao: basta a hierarquia. */
export function podeTirarCargo(p: MeuPoder, cargo: Role): boolean {
  return cargo.id !== p.ctx.everyoneRoleId && podeEditarCargo(p, cargo);
}

/** Moderar alguem (cargos, apelido, expulsar, banir): so quem esta abaixo. A si mesmo, sempre. */
export function podeAgirSobre(p: MeuPoder, alvo: MemberContext | null): boolean {
  if (!alvo) return false;
  if (alvo.userId === p.ctx.userId) return true;
  return canActOn(p.ctx, alvo);
}

/** Os cargos de cima para baixo, sem o everyone (que fica sempre embaixo, fora da lista). */
export function cargosEmOrdem(cargos: readonly Role[], everyoneId: string): Role[] {
  return cargos
    .filter((c) => c.id !== everyoneId)
    .sort((a, b) => b.position - a.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Leva o cargo do lugar `de` para `para` (indices na lista de cima para
 * baixo) e devolve o pedido para o servidor: a lista inteira renumerada, o
 * de cima com o maior numero. O servidor so considera movido quem mudou de
 * lugar na ordem, entao mandar tudo nao esbarra nos cargos acima de quem pede.
 */
export function moverCargo(cargos: readonly Role[], de: number, para: number): { id: string; position: number }[] {
  const lista = [...cargos];
  const [movido] = lista.splice(de, 1);
  if (movido) lista.splice(para, 0, movido);
  return lista.map((c, i) => ({ id: c.id, position: lista.length - i }));
}

/** Da para mover? O cargo e o destino precisam ficar abaixo do meu cargo mais alto. */
export function podeMoverPara(p: MeuPoder, cargos: readonly Role[], de: number, para: number): boolean {
  if (de === para || para < 0 || para >= cargos.length) return false;
  if (p.dono) return true;
  if (!has(p.permissoes, Permission.MANAGE_ROLES)) return false;
  const meus = new Set(p.ctx.roles.map((r) => r.id));
  const meuTopo = cargos.findIndex((c) => meus.has(c.id));
  if (meuTopo < 0) return false;
  return de > meuTopo && para > meuTopo;
}

/** A cor que o nome da pessoa ganha: a do cargo mais alto que tem cor. */
export function corDaPessoa(cargosDela: readonly Role[]): string | null {
  const comCor = cargosDela.filter((c) => c.color).sort((a, b) => b.position - a.position)[0];
  return comCor?.color ?? null;
}

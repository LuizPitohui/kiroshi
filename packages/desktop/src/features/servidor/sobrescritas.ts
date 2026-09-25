import { Permission, deserialize, serialize, type PermissionOverwrite } from '@kiroshi/shared';

/**
 * Os tres estados de uma permissao num canal, como a tela mostra.
 *
 * Por cargo ou pessoa, cada bit pode estar negado, liberado, ou em nenhum dos
 * dois — "herdar": vale o que a categoria diz e, sem nada na categoria, o que
 * o cargo tem no servidor. E exatamente a conta do servidor
 * (`mesclarSobrescritas`): o canal so vence nos bits que ele menciona.
 */
export type Estado = 'negar' | 'herdar' | 'permitir';

export interface Bits {
  allow: bigint;
  deny: bigint;
}

export function bitsDe(sobrescrita: Pick<PermissionOverwrite, 'allow' | 'deny'> | undefined): Bits {
  return { allow: deserialize(sobrescrita?.allow), deny: deserialize(sobrescrita?.deny) };
}

export function estadoDoBit(bits: Bits, bit: bigint): Estado {
  if ((bits.deny & bit) === bit) return 'negar';
  if ((bits.allow & bit) === bit) return 'permitir';
  return 'herdar';
}

export function comEstado(bits: Bits, bit: bigint, estado: Estado): Bits {
  const allow = bits.allow & ~bit;
  const deny = bits.deny & ~bit;
  if (estado === 'permitir') return { allow: allow | bit, deny };
  if (estado === 'negar') return { allow, deny: deny | bit };
  return { allow, deny };
}

/** Sem nenhum bit dito, a sobrescrita nao existe: o certo e apaga-la, nao gravar zeros. */
export function vazia(bits: Bits): boolean {
  return bits.allow === 0n && bits.deny === 0n;
}

export function paraEnviar(bits: Bits): { allow: string; deny: string } {
  return { allow: serialize(bits.allow), deny: serialize(bits.deny) };
}

/**
 * O que vale num bit que o canal deixa em "herdar", para a tela dizer: o que a
 * categoria diz para o mesmo alvo e, sem nada la, o que o cargo tem no
 * servidor. `doCargo` null (uma pessoa, e nao um cargo) fica so na categoria.
 */
export function valorHerdado(
  bit: bigint,
  daCategoria: Bits | null,
  doCargo: bigint | null,
): { permitido: boolean; de: 'categoria' | 'cargo' } | null {
  if (daCategoria) {
    const estado = estadoDoBit(daCategoria, bit);
    if (estado !== 'herdar') return { permitido: estado === 'permitir', de: 'categoria' };
  }
  if (doCargo === null) return null;
  const admin = (doCargo & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR;
  return { permitido: admin || (doCargo & bit) === bit, de: 'cargo' };
}

/**
 * Privado de verdade: o @everyone nao ve, seja pelo proprio canal, seja pela
 * categoria, seja porque o @everyone ja nao tem "ver canais" no servidor.
 */
export function privadoDeFato(doCanal: Bits, daCategoria: Bits | null, doEveryone: bigint): boolean {
  const V = Permission.VIEW_CHANNEL;
  const proprio = estadoDoBit(doCanal, V);
  if (proprio !== 'herdar') return proprio === 'negar';
  const herdado = valorHerdado(V, daCategoria, doEveryone);
  return herdado ? !herdado.permitido : false;
}

/**
 * O canal esta sincronizado com a categoria quando nao diz nada por conta
 * propria: segue a categoria inteira. E o que o botao "Sincronizar" devolve.
 */
export function sincronizado(canal: { parentId: string | null; overwrites: readonly PermissionOverwrite[] }): boolean {
  return canal.parentId !== null && canal.overwrites.every((o) => vazia(bitsDe(o)));
}

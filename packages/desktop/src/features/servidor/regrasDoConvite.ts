import type { Invite } from '@kiroshi/shared';

/**
 * Convite como link (pedido F8): validade e usos como no Discord, e o texto
 * que a lista mostra. Sem rede aqui; o teste cobre sozinho.
 */

export const VALIDADES = [
  { rotulo: '30 minutos', segundos: 30 * 60 },
  { rotulo: '1 hora', segundos: 3600 },
  { rotulo: '6 horas', segundos: 6 * 3600 },
  { rotulo: '12 horas', segundos: 12 * 3600 },
  { rotulo: '1 dia', segundos: 86_400 },
  { rotulo: '7 dias', segundos: 7 * 86_400 },
  { rotulo: 'Nunca expira', segundos: 0 },
] as const;

export const USOS = [
  { rotulo: 'Sem limite', usos: 0 },
  { rotulo: '1 uso', usos: 1 },
  { rotulo: '5 usos', usos: 5 },
  { rotulo: '10 usos', usos: 10 },
  { rotulo: '25 usos', usos: 25 },
  { rotulo: '50 usos', usos: 50 },
  { rotulo: '100 usos', usos: 100 },
] as const;

/** Padrao do Discord: 7 dias, sem limite de usos. */
export const VALIDADE_PADRAO = 7 * 86_400;
export const USOS_PADRAO = 0;

/**
 * Aceita o codigo puro, o link inteiro (https ou kiroshi://) e espaco em
 * volta. Num link, o codigo e o que vem depois de `convite/` — pegar so o
 * ultimo pedaco faria de ".../convite/" um codigo chamado "convite".
 */
export function codigoDe(texto: string): string | null {
  const limpo = texto.trim();
  const noLink = /convite\/([A-Za-z0-9]{6,12})(?:[/?#].*)?$/.exec(limpo);
  if (noLink) return noLink[1]!;
  return /^[A-Za-z0-9]{6,12}$/.test(limpo) ? limpo : null;
}

/** Ainda vale? Vencido ou sem usos, nao. */
export function valido(convite: Pick<Invite, 'expiresAt' | 'maxUses' | 'uses'>, agora: number): boolean {
  if (convite.expiresAt && Date.parse(convite.expiresAt) <= agora) return false;
  return !(convite.maxUses > 0 && convite.uses >= convite.maxUses);
}

/** "expira em 3 h", "expira em 2 dias", "não expira". */
export function quandoExpira(expiresAt: string | null, agora: number): string {
  if (!expiresAt) return 'não expira';
  const falta = Date.parse(expiresAt) - agora;
  if (falta <= 0) return 'expirado';
  const minutos = Math.ceil(falta / 60_000);
  if (minutos < 60) return `expira em ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `expira em ${horas} h`;
  const dias = Math.round(horas / 24);
  return `expira em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/** "3 de 5 usos", "7 usos" (sem limite). */
export function descreverUsos(convite: Pick<Invite, 'maxUses' | 'uses'>): string {
  if (convite.maxUses > 0) return `${convite.uses} de ${convite.maxUses} ${convite.maxUses === 1 ? 'uso' : 'usos'}`;
  return `${convite.uses} ${convite.uses === 1 ? 'uso' : 'usos'}`;
}

/** Junta classes, descartando o que for falso. Sem dependencia para isso. */
export function cx(...partes: Array<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ');
}

/**
 * Os links `kiroshi://` que abrem o app num lugar.
 *
 * Hoje ha um so: `kiroshi://convite/<codigo>`, o botao "Abrir no Kiroshi" da
 * pagina do convite. O Windows entrega o endereco como argumento do programa
 * — na abertura (`process.argv`) ou, com o app ja aberto, no `argv` da segunda
 * instancia.
 *
 * O que nao casar e ignorado: um link malformado, ou um site mal-intencionado
 * inventando enderecos, nunca leva o app a uma rota que ele nao conhece.
 */

/** O alfabeto do codigo do servidor (INVITE_CODE_PATTERN). */
const CODIGO = /^[A-Za-z0-9]{6,12}$/;

/** `kiroshi://convite/Ab3dEf7h` -> `#/convite/Ab3dEf7h`; o resto, null. */
export function rotaDoLink(endereco: string): string | null {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return null;
  }
  if (url.protocol !== 'kiroshi:') return null;
  // "convite" chega como host — num esquema proprio o URL nao poe o host em
  // minusculas, entao a comparacao ignora a caixa. O codigo, que diferencia
  // maiusculas, vem no caminho, intacto.
  const partes = [url.hostname, ...url.pathname.split('/')].filter(Boolean);
  const [lugar, codigo] = partes;
  if (lugar?.toLowerCase() === 'convite' && partes.length === 2 && codigo && CODIGO.test(codigo)) return `#/convite/${codigo}`;
  return null;
}

/** O primeiro argumento que e um link do Kiroshi valido. */
export function linkDosArgumentos(argv: readonly string[]): string | null {
  for (const argumento of argv) {
    if (!argumento.toLowerCase().startsWith('kiroshi:')) continue;
    const rota = rotaDoLink(argumento);
    if (rota) return rota;
  }
  return null;
}

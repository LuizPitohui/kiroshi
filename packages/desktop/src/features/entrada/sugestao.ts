import { LIMITS, USERNAME_PATTERN, usernameReservado } from '@kiroshi/shared';

/**
 * Um nome de usuario sugerido para quem cria a conta pelo Google, a partir do
 * email (a parte antes do @) ou do nome.
 *
 * So letras minusculas, numeros, ponto e sublinhado, sem acento, 2 a 32 — o
 * formato que o servidor aceita. A 1.x deixava passar hifen, e a conta criada
 * assim nao recebia pedido de amizade. Nome reservado (admin, kiroshi...) ganha
 * um sufixo. A pessoa troca antes de confirmar.
 */
export function sugerirUsername(email: string | null, nome: string | null): string {
  const base = (email?.split('@')[0] || nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, LIMITS.username.max);

  let sugestao = base.length >= LIMITS.username.min ? base : `${base}usuario`.slice(0, LIMITS.username.max);
  if (usernameReservado(sugestao)) sugestao = `${sugestao.slice(0, LIMITS.username.max - 2)}_1`;
  return USERNAME_PATTERN.test(sugestao) ? sugestao : 'usuario';
}

/** O que falta num nome de usuario digitado, na lingua da tela; null se esta bom. */
export function problemaNoUsername(username: string): string | null {
  if (username.length < LIMITS.username.min) return `Pelo menos ${LIMITS.username.min} caracteres.`;
  if (!USERNAME_PATTERN.test(username)) return 'Só letras minúsculas, números, ponto ou _.';
  if (usernameReservado(username)) return 'Este nome é reservado. Escolha outro.';
  return null;
}

import argon2 from 'argon2';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id com parametros acima do minimo recomendado pela OWASP.
 * 64 MiB e 3 passagens custam ~60ms por verificacao neste hardware, o que e
 * confortavel para 10 usuarios e caro o bastante para quem tentar forca bruta.
 */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

/**
 * Confere a senha.
 *
 * O hash e opcional porque a conta pode nao ter senha nenhuma: quem se
 * cadastrou pelo Google entra por la. Nesse caso NENHUMA senha confere — nem
 * a vazia, nem qualquer outra — e o tempo gasto e o mesmo de uma verificacao
 * real, para a resposta nao denunciar quais contas nao tem senha.
 *
 * Aceitar o nulo aqui, em vez de em cada chamada, e de proposito: sao cinco
 * lugares que conferem senha, e bastaria um esquecer a guarda para "sem
 * senha" virar "qualquer senha serve".
 */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    await fakeVerify();
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Hash corrompido ou em formato desconhecido conta como senha errada.
    return false;
  }
}

/**
 * Gasta o mesmo tempo de uma verificacao real. Chamado quando o usuario nao
 * existe, para que a resposta nao denuncie quais emails estao cadastrados.
 */
export async function fakeVerify(): Promise<void> {
  await argon2.hash('senha-que-nao-existe-para-igualar-o-tempo', ARGON_OPTIONS);
}

/**
 * Verdadeiro quando o hash foi gerado com parametros mais fracos do que os
 * atuais. Conta sem senha nao tem o que refazer.
 */
export function needsRehash(hash: string | null): boolean {
  if (!hash) return false;
  try {
    return argon2.needsRehash(hash, ARGON_OPTIONS);
  } catch {
    return true;
  }
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Comparacao em tempo constante para segredos de tamanho arbitrario. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // timingSafeEqual exige tamanhos iguais; compara contra si mesmo para
    // nao retornar cedo demais e ainda assim devolver false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

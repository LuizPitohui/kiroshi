import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './password.js';

/**
 * 2FA por app autenticador (TOTP, RFC 6238). SMS ficou de fora de proposito:
 * depende de gateway pago e e o metodo mais fraco, vulneravel a troca de chip.
 * Chave de seguranca (WebAuthn) exige origem HTTPS fixa e nao combina com o
 * app desktop nesta versao.
 */

authenticator.options = {
  // Aceita o codigo anterior e o seguinte, cobrindo relogio desalinhado.
  window: 1,
  step: 30,
  digits: 6,
};

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function buildOtpAuthUrl(secret: string, username: string, issuer = 'Kiroshi'): string {
  return authenticator.keyuri(username, issuer, secret);
}

export async function buildQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

/**
 * Dez codigos de recuperacao no formato xxxx-xxxx. Sao mostrados uma unica vez
 * e guardados com hash, como senha: quem tem o banco nao consegue usa-los.
 */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem 0/o/1/i/l
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      if (j === 4) code += '-';
      code += alphabet[bytes[j]! % alphabet.length];
    }
    codes.push(code);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashPassword(c)));
}

/**
 * Procura o codigo informado entre os hashes guardados. Devolve a lista sem o
 * codigo usado, porque codigo de recuperacao vale uma vez so.
 */
export async function consumeBackupCode(
  hashes: string[],
  code: string,
): Promise<{ valid: boolean; remaining: string[] }> {
  const normalized = code.trim().toLowerCase();
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (!hash) continue;
    if (await verifyPassword(hash, normalized)) {
      return { valid: true, remaining: hashes.filter((_, index) => index !== i) };
    }
  }
  return { valid: false, remaining: hashes };
}

/*
  Os aparelhos conectados, descritos para gente: o servidor guarda o
  "User-Agent" de cada entrada, que ninguem le.
*/

/** "Kiroshi Beta 1.15.0 · Windows", "Navegador Chrome · Linux", "Aparelho desconhecido". */
export function descreverAparelho(userAgent: string | null): string {
  if (!userAgent) return 'Aparelho desconhecido';
  const sistema = /Windows/i.test(userAgent)
    ? 'Windows'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/i.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : null;

  // O app se apresenta pelo nome do produto antes do Chrome: "Kiroshi Beta/1.15.0".
  const app = /(Kiroshi(?: Beta)?)\/([\d.]+)/.exec(userAgent);
  let quem: string;
  if (app) quem = `${app[1]} ${app[2]}`;
  else if (/Electron\//.test(userAgent)) quem = 'Kiroshi';
  else if (/Edg\//.test(userAgent)) quem = 'Navegador Edge';
  else if (/Firefox\//.test(userAgent)) quem = 'Navegador Firefox';
  else if (/Chrome\//.test(userAgent)) quem = 'Navegador Chrome';
  else if (/Safari\//.test(userAgent)) quem = 'Navegador Safari';
  else if (/node|undici|curl/i.test(userAgent)) quem = 'Programa';
  else quem = 'Aparelho';

  return sistema ? `${quem} · ${sistema}` : quem;
}

/** "agora", "há 5 minutos", "há 3 horas", "há 2 dias", pela ultima vez que o aparelho foi visto. */
export function vistoHa(iso: string, agora = Date.now()): string {
  const ms = agora - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 2 * 60_000) return 'agora';
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 60) return `há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

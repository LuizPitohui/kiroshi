/**
 * Os bytes das fotos de perfil animadas, baixados uma vez por endereco e antes
 * de a pessoa falar: quando ela comeca, a animacao ja esta pronta.
 *
 * Por que os bytes, e nao so o endereco: o Chromium divide UMA animacao entre
 * todas as imagens com o mesmo endereco. Com o cartao de perfil da pessoa
 * aberto (animando), a foto dela que entra na lista quando ela fala pegava a
 * animacao no meio: medido no Beta (Chromium 140), o quadro 4 de 12 em vez do
 * 0 — um salto a partir da foto parada. O `Avatar` da a cada fala um endereco
 * `blob:` novo destes bytes, e a animacao comeca sempre do primeiro quadro,
 * colada na foto parada.
 */

const animadas = new Map<string, Promise<Blob | null>>();
const bytesDe = new Map<string, number>();
let bytesGuardados = 0;

/*
  Teto da memoria: a animada tipica tem de 50 KB a 1 MB, mas o servidor aceita
  ate 6 MB. Sai primeiro a mais esquecida; uma que esteja tocando nao some da
  tela (o endereco `blob:` segura os bytes ate ser revogado).
*/
export const MAX_ANIMADAS = 64;
export const MAX_BYTES_ANIMADAS = 32 * 1024 * 1024;

function esquecer(url: string): void {
  animadas.delete(url);
  bytesGuardados -= bytesDe.get(url) ?? 0;
  bytesDe.delete(url);
}

/**
 * Os bytes da animada, ou `null`. Falha de rede nao fica guardada (a proxima
 * fala tenta de novo); 4xx fica — anexo nao volta a existir, e pedir de novo a
 * cada fala so gastaria rede.
 */
export function baixarAnimada(url: string): Promise<Blob | null> {
  const pronta = animadas.get(url);
  if (pronta) {
    // Usada de novo: vai para o fim da fila (sai primeiro a mais esquecida).
    animadas.delete(url);
    animadas.set(url, pronta);
    return pronta;
  }
  let definitivo = false;
  const baixando: Promise<Blob | null> = fetch(url)
    .then((r) => {
      if (r.ok) return r.blob();
      definitivo = r.status >= 400 && r.status < 500;
      return null;
    })
    .catch(() => null)
    .then((blob) => {
      if (animadas.get(url) !== baixando) return blob; // ja esquecida enquanto baixava
      if (!blob) {
        if (!definitivo) esquecer(url);
        return null;
      }
      bytesDe.set(url, blob.size);
      bytesGuardados += blob.size;
      for (const velha of animadas.keys()) {
        if (animadas.size <= MAX_ANIMADAS && bytesGuardados <= MAX_BYTES_ANIMADAS) break;
        if (velha !== url) esquecer(velha);
      }
      return blob;
    });
  animadas.set(url, baixando);
  return baixando;
}

/** Para os testes: quantas estao guardadas e quantos bytes somam. */
export function guardadas(): { quantas: number; bytes: number } {
  return { quantas: animadas.size, bytes: bytesGuardados };
}

/** Para os testes: esquece tudo. */
export function esquecerTodas(): void {
  for (const url of [...animadas.keys()]) esquecer(url);
}

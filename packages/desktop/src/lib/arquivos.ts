import { LIMITS } from '@kiroshi/shared';

const MB = 1024 * 1024;

function tamanho(bytes: number): string {
  return bytes >= MB ? `${bytes / MB} MB` : `${Math.round(bytes / 1024)} KB`;
}

function comoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result));
    leitor.onerror = () => rejeitar(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Le a imagem como data URL, recusando o que o servidor recusaria. */
export async function lerImagem(arquivo: File, limite: number = LIMITS.imageBytes): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha uma imagem (PNG, JPG, GIF ou WebP).');
  if (arquivo.size > limite) throw new Error(`A imagem passa de ${tamanho(limite)}.`);
  return comoDataUrl(arquivo);
}

/**
 * Le um som para o soundboard e mede a duracao decodificando de verdade.
 *
 * O servidor nao decodifica audio; quem mede e o app, antes de subir. O teto
 * de 5 segundos vale tambem na hora de tocar (o soundboard para no mesmo
 * limite), entao um cliente que minta a duracao nao ganha nada.
 */
export async function lerSom(arquivo: File): Promise<{ dataUrl: string; duracao: number }> {
  const aceitos = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'];
  const tipo = arquivo.type === 'audio/mp3' ? 'audio/mpeg' : arquivo.type === 'audio/x-wav' ? 'audio/wav' : arquivo.type;
  if (!aceitos.includes(tipo)) throw new Error('Use MP3, OGG, WAV ou WebM.');
  if (arquivo.size > LIMITS.soundBytes) throw new Error(`O som passa de ${tamanho(LIMITS.soundBytes)}.`);

  const contexto = new AudioContext();
  let duracao: number;
  try {
    const audio = await contexto.decodeAudioData(await arquivo.arrayBuffer());
    duracao = audio.duration;
  } catch {
    throw new Error('Não consegui abrir este áudio.');
  } finally {
    void contexto.close();
  }
  if (duracao > LIMITS.soundDurationSecs + 0.25) {
    throw new Error(`O som tem ${duracao.toFixed(1).replace('.', ',')} s; o limite é ${LIMITS.soundDurationSecs} s.`);
  }

  const dataUrl = await comoDataUrl(arquivo);
  // O navegador chama MP3 de audio/mp3 as vezes; o servidor so aceita o nome oficial.
  return { dataUrl: dataUrl.replace(/^data:[^;]+;/, `data:${tipo};`), duracao };
}

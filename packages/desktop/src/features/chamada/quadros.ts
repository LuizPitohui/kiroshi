/**
 * Os quadros do palco, a partir de quem esta na chamada. Puro, para as regras
 * de "quem aparece e como" serem testadas sem LiveKit.
 *
 * - Toda pessoa tem um quadro (camera ou o rosto parado): quem esta sem video
 *   nao some da tela.
 * - Toda transmissao tem um quadro proprio, antes das pessoas: e o que o grupo
 *   veio ver. A dos outros comeca como CONVITE — sem video e sem baixar nada
 *   ate a pessoa escolher assistir; a minha aparece sempre (e a previa do que
 *   sai daqui).
 */

export interface ParticipanteParaQuadro {
  userId: string;
  isLocal: boolean;
  hasVideo: boolean;
  hasScreenShare: boolean;
  /** De quem esta pessoa assiste a transmissao. */
  assistindo: readonly string[];
}

export type TipoDeQuadro = 'tela' | 'pessoa';

export interface Quadro {
  chave: string;
  userId: string;
  tipo: TipoDeQuadro;
  local: boolean;
  /** Ha imagem para mostrar agora. */
  video: boolean;
  /** Transmissao de outra pessoa que eu ainda nao escolhi assistir. */
  convite: boolean;
  /** Transmissao: quantas pessoas estao assistindo (sem contar quem transmite). */
  espectadores: number;
}

export const chaveDoQuadro = (userId: string, tipo: TipoDeQuadro) => `${userId}:${tipo}`;

/** A chave do video (no registro de `videos.ts`) de um quadro com imagem. */
export const chaveDoVideo = (q: Pick<Quadro, 'userId' | 'tipo'>) => `${q.userId}|${q.tipo === 'tela' ? 'tela' : 'camera'}`;

export function montarQuadros(participantes: readonly ParticipanteParaQuadro[], assistindoEu: readonly string[]): Quadro[] {
  const telas: Quadro[] = [];
  const pessoas: Quadro[] = [];
  for (const p of participantes) {
    if (p.hasScreenShare) {
      const convite = !p.isLocal && !assistindoEu.includes(p.userId);
      telas.push({
        chave: chaveDoQuadro(p.userId, 'tela'),
        userId: p.userId,
        tipo: 'tela',
        local: p.isLocal,
        video: !convite,
        convite,
        espectadores: participantes.filter((o) => o.userId !== p.userId && o.assistindo.includes(p.userId)).length,
      });
    }
    pessoas.push({
      chave: chaveDoQuadro(p.userId, 'pessoa'),
      userId: p.userId,
      tipo: 'pessoa',
      local: p.isLocal,
      video: p.hasVideo,
      convite: false,
      espectadores: 0,
    });
  }
  return [...telas, ...pessoas];
}

/** Escolha explicita de ficar na grade, que vence o destaque automatico. */
export const GRADE = 'grade';

/**
 * Qual quadro fica em destaque.
 *
 * A escolha da pessoa vale enquanto o quadro existir. Sem escolha, a
 * transmissao que ela esta assistindo sobe sozinha — assistir e poe-la grande
 * sao a mesma intencao. Convite nunca sobe sozinho: tomaria o palco com um
 * cartao e empurraria para a fita as pessoas com quem se conversa.
 *
 * `GRADE` e escolha, e nao falta dela: sem essa distincao, "voltar para a
 * grade" com uma transmissao assistida era desfeito na hora pelo automatico.
 */
export function quadroEmDestaque(quadros: readonly Quadro[], escolhido: string | null): string | null {
  if (escolhido === GRADE) return null;
  if (escolhido && quadros.some((q) => q.chave === escolhido)) return escolhido;
  return quadros.find((q) => q.tipo === 'tela' && !q.local && !q.convite)?.chave ?? null;
}

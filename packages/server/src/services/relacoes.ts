import { prisma } from '../db.js';

/**
 * Bloqueio entre duas pessoas, consultado de mais de um lugar.
 *
 * Morava dentro de `routes/relationships.ts`, onde so a criacao de DM e o
 * convite para grupo o consultavam. O efeito era que bloquear nao impedia
 * nada numa DM que ja existia: a outra pessoa continuava mandando mensagem e
 * entrando na chamada. Agora a mensagem, a voz e a digitacao tambem consultam.
 */

/** Verdadeiro quando existe bloqueio em qualquer direcao entre `a` e `b`. */
export async function bloqueioEntre(a: string, b: string): Promise<boolean> {
  const bloqueio = await prisma.relationship.findFirst({
    where: {
      status: 'BLOCKED',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return bloqueio !== null;
}

/**
 * Numa DM 1:1, ha bloqueio entre quem pede e o outro participante?
 *
 * So para DM de duas pessoas. Grupo continua funcionando com quem bloqueou
 * alguem dentro: sair do grupo e decisao de cada um, como no Discord.
 */
export async function bloqueioNaDm(channelId: string, userId: string): Promise<boolean> {
  const outros = await prisma.channelRecipient.findMany({
    where: { channelId, userId: { not: userId } },
    select: { userId: true },
  });
  const outro = outros[0];
  if (!outro) return false;
  return bloqueioEntre(userId, outro.userId);
}

/** A DM 1:1 entre duas pessoas, quando existe. */
export async function dmEntre(a: string, b: string): Promise<{ id: string } | null> {
  return prisma.channel.findFirst({
    where: {
      type: 'DM',
      AND: [{ recipients: { some: { userId: a } } }, { recipients: { some: { userId: b } } }],
    },
    select: { id: true },
  });
}

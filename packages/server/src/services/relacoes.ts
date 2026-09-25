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

/** Amizade aceita entre as duas. */
export async function saoAmigos(a: string, b: string): Promise<boolean> {
  const amizade = await prisma.relationship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return amizade !== null;
}

/** Estao juntas em pelo menos um servidor. */
export async function servidorEmComum(a: string, b: string): Promise<boolean> {
  const comum = await prisma.guildMember.findFirst({
    where: { userId: a, guild: { members: { some: { userId: b } } } },
    select: { guildId: true },
  });
  return comum !== null;
}

/**
 * Pode abrir uma conversa direta com essa pessoa?
 *
 * Com o cadastro aberto (fatia 7), qualquer um cria conta e acha o id de
 * alguem pelo nome de usuario. Sem esta regra, uma conta recem-criada mandava
 * mensagem para quem quisesse. Como no Discord: amigos, gente com servidor em
 * comum, ou quem ja tinha conversa aberta (ela so reabre).
 */
export async function podeAbrirDm(de: string, para: string): Promise<boolean> {
  if (await saoAmigos(de, para)) return true;
  if (await servidorEmComum(de, para)) return true;
  return (await dmEntre(de, para)) !== null;
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

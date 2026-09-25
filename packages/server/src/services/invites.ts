import { randomBytes } from 'node:crypto';
import type { Invite, InvitePreview } from '@kiroshi/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { emitToGuild, subscribeUserToGuild } from '../gateway/events.js';
import { MEMBER_INCLUDE, USER_SELECT, toMember, toPublicUser } from '../lib/serialize.js';
import { addMember } from './guilds.js';
import { getPresence } from '../gateway/registry.js';

/** Alfabeto sem caracteres que se confundem ao ler em voz alta. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

const INVITE_INCLUDE = { inviter: { select: USER_SELECT } } as const;

function toInvite(invite: Prisma.InviteGetPayload<{ include: typeof INVITE_INCLUDE }>): Invite {
  return {
    code: invite.code,
    guildId: invite.guildId,
    channelId: invite.channelId,
    inviterId: invite.inviterId,
    inviter: toPublicUser(invite.inviter),
    uses: invite.uses,
    maxUses: invite.maxUses,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
  };
}

export async function createInvite(
  guildId: string,
  inviterId: string,
  options: { channelId?: string | null; maxAgeSecs: number; maxUses: number },
): Promise<Invite> {
  // Colisao e improvavel (54^8), mas tentar de novo custa pouco.
  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await prisma.invite.findUnique({ where: { code }, select: { code: true } });
    if (!taken) break;
    code = randomCode();
  }

  const invite = await prisma.invite.create({
    data: {
      code,
      guildId,
      channelId: options.channelId ?? null,
      inviterId,
      maxUses: options.maxUses,
      expiresAt:
        options.maxAgeSecs > 0 ? new Date(Date.now() + options.maxAgeSecs * 1000) : null,
    },
    include: INVITE_INCLUDE,
  });

  return toInvite(invite);
}

function isExpired(invite: { expiresAt: Date | null; maxUses: number; uses: number }): boolean {
  if (invite.expiresAt && invite.expiresAt < new Date()) return true;
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return true;
  return false;
}

/** Dados publicos do convite, mostrados antes de entrar. */
export async function previewInvite(
  code: string,
  viewerId: string | null,
): Promise<InvitePreview> {
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: {
      guild: { select: { id: true, name: true, iconUrl: true, description: true } },
      inviter: { select: USER_SELECT },
    },
  });

  if (!invite || isExpired(invite)) {
    throw new ApiError('INVITE_INVALID', 'Convite invalido ou expirado.');
  }

  const members = await prisma.guildMember.findMany({
    where: { guildId: invite.guildId },
    select: { userId: true },
  });

  const onlineCount = members.filter(
    (m) => getPresence(m.userId).status !== 'OFFLINE',
  ).length;

  return {
    code: invite.code,
    guild: invite.guild,
    inviter: toPublicUser(invite.inviter),
    memberCount: members.length,
    onlineCount,
    alreadyMember: viewerId ? members.some((m) => m.userId === viewerId) : false,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Consome o convite e entra no servidor. Se a pessoa ja era membro, nao gasta
 * um uso: reaproveitar o link nao deveria queimar o limite.
 */
export async function acceptInvite(
  code: string,
  userId: string,
): Promise<{ guildId: string; channelId: string | null; joined: boolean }> {
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || isExpired(invite)) {
    throw new ApiError('INVITE_INVALID', 'Convite invalido ou expirado.');
  }
  const resposta = { guildId: invite.guildId, channelId: invite.channelId };

  const jaMembro = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId: invite.guildId, userId } },
    select: { userId: true },
  });
  if (jaMembro) return { ...resposta, joined: false };

  /*
    Reserva o uso ANTES de entrar, numa conta so no banco.

    Antes era ler, entrar e somar 1: duas pessoas abrindo o mesmo convite de
    um uso ao mesmo tempo entravam as duas. Agora a soma so acontece se ainda
    houver uso e validade no momento da escrita, e quem perde a corrida
    recebe "convite invalido".
  */
  const reservado = await prisma.invite.updateMany({
    where: {
      code,
      OR: [{ maxUses: 0 }, { uses: { lt: invite.maxUses } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    data: { uses: { increment: 1 } },
  });
  if (reservado.count === 0) {
    throw new ApiError('INVITE_INVALID', 'Convite invalido ou expirado.');
  }

  let joined: boolean;
  try {
    joined = await addMember(invite.guildId, userId);
  } catch (error) {
    await devolverUso(code);
    if ((error as { code?: string }).code === 'BANNED') {
      throw new ApiError('BANNED', 'Voce foi banido deste servidor.');
    }
    throw error;
  }

  // Entrou por outro caminho entre a conferencia e agora: o uso volta.
  if (!joined) {
    await devolverUso(code);
    return { ...resposta, joined: false };
  }

  const member = await prisma.guildMember.findUniqueOrThrow({
    where: { guildId_userId: { guildId: invite.guildId, userId } },
    include: MEMBER_INCLUDE,
  });

  // A sessao precisa passar a acompanhar o servidor antes do evento sair,
  // senao quem entrou nao recebe o proprio GUILD_MEMBER_ADD.
  subscribeUserToGuild(userId, invite.guildId);
  emitToGuild(invite.guildId, 'GUILD_MEMBER_ADD', toMember(member));

  logger.info({ guildId: invite.guildId, userId, code }, 'entrou pelo convite');
  return { ...resposta, joined: true };
}

/**
 * O convite no cadastro (senha ou Google).
 *
 * Cadastro fechado: o convite e o passe — obrigatorio e valido. Aberto (fatia
 * 7): opcional; se veio, a conta ja nasce dentro do servidor dele (quem chegou
 * pelo link nao precisa aceitar de novo). Um convite vencido no cadastro aberto
 * nao impede a conta: ela so nasce sem servidor.
 *
 * Devolve o codigo a aceitar depois que a conta existir, ou null.
 */
export async function conviteDoCadastro(codigo: string | undefined, aberto: boolean): Promise<string | null> {
  if (!codigo) {
    if (aberto) return null;
    throw new ApiError('REGISTRATION_CLOSED', 'Este servidor exige um codigo de convite para criar conta.');
  }
  const invite = await prisma.invite.findUnique({ where: { code: codigo } });
  if (!invite || isExpired(invite)) {
    if (aberto) return null;
    throw new ApiError('INVITE_INVALID', 'Convite invalido ou expirado.');
  }
  return codigo;
}

/** Aceita o convite do cadastro; falha vira log, a conta ja existe. Devolve o servidor, se entrou. */
export async function entrarPeloCadastro(codigo: string | null, userId: string): Promise<string | null> {
  if (!codigo) return null;
  try {
    const { guildId } = await acceptInvite(codigo, userId);
    return guildId;
  } catch (error) {
    logger.warn({ error, userId }, 'falha ao entrar no servidor do convite do cadastro');
    return null;
  }
}

async function devolverUso(code: string): Promise<void> {
  await prisma.invite
    .updateMany({ where: { code, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } })
    .catch(() => undefined);
}

export async function deleteInvite(code: string): Promise<void> {
  const deleted = await prisma.invite.deleteMany({ where: { code } });
  if (deleted.count === 0) throw notFound('Convite');
}

export async function listInvites(guildId: string): Promise<Invite[]> {
  const rows = await prisma.invite.findMany({
    where: { guildId },
    include: INVITE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toInvite);
}

/** Remove convites vencidos. Chamado por um job periodico. */
export async function pruneExpiredInvites(): Promise<number> {
  const { count } = await prisma.invite.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

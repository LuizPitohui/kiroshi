import {
  BITRATE,
  DEFAULT_EVERYONE_PERMISSIONS,
  generateId,
  type GuildWithState,
} from '@kiroshi/shared';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { buildGuildState } from './ready.js';
import { tirarDaVoz } from './voice.js';

/**
 * Criacao de servidor. Roda tudo em uma transacao: um servidor sem o cargo
 * everyone ou sem o dono como membro seria um estado quebrado que o resto do
 * sistema nao sabe tratar.
 *
 * O cargo everyone usa o mesmo id do servidor, como no Discord. Isso deixa a
 * resolucao de permissoes procurar por um id conhecido sem uma consulta extra.
 */
export async function createGuild(
  ownerId: string,
  input: { name: string; iconUrl?: string | null; withDefaultChannels?: boolean },
): Promise<GuildWithState> {
  const guildId = generateId();

  await prisma.$transaction(async (tx) => {
    await tx.guild.create({
      data: {
        id: guildId,
        name: input.name,
        iconUrl: input.iconUrl ?? null,
        ownerId,
      },
    });

    await tx.role.create({
      data: {
        id: guildId,
        guildId,
        name: 'everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        managed: true,
      },
    });

    await tx.guildMember.create({
      data: { guildId, userId: ownerId },
    });

    if (input.withDefaultChannels !== false) {
      const textCategoryId = generateId();
      const voiceCategoryId = generateId();
      const generalId = generateId();

      await tx.channel.createMany({
        data: [
          {
            id: textCategoryId,
            guildId,
            type: 'GUILD_CATEGORY',
            name: 'Canais de texto',
            position: 0,
          },
          {
            id: generalId,
            guildId,
            type: 'GUILD_TEXT',
            name: 'geral',
            parentId: textCategoryId,
            position: 0,
          },
          {
            id: voiceCategoryId,
            guildId,
            type: 'GUILD_CATEGORY',
            name: 'Canais de voz',
            position: 1,
          },
          {
            id: generateId(),
            guildId,
            type: 'GUILD_VOICE',
            name: 'Geral',
            parentId: voiceCategoryId,
            position: 0,
            bitrate: BITRATE.default,
            userLimit: 0,
          },
        ],
      });

      await tx.guild.update({
        where: { id: guildId },
        data: { systemChannelId: generalId },
      });
    }
  });

  logger.info({ guildId, ownerId, name: input.name }, 'servidor criado');
  return buildGuildState(guildId, ownerId);
}

/**
 * Adiciona um membro. Devolve false quando ja era membro, para o chamador
 * decidir se isso e erro ou apenas um convite reutilizado.
 */
export async function addMember(guildId: string, userId: string): Promise<boolean> {
  const existing = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { userId: true },
  });
  if (existing) return false;

  const banned = await prisma.guildBan.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { userId: true },
  });
  if (banned) {
    const error = new Error('banido');
    (error as Error & { code?: string }).code = 'BANNED';
    throw error;
  }

  await prisma.guildMember.create({ data: { guildId, userId } });
  return true;
}

/**
 * Remove o membro e limpa o que ficaria orfao: estado de voz, cargos e
 * preferencias daquele servidor.
 *
 * Expulsar, banir e sair passam por aqui, e as tres tiram a pessoa da voz de
 * verdade antes de tudo: avisando quem esta no canal e tirando da sala no
 * SFU. Antes a linha de voz sumia calada e a pessoa seguia na chamada.
 * Enquanto ainda e membro, para o aviso alcancar as sessoes dela.
 */
export async function removeMember(guildId: string, userId: string): Promise<void> {
  await tirarDaVoz(userId, { guildId });

  await prisma.$transaction(async (tx) => {
    await tx.voiceState.deleteMany({ where: { userId, guildId } });
    await tx.guildMember.deleteMany({ where: { guildId, userId } });
    await tx.userGuildSettings.deleteMany({ where: { guildId, userId } });
  });
}

/**
 * Transfere a posse. O dono nao pode simplesmente sair de um servidor sem
 * passar a posse, senao o servidor ficaria sem ninguem capaz de administrar.
 */
export async function transferOwnership(
  guildId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  // Erros de negocio com codigo: antes eram `Error` puro e chegavam como 500.
  await prisma.$transaction(async (tx) => {
    const guild = await tx.guild.findUnique({
      where: { id: guildId },
      select: { ownerId: true },
    });
    if (!guild) throw notFound('Servidor');
    if (guild.ownerId !== currentOwnerId) {
      throw forbidden('So o dono pode passar a posse do servidor.');
    }
    if (newOwnerId === currentOwnerId) throw badRequest('Voce ja e o dono deste servidor.');
    const member = await tx.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId: newOwnerId } },
      select: { userId: true },
    });
    if (!member) throw badRequest('O novo dono precisa ser membro do servidor.');

    await tx.guild.update({ where: { id: guildId }, data: { ownerId: newOwnerId } });
  });

  logger.info({ guildId, from: currentOwnerId, to: newOwnerId }, 'posse transferida');
}

/** Ids de todos os membros, usado para espalhar eventos. */
export async function memberIds(guildId: string): Promise<string[]> {
  const rows = await prisma.guildMember.findMany({
    where: { guildId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

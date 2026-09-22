/**
 * Popula o banco com um servidor de exemplo e algumas contas, para testar a
 * interface sem precisar cadastrar tudo a mao.
 *
 * Roda com: npm run db:seed -w @kiroshi/server
 * Nao roda em producao: exige KIROSHI_SEED=1 para evitar acidente.
 */

import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  BITRATE,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
  generateId,
} from '@kiroshi/shared';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.KIROSHI_SEED_PASSWORD ?? 'ordem123456';

const PEOPLE = [
  { username: 'pitohui', displayName: 'Pitohui' },
  { username: 'kaya', displayName: 'Kaya' },
  { username: 'rafa', displayName: 'Rafa' },
  { username: 'bruno', displayName: 'Bruno' },
  { username: 'lele', displayName: 'Lele' },
];

async function main(): Promise<void> {
  if (process.env.KIROSHI_SEED !== '1') {
    console.error('Defina KIROSHI_SEED=1 para confirmar que quer popular este banco.');
    process.exit(1);
  }

  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`O banco ja tem ${existing} usuarios. Nada a fazer.`);
    return;
  }

  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const users = [];
  for (const person of PEOPLE) {
    const user = await prisma.user.create({
      data: {
        id: generateId(),
        email: `${person.username}@order.local`,
        username: person.username,
        displayName: person.displayName,
        passwordHash,
      },
    });
    users.push(user);
    console.log(`  usuario ${user.username}`);
  }

  const owner = users[0]!;
  const guildId = generateId();

  await prisma.guild.create({
    data: {
      id: guildId,
      name: 'Arasaka',
      description: 'Servidor de testes do Order',
      ownerId: owner.id,
    },
  });

  await prisma.role.create({
    data: {
      id: guildId,
      guildId,
      name: 'everyone',
      position: 0,
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      managed: true,
    },
  });

  const adminRoleId = generateId();
  await prisma.role.create({
    data: {
      id: adminRoleId,
      guildId,
      name: 'Admin',
      color: '#e4572e',
      position: 10,
      permissions: ALL_PERMISSIONS,
      hoist: true,
      mentionable: true,
    },
  });

  const modRoleId = generateId();
  await prisma.role.create({
    data: {
      id: modRoleId,
      guildId,
      name: 'Moderacao',
      color: '#3f88c5',
      position: 5,
      permissions:
        DEFAULT_EVERYONE_PERMISSIONS |
        Permission.MANAGE_MESSAGES |
        Permission.KICK_MEMBERS |
        Permission.MUTE_MEMBERS |
        Permission.MOVE_MEMBERS |
        Permission.DEAFEN_MEMBERS,
      hoist: true,
      mentionable: true,
    },
  });

  for (const user of users) {
    await prisma.guildMember.create({ data: { guildId, userId: user.id } });
  }
  await prisma.memberRole.create({
    data: { guildId, userId: owner.id, roleId: adminRoleId },
  });
  if (users[1]) {
    await prisma.memberRole.create({
      data: { guildId, userId: users[1].id, roleId: modRoleId },
    });
  }

  const textCategoryId = generateId();
  const voiceCategoryId = generateId();
  const generalId = generateId();

  await prisma.channel.createMany({
    data: [
      { id: textCategoryId, guildId, type: 'GUILD_CATEGORY', name: 'Canais de texto', position: 0 },
      { id: generalId, guildId, type: 'GUILD_TEXT', name: 'geral', parentId: textCategoryId, position: 0, topic: 'Conversa solta' },
      { id: generateId(), guildId, type: 'GUILD_TEXT', name: 'jogos', parentId: textCategoryId, position: 1 },
      { id: generateId(), guildId, type: 'GUILD_ANNOUNCEMENT', name: 'avisos', parentId: textCategoryId, position: 2 },
      { id: voiceCategoryId, guildId, type: 'GUILD_CATEGORY', name: 'Canais de voz', position: 1 },
      { id: generateId(), guildId, type: 'GUILD_VOICE', name: 'Geral', parentId: voiceCategoryId, position: 0, bitrate: BITRATE.default, userLimit: 0 },
      { id: generateId(), guildId, type: 'GUILD_VOICE', name: 'Jogatina', parentId: voiceCategoryId, position: 1, bitrate: BITRATE.max, userLimit: 10 },
      { id: generateId(), guildId, type: 'GUILD_VOICE', name: 'AFK', parentId: voiceCategoryId, position: 2, bitrate: BITRATE.min, userLimit: 0 },
    ],
  });

  await prisma.guild.update({
    where: { id: guildId },
    data: { systemChannelId: generalId },
  });

  const greetings = [
    'primeiro!',
    'testando o canal',
    'alguem na call?',
    'boa, funcionou',
    'https://github.com veja isso',
  ];
  for (let i = 0; i < greetings.length; i++) {
    const author = users[i % users.length]!;
    await prisma.message.create({
      data: {
        id: generateId(),
        channelId: generalId,
        guildId,
        authorId: author.id,
        content: greetings[i]!,
      },
    });
  }

  await prisma.relationship.create({
    data: {
      id: generateId(),
      requesterId: owner.id,
      addresseeId: users[1]!.id,
      status: 'ACCEPTED',
    },
  });

  console.log('');
  console.log('Servidor "Arasaka" criado com 3 canais de texto e 3 de voz.');
  console.log(`Contas: ${PEOPLE.map((p) => p.username).join(', ')}`);
  console.log(`Senha de todas: ${SEED_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

/**
 * Zera o banco de desenvolvimento antes de um teste ponta a ponta.
 * Exige KIROSHI_ALLOW_RESET=1 para nao apagar nada por acidente.
 */
import { PrismaClient } from '@prisma/client';

if (process.env.KIROSHI_ALLOW_RESET !== '1') {
  console.error('Defina KIROSHI_ALLOW_RESET=1 para confirmar que quer apagar este banco.');
  process.exit(1);
}

const prisma = new PrismaClient();

// A ordem importa: filhos antes dos pais, porque nem toda FK tem cascade.
const tables = [
  'Reaction',
  'Attachment',
  'Message',
  'PermissionOverwrite',
  'ChannelRecipient',
  'VoiceState',
  'ReadState',
  'UserChannelSettings',
  'UserGuildSettings',
  'Invite',
  'MemberRole',
  'GuildMember',
  'GuildBan',
  'SoundboardSound',
  'Sticker',
  'Emoji',
  'AuditLogEntry',
  'Channel',
  'Role',
  'Guild',
  'Relationship',
  'Session',
  'User',
];

for (const table of tables) {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
}

console.log(`${tables.length} tabelas limpas.`);
await prisma.$disconnect();

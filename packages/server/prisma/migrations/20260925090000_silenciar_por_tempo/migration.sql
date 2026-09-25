-- Silenciar por um tempo (15 min, 1 h, 8 h, 24 h): ate quando o silencio de
-- um servidor ou canal vale. Nulo com "muted" ligado e silencio sem prazo,
-- como sempre foi; nada que existe muda.

-- AlterTable
ALTER TABLE "UserGuildSettings" ADD COLUMN "mutedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserChannelSettings" ADD COLUMN "mutedUntil" TIMESTAMP(3);

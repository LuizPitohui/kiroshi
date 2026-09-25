-- Chamadas em conversa direta.
--
-- O registro da chamada (quem participou e quando acabou) vai na propria
-- mensagem de sistema que a anuncia, do tipo CALL, que ja existia no enum.
-- Nulo em toda mensagem que nao e chamada; nada que existe muda.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "call" JSONB;

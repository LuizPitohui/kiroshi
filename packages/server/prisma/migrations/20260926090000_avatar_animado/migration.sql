-- Foto de perfil em GIF: a versao animada fica numa coluna propria, e a
-- avatarUrl passa a ser sempre parada (o primeiro quadro). O app troca para a
-- animada enquanto a pessoa fala; versoes antigas do app so conhecem a
-- avatarUrl e seguem mostrando a foto parada. Nada que existe muda.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarAnimatedUrl" TEXT;

import type { FastifyInstance } from 'fastify';
import { INVITE_CODE_PATTERN, Permission } from '@kiroshi/shared';
import { prisma } from '../db.js';
import { ApiError, badRequest } from '../errors.js';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { emitToUser, subscribeUserToGuild } from '../gateway/events.js';
import { acceptInvite, deleteInvite, previewInvite } from '../services/invites.js';
import { assertGuildPermissions } from '../services/permissions.js';
import { recordAudit } from '../services/audit.js';
import { buildGuildState } from '../services/ready.js';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Pre-visualizacao aberta: quem recebeu o link precisa ver o servidor antes
   * de ter conta. Com token, tambem informamos se a pessoa ja e membro.
   */
  app.get('/invites/:code', { preHandler: optionalAuth }, async (request) => {
    const { code } = request.params as { code: string };
    if (!INVITE_CODE_PATTERN.test(code)) throw badRequest('Codigo de convite invalido.');

    return previewInvite(code, request.auth?.userId ?? null);
  });

  app.post('/invites/:code', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { code } = request.params as { code: string };
    if (!INVITE_CODE_PATTERN.test(code)) throw badRequest('Codigo de convite invalido.');

    const { guildId, channelId, joined } = await acceptInvite(code, userId);

    // O GUILD_CREATE entrega o estado completo para a interface montar tudo.
    const state = await buildGuildState(guildId, userId);
    subscribeUserToGuild(userId, guildId);
    emitToUser(userId, 'GUILD_CREATE', state);

    // O canal de onde o convite saiu, para o app abrir nele — se a pessoa o ve.
    const canal = channelId && state.channels.some((c) => c.id === channelId) ? channelId : null;
    return { guild: state, joined, channelId: canal };
  });

  app.delete('/invites/:code', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { code } = request.params as { code: string };

    const invite = await prisma.invite.findUnique({
      where: { code },
      select: { guildId: true, inviterId: true },
    });
    if (!invite) throw new ApiError('INVITE_INVALID', 'Convite nao encontrado.');

    // Quem criou pode revogar o proprio link sem precisar de MANAGE_GUILD.
    if (invite.inviterId !== userId) {
      await assertGuildPermissions(invite.guildId, userId, Permission.MANAGE_GUILD);
    }

    await deleteInvite(code);
    await recordAudit(invite.guildId, userId, 'INVITE_DELETE', null, { code });
    return { ok: true };
  });
}

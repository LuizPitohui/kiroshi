import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { CHANNEL_INCLUDE, toChannel } from '../lib/serialize.js';
import { canaisComPermissao, type RetratoDaGuild } from '../lib/visibilidade.js';
import { emitToGuild } from '../gateway/events.js';
import { carregarRetratoDaGuild } from './permissions.js';
import { tirarDaVoz } from './voice.js';

/**
 * Depois de uma mudanca de cargo, quem passou a ver um canal e quem deixou.
 *
 * Um cargo decide canal privado de dois jeitos: pela permissao dele no
 * servidor (VIEW_CHANNEL) e pelas sobrescritas que citam ele. Dar ou tirar
 * um cargo, mudar as permissoes dele ou apaga-lo pode, entao, abrir ou fechar
 * canais para alguem — e antes ninguem avisava: o canal novo so aparecia
 * depois de reconectar, e o que se perdeu ficava na tela, mudo.
 *
 * Quem passou a ver recebe CHANNEL_UPDATE (o app trata como "crie se nao
 * tiver"); quem deixou de ver recebe CHANNEL_DELETE e, se estava na voz
 * daquele canal, sai dela — seguir numa chamada que nao se enxerga e o que o
 * Discord tambem nao deixa.
 *
 * `soDe` limita a conta a algumas pessoas (dar cargo a uma so). Nao lanca: a
 * mudanca ja foi gravada, e um aviso que falhou vira log.
 */
export async function avisarMudancaDeAcesso(
  guildId: string,
  antes: RetratoDaGuild | null,
  soDe?: readonly string[],
): Promise<void> {
  if (!antes) return;
  try {
    const depois = await carregarRetratoDaGuild(guildId);
    if (!depois) return;

    const quem = soDe ?? depois.members.map((m) => m.userId);
    const ganharam = new Map<string, Set<string>>();
    const perderam = new Map<string, Set<string>>();
    const anotar = (mapa: Map<string, Set<string>>, canal: string, userId: string) => {
      const pessoas = mapa.get(canal) ?? new Set<string>();
      pessoas.add(userId);
      mapa.set(canal, pessoas);
    };

    for (const userId of quem) {
      const viam = canaisComPermissao(antes, userId);
      const veem = canaisComPermissao(depois, userId);
      for (const canal of veem) if (!viam.has(canal)) anotar(ganharam, canal, userId);
      for (const canal of viam) if (!veem.has(canal)) anotar(perderam, canal, userId);
    }
    if (ganharam.size === 0 && perderam.size === 0) return;

    const canais = await prisma.channel.findMany({
      where: { id: { in: [...new Set([...ganharam.keys(), ...perderam.keys()])] }, guildId },
      include: CHANNEL_INCLUDE,
    });
    for (const canal of canais) {
      const serializado = toChannel(canal);
      const novos = ganharam.get(canal.id);
      if (novos) emitToGuild(guildId, 'CHANNEL_UPDATE', serializado, { onlyUserIds: novos });
      const fora = perderam.get(canal.id);
      if (!fora) continue;
      emitToGuild(guildId, 'CHANNEL_DELETE', serializado, { onlyUserIds: fora });
      if (canal.type === 'GUILD_VOICE') {
        for (const userId of fora) await tirarDaVoz(userId, { channelId: canal.id });
      }
    }
  } catch (error) {
    logger.error({ error, guildId }, 'nao consegui avisar quem ganhou ou perdeu canais');
  }
}

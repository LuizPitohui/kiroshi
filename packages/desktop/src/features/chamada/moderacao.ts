import { api } from '../../api/client.js';
import { avisar } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';

/*
  Moderacao de voz: silenciar, ensurdecer, mover e desconectar. Tudo passa pelo
  servidor (PATCH do membro), que confere a permissao, grava e aplica no SFU.
  A 1.x so tinha "desconectar"; mover existia so na API e ensurdecer nem isso.
*/

async function mudarMembro(guildId: string, userId: string, corpo: Record<string, unknown>, falha: string): Promise<boolean> {
  try {
    await api.patch(`/guilds/${guildId}/members/${userId}`, corpo);
    return true;
  } catch (erro) {
    avisar.erro(falha, motivo(erro, 'Tente de novo.'));
    return false;
  }
}

export function silenciarNoServidor(guildId: string, userId: string, sim: boolean): Promise<boolean> {
  return mudarMembro(guildId, userId, { serverMuted: sim }, sim ? 'Não consegui silenciar' : 'Não consegui tirar o silêncio');
}

export function ensurdecerNoServidor(guildId: string, userId: string, sim: boolean): Promise<boolean> {
  return mudarMembro(guildId, userId, { serverDeafened: sim }, sim ? 'Não consegui ensurdecer' : 'Não consegui devolver o som');
}

/** Para outro canal de voz; `null` desconecta. */
export function moverPara(guildId: string, userId: string, canalId: string | null): Promise<boolean> {
  return mudarMembro(guildId, userId, { voiceChannelId: canalId }, canalId ? 'Não consegui mover' : 'Não consegui desconectar');
}

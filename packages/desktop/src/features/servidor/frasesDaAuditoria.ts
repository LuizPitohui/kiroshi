import { deserialize, toNames, type AuditLogEntry } from '@kiroshi/shared';
import { rotuloDaPermissao } from './permissoes.js';

/**
 * O registro de auditoria em frases: "Kaya deu o cargo ADM a Rafa".
 *
 * O servidor guarda a acao e um JSON do que mudou; a tela precisa de gente
 * lendo. Os nomes vem do que o app conhece agora (cargo, canal, pessoa) e,
 * na falta, do que a propria entrada guardou — um cargo apagado ainda tem o
 * nome em `changes.name`.
 */

export type GrupoDeAcao = 'servidor' | 'pessoas' | 'cargos' | 'voz' | 'convites' | 'canais' | 'expressoes';

export const ACOES: Record<string, { rotulo: string; grupo: GrupoDeAcao }> = {
  GUILD_UPDATE: { rotulo: 'Mudou o servidor', grupo: 'servidor' },
  OWNERSHIP_TRANSFER: { rotulo: 'Passou a posse', grupo: 'servidor' },
  MEMBER_UPDATE: { rotulo: 'Mudou apelido ou cargos', grupo: 'pessoas' },
  MEMBER_ROLE_UPDATE: { rotulo: 'Deu ou tirou cargo', grupo: 'pessoas' },
  MEMBER_KICK: { rotulo: 'Expulsou', grupo: 'pessoas' },
  MEMBER_BAN: { rotulo: 'Baniu', grupo: 'pessoas' },
  MEMBER_UNBAN: { rotulo: 'Tirou banimento', grupo: 'pessoas' },
  MEMBER_MUTE: { rotulo: 'Silenciou', grupo: 'voz' },
  MEMBER_UNMUTE: { rotulo: 'Tirou o silêncio', grupo: 'voz' },
  MEMBER_DEAFEN: { rotulo: 'Ensurdeceu', grupo: 'voz' },
  MEMBER_UNDEAFEN: { rotulo: 'Devolveu o som', grupo: 'voz' },
  MEMBER_MOVE: { rotulo: 'Moveu de canal', grupo: 'voz' },
  MEMBER_DISCONNECT: { rotulo: 'Desconectou da voz', grupo: 'voz' },
  ROLE_CREATE: { rotulo: 'Criou cargo', grupo: 'cargos' },
  ROLE_UPDATE: { rotulo: 'Mudou cargo', grupo: 'cargos' },
  ROLE_DELETE: { rotulo: 'Apagou cargo', grupo: 'cargos' },
  ROLE_REORDER: { rotulo: 'Reordenou cargos', grupo: 'cargos' },
  INVITE_CREATE: { rotulo: 'Criou convite', grupo: 'convites' },
  INVITE_DELETE: { rotulo: 'Revogou convite', grupo: 'convites' },
  CHANNEL_CREATE: { rotulo: 'Criou canal', grupo: 'canais' },
  CHANNEL_UPDATE: { rotulo: 'Mudou canal', grupo: 'canais' },
  CHANNEL_DELETE: { rotulo: 'Apagou canal', grupo: 'canais' },
  CHANNEL_REORDER: { rotulo: 'Reorganizou canais', grupo: 'canais' },
  CHANNEL_OVERWRITE_UPDATE: { rotulo: 'Mudou permissões de canal', grupo: 'canais' },
  CHANNEL_OVERWRITE_DELETE: { rotulo: 'Tirou permissões de canal', grupo: 'canais' },
  CHANNEL_OVERWRITE_SYNC: { rotulo: 'Sincronizou canal com a categoria', grupo: 'canais' },
  EMOJI_CREATE: { rotulo: 'Enviou emoji', grupo: 'expressoes' },
  EMOJI_UPDATE: { rotulo: 'Renomeou emoji', grupo: 'expressoes' },
  EMOJI_DELETE: { rotulo: 'Apagou emoji', grupo: 'expressoes' },
  SOUND_CREATE: { rotulo: 'Enviou som', grupo: 'expressoes' },
  SOUND_UPDATE: { rotulo: 'Mudou som', grupo: 'expressoes' },
  SOUND_DELETE: { rotulo: 'Apagou som', grupo: 'expressoes' },
};

export const NOMES_DOS_GRUPOS: Record<GrupoDeAcao, string> = {
  servidor: 'Servidor',
  pessoas: 'Pessoas',
  cargos: 'Cargos',
  voz: 'Voz',
  convites: 'Convites',
  canais: 'Canais',
  expressoes: 'Emojis e sons',
};

export interface Nomes {
  pessoa: (id: string) => string | null;
  cargo: (id: string) => string | null;
  canal: (id: string) => string | null;
}

export interface Frase {
  /** O que foi feito, ja com o alvo: "deu o cargo ADM a Rafa". */
  texto: string;
  /** Linhas de detalhe: o que mudou, o motivo. */
  detalhes: string[];
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function duracao(segundos: number): string {
  if (!segundos) return 'sem validade';
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  if (segundos < 86_400) return `${Math.round(segundos / 3600)} h`;
  const dias = Math.round(segundos / 86_400);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

export function descrever(e: AuditLogEntry, nomes: Nomes): Frase {
  const c = e.changes ?? {};
  const alvoPessoa = (e.targetId && (nomes.pessoa(e.targetId) ?? e.targetUser?.displayName)) || 'alguém';
  // Nomes entre aspas: "criou o cargo novo cargo" nao se le; "criou o cargo “novo cargo”" sim.
  const aspas = (nome: string) => `“${nome}”`;
  /** O cargo pelo nome de agora; apagado, pelo nome que a entrada guardou; sem nada, null. */
  const cargoConhecido = (id: string | null | undefined, guardado?: string | null) => {
    const nome = (id ? nomes.cargo(id) : null) ?? guardado ?? null;
    return nome ? aspas(nome) : null;
  };
  const oCargo = (id: string | null | undefined) => {
    const nome = cargoConhecido(id, texto(c.name));
    return nome ? `o cargo ${nome}` : 'um cargo que já foi apagado';
  };
  const nomeDoCanal = (id: string | null | undefined) => {
    const nome = (id ? nomes.canal(id) : null) ?? texto(c.name);
    return nome ? aspas(nome) : 'um canal que já foi apagado';
  };
  const detalhes: string[] = [];
  const motivo = texto(e.reason) ?? texto(c.reason);
  if (motivo) detalhes.push(`Motivo: ${motivo}`);

  switch (e.action) {
    case 'GUILD_UPDATE': {
      if ('name' in c) detalhes.push(`Nome: ${texto(c.name) ?? '—'}`);
      if ('description' in c) detalhes.push(texto(c.description) ? `Descrição: ${texto(c.description)}` : 'Tirou a descrição');
      if ('iconUrl' in c) detalhes.push(c.iconUrl ? 'Trocou o ícone' : 'Tirou o ícone');
      if ('bannerUrl' in c) detalhes.push(c.bannerUrl ? 'Trocou o banner' : 'Tirou o banner');
      return { texto: 'mudou o servidor', detalhes };
    }
    case 'OWNERSHIP_TRANSFER':
      return { texto: `passou a posse do servidor para ${alvoPessoa}`, detalhes };
    case 'MEMBER_UPDATE': {
      if ('nickname' in c) {
        const apelido = texto(c.nickname);
        return { texto: apelido ? `mudou o apelido de ${alvoPessoa} para “${apelido}”` : `tirou o apelido de ${alvoPessoa}`, detalhes };
      }
      const cargos = lista(c.roleIds).map((id) => nomes.cargo(id) ?? 'cargo apagado');
      if (cargos.length) detalhes.push(`Cargos: ${cargos.join(', ')}`);
      return { texto: `mudou os cargos de ${alvoPessoa}`, detalhes };
    }
    case 'MEMBER_ROLE_UPDATE': {
      const dados = lista(c.added);
      const tirados = lista(c.removed);
      const ids = dados.length ? dados : tirados;
      const conhecidos = ids.map((id) => cargoConhecido(id)).filter((n): n is string => Boolean(n));
      const quais = conhecidos.length === ids.length && ids.length > 0 ? `o cargo ${conhecidos.join(', ')}` : 'um cargo que já foi apagado';
      return { texto: dados.length ? `deu ${quais} a ${alvoPessoa}` : `tirou ${quais} de ${alvoPessoa}`, detalhes };
    }
    case 'MEMBER_KICK':
      return { texto: `expulsou ${alvoPessoa}`, detalhes };
    case 'MEMBER_BAN':
      return { texto: `baniu ${alvoPessoa}`, detalhes };
    case 'MEMBER_UNBAN':
      return { texto: `tirou o banimento de ${alvoPessoa}`, detalhes };
    case 'MEMBER_MUTE':
      return { texto: `silenciou ${alvoPessoa} na voz`, detalhes };
    case 'MEMBER_UNMUTE':
      return { texto: `tirou o silêncio de ${alvoPessoa}`, detalhes };
    case 'MEMBER_DEAFEN':
      return { texto: `ensurdeceu ${alvoPessoa}`, detalhes };
    case 'MEMBER_UNDEAFEN':
      return { texto: `devolveu o som a ${alvoPessoa}`, detalhes };
    case 'MEMBER_MOVE':
      return { texto: `moveu ${alvoPessoa} para ${nomeDoCanal(texto(c.channelId))}`, detalhes };
    case 'MEMBER_DISCONNECT':
      return { texto: `desconectou ${alvoPessoa} da voz`, detalhes };
    case 'ROLE_CREATE':
      return { texto: `criou ${oCargo(e.targetId)}`, detalhes };
    case 'ROLE_UPDATE': {
      if ('name' in c) detalhes.push(`Nome: ${texto(c.name) ?? '—'}`);
      if ('color' in c) detalhes.push(c.color ? `Cor: ${String(c.color)}` : 'Tirou a cor');
      if ('permissions' in c) {
        const bits = toNames(deserialize(texto(c.permissions)));
        detalhes.push(bits.length ? `Permissões: ${bits.map(rotuloDaPermissao).join(', ')}` : 'Sem nenhuma permissão');
      }
      if ('hoist' in c) detalhes.push(c.hoist ? 'Passou a aparecer separado na lista' : 'Deixou de aparecer separado');
      if ('mentionable' in c) detalhes.push(c.mentionable ? 'Pode ser mencionado' : 'Não pode mais ser mencionado');
      return { texto: `mudou ${cargoConhecido(e.targetId) ? `o cargo ${cargoConhecido(e.targetId)}` : 'um cargo que já foi apagado'}`, detalhes };
    }
    case 'ROLE_DELETE':
      return { texto: `apagou o cargo ${aspas(texto(c.name) ?? 'sem nome')}`, detalhes };
    case 'ROLE_REORDER':
      return { texto: 'reordenou os cargos', detalhes };
    case 'INVITE_CREATE': {
      const codigo = texto(c.code);
      const usos = typeof c.maxUses === 'number' && c.maxUses > 0 ? `${c.maxUses} ${c.maxUses === 1 ? 'uso' : 'usos'}` : 'usos sem limite';
      const validade = typeof c.maxAgeSecs === 'number' ? duracao(c.maxAgeSecs) : null;
      detalhes.push([validade, usos].filter(Boolean).join(' · '));
      return { texto: codigo ? `criou o convite ${codigo}` : 'criou um convite', detalhes };
    }
    case 'INVITE_DELETE':
      return { texto: `revogou o convite ${texto(c.code) ?? ''}`.trim(), detalhes };
    case 'CHANNEL_CREATE':
      return { texto: `criou o canal ${nomeDoCanal(e.targetId)}`, detalhes };
    case 'CHANNEL_UPDATE': {
      if ('name' in c) detalhes.push(`Nome: ${texto(c.name) ?? '—'}`);
      if ('topic' in c) detalhes.push(texto(c.topic) ? `Tópico: ${texto(c.topic)}` : 'Tirou o tópico');
      if ('parentId' in c) detalhes.push(c.parentId ? `Categoria: ${nomeDoCanal(texto(c.parentId))}` : 'Saiu da categoria');
      if ('userLimit' in c) detalhes.push(c.userLimit ? `Limite: ${String(c.userLimit)} pessoas` : 'Sem limite de pessoas');
      const atual = e.targetId ? nomes.canal(e.targetId) : null;
      return { texto: atual ? `mudou o canal ${aspas(atual)}` : 'mudou um canal que já foi apagado', detalhes };
    }
    case 'CHANNEL_DELETE':
      return { texto: `apagou o canal ${aspas(texto(c.name) ?? 'sem nome')}`, detalhes };
    case 'CHANNEL_REORDER':
      return { texto: 'reorganizou os canais', detalhes };
    case 'CHANNEL_OVERWRITE_UPDATE':
    case 'CHANNEL_OVERWRITE_DELETE': {
      const alvo = texto(c.targetId);
      const cargo = alvo ? nomes.cargo(alvo) : null;
      const quem = cargo ? (cargo.startsWith('@') ? cargo : aspas(cargo)) : ((alvo && nomes.pessoa(alvo)) ?? 'um cargo que já foi apagado');
      const verbo = e.action === 'CHANNEL_OVERWRITE_UPDATE' ? 'mudou as permissões de' : 'tirou as permissões de';
      return { texto: `${verbo} ${quem} em ${nomeDoCanal(e.targetId)}`, detalhes };
    }
    case 'CHANNEL_OVERWRITE_SYNC':
      return { texto: `sincronizou ${nomeDoCanal(e.targetId)} com a categoria`, detalhes };
    case 'EMOJI_CREATE':
      return { texto: `enviou o emoji :${texto(c.name) ?? '?'}:`, detalhes };
    case 'EMOJI_UPDATE':
      return { texto: `renomeou um emoji para :${texto(c.name) ?? '?'}:`, detalhes };
    case 'EMOJI_DELETE':
      return { texto: `apagou o emoji :${texto(c.name) ?? '?'}:`, detalhes };
    case 'SOUND_CREATE':
      return { texto: `enviou o som ${texto(c.name) ?? ''}`.trim(), detalhes };
    case 'SOUND_UPDATE':
      return { texto: 'mudou um som', detalhes: [...detalhes, ...(texto(c.name) ? [`Nome: ${texto(c.name)}`] : [])] };
    case 'SOUND_DELETE':
      return { texto: `apagou o som ${texto(c.name) ?? ''}`.trim(), detalhes };
    default:
      return { texto: (ACOES[e.action]?.rotulo ?? e.action).toLowerCase(), detalhes };
  }
}

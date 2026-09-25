import { Permission, type PermissionName } from '@kiroshi/shared';

/**
 * As permissoes como a tela mostra: grupos, nome e o que cada uma faz.
 *
 * So entram as que o servidor confere. USE_VAD, PRIORITY_SPEAKER e
 * MANAGE_WEBHOOKS existem no bitfield e nao fazem nada (03-servidor.md) —
 * mostrar um interruptor que nao muda nada e o que a interface nova prometeu
 * nao fazer.
 *
 * `noCanal` marca as que o servidor le DENTRO de um canal (a conta com as
 * sobrescritas). As outras valem so no servidor inteiro: silenciar, mover e
 * criar convite, por exemplo, sao conferidas sem olhar o canal, e uma
 * sobrescrita delas seria enfeite.
 */

export interface DescricaoDePermissao {
  nome: PermissionName;
  rotulo: string;
  descricao: string;
  noCanal?: 'texto' | 'voz' | 'todos';
}

export interface GrupoDePermissoes {
  nome: string;
  permissoes: DescricaoDePermissao[];
}

export const GRUPOS_DE_PERMISSOES: GrupoDePermissoes[] = [
  {
    nome: 'Geral',
    permissoes: [
      { nome: 'VIEW_CHANNEL', rotulo: 'Ver canais', descricao: 'Sem isto o canal nem aparece.', noCanal: 'todos' },
      { nome: 'MANAGE_CHANNELS', rotulo: 'Gerenciar canais', descricao: 'Criar, renomear, reordenar e apagar canais.' },
      { nome: 'MANAGE_ROLES', rotulo: 'Gerenciar cargos', descricao: 'Criar e editar cargos abaixo do seu, dar e tirar cargos, e mexer nas permissões dos canais.' },
      { nome: 'MANAGE_GUILD', rotulo: 'Gerenciar servidor', descricao: 'Nome, ícone, descrição e a lista de convites.' },
      { nome: 'VIEW_AUDIT_LOG', rotulo: 'Ver o registro de auditoria', descricao: 'Quem fez o quê nos ajustes, nos cargos e na moderação.' },
      { nome: 'MANAGE_EMOJIS', rotulo: 'Gerenciar emojis', descricao: 'Enviar, renomear e apagar os emojis do servidor.' },
      { nome: 'MANAGE_SOUNDBOARD', rotulo: 'Gerenciar o soundboard', descricao: 'Enviar, editar e apagar sons.' },
    ],
  },
  {
    nome: 'Membros',
    permissoes: [
      { nome: 'CREATE_INVITE', rotulo: 'Criar convite', descricao: 'Gerar links para trazer gente nova.' },
      { nome: 'CHANGE_NICKNAME', rotulo: 'Mudar o próprio apelido', descricao: 'O nome que a pessoa usa neste servidor.' },
      { nome: 'MANAGE_NICKNAMES', rotulo: 'Gerenciar apelidos', descricao: 'Mudar o apelido de quem está abaixo na hierarquia.' },
      { nome: 'KICK_MEMBERS', rotulo: 'Expulsar membros', descricao: 'A pessoa sai e pode voltar com um convite.' },
      { nome: 'BAN_MEMBERS', rotulo: 'Banir membros', descricao: 'A pessoa sai e não volta nem com convite.' },
    ],
  },
  {
    nome: 'Texto',
    permissoes: [
      { nome: 'SEND_MESSAGES', rotulo: 'Enviar mensagens', descricao: '', noCanal: 'todos' },
      { nome: 'READ_MESSAGE_HISTORY', rotulo: 'Ler o histórico', descricao: 'Sem isto só se vê o que chega depois de abrir o canal.', noCanal: 'todos' },
      { nome: 'EMBED_LINKS', rotulo: 'Cartões de link', descricao: 'Links viram cartão com título e imagem.', noCanal: 'todos' },
      { nome: 'ATTACH_FILES', rotulo: 'Anexar arquivos', descricao: '', noCanal: 'todos' },
      { nome: 'ADD_REACTIONS', rotulo: 'Reagir', descricao: '', noCanal: 'todos' },
      { nome: 'USE_EXTERNAL_EMOJIS', rotulo: 'Emojis de outros servidores', descricao: 'Nas reações.', noCanal: 'todos' },
      { nome: 'MENTION_EVERYONE', rotulo: 'Mencionar @everyone e @here', descricao: '', noCanal: 'todos' },
      { nome: 'MANAGE_MESSAGES', rotulo: 'Gerenciar mensagens', descricao: 'Apagar mensagens dos outros e fixar.', noCanal: 'todos' },
    ],
  },
  {
    nome: 'Voz',
    permissoes: [
      { nome: 'CONNECT', rotulo: 'Entrar em canais de voz', descricao: '', noCanal: 'voz' },
      { nome: 'SPEAK', rotulo: 'Falar', descricao: 'Sem isto a pessoa entra só para ouvir.', noCanal: 'voz' },
      { nome: 'STREAM', rotulo: 'Câmera e tela', descricao: '', noCanal: 'voz' },
      { nome: 'USE_SOUNDBOARD', rotulo: 'Tocar sons do soundboard', descricao: '', noCanal: 'voz' },
      { nome: 'MUTE_MEMBERS', rotulo: 'Silenciar membros', descricao: 'Tira o microfone de alguém para todos.' },
      { nome: 'DEAFEN_MEMBERS', rotulo: 'Ensurdecer membros', descricao: 'A pessoa para de ouvir a chamada.' },
      { nome: 'MOVE_MEMBERS', rotulo: 'Mover membros', descricao: 'Levar alguém para outro canal de voz, ou desconectar.' },
    ],
  },
  {
    nome: 'Avançado',
    permissoes: [
      {
        nome: 'ADMINISTRATOR',
        rotulo: 'Administrador',
        descricao: 'Tudo, em todo canal, sem exceção. Ainda assim só age sobre quem está abaixo na hierarquia.',
      },
    ],
  },
];

export const TODAS_AS_VISIVEIS: DescricaoDePermissao[] = GRUPOS_DE_PERMISSOES.flatMap((g) => g.permissoes);

/** O nome em portugues de uma permissao, para mensagens (ex.: a auditoria). */
export function rotuloDaPermissao(nome: string): string {
  return TODAS_AS_VISIVEIS.find((p) => p.nome === nome)?.rotulo ?? nome;
}

export type TipoDeCanal = 'GUILD_TEXT' | 'GUILD_ANNOUNCEMENT' | 'GUILD_VOICE' | 'GUILD_CATEGORY';

/** Os grupos que valem nas permissoes de um canal daquele tipo. */
export function gruposDoCanal(tipo: TipoDeCanal): GrupoDePermissoes[] {
  return GRUPOS_DE_PERMISSOES.map((g) => ({
    nome: g.nome,
    permissoes: g.permissoes.filter((p) => {
      if (!p.noCanal) return false;
      if (tipo === 'GUILD_CATEGORY' || p.noCanal === 'todos') return true;
      return p.noCanal === (tipo === 'GUILD_VOICE' ? 'voz' : 'texto');
    }),
  })).filter((g) => g.permissoes.length > 0);
}

export const bitDe = (nome: PermissionName): bigint => Permission[nome];

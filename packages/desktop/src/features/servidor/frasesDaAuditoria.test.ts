import { describe, expect, it } from 'vitest';
import { Permission, type AuditLogEntry } from '@kiroshi/shared';
import { descrever, type Nomes } from './frasesDaAuditoria.js';

const pessoa = { id: 'p1', username: 'rafa', displayName: 'Rafa', avatarUrl: null, bannerUrl: null, bio: null, pronouns: null, accentColor: null, bot: false, createdAt: '' };

function entrada(action: string, changes: Record<string, unknown> = {}, targetId: string | null = 'p1'): AuditLogEntry {
  return { id: '1', action, actor: { ...pessoa, id: 'a', displayName: 'Kaya' }, targetId, targetUser: pessoa, changes, reason: null, createdAt: '' };
}

const nomes: Nomes = {
  pessoa: (id) => (id === 'p1' ? 'Rafa' : null),
  cargo: (id) => (id === 'adm' ? 'ADM' : null),
  canal: (id) => (id === 'c1' ? 'Geral' : null),
};

describe('frases da auditoria', () => {
  it('dar e tirar cargo', () => {
    expect(descrever(entrada('MEMBER_ROLE_UPDATE', { added: ['adm'] }), nomes).texto).toBe('deu o cargo “ADM” a Rafa');
    expect(descrever(entrada('MEMBER_ROLE_UPDATE', { removed: ['adm'] }), nomes).texto).toBe('tirou o cargo “ADM” de Rafa');
  });

  it('pessoa que ja saiu aparece pelo nome que a entrada trouxe', () => {
    const semNome: Nomes = { ...nomes, pessoa: () => null };
    expect(descrever(entrada('MEMBER_BAN', { reason: 'spam' }), semNome)).toEqual({ texto: 'baniu Rafa', detalhes: ['Motivo: spam'] });
  });

  it('cargo apagado usa o nome guardado', () => {
    expect(descrever(entrada('ROLE_DELETE', { name: 'VIP' }, 'r9'), nomes).texto).toBe('apagou o cargo “VIP”');
  });

  it('permissoes do cargo em portugues', () => {
    const f = descrever(entrada('ROLE_UPDATE', { permissions: String(Permission.KICK_MEMBERS | Permission.SPEAK) }, 'adm'), nomes);
    expect(f.texto).toBe('mudou o cargo “ADM”');
    expect(f.detalhes).toEqual(['Permissões: Expulsar membros, Falar']);
  });

  it('mover diz para onde', () => {
    expect(descrever(entrada('MEMBER_MOVE', { channelId: 'c1' }), nomes).texto).toBe('moveu Rafa para “Geral”');
  });

  it('convite com validade e usos', () => {
    const f = descrever(entrada('INVITE_CREATE', { code: 'abc123', maxAgeSecs: 86_400, maxUses: 1 }, null), nomes);
    expect(f).toEqual({ texto: 'criou o convite abc123', detalhes: ['1 dia · 1 uso'] });
  });

  it('cargo que ja foi apagado vira frase propria, e nao "o cargo um cargo apagado"', () => {
    expect(descrever(entrada('MEMBER_ROLE_UPDATE', { added: ['r9'] }), nomes).texto).toBe('deu um cargo que já foi apagado a Rafa');
    expect(descrever(entrada('ROLE_UPDATE', { color: '#fff' }, 'r9'), nomes).texto).toBe('mudou um cargo que já foi apagado');
    expect(descrever(entrada('ROLE_CREATE', { name: 'novo cargo' }, 'r9'), nomes).texto).toBe('criou o cargo “novo cargo”');
  });

  it('acao desconhecida nao quebra a tela', () => {
    expect(descrever(entrada('ALGO_NOVO'), nomes).texto).toBe('algo_novo');
  });
});

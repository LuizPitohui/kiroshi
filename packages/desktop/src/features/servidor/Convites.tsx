import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Trash2 } from 'lucide-react';
import type { Invite } from '@kiroshi/shared';
import { useStore } from '../../store/index.js';
import { Avatar, Aviso, Botao, BotaoIcone, Carregando, EstadoVazio, avisar, cx } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';
import { linkDoConvite, listarConvites, revogarConvite } from './acoes.js';
import { descreverUsos, quandoExpira, valido } from './regrasDoConvite.js';
import { JanelaDeConvite } from './JanelaDeConvite.js';

function LinhaDoConvite({ convite, agora, aoRevogar }: { convite: Invite; agora: number; aoRevogar: () => void }) {
  const canal = useStore((s) => (convite.channelId ? s.channels.get(convite.channelId)?.name : null));
  const quem = convite.inviter;
  const vale = valido(convite, agora);

  return (
    <li className={cx('grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-4 border-b border-borda px-3 py-2.5 last:border-b-0', !vale && 'opacity-50')}>
      <div className="min-w-0">
        <p className="truncate font-mono text-13 text-texto">{convite.code}</p>
        <p className="truncate text-12 text-texto-3">{canal ? `para #${canal}` : 'para o servidor'}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {quem ? <Avatar nome={quem.displayName} id={quem.id} url={quem.avatarUrl} tamanho={24} /> : null}
        <span className="truncate text-13 text-texto-2">{quem?.displayName ?? 'alguém'}</span>
      </div>
      <div className="min-w-0 text-12 text-texto-3">
        <p>{descreverUsos(convite)}</p>
        <p>{vale ? quandoExpira(convite.expiresAt, agora) : convite.maxUses > 0 && convite.uses >= convite.maxUses ? 'usos esgotados' : 'expirado'}</p>
      </div>
      <div className="flex gap-1">
        <BotaoIcone
          rotulo="Copiar o link"
          tamanho="sm"
          disabled={!vale}
          icone={<Copy className="size-4" strokeWidth={1.5} />}
          onClick={() =>
            void navigator.clipboard.writeText(linkDoConvite(convite.code)).then(() => avisar.ok('Link copiado'))
          }
        />
        <BotaoIcone rotulo={`Revogar ${convite.code}`} tamanho="sm" icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={aoRevogar} />
      </div>
    </li>
  );
}

/** Os convites do servidor: quem criou, usos, validade; revogar e criar. */
export function PaginaConvites({ guildId }: { guildId: string }) {
  const [convites, setConvites] = useState<Invite[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const agora = Date.now();

  const carregar = useCallback(() => {
    setErro(null);
    listarConvites(guildId)
      .then(setConvites)
      .catch((e: unknown) => setErro(motivo(e, 'Não consegui carregar os convites.')));
  }, [guildId]);

  useEffect(carregar, [carregar]);

  async function revogar(codigo: string) {
    if (await revogarConvite(codigo)) {
      setConvites((atual) => atual?.filter((c) => c.code !== codigo) ?? null);
      avisar.ok('Convite revogado', 'O link parou de funcionar agora.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-13 text-texto-3">Revogar faz o link parar de funcionar na hora. Quem já entrou continua no servidor.</p>
        <Botao variante="primario" icone={<Link2 className="size-4" strokeWidth={1.5} />} onClick={() => setCriando(true)}>
          Criar convite
        </Botao>
      </div>
      {erro ? (
        <Aviso tipo="erro" titulo="Não deu para ver os convites" acao={<Botao tamanho="sm" onClick={carregar}>Tentar de novo</Botao>}>
          {erro}
        </Aviso>
      ) : convites === null ? (
        <div className="py-10">
          <Carregando texto="Lendo os convites" />
        </div>
      ) : convites.length === 0 ? (
        <div className="h-64 border border-borda">
          <EstadoVazio rotulo="convites" titulo="Nenhum convite ativo">
            Crie um link para trazer gente nova. Dá para escolher por quanto tempo e quantas vezes ele vale.
          </EstadoVazio>
        </div>
      ) : (
        <ul className="border border-borda bg-deck">
          {convites.map((c) => (
            <LinhaDoConvite key={c.code} convite={c} agora={agora} aoRevogar={() => void revogar(c.code)} />
          ))}
        </ul>
      )}
      <JanelaDeConvite
        guildId={guildId}
        canalId={null}
        aberto={criando}
        aoMudar={(v) => {
          setCriando(v);
          if (!v) carregar();
        }}
      />
    </div>
  );
}

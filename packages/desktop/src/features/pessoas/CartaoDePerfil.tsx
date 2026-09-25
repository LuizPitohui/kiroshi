import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import { Avatar, Balao, BalaoAncora, BalaoConteudo, Botao } from '../../design/primitivos/index.js';
import { abrirConversa } from '../inicio/acoes.js';
import { CargosDaPessoa } from './CargosDaPessoa.js';

const data = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

interface Props {
  userId: string;
  /** Sem servidor (numa DM), o cartao nao tem apelido nem cargos. */
  guildId: string | null;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  lado?: 'left' | 'right' | 'bottom';
  /** O que ancora o cartao: a linha do membro, o nome na mensagem. */
  children: ReactNode;
}

/**
 * O perfil de alguem, como no Discord: foto, nomes, pronomes, "sobre mim",
 * desde quando esta no servidor e os cargos — com o `+` para dar cargo ali
 * mesmo (10-front-end-novo.md 4.7).
 */
export function CartaoDePerfil({ userId, guildId, aberto, aoMudar, lado = 'left', children }: Props) {
  const usuario = useStore((s) => s.users.get(userId));
  const nome = useStore((s) => selectors.displayNameOf(s, userId, guildId));
  const status = useStore((s) => s.presences.get(userId)?.status ?? 'OFFLINE');
  const frase = useStore((s) => s.presences.get(userId)?.customStatus ?? null);
  const entrouEm = useStore((s) => (guildId ? s.members.get(`${guildId}:${userId}`)?.joinedAt : undefined));
  const souEu = useStore((s) => s.user?.id === userId);
  const cor = usuario?.accentColor ?? null;

  return (
    <Balao open={aberto} onOpenChange={aoMudar}>
      <BalaoAncora asChild>{children}</BalaoAncora>
      <BalaoConteudo rotulo={`Perfil de ${nome}`} lado={lado} alinhar="start" className="w-[300px]">
        <div aria-hidden className="h-14 border-b border-borda" style={{ background: cor ?? 'var(--k-terminal)' }} />
        <div className="-mt-8 px-4 pb-4">
          <Avatar nome={nome} id={userId} url={usuario?.avatarUrl} tamanho={72} status={status} className="ring-4 ring-elevado" />
          <p className="mt-2 truncate font-display text-20 font-bold tracking-[0.04em] text-texto">{nome}</p>
          <p className="truncate font-mono text-11 text-texto-3">
            @{usuario?.username ?? '?'}
            {usuario?.pronouns ? <span className="text-mudo"> · {usuario.pronouns}</span> : null}
          </p>
          {frase ? <p className="mt-2 text-13 text-texto-2">{frase}</p> : null}

          {usuario?.bio ? (
            <section className="mt-3 border-t border-borda pt-3">
              <h3 className="k-rotulo">Sobre</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-13 text-texto-2">{usuario.bio}</p>
            </section>
          ) : null}

          <section className="mt-3 border-t border-borda pt-3">
            <h3 className="k-rotulo">Membro desde</h3>
            <p className="mt-1 text-13 text-texto-2">
              {guildId && entrouEm ? `${data(entrouEm)} neste servidor` : null}
              {guildId && entrouEm && usuario?.createdAt ? ' · ' : null}
              {usuario?.createdAt ? `${data(usuario.createdAt)} no Kiroshi` : null}
            </p>
          </section>

          {guildId ? (
            <section className="mt-3 border-t border-borda pt-3">
              <h3 className="k-rotulo">Cargos</h3>
              <CargosDaPessoa guildId={guildId} userId={userId} className="mt-2" />
            </section>
          ) : null}

          {!souEu ? (
            <Botao
              className="mt-4 w-full"
              icone={<MessageSquare className="size-4" strokeWidth={1.5} />}
              onClick={() => {
                aoMudar(false);
                void abrirConversa(userId);
              }}
            >
              Mandar mensagem
            </Botao>
          ) : null}
        </div>
      </BalaoConteudo>
    </Balao>
  );
}

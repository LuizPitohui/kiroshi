import { useState, type ReactNode } from 'react';
import { Check, Clock, MessageSquare, UserPlus } from 'lucide-react';
import { selectors, useStore } from '../../store/index.js';
import { Avatar, Balao, BalaoAncora, BalaoConteudo, Botao, avisar } from '../../design/primitivos/index.js';
import { abrirConversa, aceitarPedido, pedirAmizade } from '../inicio/acoes.js';
import { CargosDaPessoa } from './CargosDaPessoa.js';

/**
 * A amizade no proprio perfil, como no Discord: sem precisar saber o nome de
 * usuario (pedido do dono em 2026-09-26, "os pedidos de amizade, como eu
 * faco?"). Pedido recebido vira "Aceitar"; enviado, so avisa; amigo, nada.
 */
function BotaoDeAmizade({ userId, username }: { userId: string; username: string }) {
  const relacao = useStore((s) => [...s.relationships.values()].find((r) => r.user.id === userId));
  const [enviando, setEnviando] = useState(false);

  if (relacao?.type === 'FRIEND' || relacao?.type === 'BLOCKED') return null;
  if (relacao?.type === 'PENDING_OUTGOING') {
    return (
      <Botao className="mt-2 w-full" disabled icone={<Clock className="size-4" strokeWidth={1.5} />}>
        Pedido de amizade enviado
      </Botao>
    );
  }
  if (relacao?.type === 'PENDING_INCOMING') {
    return (
      <Botao
        variante="primario"
        className="mt-2 w-full"
        carregando={enviando}
        icone={<Check className="size-4" strokeWidth={1.75} />}
        onClick={() => {
          setEnviando(true);
          void aceitarPedido(relacao.id).finally(() => setEnviando(false));
        }}
      >
        Aceitar pedido de amizade
      </Botao>
    );
  }
  return (
    <Botao
      className="mt-2 w-full"
      carregando={enviando}
      icone={<UserPlus className="size-4" strokeWidth={1.5} />}
      onClick={() => {
        setEnviando(true);
        void pedirAmizade(username).then((r) => {
          setEnviando(false);
          if (r.ok) avisar.ok(r.mensagem);
          else avisar.erro('Não consegui enviar o pedido', r.mensagem);
        });
      }}
    >
      Adicionar amigo
    </Botao>
  );
}

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
          {/* No cartao a foto e o destaque: o GIF, se houver, anima (como no Discord). */}
          <Avatar
            nome={nome}
            id={userId}
            url={usuario?.avatarUrl}
            urlAnimada={usuario?.avatarAnimatedUrl}
            tamanho={72}
            status={status}
            animar
            className="ring-4 ring-elevado"
          />
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
          {!souEu && usuario && !usuario.bot ? <BotaoDeAmizade userId={userId} username={usuario.username} /> : null}
        </div>
      </BalaoConteudo>
    </Balao>
  );
}

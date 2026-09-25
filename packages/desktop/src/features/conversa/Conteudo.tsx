import { memo, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { isOnlyEmojis } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { navegar } from '../../app/rotas.js';
import { cx } from '../../design/primitivos/index.js';
import { analisar, type Bloco, type Trecho } from './markdown.js';

/*
  O texto de uma mensagem, a partir da arvore de `markdown.ts`.

  Mencao, canal e emoji leem o store pelo seu proprio seletor: trocar o
  apelido de alguem atualiza as mencoes na hora. Na 1.x o nome era lido uma
  vez, na montagem, e ficava velho ate a mensagem ser redesenhada por outro
  motivo.
*/

const PILULA = 'rounded-chip px-0.5 font-medium';

function Pessoa({ id, guildId }: { id: string; guildId: string | null }) {
  const nome = useStore((s) => selectors.displayNameOf(s, id, guildId));
  const souEu = useStore((s) => s.user?.id === id);
  return <span className={cx(PILULA, souEu ? 'bg-mencao/15 text-mencao' : 'bg-acento-tenue text-acento-2')}>@{nome}</span>;
}

function Cargo({ id }: { id: string }) {
  const cargo = useStore((s) => s.roles.get(id));
  const meu = useStore((s) => {
    const eu = s.user?.id;
    return Boolean(eu && cargo && s.members.get(`${cargo.guildId}:${eu}`)?.roleIds.includes(id));
  });
  if (meu) return <span className={cx(PILULA, 'bg-mencao/15 text-mencao')}>@{cargo?.name ?? 'cargo'}</span>;
  return (
    <span
      className={cx(PILULA, !cargo?.color && 'bg-acento-tenue text-acento-2')}
      style={cargo?.color ? { color: cargo.color, background: `color-mix(in srgb, ${cargo.color} 14%, transparent)` } : undefined}
    >
      @{cargo?.name ?? 'cargo'}
    </span>
  );
}

function Canal({ id }: { id: string }) {
  const canal = useStore((s) => s.channels.get(id));
  // Botao, e nao span: a mencao de canal LEVA a algum lugar, e sem estar na
  // ordem de tabulacao so quem usa mouse conseguia segui-la.
  return (
    <button
      type="button"
      disabled={!canal?.guildId}
      onClick={() => canal?.guildId && navegar({ tela: 'servidor', guildId: canal.guildId, canalId: canal.id })}
      className={cx(PILULA, 'bg-acento-tenue text-acento-2 hover:underline disabled:cursor-default disabled:no-underline')}
    >
      #{canal?.name ?? 'canal-desconhecido'}
    </button>
  );
}

function Emoji({ nome, id, grande }: { nome: string; id: string; grande: boolean }) {
  const url = useStore((s) => {
    for (const g of s.guilds.values()) {
      const e = g.emojis.find((x) => x.id === id);
      if (e) return e.url;
    }
    return null;
  });
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) return <span>{`:${nome}:`}</span>;
  return (
    <img
      src={url}
      alt={`:${nome}:`}
      title={`:${nome}:`}
      draggable={false}
      onError={() => setFalhou(true)}
      className={cx('inline-block object-contain', grande ? 'size-12' : 'size-[22px] align-[-5px]')}
    />
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revelado, setRevelado] = useState(false);
  if (revelado) return <span className="bg-realce-forte px-0.5">{children}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Spoiler escondido. Ative para revelar."
      onClick={() => setRevelado(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setRevelado(true);
        }
      }}
      className="cursor-pointer bg-texto-3 px-0.5 hover:bg-texto-2"
    >
      <span aria-hidden className="invisible">
        {children}
      </span>
    </span>
  );
}

function BlocoDeCodigo({ linguagem, texto }: { linguagem: string | null; texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="group/codigo relative my-1 max-w-[min(100%,720px)] border border-borda bg-terminal">
      {linguagem ? <span className="absolute left-3 top-1 font-mono text-10 uppercase tracking-rotulo text-mudo">{linguagem}</span> : null}
      <button
        type="button"
        aria-label={copiado ? 'Copiado' : 'Copiar código'}
        onClick={() => {
          void navigator.clipboard.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
        className="absolute right-1 top-1 grid size-7 place-items-center border border-transparente text-texto-3 opacity-0 hover:border-borda-2 hover:text-texto focus-visible:opacity-100 group-hover/codigo:opacity-100"
      >
        {copiado ? <Check aria-hidden className="size-3.5 text-ok" /> : <Copy aria-hidden className="size-3.5" strokeWidth={1.5} />}
      </button>
      <pre className={cx('k-rolagem overflow-x-auto px-3 pb-2 font-mono text-12 leading-relaxed text-texto', linguagem ? 'pt-5' : 'pt-2')}>
        <code>{texto}</code>
      </pre>
    </div>
  );
}

function Trechos({ trechos, guildId, grande }: { trechos: readonly Trecho[]; guildId: string | null; grande: boolean }) {
  return (
    <>
      {trechos.map((t, i) => {
        switch (t.tipo) {
          case 'texto':
            return <span key={i}>{t.texto}</span>;
          case 'codigo':
            return (
              <code key={i} className="border border-borda bg-terminal px-1 py-px font-mono text-[0.85em]">
                {t.texto}
              </code>
            );
          case 'negrito':
            return (
              <strong key={i} className="font-semibold">
                <Trechos trechos={t.filhos} guildId={guildId} grande={grande} />
              </strong>
            );
          case 'italico':
            return (
              <em key={i}>
                <Trechos trechos={t.filhos} guildId={guildId} grande={grande} />
              </em>
            );
          case 'sublinhado':
            return (
              <u key={i} className="underline-offset-2">
                <Trechos trechos={t.filhos} guildId={guildId} grande={grande} />
              </u>
            );
          case 'riscado':
            return (
              <s key={i}>
                <Trechos trechos={t.filhos} guildId={guildId} grande={grande} />
              </s>
            );
          case 'spoiler':
            return (
              <Spoiler key={i}>
                <Trechos trechos={t.filhos} guildId={guildId} grande={grande} />
              </Spoiler>
            );
          case 'pessoa':
            return <Pessoa key={i} id={t.id} guildId={guildId} />;
          case 'cargo':
            return <Cargo key={i} id={t.id} />;
          case 'canal':
            return <Canal key={i} id={t.id} />;
          case 'emoji':
            return <Emoji key={i} nome={t.nome} id={t.id} grande={grande} />;
          case 'todos':
            return (
              <span key={i} className={cx(PILULA, 'bg-mencao/15 text-mencao')}>
                @{t.alvo}
              </span>
            );
          case 'link':
            return (
              <a
                key={i}
                href={t.url}
                target="_blank"
                rel="noreferrer noopener"
                title={t.url}
                className="text-info underline-offset-2 hover:underline"
              >
                {t.url}
              </a>
            );
        }
      })}
    </>
  );
}

interface Props {
  conteudo: string;
  guildId: string | null;
  /** Vai no fim da ultima linha de texto: o "(editada)". */
  sufixo?: ReactNode;
}

/**
 * O corpo da mensagem.
 *
 * No compacto o texto corre na mesma linha do nome (`22:31  kaya  oi`), entao
 * o bloco de texto vira `inline`; codigo e citacao continuam em bloco.
 */
export const Conteudo = memo(function Conteudo({ conteudo, guildId, sufixo }: Props) {
  const blocos = useMemo<Bloco[]>(() => analisar(conteudo), [conteudo]);
  // So emoji: grande, como no Discord (ate 27, senao vira parede).
  const grande = useMemo(() => isOnlyEmojis(conteudo) && [...conteudo.matchAll(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu)].length <= 27, [conteudo]);
  if (!conteudo) return sufixo ? <>{sufixo}</> : null;

  let ultimoDeTexto = -1;
  blocos.forEach((b, i) => {
    if (b.tipo !== 'codigo') ultimoDeTexto = i;
  });
  return (
    <div className={cx('min-w-0 text-15 leading-[1.4] text-texto compacto:inline', grande && 'text-[44px] leading-[1.15]')}>
      {blocos.map((b, i) => {
        const fim = i === ultimoDeTexto && i === blocos.length - 1 ? sufixo : null;
        if (b.tipo === 'codigo') return <BlocoDeCodigo key={i} linguagem={b.linguagem} texto={b.texto} />;
        if (b.tipo === 'citacao') {
          return (
            <blockquote key={i} className="my-0.5 whitespace-pre-wrap border-l-2 border-borda-2 pl-3 text-texto-2 [overflow-wrap:anywhere]">
              <Trechos trechos={b.filhos} guildId={guildId} grande={grande} />
              {fim}
            </blockquote>
          );
        }
        return (
          <span key={i} className="block whitespace-pre-wrap [overflow-wrap:anywhere] compacto:inline">
            <Trechos trechos={b.filhos} guildId={guildId} grande={grande} />
            {fim}
          </span>
        );
      })}
      {ultimoDeTexto !== blocos.length - 1 ? sufixo : null}
    </div>
  );
});

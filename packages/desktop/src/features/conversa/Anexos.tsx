import { memo, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, X } from 'lucide-react';
import type { Attachment, Embed } from '@kiroshi/shared';
import { cx } from '../../design/primitivos/index.js';

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const ehImagem = (a: Attachment) => (a.contentType ?? '').startsWith('image/');

/**
 * Tamanho reservado para a imagem ANTES de ela carregar.
 *
 * Sem largura e altura, a imagem entra com 0 px e cresce quando chega — a
 * conversa pula e quem estava no fim deixa de estar. Com as medidas que o
 * servidor manda, o espaco ja existe desde o primeiro quadro.
 */
function caixaDaImagem(a: Attachment, maxL = 400, maxA = 300): { width: number; height: number } | undefined {
  if (!a.width || !a.height) return undefined;
  const escala = Math.min(1, maxL / a.width, maxA / a.height);
  return { width: Math.round(a.width * escala), height: Math.round(a.height * escala) };
}

/** Imagem em tela cheia, com as outras imagens da mesma mensagem nas setas. */
function Visualizador({ imagens, inicial, aoFechar }: { imagens: Attachment[]; inicial: number; aoFechar: () => void }) {
  const [i, setI] = useState(inicial);
  const atual = imagens[i];
  const varias = imagens.length > 1;

  useEffect(() => {
    if (!varias) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % imagens.length);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + imagens.length) % imagens.length);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [varias, imagens.length]);

  if (!atual) return null;
  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--k-z-dialogo)] bg-preto/90" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[var(--k-z-dialogo)] flex flex-col outline-none"
          onClick={(e) => {
            // Clique fora da imagem fecha; na imagem, nao.
            if (e.target === e.currentTarget) aoFechar();
          }}
        >
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-borda bg-deck/80 px-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-14 text-texto">{atual.filename}</Dialog.Title>
            <span className="font-mono text-11 text-texto-3">
              {varias ? `${i + 1}/${imagens.length} · ` : ''}
              {tamanhoLegivel(atual.size)}
            </span>
            <a
              href={atual.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Abrir o original no navegador"
              className="grid size-8 place-items-center text-texto-3 hover:bg-realce hover:text-texto"
            >
              <ExternalLink aria-hidden className="size-4" strokeWidth={1.5} />
            </a>
            <Dialog.Close aria-label="Fechar" className="grid size-8 place-items-center text-texto-3 hover:bg-realce hover:text-texto">
              <X aria-hidden className="size-4" strokeWidth={1.5} />
            </Dialog.Close>
          </header>
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-6" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
            <img src={atual.url} alt={atual.filename} className="max-h-full max-w-full object-contain" />
            {varias ? (
              <>
                <button
                  type="button"
                  aria-label="Imagem anterior"
                  onClick={() => setI((x) => (x - 1 + imagens.length) % imagens.length)}
                  className="absolute left-4 grid size-10 place-items-center border border-borda-2 bg-deck/80 text-texto hover:border-acento"
                >
                  <ChevronLeft aria-hidden className="size-5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="Próxima imagem"
                  onClick={() => setI((x) => (x + 1) % imagens.length)}
                  className="absolute right-4 grid size-10 place-items-center border border-borda-2 bg-deck/80 text-texto hover:border-acento"
                >
                  <ChevronRight aria-hidden className="size-5" strokeWidth={1.5} />
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Arquivo({ anexo }: { anexo: Attachment }) {
  return (
    <div className="flex w-[min(100%,420px)] items-center gap-3 border border-borda bg-terminal px-3 py-2.5">
      <FileText aria-hidden className="size-7 shrink-0 text-texto-3" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <a href={anexo.url} target="_blank" rel="noreferrer noopener" className="block truncate text-14 text-info hover:underline">
          {anexo.filename}
        </a>
        <p className="font-mono text-11 text-texto-3">{tamanhoLegivel(anexo.size)}</p>
      </div>
    </div>
  );
}

export const Anexos = memo(function Anexos({ anexos }: { anexos: Attachment[] }) {
  const [aberta, setAberta] = useState<number | null>(null);
  if (anexos.length === 0) return null;
  const imagens = anexos.filter(ehImagem);

  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {imagens.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {imagens.map((a, i) => (
            <button
              key={a.id}
              type="button"
              aria-label={`Abrir imagem ${a.filename}`}
              onClick={() => setAberta(i)}
              className="block overflow-hidden border border-borda bg-terminal hover:border-borda-2"
              style={a.placeholder ? { backgroundImage: `url(${a.placeholder})`, backgroundSize: 'cover' } : undefined}
            >
              <img
                src={a.url}
                alt={a.filename}
                loading="lazy"
                draggable={false}
                {...caixaDaImagem(a)}
                className="block max-h-[300px] max-w-[min(400px,100%)] object-contain"
              />
            </button>
          ))}
        </div>
      ) : null}
      {anexos
        .filter((a) => !ehImagem(a))
        .map((a) => {
          const tipo = a.contentType ?? '';
          if (tipo.startsWith('video/')) {
            return <video key={a.id} src={a.url} controls preload="metadata" className="max-h-[320px] max-w-[min(480px,100%)] border border-borda bg-preto" />;
          }
          if (tipo.startsWith('audio/')) {
            return (
              <div key={a.id} className="w-[min(100%,420px)] border border-borda bg-terminal p-2">
                <p className="mb-1 truncate text-13 text-texto-2">{a.filename}</p>
                <audio src={a.url} controls preload="metadata" className="w-full" />
              </div>
            );
          }
          return <Arquivo key={a.id} anexo={a} />;
        })}
      {aberta !== null ? <Visualizador imagens={imagens} inicial={aberta} aoFechar={() => setAberta(null)} /> : null}
    </div>
  );
});

/** Cartao de link: o site, o titulo em vermelho, a descricao, a miniatura. */
export const Cartoes = memo(function Cartoes({ cartoes }: { cartoes: Embed[] }) {
  if (cartoes.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {cartoes.map((c, i) => {
        const grande = c.type === 'image' && c.imageUrl;
        return (
          <div
            key={i}
            className={cx('flex max-w-[min(100%,460px)] gap-3 border border-borda border-l-2 bg-terminal px-3 py-2.5', !c.color && 'border-l-acento')}
            style={c.color ? { borderLeftColor: c.color } : undefined}
          >
            <div className="min-w-0 flex-1">
              {c.siteName ? <p className="font-mono text-10 uppercase tracking-[0.14em] text-texto-3">{c.siteName}</p> : null}
              {c.title ? (
                c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer noopener" className="my-0.5 block font-semibold text-acento-2 hover:underline">
                    {c.title}
                  </a>
                ) : (
                  <p className="my-0.5 font-semibold text-texto">{c.title}</p>
                )
              ) : null}
              {c.description ? <p className="line-clamp-3 text-13 text-texto-2">{c.description}</p> : null}
              {grande ? <img src={c.imageUrl!} alt="" loading="lazy" className="mt-2 max-h-[240px] max-w-full border border-borda object-contain" /> : null}
            </div>
            {!grande && c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" loading="lazy" className="size-20 shrink-0 border border-borda object-cover" /> : null}
          </div>
        );
      })}
    </div>
  );
});

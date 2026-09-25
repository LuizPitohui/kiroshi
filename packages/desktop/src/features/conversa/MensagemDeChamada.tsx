import { Phone, PhoneMissed } from 'lucide-react';
import type { Message } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { Botao, cx } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { atender } from '../inicio/acoes.js';
import { descreverChamada } from '../chamada/dm.js';
import { horaCurta } from './linhas.js';

interface PropsDaLinha {
  texto: string;
  perdida: boolean;
  noAr: boolean;
  hora: string;
  /** Entrar na chamada no ar; ausente quando ja se esta nela ou ela acabou. */
  aoEntrar?: () => void;
}

/**
 * A linha de sistema de uma chamada: o telefone na calha da foto, o texto e a
 * hora. Verde no ar, vermelho perdida. So desenha — a vitrine mostra os tres
 * casos sem conta nenhuma.
 */
export function LinhaDeChamada({ texto, perdida, noAr, hora, aoEntrar }: PropsDaLinha) {
  const Icone = perdida ? PhoneMissed : Phone;
  return (
    <div className="flex min-h-10 items-center gap-4 py-1 pl-4 pr-4">
      <span className={cx('flex w-10 shrink-0 justify-center', perdida ? 'text-perigo' : noAr ? 'text-fala' : 'text-texto-3')}>
        <Icone aria-hidden className="size-[18px]" strokeWidth={1.5} />
      </span>
      <p className="min-w-0 text-14 text-texto-2">{texto}</p>
      <span className="shrink-0 font-mono text-11 text-texto-3">{hora}</span>
      {aoEntrar ? (
        <Botao variante="primario" tamanho="sm" className="shrink-0" onClick={aoEntrar}>
          Entrar
        </Botao>
      ) : null}
    </div>
  );
}

/**
 * A mensagem de chamada (tipo CALL) numa conversa direta. Nao tem acoes de
 * mensagem — e registro do sistema, nao algo que alguem escreveu —, mas entra
 * na navegacao por setas como as outras.
 */
export function MensagemDeChamada({ mensagem, euSou, focavel }: { mensagem: Message; euSou: string | null; focavel: boolean }) {
  const autor = useStore((s) => selectors.displayNameOf(s, mensagem.authorId, null));
  const noAr = useStore((s) => s.calls.get(mensagem.channelId)?.messageId === mensagem.id);
  const estouNela = useVoz((v) => v.channelId === mensagem.channelId && (v.connected || v.connecting));
  const registro = descreverChamada({ mensagem, autor, euSou, noAr });
  const hora = horaCurta(mensagem.createdAt);

  return (
    <article data-mensagem={mensagem.id} tabIndex={focavel ? 0 : -1} aria-label={`${registro.texto} ${hora}`} className="outline-none focus-visible:bg-terminal">
      <LinhaDeChamada
        texto={registro.texto}
        perdida={registro.perdida}
        noAr={registro.noAr}
        hora={hora}
        aoEntrar={registro.noAr && !estouNela ? () => void atender(mensagem.channelId) : undefined}
      />
    </article>
  );
}

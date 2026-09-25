import { Phone, Video } from 'lucide-react';
import { selectors, useStore, useVoiceMembersOf } from '../../store/index.js';
import { Avatar, Botao, BotaoIcone } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { atender, ligar, tocarDeNovo } from '../inicio/acoes.js';
import { Palco } from './Palco.js';
import { Controles } from './Controles.js';

/** Ligar e ligar com video, no cabecalho da conversa direta. Na chamada, somem: os controles estao no palco. */
export function BotoesDeLigar({ canalId }: { canalId: string }) {
  const naChamada = useVoz((v) => v.channelId === canalId && (v.connected || v.connecting));
  if (naChamada) return null;
  return (
    <>
      <BotaoIcone rotulo="Ligar" onClick={() => void ligar(canalId)} icone={<Phone className="size-[18px]" strokeWidth={1.5} />} />
      <BotaoIcone
        rotulo="Ligar com vídeo"
        onClick={() => void ligar(canalId, { video: true })}
        icone={<Video className="size-[18px]" strokeWidth={1.5} />}
      />
    </>
  );
}

/** Quem estou chamando agora, e o que fazer quando ninguem atende. */
function Chamando({ canalId }: { canalId: string }) {
  const euSou = useStore((s) => s.user?.id ?? null);
  // A lista do store, e nao uma filtrada no seletor: lista nova a cada leitura
  // faz o Zustand redesenhar sem parar.
  const tocando = useStore((s) => s.calls.get(canalId)?.ringing);
  const chamando = (tocando ?? []).filter((id) => id !== euSou);
  const nomes = useStore((s) => chamando.map((id) => selectors.displayNameOf(s, id, null)).join(', '));

  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-3 border-b border-borda font-mono text-11 uppercase tracking-rotulo text-texto-2">
      {chamando.length > 0 ? (
        <>
          <span aria-hidden className="k-anima k-pulso size-1.5 bg-acento" />
          <span role="status">Chamando {nomes}…</span>
        </>
      ) : (
        <>
          <span role="status">Ninguém atendeu ainda</span>
          <Botao tamanho="sm" onClick={() => void tocarDeNovo(canalId)}>
            Chamar de novo
          </Botao>
        </>
      )}
    </div>
  );
}

/** Ha chamada na conversa e eu nao estou nela: quem esta, e entrar. */
function FaixaDaChamada({ canalId }: { canalId: string }) {
  const presentes = useVoiceMembersOf(canalId);
  const conectando = useVoz((v) => v.channelId === canalId && v.connecting);
  const nomes = useStore((s) => presentes.map((p) => selectors.displayNameOf(s, p.userId, null)).join(', '));
  const usuarios = useStore((s) => s.users);

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-borda bg-deck px-4">
      <span aria-hidden className="k-anima k-pulso size-2 bg-fala" />
      <p className="k-rotulo shrink-0 text-fala">Chamada em andamento</p>
      <ul aria-label="Na chamada" className="flex shrink-0 -space-x-2">
        {presentes.slice(0, 4).map((p) => {
          const u = usuarios.get(p.userId);
          return (
            <li key={p.userId} className="rounded-full ring-2 ring-deck">
              <Avatar nome={u?.displayName ?? '?'} id={p.userId} url={u?.avatarUrl} tamanho={24} />
            </li>
          );
        })}
      </ul>
      <p className="min-w-0 truncate text-13 text-texto-2">{nomes}</p>
      <Botao variante="primario" tamanho="sm" carregando={conectando} className="ml-auto shrink-0" onClick={() => void atender(canalId)}>
        ▸ Entrar na chamada
      </Botao>
    </div>
  );
}

/**
 * A chamada no topo da conversa direta, como no Discord (10-front-end-novo.md
 * 4.5): o mesmo palco, quadros e controles do canal de voz enquanto se esta
 * nela; uma faixa para entrar quando ha chamada sem voce; nada sem chamada.
 */
export function ChamadaNaConversa({ canalId }: { canalId: string }) {
  const estou = useVoz((v) => v.channelId === canalId && v.connected);
  const alguem = useStore((s) => selectors.voiceMembersOf(s, canalId).length > 0);
  const sozinho = useVoz((v) => v.participants.every((p) => p.isLocal));

  if (estou) {
    return (
      <section aria-label="Chamada" className="flex h-[46%] min-h-[280px] shrink-0 flex-col border-b border-borda bg-void">
        {sozinho ? <Chamando canalId={canalId} /> : null}
        <Palco guildId={null} canalId={canalId} controles={<Controles canalId={canalId} />} className="min-h-0 flex-1" />
      </section>
    );
  }
  return alguem ? <FaixaDaChamada canalId={canalId} /> : null;
}

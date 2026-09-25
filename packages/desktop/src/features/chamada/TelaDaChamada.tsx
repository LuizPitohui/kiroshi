import { HeadphoneOff, MessageSquare, MicOff, Video, Volume2 } from 'lucide-react';
import { selectors, useStore, useVoiceMembersOf } from '../../store/index.js';
import { useInterface } from '../../app/interface.js';
import { useTelaLarga } from '../../app/largura.js';
import { Avatar, BotaoIcone, Botao, SeloVivo } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { entrarNaVoz } from '../casca/acoesDeVoz.js';
import { Palco } from './Palco.js';
import { Controles } from './Controles.js';

function Cabecalho({ canalId }: { canalId: string }) {
  const canal = useStore((s) => s.channels.get(canalId));
  const presentes = useVoiceMembersOf(canalId);
  const transmitindo = presentes.filter((p) => p.selfStream).length;
  const telaLarga = useTelaLarga();
  const painel = useInterface((s) => (telaLarga ? s.membros : s.gavetaDeMembros));
  const alternar = useInterface((s) => s.alternarMembros);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-borda px-4">
      <h1 className="flex shrink-0 items-center gap-2 font-display text-20 font-bold tracking-[0.06em]">
        <Volume2 aria-hidden className="size-5 text-acento" strokeWidth={1.5} />
        {canal?.name ?? 'Chamada'}
      </h1>
      <p className="min-w-0 truncate border-l border-borda pl-3 font-mono text-11 uppercase tracking-[0.1em] text-texto-3">
        {presentes.length === 0 ? 'Ninguém na chamada' : presentes.length === 1 ? '1 na chamada' : `${presentes.length} na chamada`}
        {transmitindo > 0 ? ` · ${transmitindo} transmitindo` : ''}
      </p>
      <div className="ml-auto flex items-center gap-1">
        <BotaoIcone
          rotulo={painel ? 'Esconder a conversa da chamada' : 'Mostrar a conversa da chamada'}
          ligado={painel}
          onClick={() => alternar(telaLarga)}
          icone={<MessageSquare className="size-[18px]" strokeWidth={1.5} />}
        />
      </div>
    </header>
  );
}

/** Quem esta la antes de entrar, e o botao grande de entrar. */
function AntesDeEntrar({ canalId, guildId }: { canalId: string; guildId: string | null }) {
  const presentes = useVoiceMembersOf(canalId);
  const conectando = useVoz((v) => v.connecting && v.channelId === canalId);
  const s = useStore.getState();

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-8">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-6 text-center">
        {presentes.length === 0 ? (
          <p className="text-15 text-texto-3">Ninguém na chamada ainda. Entre e chame a galera.</p>
        ) : (
          <ul aria-label="Na chamada" className="flex flex-wrap justify-center gap-4">
            {presentes.map((p) => {
              const nome = selectors.displayNameOf(s, p.userId, guildId);
              return (
                <li key={p.userId} className="flex w-[96px] flex-col items-center gap-2">
                  <Avatar nome={nome} id={p.userId} url={s.users.get(p.userId)?.avatarUrl} tamanho={72} />
                  <span className="max-w-full truncate text-13 text-texto-2">{nome}</span>
                  <span className="flex h-4 items-center gap-1 text-texto-3">
                    {p.selfStream ? <SeloVivo /> : null}
                    {p.selfVideo ? <Video aria-label="câmera ligada" className="size-3.5" strokeWidth={1.5} /> : null}
                    {p.selfDeaf || p.serverDeaf ? (
                      <HeadphoneOff aria-label="som desligado" className="size-3.5 text-perigo" strokeWidth={1.5} />
                    ) : p.selfMute || p.serverMute ? (
                      <MicOff aria-label="microfone desligado" className="size-3.5 text-perigo" strokeWidth={1.5} />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Botao variante="primario" carregando={conectando} onClick={() => void entrarNaVoz(canalId, guildId)}>
          ▸ Entrar na chamada
        </Botao>
      </div>
    </div>
  );
}

/**
 * O canal de voz aberto: o palco ocupa a area principal e a conversa da
 * chamada fica no painel da direita (a Casca cuida dele).
 */
export function TelaDaChamada({ canalId, guildId }: { canalId: string; guildId: string | null }) {
  const estou = useVoz((v) => v.channelId === canalId && v.connected);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Cabecalho canalId={canalId} />
      {estou ? <Palco guildId={guildId} canalId={canalId} controles={<Controles canalId={canalId} />} className="min-h-0 flex-1" /> : <AntesDeEntrar canalId={canalId} guildId={guildId} />}
    </div>
  );
}

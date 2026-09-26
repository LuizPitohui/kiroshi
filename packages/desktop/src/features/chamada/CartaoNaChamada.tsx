import { useState, type ReactNode } from 'react';
import { Permission, has } from '@kiroshi/shared';
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { selectors, useChannelsOfGuild, useStore } from '../../store/index.js';
import { usePermissoesNoServidor } from '../../app/permissoes.js';
import { voice } from '../../voice/controller.js';
import { Avatar, Balao, BalaoAncora, BalaoConteudo, Botao, Deslizante } from '../../design/primitivos/index.js';
import { ensurdecerNoServidor, moverPara, silenciarNoServidor } from './moderacao.js';

interface Props {
  userId: string;
  guildId: string | null;
  /** O canal de voz onde a pessoa esta (para listar os outros no "mover"). */
  canalId: string | null;
  transmitindo: boolean;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** O quadro, que ancora o cartao. */
  children: ReactNode;
}

const porcento = (v: number) => `${Math.round(v)}%`;

/**
 * O cartao da pessoa na chamada: botao direito (ou Shift+F10) num quadro.
 *
 * Volume da voz e, separado, o da transmissao — quem transmite um jogo manda o
 * som do jogo pelo mesmo canal em que fala, e um controle so obrigaria a
 * escolher entre ouvir a pessoa e ouvir o jogo. Com permissao, a moderacao:
 * silenciar, ensurdecer, mover e desconectar.
 *
 * Balao, e nao menu: controle deslizante dentro de menu briga com as setas
 * (no menu elas trocam de item), e aqui Tab anda por tudo como num formulario.
 */
export function CartaoNaChamada({ userId, guildId, canalId, transmitindo, aberto, aoMudar, children }: Props) {
  const nome = useStore((s) => selectors.displayNameOf(s, userId, guildId));
  const usuario = useStore((s) => s.users.get(userId));
  const estado = useStore((s) => s.voiceStates.get(userId));
  const permissoes = usePermissoesNoServidor(guildId);
  const canais = useChannelsOfGuild(guildId);
  const [voz, setVoz] = useState(() => voice.getUserVolume(userId) * 100);
  const [tela, setTela] = useState(() => voice.getScreenVolume(userId) * 100);

  const podeSilenciar = Boolean(guildId) && has(permissoes, Permission.MUTE_MEMBERS);
  const podeEnsurdecer = Boolean(guildId) && has(permissoes, Permission.DEAFEN_MEMBERS);
  const podeMover = Boolean(guildId) && has(permissoes, Permission.MOVE_MEMBERS);
  const outrosCanais = canais.filter((c) => c.type === 'GUILD_VOICE' && c.id !== canalId);

  return (
    <Balao open={aberto} onOpenChange={aoMudar}>
      <BalaoAncora asChild>{children}</BalaoAncora>
      <BalaoConteudo rotulo={`Opções de ${nome}`} lado="right" alinhar="start" className="w-[300px]">
        <div className="flex items-center gap-3 border-b border-borda px-4 py-3">
          <Avatar nome={nome} id={userId} url={usuario?.avatarUrl} urlAnimada={usuario?.avatarAnimatedUrl} tamanho={40} animar />
          <div className="min-w-0">
            <p className="truncate text-15 font-semibold text-texto">{nome}</p>
            {usuario ? <p className="truncate font-mono text-11 text-texto-3">@{usuario.username}</p> : null}
          </div>
        </div>

        <div className="space-y-4 px-4 py-3">
          <Deslizante
            rotulo="Volume da voz"
            valor={voz}
            min={0}
            max={200}
            passo={5}
            marca={100}
            formatar={porcento}
            aoMudar={(v) => {
              setVoz(v);
              voice.setUserVolume(userId, v / 100);
            }}
          />
          {transmitindo ? (
            <Deslizante
              rotulo="Volume da transmissão"
              valor={tela}
              min={0}
              max={200}
              passo={5}
              marca={100}
              formatar={porcento}
              aoMudar={(v) => {
                setTela(v);
                voice.setScreenVolume(userId, v / 100);
              }}
            />
          ) : null}
          <Botao
            tamanho="sm"
            variante="secundario"
            icone={<VolumeX className="size-4" strokeWidth={1.5} />}
            onClick={() => {
              const novo = voz === 0 ? 100 : 0;
              setVoz(novo);
              voice.setUserVolume(userId, novo / 100);
            }}
          >
            {voz === 0 ? 'Voltar a ouvir' : 'Silenciar para mim'}
          </Botao>
        </div>

        {guildId && (podeSilenciar || podeEnsurdecer || podeMover) ? (
          <div className="space-y-2 border-t border-borda px-4 py-3">
            <p className="k-rotulo">Moderação</p>
            <div className="flex flex-wrap gap-2">
              {podeSilenciar ? (
                <Botao
                  tamanho="sm"
                  variante="secundario"
                  icone={estado?.serverMute ? <Mic className="size-4" strokeWidth={1.5} /> : <MicOff className="size-4" strokeWidth={1.5} />}
                  onClick={() => void silenciarNoServidor(guildId, userId, !estado?.serverMute)}
                >
                  {estado?.serverMute ? 'Tirar silêncio' : 'Silenciar'}
                </Botao>
              ) : null}
              {podeEnsurdecer ? (
                <Botao
                  tamanho="sm"
                  variante="secundario"
                  icone={estado?.serverDeaf ? <Headphones className="size-4" strokeWidth={1.5} /> : <HeadphoneOff className="size-4" strokeWidth={1.5} />}
                  onClick={() => void ensurdecerNoServidor(guildId, userId, !estado?.serverDeaf)}
                >
                  {estado?.serverDeaf ? 'Devolver o som' : 'Ensurdecer'}
                </Botao>
              ) : null}
            </div>
            {podeMover && outrosCanais.length > 0 ? (
              <div>
                <p className="mb-1 font-mono text-10 uppercase tracking-rotulo-largo text-texto-2">
                  <span className="text-mudo">// </span>Mover para
                </p>
                <ul className="max-h-40 overflow-y-auto border border-borda">
                  {outrosCanais.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => void moverPara(guildId, userId, c.id).then((ok) => ok && aoMudar(false))}
                        className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-13 text-texto-2 hover:bg-realce hover:text-texto"
                      >
                        <Volume2 aria-hidden className="size-3.5 shrink-0 text-texto-3" strokeWidth={1.5} />
                        <span className="truncate">{c.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {podeMover ? (
              <Botao
                tamanho="sm"
                variante="perigo"
                icone={<PhoneOff className="size-4" strokeWidth={1.5} />}
                onClick={() => void moverPara(guildId, userId, null).then((ok) => ok && aoMudar(false))}
              >
                Desconectar
              </Botao>
            ) : null}
          </div>
        ) : null}
      </BalaoConteudo>
    </Balao>
  );
}

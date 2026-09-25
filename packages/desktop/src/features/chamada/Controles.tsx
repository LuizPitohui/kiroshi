import { useState, type ReactNode } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Music, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff } from 'lucide-react';
import { Permission, has } from '@kiroshi/shared';
import { voice } from '../../voice/controller.js';
import { usePermissoesNoCanal } from '../../app/permissoes.js';
import { Balao, BalaoConteudo, BalaoGatilho, cx } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { alternarFone, alternarMicrofone, sairDaVoz } from '../casca/acoesDeVoz.js';
import { SeletorDeTela } from './SeletorDeTela.js';
import { Soundboard } from './Soundboard.js';

type Tom = 'normal' | 'ligado' | 'alerta' | 'sair';

interface PropsDoControle {
  rotulo: string;
  legenda: string;
  icone: ReactNode;
  tom?: Tom;
  /** Estado de liga/desliga, para leitor de tela. */
  pressionado?: boolean;
  desativado?: boolean;
  onClick?: () => void;
}

/** Botao chanfrado com a legenda mono embaixo (MIC, CÂMERA, TELA...). */
function Controle({ rotulo, legenda, icone, tom = 'normal', pressionado, desativado, onClick, ...resto }: PropsDoControle) {
  return (
    <div className="flex w-[58px] flex-col items-center gap-[5px]">
      <button
        type="button"
        aria-label={rotulo}
        title={rotulo}
        aria-pressed={pressionado}
        disabled={desativado}
        onClick={onClick}
        {...resto}
        className={cx(
          'k-chanfro-sm grid h-[42px] w-[46px] place-items-center border outline-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-branco disabled:pointer-events-none disabled:opacity-30',
          'animado:transition-colors animado:duration-[120ms]',
          tom === 'normal' && 'border-borda-2 bg-terminal text-texto hover:border-texto-3',
          tom === 'ligado' && 'border-acento bg-acento text-sobre-acento shadow-[0_0_16px_var(--k-acento-brilho)]',
          tom === 'alerta' && 'border-perigo bg-terminal text-perigo hover:bg-acento-tenue',
          tom === 'sair' && 'border-vivo bg-vivo text-branco hover:bg-acento-2',
        )}
      >
        {icone}
      </button>
      <span aria-hidden className="font-mono text-[9px] tracking-[0.16em] text-texto-3">
        {legenda}
      </span>
    </div>
  );
}

const ic = 'size-5';

/**
 * Os controles da chamada, no pe do palco: perto do que se esta olhando, e
 * nao no rodape da janela. Microfone e fone cortados ficam vermelhos (forma
 * E cor); camera e tela ligadas ficam no acento; sair e o botao solido.
 */
export function Controles({ canalId }: { canalId: string }) {
  const conectado = useVoz((v) => v.connected);
  const mudo = useVoz((v) => v.selfMuted);
  const surdo = useVoz((v) => v.selfDeafened);
  const moderado = useVoz((v) => v.silenciadoPeloServidor || v.ensurdecidoPeloServidor);
  const camera = useVoz((v) => v.cameraOn);
  const transmitindo = useVoz((v) => v.screenSharing);
  const guildId = useVoz((v) => v.guildId);
  const permissoes = usePermissoesNoCanal(canalId);
  const [escolhendoTela, setEscolhendoTela] = useState(false);
  const [sons, setSons] = useState(false);

  const podeVideo = has(permissoes, Permission.STREAM);
  const podeSons = Boolean(guildId) && has(permissoes, Permission.USE_SOUNDBOARD) && has(permissoes, Permission.SPEAK);

  return (
    <div role="toolbar" aria-label="Controles da chamada" className="flex h-[76px] shrink-0 items-center justify-center gap-2">
      <Controle
        rotulo={moderado ? 'Silenciado pela moderação' : mudo ? 'Ligar microfone' : 'Silenciar microfone'}
        legenda={moderado ? 'MODERADO' : 'MIC'}
        tom={mudo || moderado ? 'alerta' : 'normal'}
        pressionado={mudo || moderado}
        desativado={moderado}
        icone={mudo || moderado ? <MicOff className={ic} strokeWidth={1.5} /> : <Mic className={ic} strokeWidth={1.5} />}
        onClick={() => void alternarMicrofone()}
      />
      <Controle
        rotulo={camera ? 'Desligar câmera' : 'Ligar câmera'}
        legenda="CÂMERA"
        tom={camera ? 'ligado' : 'normal'}
        pressionado={camera}
        desativado={!conectado || !podeVideo}
        icone={camera ? <Video className={ic} strokeWidth={1.5} /> : <VideoOff className={ic} strokeWidth={1.5} />}
        onClick={() => void voice.setCamera(!camera)}
      />
      <Controle
        rotulo={transmitindo ? 'Parar a transmissão' : 'Transmitir a tela'}
        legenda={transmitindo ? 'AO VIVO' : 'TELA'}
        tom={transmitindo ? 'ligado' : 'normal'}
        pressionado={transmitindo}
        desativado={!conectado || !podeVideo}
        icone={transmitindo ? <ScreenShareOff className={ic} strokeWidth={1.5} /> : <ScreenShare className={ic} strokeWidth={1.5} />}
        onClick={() => (transmitindo ? void voice.stopScreenShare() : setEscolhendoTela(true))}
      />
      {podeSons ? (
        <Balao open={sons} onOpenChange={setSons}>
          <BalaoGatilho asChild>
            <Controle rotulo="Soundboard" legenda="SONS" pressionado={sons} desativado={!conectado} icone={<Music className={ic} strokeWidth={1.5} />} />
          </BalaoGatilho>
          <BalaoConteudo rotulo="Soundboard" lado="top" alinhar="center">
            <Soundboard canalId={canalId} guildId={guildId} />
          </BalaoConteudo>
        </Balao>
      ) : null}
      <Controle
        rotulo={surdo ? 'Voltar a ouvir' : 'Silenciar o som'}
        legenda="FONE"
        tom={surdo ? 'alerta' : 'normal'}
        pressionado={surdo}
        icone={surdo ? <HeadphoneOff className={ic} strokeWidth={1.5} /> : <Headphones className={ic} strokeWidth={1.5} />}
        onClick={() => void alternarFone()}
      />
      <span aria-hidden className="mx-1.5 mb-4 h-[30px] w-px bg-borda-2" />
      <Controle rotulo="Sair da chamada" legenda="SAIR" tom="sair" icone={<PhoneOff className={ic} strokeWidth={1.5} />} onClick={sairDaVoz} />
      <SeletorDeTela aberto={escolhendoTela} aoMudar={setEscolhendoTela} />
    </div>
  );
}

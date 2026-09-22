import { useState } from 'react';
import { useStore } from '../store/index.js';
import { gateway } from '../api/gateway.js';
import { voice } from '../voice/controller.js';
import { useVoiceState } from '../hooks/useVoice.js';
import { ScreenPickerModal } from './modals/ScreenPickerModal.js';
import {
  Headphones,
  HeadphonesOff,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  Video,
  VideoOff,
} from './Icons.js';

/**
 * Os controles da chamada, em um lugar so.
 *
 * Existiam so na barra de baixo, que atravessa a largura inteira da janela.
 * Dentro de um canal de voz isso e longe: a pessoa esta olhando para o palco,
 * no meio da tela, e para desligar o microfone precisa ir ate o rodape e
 * achar o botao certo entre os de ajustes e de presenca. A especificacao pede
 * os controles ABAIXO DO PALCO justamente por isso — perto do que se esta
 * olhando.
 *
 * Os dois lugares usam este mesmo componente, e nao duas copias. A copia seria
 * o caminho natural, e seria o erro: sao cinco botoes com estado, e bastaria
 * um deles ganhar uma correcao de um lado so para o microfone dizer uma coisa
 * embaixo do palco e outra no rodape.
 *
 * `compacto` e a variante do rodape: so os icones, sem rotulo, sem o botao de
 * sair quando nao ha chamada. A variante grande ganha rotulo de texto, porque
 * abaixo do palco ha espaco e um icone de fone cortado nao explica sozinho a
 * diferenca entre "silenciar meu microfone" e "silenciar todo mundo".
 */

export interface CallControlsProps {
  /** A variante do rodape: so icones. */
  compacto?: boolean;
}

export function CallControls({ compacto = false }: CallControlsProps) {
  const voz = useVoiceState();
  const canalDeVoz = useStore((s) => (voz.channelId ? s.channels.get(voz.channelId) : null));
  const [escolhendoTela, setEscolhendoTela] = useState(false);

  const naChamada = voz.connected || voz.connecting;

  function sair(): void {
    // O gateway e avisado primeiro para os outros verem a saida mesmo que a
    // desconexao do SFU demore; `leave` nao depende dessa ordem.
    gateway.updateVoiceState({
      guildId: canalDeVoz?.guildId ?? null,
      channelId: null,
      selfMute: voz.selfMuted,
      selfDeaf: voz.selfDeafened,
    });
    void voice.leave();
  }

  const botao = (
    chave: string,
    ativo: boolean,
    classe: string,
    rotulo: string,
    icone: React.ReactNode,
    aoClicar: () => void,
    desabilitado = false,
  ) => (
    <button
      key={chave}
      className={`act ${classe}`}
      onClick={aoClicar}
      disabled={desabilitado}
      title={rotulo}
      aria-label={rotulo}
      // O estado do botao, para quem usa leitor de tela. Sem isso o rotulo
      // muda de texto mas nada anuncia que ele esta ligado ou desligado.
      aria-pressed={ativo}
    >
      {icone}
      {!compacto && <span className="act-rotulo">{rotulo}</span>}
    </button>
  );

  const tamanho = compacto ? 17 : 16;

  return (
    <>
      <div className={compacto ? 'hud-controls' : 'chamada-controles'}>
        {botao(
          'mic',
          voz.selfMuted,
          voz.selfMuted ? 'off' : '',
          voz.selfMuted ? 'Ativar microfone' : 'Silenciar microfone',
          voz.selfMuted ? <MicOff size={tamanho} /> : <Mic size={tamanho} />,
          () => void voice.setMuted(!voz.selfMuted),
        )}

        {botao(
          'fone',
          voz.selfDeafened,
          voz.selfDeafened ? 'off' : '',
          voz.selfDeafened ? 'Ouvir de novo' : 'Silenciar tudo',
          voz.selfDeafened ? <HeadphonesOff size={tamanho} /> : <Headphones size={tamanho} />,
          () => void voice.setDeafened(!voz.selfDeafened),
        )}

        {/*
          Camera e tela so fazem sentido dentro de uma chamada. Ficam sempre
          visiveis, mas desabilitados fora dela, para a barra nao mudar de
          tamanho ao entrar e sair.
        */}
        {botao(
          'camera',
          voz.cameraOn,
          voz.cameraOn ? 'on' : '',
          voz.cameraOn ? 'Desligar camera' : 'Ligar camera',
          voz.cameraOn ? <Video size={tamanho} /> : <VideoOff size={tamanho} />,
          () => void voice.setCamera(!voz.cameraOn),
          !voz.connected,
        )}

        {botao(
          'tela',
          voz.screenSharing,
          voz.screenSharing ? 'live' : '',
          voz.screenSharing ? 'Parar transmissao' : 'Compartilhar tela',
          <ScreenShare size={tamanho} />,
          () => (voz.screenSharing ? void voice.stopScreenShare() : setEscolhendoTela(true)),
          !voz.connected,
        )}

        {naChamada &&
          botao(
            'sair',
            false,
            'danger',
            'Sair da chamada',
            <PhoneOff size={tamanho} />,
            sair,
          )}
      </div>

      {escolhendoTela && <ScreenPickerModal onClose={() => setEscolhendoTela(false)} />}
    </>
  );
}

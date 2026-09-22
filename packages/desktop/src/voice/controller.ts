import {
  VideoPreset,
  ConnectionQuality,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
} from 'livekit-client';
import type { VoiceServerUpdateEvent } from '@kiroshi/shared';
import { api, ApiRequestError } from '../api/client.js';
import { lerCaminhos, type CaminhosDisponiveis } from './caminhos.js';
import { bitrateDeTela, restricoesDeTela, camadasDeTela } from './qualidade.js';
import { explicarFalhaDeMidia } from './falhas.js';
import { SaidaDeAudio } from './saida.js';
import { LimpezaDeRuido, limpezaDisponivel } from './ruido.js';

/**
 * Controle de voz, video e compartilhamento de tela.
 *
 * O LiveKit cuida do transporte; o que fica aqui e o comportamento que o
 * usuario percebe: push-to-talk, ensurdecer, volume por pessoa, escolha de
 * dispositivo, e o seletor de janela do Electron.
 *
 * Um detalhe importante: ensurdecer nao e "mutar o alto-falante". Silenciamos
 * cada faixa remota individualmente, porque assim o indicador de quem esta
 * falando continua funcionando e a pessoa ve a conversa acontecendo.
 */

export type InputMode = 'voice-activity' | 'push-to-talk';

export interface VoiceParticipant {
  userId: string;
  name: string;
  speaking: boolean;
  /** 0 a 1, para desenhar o anel de audio. */
  audioLevel: number;
  muted: boolean;
  deafened: boolean;
  hasVideo: boolean;
  hasScreenShare: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown';
  isLocal: boolean;
}

export interface VoiceSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  inputMode: InputMode;
  /** Limiar de deteccao de voz, 0 a 1. */
  voiceThreshold: number;
  /**
   * Supressor classico do WebRTC. Bom para ruido CONSTANTE — ventilador,
   * chiado, ar-condicionado — e fraco para transiente: teclado, clique de
   * mouse, porta batendo.
   */
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /**
   * Isolamento de voz: o modelo que separa a voz de quem fala do resto.
   *
   * E outra coisa, nao um `noiseSuppression` mais forte. Enquanto aquele
   * estima um piso de ruido e o subtrai, este reconhece VOZ e descarta o que
   * nao for — teclado, televisao, outra pessoa falando no mesmo comodo.
   *
   * Medido nesta maquina: sem pedir, o navegador entrega `voiceIsolation:
   * false`. Ou seja, quem so liga a supressao de ruido esta usando metade do
   * que existe, e a metade fraca. Era dai que vinha "da para ouvir o teclado
   * dos outros".
   *
   * Pedido como preferencia, nao como exigencia: em maquina que nao suporta,
   * a captura continua funcionando sem ele em vez de falhar.
   */
  voiceIsolation: boolean;
  /**
   * Limpeza reforcada com RNNoise, no lugar da do navegador.
   *
   * SUBSTITUI, nao soma. Ligada, a captura desliga `noiseSuppression` e
   * `voiceIsolation`: modelos sao treinados em audio cru, e alimentar um com
   * a saida do outro da voz robotica e gasta processador duas vezes.
   *
   * Ligada por padrao porque foi medido que a do navegador nao basta — os
   * quatro ajustes confirmados ligados, e teclado ainda passando.
   */
  limpezaDeRuido: boolean;
  /** Volume de saida geral, 0 a 1. */
  outputVolume: number;
  /** Volume da VOZ de cada pessoa, 0 a 2. */
  userVolumes: Record<string, number>;
  /**
   * Volume do AUDIO DA TRANSMISSAO de cada pessoa, 0 a 2.
   *
   * Separado da voz de proposito, e a separacao e o ponto: quem transmite um
   * jogo manda som alto de jogo pelo mesmo canal em que fala. Um controle so
   * obrigaria a escolher entre ouvir a pessoa e ouvir o jogo — e quem abaixa
   * o volume para aguentar a trilha sonora acaba nao ouvindo mais o amigo.
   */
  screenVolumes: Record<string, number>;
  /**
   * Avisos sonoros quando alguem entra ou sai da chamada.
   *
   * Ligado por padrao: e a informacao que mais se perde quando a janela esta
   * atras de um jogo, que e onde este aplicativo passa a maior parte do tempo.
   */
  avisosSonoros: boolean;
}

/** De onde vem o audio de uma pessoa: a voz dela ou a transmissao dela. */
type FonteDeAudio = 'voz' | 'tela';

interface AudioRemoto {
  elemento: HTMLAudioElement;
  identidade: string;
  fonte: FonteDeAudio;
}

const SETTINGS_KEY = 'kiroshi.voice';

const DEFAULT_SETTINGS: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputMode: 'voice-activity',
  voiceThreshold: 0.02,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  voiceIsolation: true,
  limpezaDeRuido: true,
  outputVolume: 1,
  userVolumes: {},
  screenVolumes: {},
  avisosSonoros: true,
};

type Listener = () => void;

export interface VoiceState {
  connected: boolean;
  connecting: boolean;
  channelId: string | null;
  guildId: string | null;
  participants: VoiceParticipant[];
  selfMuted: boolean;
  selfDeafened: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  /** Erro da ultima tentativa de conexao, para mostrar na interface. */
  error: string | null;
  /** Latencia ida e volta em ms, quando disponivel. */
  ping: number | null;
  /**
   * Sobe a cada mudanca de faixa na sala.
   *
   * Quem desenha video precisa buscar a faixa de novo quando ela chega, e nao
   * da para saber disso olhando so para `hasVideo`: a publicacao aparece antes
   * da assinatura, entao o quadro tenta pegar a faixa cedo demais, recebe nulo
   * e ficaria preto para sempre esperando um sinal que nao vem.
   */
  mediaVersion: number;
  /**
   * De quem eu escolhi assistir a transmissao.
   *
   * Lista e nao `Set` porque vai para dentro do estado do React, e comparar
   * `Set` por identidade nao detecta mudanca de conteudo.
   */
  assistindo: string[];
}

class VoiceController {
  private room: Room | null = null;
  private micTrack: LocalAudioTrack | null = null;
  private cameraTrack: LocalVideoTrack | null = null;
  private screenTracks: (LocalVideoTrack | LocalAudioTrack)[] = [];

  private settings: VoiceSettings = this.loadSettings();

  private state: VoiceState = {
    connected: false,
    connecting: false,
    channelId: null,
    guildId: null,
    participants: [],
    selfMuted: false,
    selfDeafened: false,
    cameraOn: false,
    screenSharing: false,
    error: null,
    ping: null,
    mediaVersion: 0,
    assistindo: [],
  };

  private readonly listeners = new Set<Listener>();

  /**
   * Elementos de audio das faixas remotas.
   *
   * A chave junta identidade E fonte. Antes era so a identidade, e isso fazia
   * o audio da transmissao de alguem SOBRESCREVER o microfone dessa mesma
   * pessoa no registro: sobrava um elemento tocando sem ninguem rastreando, e
   * os dois respondiam ao mesmo controle de volume. E o motivo de nao existir
   * volume separado ate agora.
   */
  private readonly audioElements = new Map<string, AudioRemoto>();

  /*
    A cadeia de saida existe porque o volume do ELEMENTO para em 100%.

    Ver `voice/saida.ts`: o controle por pessoa vai a 200%, e passar de 1 no
    elemento lanca excecao. Sem isto, tudo acima de cem por cento era
    silenciosamente descartado.
  */
  private readonly saida = new SaidaDeAudio();

  /** Enquanto true, o push-to-talk esta com a tecla pressionada. */
  private pttActive = false;

  /**
   * Marca que a saida foi decidida aqui, nao sofrida.
   *
   * O evento de desconexao do LiveKit e o mesmo nos dois casos: clicar em
   * sair e a midia morrer. Sem separar, ou o app explica uma queda que nao
   * houve, ou cala numa que houve — e calar foi o que deixou alguem sem voz
   * sem nunca saber o motivo.
   */
  private saindoDeProposito = false;

  /** Ultima assinatura de faixas vista, para so avisar a interface quando mudar. */
  private ultimaAssinaturaDeMidia = '';

  /**
   * Quem eu escolhi assistir. Identidades de quem transmite.
   *
   * Assistir e uma DECISAO, e nao o padrao. Antes toda transmissao entrava na
   * grade sozinha, o video vinha pela rede querendo ou nao, e a pessoa que so
   * queria conversar pagava banda e espaco de tela por algo que nao pediu.
   *
   * Isso tambem e o que conserta a qualidade cair sozinha. O LiveKit escolhe
   * a camada de video pelo TAMANHO do quadro na tela de quem assiste — quadro
   * pequeno na grade, camada baixa. Como cada pessoa que entrava ou saia da
   * chamada rearranjava o palco e mudava o tamanho dos quadros, a camada
   * trocava junto: 1080p que "perde qualidade do nada". Assistir de proposito
   * poe a transmissao em destaque, grande, e a camada cheia vem junto.
   */
  private assistindo = new Set<string>();

  private loadSettings(): VoiceSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<VoiceSettings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  getSettings(): VoiceSettings {
    return this.settings;
  }

  getState(): VoiceState {
    return this.state;
  }

  /**
   * Apaga o aviso da ultima falha.
   *
   * Existe porque o aviso nao tinha saida nenhuma. Ele so era limpo dentro do
   * `joinChannel`, entao quem levasse uma queda e nao tentasse entrar de novo
   * ficava com a mensagem na barra para sempre — inclusive depois do problema
   * ter passado, dizendo que a internet nao tem IPv6 para alguem que estava
   * conversando normalmente. Um aviso que nao some vira mobilia, e a pessoa
   * para de ler tambem os que importam.
   */
  clearError(): void {
    if (this.state.error === null) return;
    this.emit({ error: null });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<VoiceState> = {}): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ---------------------------------------------------------------------------
  // Conexao
  // ---------------------------------------------------------------------------

  /**
   * Entra em um canal de voz.
   *
   * O cliente pede o token e conecta por conta propria, em vez de esperar o
   * servidor mandar um pelo gateway. A diferenca importa: o servidor so emitia
   * token quando achava que algo mudou, e se o app perdesse a conexao com o
   * SFU sem que o servidor soubesse, a pessoa clicava no canal e nada
   * acontecia — para sempre, porque do ponto de vista do servidor ela ja
   * estava la.
   *
   * Quem sabe se ha conexao de midia e quem a mantem. Entao a decisao e daqui.
   */
  async joinChannel(channelId: string, guildId: string | null): Promise<void> {
    if (this.isConnectedTo(channelId)) return;

    this.emit({ connecting: true, error: null, channelId, guildId });

    try {
      const info = await api.post<VoiceServerUpdateEvent>('/voice/join', { channelId });
      await this.connect({ ...info, channelId, guildId });
    } catch (error) {
      this.emit({
        connecting: false,
        connected: false,
        channelId: null,
        guildId: null,
        error:
          error instanceof ApiRequestError ? error.message : 'Nao consegui entrar no canal de voz.',
      });
      throw error;
    }
  }

  async connect(payload: VoiceServerUpdateEvent): Promise<void> {
    // O servidor tambem manda token pelo gateway, e depois de entrar por conta
    // propria esse aviso chega como eco. Reconectar ali derrubaria uma chamada
    // que ja esta funcionando, entao ignoramos quando ja estamos na sala.
    if (this.isConnectedTo(payload.channelId)) return;

    // Trocar de canal: sai da sala anterior antes de entrar na nova.
    if (this.room) await this.leave();

    // Depois do leave acima, senao a saida intencional dele deixaria a marca
    // ligada e a proxima queda de verdade passaria por saida voluntaria.
    this.saindoDeProposito = false;

    this.emit({
      connecting: true,
      error: null,
      channelId: payload.channelId,
      guildId: payload.guildId,
    });

    const options: RoomOptions = {
      adaptiveStream: true,
      // Publica varias resolucoes: quem esta com a janela pequena ou com
      // internet ruim recebe a menor sem afetar os outros.
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: undefined,
        /*
          64 kbps, e nao 32.

          Bitrate nao e volume — nao resolve "a voz esta baixa" —, mas resolve
          a voz fina e abafada que se confunde com baixa. A 32 kbps o Opus
          corta os agudos, e consoante sem agudo vira sopro: da para ouvir que
          a pessoa falou e nao o que ela disse.

          64 kbps e tambem o padrao do Discord para canal de voz. Com DTX
          ligado nao se transmite silencio, entao o custo real fica bem abaixo
          do numero em quase toda conversa.
        */
        audioPreset: { maxBitrate: 64_000 },
        dtx: true,
        red: true,
      },
      audioCaptureDefaults: {
        deviceId: this.settings.inputDeviceId ?? undefined,
        echoCancellation: this.settings.echoCancellation,
        ...this.limpezaDoNavegador(),
      },
      videoCaptureDefaults: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
    };

    const room = new Room(options);
    this.room = room;

    this.wireRoomEvents(room);

    try {
      await room.connect(payload.url, payload.token, {
        // Com NAT restritivo o caminho direto nao fecha; o relay resolve ao
        // custo de um pouco de latencia.
        rtcConfig: {
          iceServers: payload.iceServers.length > 0 ? payload.iceServers : undefined,
          iceTransportPolicy: payload.forceRelay ? 'relay' : undefined,
        },
        autoSubscribe: true,
        maxRetries: 3,
      });

      // Entrar na sala e publicar o microfone sao coisas separadas de
      // proposito. Quem nao tem microfone, ou negou a permissao, ainda deve
      // conseguir entrar para ouvir e ver a tela de alguem. Tratar a falha do
      // microfone como falha da chamada deixaria essa pessoa de fora.
      try {
        await this.publishMicrophone();
      } catch (micError) {
        this.emit({
          error:
            'Entrou sem microfone. Voce ouve os outros, mas eles nao ouvem voce. ' +
            'Confira a permissao de microfone nos ajustes do sistema.',
        });
        console.warn('microfone indisponivel, seguindo so como ouvinte', micError);
      }

      this.emit({ connected: true, connecting: false });
      this.refreshParticipants();
    } catch (error) {
      this.emit({
        connecting: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Nao consegui entrar na chamada.',
      });
      await this.leave();
      throw error;
    }
  }

  private wireRoomEvents(room: Room): void {
    room
      .on(RoomEvent.ParticipantConnected, () => this.refreshParticipants())
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        // Voz E audio de transmissao: sao dois registros, e deixar um para
        // tras deixava um elemento de audio orfao preso no documento.
        for (const fonte of ['voz', 'tela'] as const) {
          const chave = `${participant.identity}|${fonte}`;
          const saindo = this.audioElements.get(chave)?.elemento;
          if (saindo) {
            this.saida.desligar(saindo);
            saindo.remove();
          }
          this.audioElements.delete(chave);
        }
        this.refreshParticipants();
      })
      .on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Audio) {
            // Audio de transmissao e voz sao coisas diferentes para quem
            // ouve, e cada um tem o proprio controle de volume.
            const fonte = pub.source === Track.Source.ScreenShareAudio ? 'tela' : 'voz';
            this.attachRemoteAudio(track, participant, fonte);
          }
          this.refreshParticipants();
        },
      )
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        this.refreshParticipants();
      })
      .on(RoomEvent.TrackMuted, () => this.refreshParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.refreshParticipants())
      .on(RoomEvent.LocalTrackPublished, () => this.refreshParticipants())
      .on(RoomEvent.LocalTrackUnpublished, () => this.refreshParticipants())
      .on(RoomEvent.ActiveSpeakersChanged, () => this.refreshParticipants())
      .on(RoomEvent.ConnectionQualityChanged, () => this.refreshParticipants())
      .on(RoomEvent.Disconnected, (motivo?: unknown) => {
        const inesperada = !this.saindoDeProposito;

        /*
          Solta a sala aqui, nao so no leave().

          Sem isto ficava uma chamada fantasma: o objeto da sala continuava
          vivo, o temporizador que amostra audio seguia rodando e repovoando
          a lista de participantes a partir de uma conexao morta, e o palco
          ficava na tela. Pior: a barra escondia o botao de sair, porque para
          ela a chamada tinha acabado. A pessoa ficava presa olhando uma
          chamada que nao existia, sem como abandonar.
        */
        this.descartarSala();

        this.emit({
          connected: false,
          connecting: false,
          participants: [],
          channelId: inesperada ? null : this.state.channelId,
          guildId: inesperada ? null : this.state.guildId,
          cameraOn: false,
          screenSharing: false,
          ping: null,
        });

        // Sair por vontade propria nao e falha; so o resto merece explicacao.
        if (inesperada) void this.explicarQueda(motivo);
      })
      .on(RoomEvent.Reconnecting, () => this.emit({ connecting: true }))
      .on(RoomEvent.Reconnected, () => {
        this.emit({ connecting: false, connected: true });
        this.refreshParticipants();
      })
      .on(RoomEvent.MediaDevicesError, (error: Error) => {
        this.emit({ error: `Problema com o dispositivo de audio: ${error.message}` });
      });

    // Amostra periodica do nivel de audio para desenhar o anel de quem fala.
    const levelTimer = setInterval(() => {
      if (!this.room) {
        clearInterval(levelTimer);
        return;
      }
      this.refreshParticipants();
    }, 200);

    // A latencia muda devagar e custa uma leitura de estatisticas do WebRTC;
    // dois segundos e frequente o bastante para a pessoa ver a conexao piorar
    // e raro o bastante para nao pesar.
    const statsTimer = setInterval(() => {
      if (!this.room) {
        clearInterval(statsTimer);
        return;
      }
      void this.samplePing();
    }, 2000);
  }

  /** Le o tempo de ida e volta ate o SFU e guarda no estado. */
  private async samplePing(): Promise<void> {
    const stats = await this.inspectConnection();
    if (stats.latenciaMs === this.state.ping) return;
    this.emit({ ping: stats.latenciaMs });
  }

  /** O volume final de uma faixa: geral vezes o ajuste daquela fonte. */
  private volumeDe(identidade: string, fonte: FonteDeAudio): number {
    if (this.state.selfDeafened) return 0;
    const individual =
      fonte === 'tela'
        ? (this.settings.screenVolumes[identidade] ?? 1)
        : (this.settings.userVolumes[identidade] ?? 1);
    /*
      Sem `Math.min(1, ...)` aqui.

      Aquele limite nao era protecao: era o defeito. O elemento de audio recusa
      valores acima de 1, e o `min` escondia isso em vez de resolver — quem
      punha 150% no cartao continuava ouvindo 100%. Quem segura o teto agora e
      a cadeia de saida, ate `GANHO_MAXIMO`.
    */
    return this.settings.outputVolume * individual;
  }

  /** Reaplica o volume em tudo que esta tocando. */
  private aplicarVolumes(): void {
    for (const a of this.audioElements.values()) {
      const volume = this.volumeDe(a.identidade, a.fonte);
      if (this.saida.ativa) {
        this.saida.ajustar(a.elemento, volume);
      } else {
        // Sem Web Audio, volta ao elemento — e ao teto de 100%. Ouvir baixo
        // e melhor do que nao ouvir.
        a.elemento.volume = Math.min(1, volume);
      }
    }
  }

  private attachRemoteAudio(
    track: RemoteTrack,
    participant: RemoteParticipant,
    fonte: FonteDeAudio,
  ): void {
    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;

    const volume = this.volumeDe(participant.identity, fonte);
    if (this.saida.ligar(element)) {
      this.saida.ajustar(element, volume);
      if (this.settings.outputDeviceId) {
        void this.saida.trocarSaida(this.settings.outputDeviceId);
      }
    } else {
      element.volume = Math.min(1, volume);
    }

    if (this.settings.outputDeviceId && 'setSinkId' in element) {
      void (element as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(this.settings.outputDeviceId)
        .catch(() => undefined);
    }

    document.body.appendChild(element);
    this.audioElements.set(`${participant.identity}|${fonte}`, {
      elemento: element,
      identidade: participant.identity,
      fonte,
    });
  }

  private refreshParticipants(): void {
    // Antes de recontar: transmissao que ninguem pediu nao deve estar chegando.
    this.recusarTransmissoesNaoPedidas();

    const room = this.room;
    if (!room) {
      this.emit({ participants: [] });
      return;
    }

    const toEntry = (participant: Participant, isLocal: boolean): VoiceParticipant => {
      const camera = participant.getTrackPublication(Track.Source.Camera);
      const screen = participant.getTrackPublication(Track.Source.ScreenShare);
      const mic = participant.getTrackPublication(Track.Source.Microphone);

      const quality =
        participant.connectionQuality === ConnectionQuality.Excellent
          ? 'excellent'
          : participant.connectionQuality === ConnectionQuality.Good
            ? 'good'
            : participant.connectionQuality === ConnectionQuality.Poor
              ? 'poor'
              : 'unknown';

      return {
        userId: participant.identity,
        name: participant.name || participant.identity,
        speaking: participant.isSpeaking,
        audioLevel: participant.audioLevel,
        muted: !mic || mic.isMuted,
        deafened: false,
        hasVideo: Boolean(camera && !camera.isMuted),
        hasScreenShare: Boolean(screen && !screen.isMuted),
        connectionQuality: quality,
        isLocal,
      };
    };

    const participants: VoiceParticipant[] = [
      toEntry(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => toEntry(p, false)),
    ];

    /*
      `mediaVersion` so anda quando as FAIXAS mudam.

      Ele existe para a interface saber que precisa anexar o video de novo, e
      esta funcao roda a cada 200 ms para desenhar o anel de quem fala. Somar
      um a cada passagem fazia a versao andar cinco vezes por segundo, e cada
      passo desanexava e reanexava a faixa: `detach` zera o `srcObject`, entao
      o quadro ficava preto e voltava cinco vezes por segundo. Era esse o
      piscar da camera e da transmissao.

      A assinatura junta quem esta publicando o que, pelo identificador da
      faixa. Nivel de audio, quem esta falando e qualidade de conexao mudam o
      tempo todo e ficam de fora de proposito: nada disso exige reanexar nada.
    */
    const assinatura = this.assinaturaDeMidia(room);
    const mudou = assinatura !== this.ultimaAssinaturaDeMidia;
    if (mudou) this.ultimaAssinaturaDeMidia = assinatura;

    this.emit({ participants, ...(mudou ? { mediaVersion: this.state.mediaVersion + 1 } : {}) });
  }

  /**
   * Quem publica qual faixa, agora.
   *
   * O identificador da faixa entra junto porque trocar de camera despublica
   * uma e publica outra: sem ele a assinatura ficaria igual e o video novo
   * nunca apareceria.
   */
  private assinaturaDeMidia(room: Room): string {
    const partes: string[] = [];

    const anotar = (participante: Participant): void => {
      for (const fonte of [Track.Source.Camera, Track.Source.ScreenShare]) {
        const publicacao = participante.getTrackPublication(fonte);
        const vivo = publicacao && !publicacao.isMuted && publicacao.track;
        partes.push(`${participante.identity}:${fonte}:${vivo ? publicacao.trackSid : '-'}`);
      }
    };

    anotar(room.localParticipant);
    for (const p of room.remoteParticipants.values()) anotar(p);

    // Ordenado: a ordem do mapa de participantes nao e estavel, e uma troca de
    // ordem sozinha nao e motivo para reanexar video de ninguem.
    return partes.sort().join('|');
  }

  async leave(): Promise<void> {
    this.saindoDeProposito = true;

    // Avisa os outros antes de derrubar as faixas: despublicar com a sala
    // ainda de pe tira o quadro da tela de quem ficou na hora, em vez de
    // deixar um retrato congelado ate o tempo limite.
    await this.stopScreenShare().catch(() => undefined);
    await this.setCamera(false).catch(() => undefined);

    if (this.room) await this.room.disconnect().catch(() => undefined);

    // A mesma limpeza da queda inesperada, para os dois caminhos nao
    // divergirem: um deles ja ficou para tras e deixou chamada fantasma.
    this.descartarSala();

    this.emit({
      connected: false,
      connecting: false,
      channelId: null,
      guildId: null,
      participants: [],
      cameraOn: false,
      screenSharing: false,
      ping: null,
      assistindo: [],
    });
  }

  // ---------------------------------------------------------------------------
  // Microfone
  // ---------------------------------------------------------------------------

  /**
   * A limpeza que o NAVEGADOR faz, conforme quem esta no comando.
   *
   * Com o RNNoise ligado, a do navegador sai de cena inteira. Deixar as duas
   * seria empilhar dois modelos sobre o mesmo sinal — o segundo recebe algo
   * que ja nao parece a voz humana em que foi treinado, e o resultado e pior
   * que qualquer um dos dois sozinho.
   *
   * O ganho automatico fica em ambos os casos: ele nivela volume, nao remove
   * ruido, entao nao disputa com ninguem.
   */
  private limpezaDoNavegador(): {
    noiseSuppression: boolean;
    autoGainControl: boolean;
    voiceIsolation: boolean;
  } {
    const comRnnoise = this.settings.limpezaDeRuido && limpezaDisponivel();
    return {
      noiseSuppression: comRnnoise ? false : this.settings.noiseSuppression,
      voiceIsolation: comRnnoise ? false : this.settings.voiceIsolation,
      autoGainControl: this.settings.autoGainControl,
    };
  }

  private async publishMicrophone(): Promise<void> {
    const room = this.room;
    if (!room) return;

    this.micTrack = await createLocalAudioTrack({
      deviceId: this.settings.inputDeviceId ?? undefined,
      echoCancellation: this.settings.echoCancellation,
      ...this.limpezaDoNavegador(),
    });

    /*
      O processador entra ANTES de publicar.

      Depois de publicada, a faixa ja esta indo para o codificador: trocar o
      processamento ali no meio produz um corte audivel em quem esta ouvindo.
    */
    if (this.settings.limpezaDeRuido && limpezaDisponivel()) {
      try {
        await this.micTrack.setProcessor(new LimpezaDeRuido());
      } catch (erro) {
        // Falhar aqui nao pode calar o microfone: sem limpeza e muito melhor
        // do que sem voz. Fica o ruido, que e o problema que ja existia.
        console.warn('limpeza de ruido indisponivel nesta maquina', erro);
      }
    }

    await room.localParticipant.publishTrack(this.micTrack, {
      source: Track.Source.Microphone,
      dtx: true,
      red: true,
    });

    // No modo push-to-talk o microfone comeca fechado.
    const shouldMute = this.state.selfMuted || this.settings.inputMode === 'push-to-talk';
    if (shouldMute) await this.micTrack.mute();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.emit({ selfMuted: muted });

    // Sem faixa de microfone (entrou so para ouvir), tenta publicar agora: a
    // pessoa pode ter concedido a permissao depois de entrar.
    if (!this.micTrack && !muted && this.room) {
      try {
        await this.publishMicrophone();
        this.emit({ error: null });
      } catch {
        this.emit({ error: 'Microfone ainda indisponivel.' });
      }
      this.refreshParticipants();
      return;
    }

    if (!this.micTrack) return;

    if (muted) await this.micTrack.mute();
    else if (this.settings.inputMode !== 'push-to-talk' || this.pttActive) {
      await this.micTrack.unmute();
    }
    this.refreshParticipants();
  }

  async setDeafened(deafened: boolean): Promise<void> {
    this.emit({ selfDeafened: deafened });

    // Uma passada so cobre as duas fontes de cada pessoa — voz e transmissao.
    // O proprio `aplicarVolumes` le `selfDeafened`, que acabou de mudar acima.
    this.aplicarVolumes();

    // Ensurdecer tambem fecha o proprio microfone: e o comportamento que as
    // pessoas esperam, e evita falar sozinho sem perceber.
    if (deafened && !this.state.selfMuted) await this.setMuted(true);
  }

  /** Chamado no keydown e keyup da tecla de push-to-talk. */
  async setPushToTalkActive(active: boolean): Promise<void> {
    if (this.settings.inputMode !== 'push-to-talk') return;
    if (this.pttActive === active) return;

    this.pttActive = active;
    if (!this.micTrack || this.state.selfMuted || this.state.selfDeafened) return;

    if (active) await this.micTrack.unmute();
    else await this.micTrack.mute();

    this.refreshParticipants();
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  async setCamera(enabled: boolean, deviceId?: string): Promise<void> {
    const room = this.room;
    if (!room) return;

    if (!enabled) {
      if (this.cameraTrack) {
        await room.localParticipant.unpublishTrack(this.cameraTrack);
        this.cameraTrack.stop();
        this.cameraTrack = null;
      }
      this.emit({ cameraOn: false, error: null });
      this.refreshParticipants();
      return;
    }

    this.emit({ error: null });

    try {
      this.cameraTrack = await this.abrirCamera(deviceId);

      await room.localParticipant.publishTrack(this.cameraTrack, {
        source: Track.Source.Camera,
        simulcast: true,
      });

      this.emit({ cameraOn: true, error: null });
      this.refreshParticipants();
    } catch (erro) {
      // Sem isto a falha morria aqui: quem chama usa `void`, entao a promessa
      // rejeitada nao tinha ninguem para ouvir. O botao voltava sozinho para
      // "ligar camera" e a pessoa ficava clicando sem nunca saber por que.
      this.cameraTrack?.stop();
      this.cameraTrack = null;
      this.emit({ cameraOn: false, error: explicarFalhaDeMidia(erro, 'camera') });
      this.refreshParticipants();
    }
  }

  /**
   * Abre a camera, cedendo na qualidade antes de desistir.
   *
   * Pedir 720p a 30 fps funciona na maioria das webcams, mas camera virtual
   * (celular como webcam, OBS) costuma oferecer um punhado de modos fixos e
   * recusa o pedido inteiro quando nao bate — um `OverconstrainedError` que,
   * para a pessoa, parece simplesmente nao funcionar. A segunda tentativa
   * aceita o que o dispositivo tiver.
   */
  private async abrirCamera(deviceId?: string): Promise<LocalVideoTrack> {
    /*
      Tenta do melhor para o pior, em vez de um modo unico.

      Antes pedia 720p e pronto. Webcam boa faz 1080p e ficava entregando
      metade disso; camera virtual (celular como webcam, OBS) costuma oferecer
      um punhado de modos fixos e recusa o pedido inteiro quando nao bate — um
      `OverconstrainedError` que, para a pessoa, parece simplesmente nao
      funcionar.

      A ultima tentativa vai sem exigencia nenhuma: qualquer imagem e melhor
      que um erro.
    */
    const modos = [
      { width: 1920, height: 1080, frameRate: 30 },
      { width: 1280, height: 720, frameRate: 30 },
    ];

    for (const resolution of modos) {
      try {
        return await createLocalVideoTrack({ deviceId, resolution });
      } catch (erro) {
        // So insiste quando a recusa foi do formato. Permissao negada ou
        // camera em uso por outro programa nao melhoram com outro modo, e
        // tentar de novo so atrasaria a mensagem de erro.
        if (!ehRestricaoImpossivel(erro)) throw erro;
      }
    }

    return createLocalVideoTrack({ deviceId });
  }

  // ---------------------------------------------------------------------------
  // Compartilhamento de tela
  // ---------------------------------------------------------------------------

  /**
   * Compartilha uma tela ou janela escolhida no seletor do Electron.
   *
   * O fluxo tem duas etapas porque o Chromium decide a fonte dentro do
   * getDisplayMedia: primeiro avisamos o processo principal qual fonte usar,
   * depois pedimos a captura e o handler la responde com ela.
   */
  /**
   * Comeca a transmitir uma tela.
   *
   * Devolve se o som do sistema entrou junto, e por que nao entrou quando for
   * o caso. Quem chama precisa saber: prometemos o som na tela do seletor, e
   * transmitir em silencio sem avisar e pior que nao transmitir.
   */
  async startScreenShare(
    sourceId: string,
    options: { withAudio?: boolean; fps?: number; maxHeight?: number } = {},
  ): Promise<{ comSom: boolean; motivoSemSom: string | null }> {
    const room = this.room;
    if (!room) throw new Error('Entre em um canal de voz antes de compartilhar a tela.');

    /*
      Derruba qualquer transmissao anterior antes de comecar outra.

      Sem isto, `this.screenTracks = published` no fim desta funcao sobrescrevia
      a lista e ORFANAVA as faixas antigas: elas continuavam publicadas no
      servidor, e o `stopScreenShare` — que so percorre a lista atual — nao
      tinha mais como alcanca-las. O resultado ficava para sempre.

      Visto em uma chamada real: uma pessoa aparecia no SFU com DUAS faixas de
      tela 1920x1080 ao mesmo tempo, com identificadores diferentes, subindo a
      mesma imagem duas vezes. Quem paga esse dobro e o upload de quem
      transmite, que ja e o mais apertado dos dois lados.

      A limpeza varre as publicacoes do servidor, e nao so a lista local: e
      justamente a lista local que pode ter perdido o rastro.
    */
    await this.derrubarTransmissoesAnteriores();

    const quisSom = options.withAudio ?? false;
    const fps = options.fps ?? 30;
    const altura = options.maxHeight ?? 1080;

    /*
      A captura limita a ALTURA, e so ela. A conta mora em `qualidade.ts`,
      junto de um teste que passa cada formato de monitor real por ela.

      Havia tambem um teto de largura aqui, e ele quebrava exatamente quem
      dizia proteger — ver o comentario de `restricoesDeTela`.
    */
    const video = restricoesDeTela(altura, fps);

    let stream: MediaStream;
    let motivoSemSom: string | null = null;

    await window.kiroshi.screen.select(sourceId, quisSom);

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: quisSom });
    } catch (erro) {
      /*
        O som nao pode levar o video junto.

        Pedir tela COM som e uma chamada so: se a captura de audio do sistema
        falhar, o navegador rejeita tudo, inclusive a imagem. Visto em uma
        maquina real — sem som transmitia normalmente, com som nao transmitia
        nada — e a pessoa perdia a unica coisa que tinha ido fazer por causa
        de um extra.

        Entao tenta de novo sem o som e conta o que aconteceu. A escolha entre
        "tela muda" e "nada" nao devia nem existir, mas quando existe, tela
        muda ganha.

        O `select` vai de novo porque o processo principal descarta a escolha
        depois de responder ao primeiro pedido.
      */
      if (!quisSom) throw erro;

      motivoSemSom = explicarFalhaDeMidia(erro, 'som-da-tela');
      await window.kiroshi.screen.select(sourceId, false);
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    }

    /*
      Pode vir sem faixa de audio mesmo sem erro nenhum: o Windows entrega a
      imagem e simplesmente omite o loopback. Silencioso, e o mesmo resultado
      pratico, entao tambem precisa ser dito.
    */
    if (quisSom && !motivoSemSom && stream.getAudioTracks().length === 0) {
      motivoSemSom = 'O Windows nao entregou o audio do sistema.';
    }

    const published: (LocalVideoTrack | LocalAudioTrack)[] = [];

    for (const mediaTrack of stream.getTracks()) {
      if (mediaTrack.kind === 'video') {
        const track = new LocalVideoTrack(mediaTrack);
        await room.localParticipant.publishTrack(track, {
          source: Track.Source.ScreenShare,
          simulcast: true,
          /*
            `screenShareEncoding`, e nao `videoEncoding`.

            O LiveKit descarta `videoEncoding` quando a fonte e tela — em
            `computeVideoEncodings`: `if (isScreenShare) videoEncoding =
            options.screenShareEncoding`. Sem este campo ele usava o proprio
            padrao, `h1080fps15`: 2,5 Mbps e QUINZE quadros por segundo.

            Isso foi medido no SFU durante uma chamada de verdade, nao
            deduzido: a camada de topo publicada estava em 1920x1080@2500kbps.
            Quem escolhia "1080p, 60 fps — jogos" recebia 15 fps desde sempre,
            e nada na tela dizia isso.
          */
          screenShareEncoding: {
            maxBitrate: bitrateDeTela(altura, fps),
            maxFramerate: fps,
            priority: 'high',
          },
          // Um degrau no meio: sem ele a queda ia de 1080p direto para 540p,
          // que e a diferenca entre ler o texto da tela e nao ler.
          screenShareSimulcastLayers: camadasDeTela(altura, fps).map(
            (c) => new VideoPreset(c.largura, c.altura, c.bitrate, c.fps),
          ),
          /*
            A preferencia acompanha o que a pessoa escolheu.

            Quando a banda aperta, o codificador tem que abrir mao de algo.
            Fixar `maintain-resolution` para todos os modos era o que tornava a
            opcao de 60 fps inutil: ela segurava os 1080p e derrubava a taxa de
            quadros, ou seja, entregava exatamente o contrario do pedido.

            A 60 fps o motivo e movimento — jogo, video — e fluidez vem antes.
            A 30 fps o motivo e ler a tela, e nitidez vem antes.
          */
          degradationPreference: fps >= 60 ? 'maintain-framerate' : 'maintain-resolution',
        });
        published.push(track);
      } else {
        const track = new LocalAudioTrack(mediaTrack);
        await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio });
        published.push(track);
      }
    }

    // Quem parar pelo aviso do sistema operacional tambem precisa encerrar aqui.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      void this.stopScreenShare();
    });

    this.screenTracks = published;
    this.emit({ screenSharing: true });
    this.refreshParticipants();

    return { comSom: motivoSemSom === null && quisSom, motivoSemSom };
  }

  /**
   * Tira do ar TODA faixa de tela publicada por mim, conhecida ou nao.
   *
   * A diferenca para o `stopScreenShare` esta em onde cada um procura.
   * Aquele percorre `this.screenTracks`, a lista que o proprio aplicativo
   * mantem; este pergunta ao SERVIDOR o que esta publicado. Sao a mesma coisa
   * enquanto nada se perde — e o caso interessante e exatamente quando algo
   * se perdeu.
   */
  private async derrubarTransmissoesAnteriores(): Promise<void> {
    const room = this.room;
    if (!room) return;

    for (const pub of room.localParticipant.trackPublications.values()) {
      const deTela =
        pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
      if (!deTela || !pub.track) continue;
      await room.localParticipant.unpublishTrack(pub.track).catch(() => undefined);
      pub.track.stop();
    }

    for (const track of this.screenTracks) track.stop();
    this.screenTracks = [];
  }

  async stopScreenShare(): Promise<void> {
    const room = this.room;
    if (!room) return;

    await this.derrubarTransmissoesAnteriores();

    this.emit({ screenSharing: false });
    this.refreshParticipants();
  }

  /** Faixa de video de um participante, para o componente de video anexar. */
  // ---------------------------------------------------------------------------
  // Assistir transmissoes
  // ---------------------------------------------------------------------------

  /** A publicacao de tela de alguem, quando ela e remota. */
  private publicacaoDeTela(userId: string): RemoteTrackPublication | null {
    const room = this.room;
    if (!room) return null;
    for (const p of room.remoteParticipants.values()) {
      if (p.identity !== userId) continue;
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      return (pub as RemoteTrackPublication | undefined) ?? null;
    }
    return null;
  }

  estouAssistindo(userId: string): boolean {
    return this.assistindo.has(userId);
  }

  /**
   * Passa a receber a transmissao de alguem.
   *
   * A inscricao e explicita, nao automatica. Alem de poupar a banda de quem
   * nao quer assistir, e o que garante a qualidade: quem assiste poe a
   * transmissao em destaque, o quadro fica grande, e o LiveKit passa a pedir a
   * camada cheia em vez da miniatura.
   */
  async assistirTransmissao(userId: string): Promise<void> {
    if (this.assistindo.has(userId)) return;
    this.assistindo.add(userId);
    this.publicacaoDeTela(userId)?.setSubscribed(true);
    this.emit({ assistindo: [...this.assistindo] });
  }

  async pararDeAssistir(userId: string): Promise<void> {
    if (!this.assistindo.delete(userId)) return;
    /*
      Cancelar a inscricao, e nao so esconder o quadro.

      Esconder economiza espaco de tela e nada mais: o video continuaria
      chegando pela rede, que e o custo que mais pesa em quem tem internet
      apertada. Quem nao esta assistindo nao deve baixar nada.
    */
    this.publicacaoDeTela(userId)?.setSubscribed(false);
    this.emit({ assistindo: [...this.assistindo] });
  }

  /**
   * Recusa as transmissoes que ninguem pediu para ver.
   *
   * A sala conecta com `autoSubscribe`, que e o certo para microfone e camera
   * — sao leves e todo mundo quer. Transmissao de tela nao: ela e a faixa mais
   * cara da chamada, e chegava sozinha para todos assim que alguem comecava.
   *
   * Roda a cada mudanca de faixa porque a publicacao pode aparecer a qualquer
   * momento, inclusive durante uma reconexao.
   */
  private recusarTransmissoesNaoPedidas(): void {
    const room = this.room;
    if (!room) return;

    for (const p of room.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.ScreenShare) as
        | RemoteTrackPublication
        | undefined;
      if (!pub) continue;
      const querido = this.assistindo.has(p.identity);
      if (pub.isSubscribed !== querido) pub.setSubscribed(querido);
    }

    // Quem parou de transmitir sai da lista: guardar a escolha para uma
    // transmissao que acabou faria a proxima comecar sendo assistida sem
    // ninguem ter pedido.
    let mudou = false;
    for (const id of [...this.assistindo]) {
      const aindaTransmite = [...room.remoteParticipants.values()].some(
        (p) => p.identity === id && p.getTrackPublication(Track.Source.ScreenShare),
      );
      if (!aindaTransmite) {
        this.assistindo.delete(id);
        mudou = true;
      }
    }
    if (mudou) this.emit({ assistindo: [...this.assistindo] });
  }

  getVideoTrack(userId: string, source: 'camera' | 'screen'): RemoteTrack | LocalVideoTrack | null {
    const room = this.room;
    if (!room) return null;

    const trackSource = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;

    if (userId === room.localParticipant.identity) {
      const publication = room.localParticipant.getTrackPublication(trackSource);
      return (publication?.track as LocalVideoTrack | undefined) ?? null;
    }

    const participant = [...room.remoteParticipants.values()].find((p) => p.identity === userId);
    const publication = participant?.getTrackPublication(trackSource) as
      RemoteTrackPublication | undefined;

    return (publication?.track as RemoteTrack | undefined) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Dispositivos e ajustes
  // ---------------------------------------------------------------------------

  async listDevices(): Promise<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
  }> {
    // Sem permissao concedida os rotulos vem vazios; pedir e devolver na hora
    // resolve sem deixar o microfone aberto.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch {
      // Sem permissao: ainda listamos, so que sem nome.
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === 'audioinput'),
      outputs: devices.filter((d) => d.kind === 'audiooutput'),
      cameras: devices.filter((d) => d.kind === 'videoinput'),
    };
  }

  async updateSettings(patch: Partial<VoiceSettings>): Promise<void> {
    const previous = this.settings;
    this.settings = { ...this.settings, ...patch };
    this.saveSettings();

    // Trocar de microfone exige republicar a faixa.
    if (patch.inputDeviceId !== undefined && patch.inputDeviceId !== previous.inputDeviceId) {
      if (this.room && this.micTrack) {
        await this.room.localParticipant.unpublishTrack(this.micTrack);
        this.micTrack.stop();
        await this.publishMicrophone();
      }
    }

    if (patch.outputDeviceId !== undefined) {
      const destino = patch.outputDeviceId ?? 'default';

      /*
        Com a cadeia ativa, quem toca e o CONTEXTO, nao o elemento — trocar so
        no elemento faria o seletor de dispositivo parecer quebrado.
      */
      void this.saida.trocarSaida(destino).then((trocou) => {
        if (trocou) return;
        for (const { elemento } of this.audioElements.values()) {
          if (!('setSinkId' in elemento)) continue;
          void (elemento as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
            .setSinkId(destino)
            .catch(() => undefined);
        }
      });
    }

    if (
      patch.outputVolume !== undefined ||
      patch.userVolumes !== undefined ||
      patch.screenVolumes !== undefined
    ) {
      this.aplicarVolumes();
    }

    // Entrar em push-to-talk fecha o microfone na hora.
    if (patch.inputMode !== undefined && this.micTrack) {
      if (patch.inputMode === 'push-to-talk' && !this.pttActive) await this.micTrack.mute();
      else if (patch.inputMode === 'voice-activity' && !this.state.selfMuted) {
        await this.micTrack.unmute();
      }
    }
  }

  /**
   * Volume da VOZ de uma pessoa, de 0 a 2.
   *
   * Passa de 1 de proposito: microfone fraco e comum, e mandar a pessoa
   * "chegar mais perto do microfone" toda vez nao e solucao. O teto do
   * elemento de audio continua em 1, entao o ganho acima disso so aproveita
   * quando o volume geral esta abaixo do maximo — e essa e a unica forma
   * honesta de fazer isso sem processar o audio.
   */
  setUserVolume(userId: string, volume: number): void {
    void this.updateSettings({
      userVolumes: { ...this.settings.userVolumes, [userId]: Math.max(0, Math.min(2, volume)) },
    });
  }

  /** Volume do AUDIO DA TRANSMISSAO de uma pessoa, de 0 a 2. */
  setScreenVolume(userId: string, volume: number): void {
    void this.updateSettings({
      screenVolumes: { ...this.settings.screenVolumes, [userId]: Math.max(0, Math.min(2, volume)) },
    });
  }

  getUserVolume(userId: string): number {
    return this.settings.userVolumes[userId] ?? 1;
  }

  getScreenVolume(userId: string): number {
    return this.settings.screenVolumes[userId] ?? 1;
  }

  /**
   * A pessoa esta mandando audio de transmissao neste momento?
   *
   * Quem decide se o controle de volume da transmissao aparece. Mostrar um
   * controle que nao mexe em nada — porque a pessoa transmite sem som, como
   * acontece — e pior que nao mostrar: a pessoa arrasta, nada muda, e ela
   * conclui que o aplicativo esta quebrado.
   */
  temAudioDeTransmissao(userId: string): boolean {
    return this.audioElements.has(`${userId}|tela`);
  }

  /** Toca um som do soundboard localmente. */
  async playSound(url: string, volume = 1): Promise<void> {
    const audio = new Audio(url);
    audio.volume = Math.min(1, volume * this.settings.outputVolume);

    if (this.settings.outputDeviceId && 'setSinkId' in audio) {
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(this.settings.outputDeviceId)
        .catch(() => undefined);
    }

    await audio.play().catch(() => undefined);
  }

  isConnectedTo(channelId: string): boolean {
    return this.state.connected && this.state.channelId === channelId;
  }

  /**
   * Sai porque um moderador desconectou, nao porque a pessoa clicou.
   *
   * O servidor so manda esse aviso para quem foi desconectado por outra
   * pessoa; a propria saida nao volta como eco. So age se ainda estivermos no
   * canal citado, para nao derrubar uma chamada seguinte por engano.
   */
  async leaveByRemote(channelId: string | null): Promise<void> {
    if (channelId && this.state.channelId !== channelId) return;
    await this.leave();
  }

  /**
   * Por onde a midia esta passando de fato.
   *
   * Existe porque a voz depende de um caminho direto ate o servidor, e quando
   * ela nao funciona a pergunta e sempre a mesma: "e a minha rede?". Em vez de
   * adivinhar, isto responde com o que o WebRTC negociou.
   *
   *   host   -> conexao direta, o melhor caso
   *   srflx  -> passou por NAT, ainda direto
   *   relay  -> esta usando um servidor de retransmissao, com latencia extra
   */
  /**
   * Larga a sala e tudo que pendurava nela.
   *
   * Os temporizadores de audio e de latencia param sozinhos quando `room` e
   * nulo, entao anular aqui e o que os desliga. Os elementos de audio precisam
   * sair do documento na mao, senao sobram mudos e invisiveis a cada queda.
   */
  private descartarSala(): void {
    this.saida.fechar();
    for (const { elemento } of this.audioElements.values()) elemento.remove();
    this.audioElements.clear();

    this.cameraTrack?.stop();
    this.cameraTrack = null;
    for (const faixa of this.screenTracks) faixa.stop();
    this.screenTracks = [];

    this.micTrack?.stop();
    this.micTrack = null;

    /*
      As escolhas de quem assistir morrem com a sala.

      Guarda-las faria a proxima chamada comecar baixando a transmissao de
      alguem que por acaso tem a mesma identidade — e, mais simples que isso,
      "estou assistindo o Fulano" e uma frase sobre uma chamada, nao sobre uma
      pessoa para sempre.
    */
    this.assistindo.clear();

    this.room = null;
  }

  /**
   * Diz por que a chamada caiu, em vez de sumir da tela sem explicacao.
   *
   * Cair sem aviso e o pior desfecho possivel: a pessoa some do canal, nao
   * sabe se foi a internet dela, o servidor, ou o aplicativo, e nao tem o que
   * relatar para quem poderia ajudar. Aconteceu de verdade com alguem que
   * ficou tentando entrar oito vezes seguidas.
   *
   * Sao dois caminhos ate o servidor, e a mensagem precisa dizer qual faltou:
   *
   *   IPv6          direto e mais rapido. Serve quem tem IPv6 na operadora.
   *   rede virtual  o unico caminho de quem so tem IPv4, porque o IPv4 do
   *                 servidor esta atras de CGNAT e nao aceita conexao de fora.
   *
   * Antes esta funcao dizia "sem IPv6 nao ha o que fazer, avise o dono do
   * servidor". Isso deixou de ser verdade quando a rede virtual entrou: hoje
   * o conserto esta na mao da propria pessoa, e basta ligar a VPN. Mandar
   * alguem esperar por outro quando ela mesma resolve e o tipo de mensagem
   * que faz desistir do aplicativo.
   */
  private async explicarQueda(motivo?: unknown): Promise<void> {
    const { temIPv6, naVpn } = await this.caminhosDisponiveis();

    if (!temIPv6 && !naVpn) {
      this.emit({
        error:
          'A chamada caiu porque sua internet nao tem IPv6, que e o caminho direto ate o ' +
          'servidor. Existe um segundo caminho: a rede virtual (Tailscale). Instale o ' +
          'Tailscale, aceite o convite que o dono do servidor mandou e deixe o icone dele ' +
          'como "Connected" antes de entrar na voz. O chat funciona sem isso.',
      });
      return;
    }

    if (!temIPv6) {
      this.emit({
        error:
          'A chamada caiu. Sua internet nao tem IPv6, entao a voz depende da rede virtual: ' +
          'ela esta ligada aqui, mas a midia nao passou. Confira se o Tailscale mostra ' +
          '"Connected" e se o servidor aparece na lista de maquinas dele, e tente de novo.',
      });
      return;
    }

    const detalhe =
      typeof motivo === 'string' || typeof motivo === 'number' ? ` (${String(motivo)})` : '';
    this.emit({
      error:
        `A conexao de voz caiu${detalhe}. Sua internet tem IPv6, entao provavelmente foi ` +
        'instabilidade ou algo bloqueando UDP na sua rede. Tente entrar de novo; se repetir, ' +
        'rode Ajustes > Voz e video > Diagnostico e mande o resultado.',
    });
  }

  /**
   * Descobre se esta maquina tem IPv6, sem depender de nenhum site.
   *
   * Isto e a primeira pergunta quando alguem nao consegue entrar na voz: a
   * midia vai direto ao servidor pelo IPv6, e quem nao tem IPv6 simplesmente
   * nao fecha a chamada — o chat funciona, a pessoa aparece no canal, e
   * ninguem ouve ninguem. Sem esta resposta, quem esta de fora nao tem como
   * relatar o proprio problema.
   *
   * O jeito de perguntar e abrir uma conexao descartavel e olhar os candidatos
   * locais que o navegador junta. Se aparece algum endereco com ":", ha IPv6
   * na maquina. Nao prova que a internet inteira funciona, mas pega o caso
   * comum, que e nao ter nenhum.
   */
  async hasIPv6(): Promise<boolean> {
    return (await this.caminhosDisponiveis()).temIPv6;
  }

  /**
   * Quais dos dois caminhos ate o servidor esta maquina tem.
   *
   * Uma coleta so responde as duas perguntas, e elas sao sempre feitas juntas:
   * "tem IPv6?" sozinha nao basta mais desde que a rede virtual virou o plano
   * B de quem so tem IPv4.
   */
  private async caminhosDisponiveis(): Promise<CaminhosDisponiveis> {
    return lerCaminhos(await this.enderecosLocais());
  }

  /**
   * Os enderecos das interfaces desta maquina, sem depender de nenhum site.
   *
   * O jeito de perguntar e abrir uma conexao descartavel e olhar os candidatos
   * locais que o navegador junta. Nao prova que a internet inteira funciona,
   * mas diz o que existe aqui, que e o que separa "voce nao tem esse caminho"
   * de "voce tem e ele falhou".
   *
   * Espera a coleta terminar em vez de parar no primeiro achado: o IPv6 pode
   * chegar antes do endereco da VPN, e sair cedo daria "sem VPN" para quem
   * esta com ela ligada.
   */
  private async enderecosLocais(): Promise<string[]> {
    let pc: RTCPeerConnection | null = null;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      // Um canal qualquer so para o navegador ter o que negociar.
      pc.createDataChannel('sonda');
      await pc.setLocalDescription(await pc.createOffer());

      const conexao = pc;
      return await new Promise<string[]>((resolve) => {
        const achados: string[] = [];
        const prazo = setTimeout(() => resolve(achados), 2500);

        conexao.onicecandidate = (evento) => {
          // Candidato nulo marca o fim da coleta.
          if (!evento.candidate) {
            clearTimeout(prazo);
            resolve(achados);
            return;
          }
          // Formato: candidate:<fundacao> <componente> <transporte> <prioridade>
          //          <endereco> <porta> typ <tipo> ...
          // Ler o campo pela posicao e mais confiavel que procurar ":" na linha
          // inteira, que casa tambem com o proprio "candidate:" e com formas
          // comprimidas que aparecem em outros campos.
          const endereco = evento.candidate.candidate.split(' ')[4];
          if (endereco) achados.push(endereco);
        };
      });
    } catch {
      return [];
    } finally {
      pc?.close();
    }
  }

  async inspectConnection(): Promise<{
    conectado: boolean;
    caminho: 'direto' | 'nat' | 'relay' | 'desconhecido';
    endereco: string | null;
    protocolo: string | null;
    latenciaMs: number | null;
    perdaPacotes: number | null;
    temIPv6: boolean;
    naVpn: boolean;
  }> {
    // Os dois caminhos sao relatados juntos porque a resposta util nao e "tem
    // IPv6?" e sim "sobrou algum caminho?". Faltar IPv6 so e problema para
    // quem tambem esta fora da rede virtual.
    const { temIPv6, naVpn } = await this.caminhosDisponiveis();

    const vazio = {
      conectado: false,
      caminho: 'desconhecido' as const,
      endereco: null,
      protocolo: null,
      latenciaMs: null,
      perdaPacotes: null,
      temIPv6,
      naVpn,
    };

    const room = this.room;
    if (!room || !this.state.connected) return vazio;

    // O LiveKit nao expoe a RTCPeerConnection na API publica; chegar nela
    // exige atravessar o interno. Se a estrutura mudar, o diagnostico para de
    // funcionar, mas a chamada continua normal.
    const engine = (
      room as unknown as {
        engine?: {
          pcManager?: {
            publisher?: { _pc?: RTCPeerConnection };
            subscriber?: { _pc?: RTCPeerConnection };
          };
        };
      }
    ).engine;

    const pc = engine?.pcManager?.publisher?._pc ?? engine?.pcManager?.subscriber?._pc;
    if (!pc) return { ...vazio, conectado: true };

    try {
      const stats = await pc.getStats();
      const all = [...stats.values()] as Record<string, unknown>[];

      const pair = all.find(
        (s) => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated,
      );
      if (!pair) return { ...vazio, conectado: true };

      const remote = all.find((c) => c.id === pair.remoteCandidateId);
      const inbound = all.find((s) => s.type === 'inbound-rtp' && s.kind === 'audio');

      const tipo = remote?.candidateType as string | undefined;
      const caminho =
        tipo === 'host' ? 'direto' : tipo === 'relay' ? 'relay' : tipo ? 'nat' : 'desconhecido';

      const recebidos = Number(inbound?.packetsReceived ?? 0);
      const perdidos = Number(inbound?.packetsLost ?? 0);

      return {
        conectado: true,
        caminho,
        endereco: (remote?.address as string | undefined) ?? null,
        protocolo: (remote?.protocol as string | undefined) ?? null,
        latenciaMs:
          pair.currentRoundTripTime != null
            ? Math.round(Number(pair.currentRoundTripTime) * 1000)
            : null,
        perdaPacotes:
          recebidos + perdidos > 0
            ? Math.round((perdidos / (recebidos + perdidos)) * 1000) / 10
            : null,
        temIPv6,
        naVpn,
      };
    } catch {
      return { ...vazio, conectado: true };
    }
  }
}

export const voice = new VoiceController();

// ---------------------------------------------------------------------------
// Falhas de midia, em portugues
// ---------------------------------------------------------------------------

/** O dispositivo existe mas nao aceita o formato pedido. */
function ehRestricaoImpossivel(erro: unknown): boolean {
  const nome = (erro as { name?: string })?.name;
  return nome === 'OverconstrainedError' || nome === 'ConstraintNotSatisfiedError';
}

/**
 * Traduz a falha para uma frase que diz o que fazer.
 *
 * O nome do erro do navegador ("NotReadableError") nao ajuda ninguem, e o
 * texto que acompanha vem em ingles e fala de "tracks" e "constraints". Quem
 * esta tentando ligar a camera precisa saber se o problema e permissao, se e
 * outro programa segurando o aparelho, ou se nao ha camera nenhuma.
 */

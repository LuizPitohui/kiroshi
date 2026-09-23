import {
  VideoPreset,
  ConnectionQuality,
  DisconnectReason,
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
import { prepararFaixaParaProcessador, type ProcessadorDeLimpeza } from './ruido.js';
import {
  aplicarLimpeza,
  aquecerLimpeza,
  planejarLimpeza,
  planoSemModelos,
  type LimpezaMontada,
} from './cadeia.js';
import {
  INTENSIDADE_PADRAO,
  LIMIAR_PADRAO_DB,
  exigeReabrirMicrofone,
  intensidadeValida,
  limiarDoPortao,
  limiarValido,
  restricoesDoNavegador,
  type MotorDeLimpeza,
} from './limpeza.js';
import {
  devoAtenderTokenDoGateway,
  devoIgnorarEntrada,
  type SituacaoDeEntrada,
} from './entrada.js';

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
  /**
   * Limiar do portao no modo por atividade de voz, em dB.
   *
   * Substitui o antigo `voiceThreshold` (0 a 1), que era salvo mas nunca lido:
   * o modo "por voz" transmitia o tempo todo. Nome novo de proposito, para o
   * valor antigo que ficou guardado nas maquinas nao ser reinterpretado numa
   * escala que nao e a dele.
   */
  limiarDeVozDb: number;
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
   * Limpeza por modelo: DeepFilterNet3, com GTCRN de reserva.
   *
   * SUBSTITUI, nao soma. Com um modelo ativo, a captura desliga
   * `noiseSuppression` e `voiceIsolation`: modelos sao treinados em audio
   * cru, e alimentar um com a saida do outro da voz robotica.
   *
   * Ligada por padrao porque foi medido que a do navegador nao basta — os
   * quatro ajustes confirmados ligados, e teclado ainda passando.
   *
   * O nome ficou o mesmo da versao com RNNoise para quem desligou continuar
   * desligado depois de atualizar. Detalhes em docs/SUPRESSAO-DE-RUIDO.md.
   */
  limpezaDeRuido: boolean;
  /**
   * Intensidade do DeepFilterNet3, 0 a 100: o limite de atenuacao em dB.
   *
   * 100 = sem limite, o modelo remove tudo que julgar ruido. Abaixo disso,
   * um pouco do som original volta misturado: voz mais natural, fundo junto.
   * Muda ao vivo. O GTCRN ignora.
   */
  intensidadeDaLimpeza: number;
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
  limiarDeVozDb: LIMIAR_PADRAO_DB,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  voiceIsolation: true,
  limpezaDeRuido: true,
  intensidadeDaLimpeza: INTENSIDADE_PADRAO,
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
  /**
   * O que esta REALMENTE limpando o microfone agora, e nao o que foi pedido.
   *
   * `null` sem microfone aberto. Existe porque a tela antiga dizia "limpeza
   * reforcada: sim" olhando para o interruptor, enquanto o processador
   * falhava em todas as maquinas. Pedido e resultado sao coisas diferentes.
   */
  limpeza: EstadoDaLimpeza | null;
}

export interface EstadoDaLimpeza {
  motor: MotorDeLimpeza;
  portao: boolean;
  /** Por que motores preferidos ficaram de fora. Vazio quando o DFN3 pegou. */
  falhas: string[];
}

class VoiceController {
  /**
   * O canal cuja entrada esta em voo agora.
   *
   * Escrito por quem COMECA uma entrada e limpo no fim, aconteca o que
   * acontecer. E a unica coisa que distingue "ja existe alguem entrando aqui"
   * de "esta e a minha propria entrada" — distincao que o `connecting` do
   * estado publico nao faz, e cuja confusao travou a tela em "Entrando na
   * chamada..." numa versao publicada.
   */
  private entradaEmVoo: string | null = null;

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
    limpeza: null,
  };

  /** O processador de limpeza plugado no microfone agora, para ajustes ao vivo. */
  private limpeza: ProcessadorDeLimpeza | null = null;

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
      const lido = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<VoiceSettings>) };
      // Valor fora da faixa (editado na mao, ou de versao futura) nao pode
      // virar um portao que nunca abre ou uma intensidade que nao existe.
      lido.limiarDeVozDb = limiarValido(lido.limiarDeVozDb);
      lido.intensidadeDaLimpeza = intensidadeValida(lido.intensidadeDaLimpeza);
      return lido;
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
    if (devoIgnorarEntrada(this.situacaoDeEntrada(), channelId)) return;

    /*
      A marca de voo e escrita AQUI, no clique — nao la dentro, depois de a API
      responder.

      Entre pedir o token e receber passa-se um tempo, e e nele que o eco do
      gateway costuma chegar. Marcar so na hora de abrir a sala deixaria essa
      janela descoberta, que e a corrida inteira de volta.
    */
    this.entradaEmVoo = channelId;
    this.emit({ connecting: true, error: null, channelId, guildId });

    try {
      const info = await api.post<VoiceServerUpdateEvent>('/voice/join', { channelId });
      /*
        Vai direto ao trabalho, sem passar pelo `connect` publico.

        Passar por ele era o defeito publicado na versao anterior: a guarda de
        la via a marca de voo que ESTA funcao tinha acabado de escrever,
        concluia que alguem ja estava entrando e desistia. A tela ficava em
        "Entrando na chamada..." sem fim.
      */
      await this.entrarNaSala({ ...info, channelId, guildId });
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
    } finally {
      // Sempre, inclusive na falha: uma marca presa impediria a proxima
      // tentativa para sempre, e a pessoa ficaria sem chamada ate reiniciar.
      this.entradaEmVoo = null;
    }
  }

  /** O que a guarda de entrada precisa saber, num lugar so. */
  private situacaoDeEntrada(): SituacaoDeEntrada {
    return {
      emVoo: this.entradaEmVoo,
      connected: this.state.connected,
      channelId: this.state.channelId,
      naSala: this.room !== null,
    };
  }

  /**
   * A entrada pedida pelo GATEWAY, pelo aviso `VOICE_SERVER_UPDATE`.
   *
   * Ele existe de proposito — e por ele que um moderador move alguem de sala —
   * e tambem chega como eco alguns milissegundos depois de a pessoa entrar por
   * conta propria. Esse eco e a corrida que derrubava chamadas: os dois
   * caminhos abriam sala, o servidor via duas conexoes com a mesma identidade
   * e fechava a primeira.
   *
   * A guarda mora em `entrada.ts`, com teste, porque ela ja errou dos dois
   * lados em versoes publicadas: frouxa demais derruba a chamada, apertada
   * demais trava a tela em "Entrando na chamada..." para sempre.
   */
  async connect(payload: VoiceServerUpdateEvent): Promise<void> {
    /*
      PRIMEIRO: este token e para mim?

      O servidor emite com `emitToUser`, que entrega a todas as sessoes da
      conta. Sem esta guarda, entrar numa chamada pelo computador faz qualquer
      outro aparelho logado entrar junto — eles se derrubam em circulo por
      identidade duplicada, e um deles comeca a transmitir o microfone de outro
      comodo sem ninguem ter tocado nele.

      Foi visto acontecendo: uma segunda instancia aberta nesta maquina,
      logada na mesma conta, apareceu dentro da chamada sem um clique.
    */
    if (!devoAtenderTokenDoGateway(this.situacaoDeEntrada())) return;

    if (devoIgnorarEntrada(this.situacaoDeEntrada(), payload.channelId)) return;

    this.entradaEmVoo = payload.channelId;
    try {
      await this.entrarNaSala(payload);
    } finally {
      this.entradaEmVoo = null;
    }
  }

  /**
   * O trabalho de entrar, sem guarda nenhuma.
   *
   * NAO consulta `devoIgnorarEntrada`, e e isso que o mantem correto: quem
   * chega aqui ja marcou o proprio voo, e uma guarda neste ponto barraria a
   * entrada que ela mesma armou. Foi exatamente esse o defeito da versao
   * anterior — `joinChannel` passava pelo `connect` publico e era bloqueado
   * por si mesmo.
   */
  private async entrarNaSala(payload: VoiceServerUpdateEvent): Promise<void> {
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
      /*
        So um padrao de reserva: o microfone de verdade e aberto em
        `publishMicrophone`, com as restricoes que a cascata de limpeza decide
        ali. Isto vale apenas se o proprio LiveKit precisar abrir a captura.
      */
      audioCaptureDefaults: {
        deviceId: this.settings.inputDeviceId ?? undefined,
        ...restricoesDoNavegador(this.settings, this.settings.limpezaDeRuido),
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
      /*
        Tenta ligar de novo a cada passada.

        Quem ficou de fora na primeira vez — fluxo que ainda nao tinha
        chegado, contexto suspenso esperando um gesto — entra agora. E
        `ligar` ja devolve cedo para quem esta ligado, entao repetir nao
        custa.
      */
      this.saida.ligar(a.elemento);
      // `ajustar` cuida dos dois caminhos: no grafo ou no proprio elemento.
      this.saida.ajustar(a.elemento, this.volumeDe(a.identidade, a.fonte));
    }
  }

  private attachRemoteAudio(
    track: RemoteTrack,
    participant: RemoteParticipant,
    fonte: FonteDeAudio,
  ): void {
    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;

    this.saida.ligar(element);
    this.saida.ajustar(element, this.volumeDe(participant.identity, fonte));
    if (this.settings.outputDeviceId) {
      void this.saida.trocarSaida(this.settings.outputDeviceId);
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
      limpeza: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Microfone
  // ---------------------------------------------------------------------------

  /**
   * Abre o microfone, pluga a limpeza de ruido e publica.
   *
   * A ordem importa e cada passo existe por um motivo:
   *
   *   1. PLANEJAR antes de abrir: se vai haver modelo, o supressor do
   *      navegador tem que ser pedido DESLIGADO na captura (nunca dois
   *      supressores empilhados).
   *
   *   2. PREPARAR a faixa para aceitar processador. Sem isto o LiveKit recusa
   *      qualquer processador numa faixa ainda nao publicada — e esse era o
   *      bug que deixava o teclado passar. Ver `prepararFaixaParaProcessador`.
   *
   *   3. APLICAR a cascata antes de publicar. Depois de publicada a faixa ja
   *      esta indo para o codificador, e trocar o processamento no meio causa
   *      um corte audivel em quem esta ouvindo.
   *
   *   4. RESGATAR se nenhum modelo pegou: reabrir o microfone com o supressor
   *      do navegador ligado. Falhar nunca pode significar microfone cru.
   */
  private async publishMicrophone(): Promise<void> {
    const room = this.room;
    if (!room) return;

    const ajustes = this.settings;
    const plano = await planejarLimpeza(ajustes);

    this.micTrack = await createLocalAudioTrack({
      deviceId: ajustes.inputDeviceId ?? undefined,
      ...plano.restricoes,
    });
    const faixa = this.micTrack;
    prepararFaixaParaProcessador(faixa);

    const aplicar = (p: ProcessadorDeLimpeza): Promise<void> => faixa.setProcessor(p);
    let montada: LimpezaMontada = await aplicarLimpeza(plano, ajustes, aplicar);

    if (montada.precisaReabrir) {
      console.error('[limpeza] nenhum modelo pegou; voltando para o navegador', montada.falhas);
      await faixa.restartTrack({
        deviceId: ajustes.inputDeviceId ?? undefined,
        ...montada.restricoesDeResgate,
      });
      montada = await aplicarLimpeza(planoSemModelos(ajustes, montada.falhas), ajustes, aplicar);
    }

    this.limpeza = montada.processador;
    this.emit({
      limpeza: { motor: montada.motor, portao: montada.portao, falhas: montada.falhas },
    });
    if (montada.falhas.length > 0) {
      console.warn(`[limpeza] motor em uso: ${montada.motor}`, montada.falhas);
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
  /**
   * As faixas da transmissao de alguem: imagem E som.
   *
   * Devolve as duas porque assistir e uma decisao so. A versao anterior
   * devolvia so o video, e o som ficava assinado por conta propria — quem nao
   * tinha pedido para assistir ouvia o jogo dos outros sem imagem e sem saber
   * de onde vinha.
   */
  private publicacoesDeTela(userId: string): RemoteTrackPublication[] {
    const room = this.room;
    if (!room) return [];
    for (const p of room.remoteParticipants.values()) {
      if (p.identity !== userId) continue;
      return [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]
        .map((fonte) => p.getTrackPublication(fonte) as RemoteTrackPublication | undefined)
        .filter((pub): pub is RemoteTrackPublication => Boolean(pub));
    }
    return [];
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
    for (const pub of this.publicacoesDeTela(userId)) pub.setSubscribed(true);
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
    for (const pub of this.publicacoesDeTela(userId)) pub.setSubscribed(false);
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
      const querido = this.assistindo.has(p.identity);

      /*
        Video E SOM. A primeira versao so recusava o video.

        Sao duas faixas separadas no LiveKit, e cuidar de uma so produzia o
        pior resultado possivel: a pessoa nao via a transmissao, nao tinha
        pedido para ver, e mesmo assim OUVIA o jogo dos outros. Sem imagem, sem
        ter escolhido, e sem entender de onde vinha o som.

        O som vem junto da imagem ou nao vem: assistir e uma decisao so.
      */
      for (const fonte of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
        const pub = p.getTrackPublication(fonte) as RemoteTrackPublication | undefined;
        if (!pub) continue;
        if (pub.isSubscribed !== querido) pub.setSubscribed(querido);
      }
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

    /*
      Ajustes de captura exigem reabrir o microfone; os de limpeza mudam ao
      vivo.

      Antes, so a troca de aparelho valia durante a chamada. Ligar ou
      desligar a limpeza no meio de uma conversa nao fazia nada ate sair e
      entrar de novo — e quem testasse assim concluiria que ela nao existe.
    */
    if (exigeReabrirMicrofone(patch, { ...previous })) {
      if (this.room && this.micTrack) {
        await this.room.localParticipant.unpublishTrack(this.micTrack);
        this.micTrack.stop();
        await this.limpeza?.destroy().catch(() => undefined);
        this.limpeza = null;
        await this.publishMicrophone();
      }
    } else {
      if (patch.intensidadeDaLimpeza !== undefined) {
        this.settings.intensidadeDaLimpeza = intensidadeValida(patch.intensidadeDaLimpeza);
        this.saveSettings();
        this.limpeza?.definirIntensidade(this.settings.intensidadeDaLimpeza);
      }
      if (patch.limiarDeVozDb !== undefined || patch.inputMode !== undefined) {
        this.settings.limiarDeVozDb = limiarValido(this.settings.limiarDeVozDb);
        this.saveSettings();
        const limiar = limiarDoPortao(this.settings);
        if (this.limpeza) {
          await this.limpeza.definirPortao(limiar).catch((erro: unknown) => {
            console.warn('[limpeza] nao consegui ajustar o portao', erro);
          });
          if (this.state.limpeza) {
            this.emit({ limpeza: { ...this.state.limpeza, portao: limiar !== null } });
          }
        }
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
    // O LiveKit ja desfaz o processador ao parar a faixa; soltar a referencia
    // evita ajustar ao vivo um processador morto.
    this.limpeza = null;

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
    /*
      QUEDA QUE O PROPRIO CLIENTE CAUSOU NAO E CULPA DA REDE.

      Tudo abaixo desta guarda investiga o CAMINHO — IPv6, rede virtual, UDP
      bloqueado — e manda a pessoa conferir o roteador ou o Tailscale. Isso so
      faz sentido quando a midia de fato nao passou.

      `CLIENT_INITIATED` quer dizer o contrario: fomos nos que fechamos. Foi
      exatamente o que aconteceu no defeito da corrida de entrada — um
      `connect` reentrante chamava `leave()` na sala meio aberta, e o evento de
      desconexao chegava depois de a marca de saida intencional ter sido
      limpa. Resultado na tela: "A conexao de voz caiu (1). Sua internet tem
      IPv6, entao provavelmente foi instabilidade ou algo bloqueando UDP na sua
      rede."

      Mandar alguem procurar defeito no proprio roteador por causa de uma
      corrida no cliente e pior do que nao explicar nada: alem de nao
      consertar, gasta o tempo da pessoa e a ensina a desconfiar da propria
      internet.

      A corrida esta consertada em `entrada.ts`. Esta guarda fica porque a
      classe de erro continua possivel, e o proximo caso nao pode voltar a sair
      disfarcado de problema de rede — a mensagem honesta e a que me diz onde
      procurar.
    */
    if (motivo === DisconnectReason.CLIENT_INITIATED) {
      this.emit({
        error:
          'A chamada caiu por um problema do proprio aplicativo, nao da sua internet. ' +
          'Tente entrar de novo; se repetir, avise que isso e defeito para consertar aqui.',
      });
      return;
    }

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

// O autoteste do DeepFilterNet3 roda com o aplicativo ocioso, para a primeira
// entrada em chamada nao esperar por ele.
aquecerLimpeza();

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

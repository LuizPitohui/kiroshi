import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { release } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  session,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import type { AcaoDeAtalho, AtualizacaoEstado, PreferenciasDoApp } from './preload.js';
import { gravarPreferencias, lerPreferencias, primeiraExecucao } from './preferencias.js';
import { atalhosGlobaisAtivos, configurarAtalhos, pararAtalhos } from './atalhos.js';
import { linkDosArgumentos } from './links.js';

/** Id do app no Windows (notificacoes, atalhos), trocado na compilacao: Kiroshi ou Kiroshi Beta. */
declare const __APP_ID__: string;
import { abrirEEsperar, cancelarEspera, prepararRetorno } from './google.js';

/**
 * Processo principal do Electron.
 *
 * Responsabilidades que so existem aqui, fora do alcance da interface:
 *  - janela sem moldura com controles proprios;
 *  - captura de tela (o navegador sozinho nao lista as janelas do sistema);
 *  - atalho global de push-to-talk, que precisa funcionar com o jogo em foco;
 *  - bandeja do sistema e fechar para a bandeja;
 *  - notificacoes nativas.
 */

const isDev = !app.isPackaged;

// Em desenvolvimento, abre a porta de depuracao do Chrome. Sem isto nao ha
// como inspecionar a interface do Electron de fora, e problemas de captura de
// tela e camera so aparecem aqui, nunca no navegador.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// ---------------------------------------------------------------------------
// Arquivos dos modelos de limpeza de ruido
// ---------------------------------------------------------------------------

/**
 * Esquema pelo qual a interface le os arquivos do DeepFilterNet3.
 *
 * POR QUE UM ESQUEMA PROPRIO, e nao `file://` nem a CDN do pacote:
 *
 *   CDN      o pacote `deepfilternet3-noise-filter` baixa o modelo de um
 *            servidor de terceiros por padrao. O Kiroshi e auto-hospedado:
 *            a voz de ninguem vai depender de uma maquina que nao e nossa,
 *            nem avisar a ela quando alguem entra numa chamada.
 *
 *   file://  o Chromium recusa `fetch` em `file://`, e e com `fetch` que o
 *            pacote le os arquivos. Nao ha como trocar isso sem mexer nele.
 *
 * Um esquema registrado com `supportFetchAPI` resolve os dois: o pacote
 * recebe uma URL base (`kiroshi-modelos://dfn3`) e faz `fetch` normalmente,
 * e quem responde e este processo, lendo do disco.
 *
 * Precisa ser registrado ANTES do `ready` — depois disso o Electron ignora.
 */
const ESQUEMA_DOS_MODELOS = 'kiroshi-modelos';

protocol.registerSchemesAsPrivileged([
  {
    scheme: ESQUEMA_DOS_MODELOS,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // A interface roda em `file://` (origem nula): sem CORS liberado o
      // `fetch` dela para este esquema e bloqueado.
      corsEnabled: true,
    },
  },
]);

/**
 * Onde moram os arquivos do modelo.
 *
 * Instalado: `resources/modelos`, ao lado do app.asar — vem por
 * `extraResources` no electron-builder.yml, FORA do asar de proposito, para o
 * modelo ser lido direto do disco sem descompactar o pacote inteiro.
 *
 * Empacotado e simples: o `electron-builder` copia a pasta para
 * `resources/modelos`, ao lado do `app.asar`.
 *
 * EM DESENVOLVIMENTO NAO E. A primeira versao disto usava
 * `join(app.getAppPath(), 'resources', 'modelos')`, e foi MEDIDO que nao
 * funciona: rodando o main compilado — que e o que tanto o `electron-vite dev`
 * quanto um `electron out/main/index.js` fazem — `app.getAppPath()` devolve
 * `packages/desktop/out/main`, e nao a raiz do pacote. O protocolo procurava
 * em `out/main/resources/modelos` enquanto o `npm run modelos` gravava em
 * `packages/desktop/resources/modelos`.
 *
 * O sintoma: todo `kiroshi-modelos://` respondia 404, o autoteste reprovava
 * com "nao consegui carregar os arquivos do modelo" e a limpeza caia para o
 * GTCRN — em desenvolvimento, sempre. Confirmado com um arquivo de teste de
 * uma linha: so aparecia em `out/main/resources/modelos`.
 *
 * Por isso a lista de candidatos em vez de um caminho so. Nao e chute: sao os
 * dois lugares onde o `getAppPath()` pode cair conforme quem abre o app, e o
 * primeiro que existir vence. Se nenhum existir, devolve o primeiro mesmo
 * assim — o 404 e a mensagem do autoteste ja explicam o que falta.
 */
function pastaDosModelos(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'modelos');

  const base = app.getAppPath();
  const aoLadoDoApp = join(base, 'resources', 'modelos');
  // De `out/main` de volta para a raiz do pacote, que e onde o
  // `npm run modelos` grava.
  const naRaizDoPacote = join(base, '..', '..', 'resources', 'modelos');

  if (existsSync(aoLadoDoApp)) return aoLadoDoApp;
  if (existsSync(naRaizDoPacote)) return naRaizDoPacote;
  return aoLadoDoApp;
}

const TIPOS: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.json': 'application/json',
};

function registrarProtocoloDosModelos(): void {
  const raiz = resolve(pastaDosModelos());

  protocol.handle(ESQUEMA_DOS_MODELOS, async (requisicao) => {
    // kiroshi-modelos://dfn3/v3/pkg/df_bg.wasm -> <raiz>/dfn3/v3/pkg/df_bg.wasm
    const url = new URL(requisicao.url);
    const relativo = decodeURIComponent(`${url.hostname}${url.pathname}`);
    const alvo = resolve(raiz, relativo);

    // Nada fora da pasta dos modelos: `..` na URL nao pode ler o disco.
    if (!alvo.startsWith(raiz + sep)) {
      return new Response('fora da pasta dos modelos', { status: 403 });
    }

    let resposta: Response;
    try {
      resposta = await net.fetch(pathToFileURL(alvo).toString());
    } catch {
      return new Response(`arquivo ausente: ${relativo}`, { status: 404 });
    }

    const extensao = alvo.slice(alvo.lastIndexOf('.'));
    const cabecalhos = new Headers(resposta.headers);
    cabecalhos.set('Access-Control-Allow-Origin', '*');
    // O modelo e um .tar.gz que o pacote descompacta sozinho. Se algum
    // cabecalho disser que a resposta ja vem comprimida, o Chromium
    // descomprime antes, os bytes chegam trocados e o modelo nao carrega.
    cabecalhos.delete('Content-Encoding');
    cabecalhos.set('Content-Type', TIPOS[extensao] ?? 'application/octet-stream');
    return new Response(resposta.body, { status: resposta.status, headers: cabecalhos });
  });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/**
 * Estado da atualizacao, guardado aqui.
 *
 * A interface pode abrir depois do aviso ter passado — por exemplo quando a
 * janela e recriada a partir da bandeja. Sem guardar, quem chegou depois
 * nunca saberia que ha uma versao pronta esperando.
 */
let estadoDaAtualizacao: AtualizacaoEstado = {
  fase: 'ocioso',
  versao: null,
  progresso: 0,
  erro: null,
};

/** Fonte escolhida no seletor de tela, consumida pelo getDisplayMedia. */
let pendingScreenSource: { id: string; withAudio: boolean } | null = null;

// Uma instancia so: abrir de novo traz a janela existente para frente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/*
  O link kiroshi:// com que o app foi aberto (o Windows passa como argumento).
  Fica guardado ate a interface pedir: mandar por evento na abertura chegaria
  antes de o React montar quem escuta, e o convite se perderia.
*/
let linkDaAbertura: string | null = linkDosArgumentos(process.argv);
ipcMain.handle('link:pendente', () => {
  const rota = linkDaAbertura;
  linkDaAbertura = null;
  return rota;
});

function resolveIcon(): string {
  return join(__dirname, '../../build/icon.png');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d12',
    icon: resolveIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // A interface nunca toca em node diretamente; tudo passa pelo preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      /*
        Nao estrangular a interface quando a janela fica coberta.

        O padrao do Chromium e reduzir temporizadores e parar de desenhar
        assim que outra janela cobre esta — o que faz sentido para uma aba de
        navegador e nao faz nenhum para este aplicativo. O uso normal dele e
        exatamente este: a pessoa esta em chamada e alterna para um jogo em
        tela cheia, deixando o Kiroshi atras.

        Estrangulado, o medidor de voz, o indicador de quem esta falando, a
        medida de latencia e os temporizadores de reconexao passam a rodar uma
        vez por segundo ou menos. Quem esta jogando e justamente quem menos
        pode perceber que o aplicativo parou de acompanhar a conversa.
      */
      backgroundThrottling: false,
    },
  });

  /**
   * Todas as interfaces da maquina, e nao so a da rota padrao.
   *
   * Aqui estava `default_public_and_private_interfaces`, que limita o WebRTC
   * aos enderecos da interface por onde sai a rota padrao. Foi posto para
   * cortar candidatos mortos — adaptador virtual do Hyper-V, VPN desligada,
   * placa sem cabo em APIPA (169.254.x.x) — que o ICE testava um por um ate
   * desistir, fazendo camera e compartilhamento de tela levarem quase 15
   * segundos para publicar.
   *
   * O problema e que a rede virtual TAMBEM e uma interface fora da rota
   * padrao. Com aquela politica o aplicativo nunca coletava o endereco da VPN,
   * entao nunca mandava um pacote por ela: a chamada caia com o Tailscale
   * conectado na bandeja, sem nada no log do servidor, porque o cliente nem
   * chegava a tentar aquele caminho. Medido: a coleta terminava com dois
   * candidatos (um IPv4 e um IPv6, os da rota padrao) e `network-cost 999` em
   * ambos, que e o valor de quando o tipo da interface nem e informado.
   *
   * Para quem nao tem IPv6, essa interface e o unico caminho ate a midia — o
   * IPv4 do servidor esta atras de CGNAT. Limitar as interfaces deixava essas
   * pessoas permanentemente sem voz, que e pior do que uma negociacao lenta.
   *
   * A lentidao original foi atacada na origem e nao precisa mais desta
   * politica: o SFU agora anuncia poucos candidatos (`interfaces.includes` no
   * livekit.yaml, que cortou 18 enderecos de pontes docker para 4). O numero
   * de pares a testar e o produto dos dois lados, e o lado que explodia era o
   * do servidor.
   */
  mainWindow.webContents.setWebRTCIPHandlingPolicy('default');

  /*
    Aberto pelo Windows ao iniciar (`--hidden`, posto no registro so quando a
    pessoa escolhe abrir escondido): fica na bandeja. Antes a opcao era gravada
    e nunca lida — a janela aparecia sempre.
  */
  const escondido = process.argv.includes('--hidden');
  mainWindow.once('ready-to-show', () => {
    if (!escondido) mainWindow?.show();
  });

  // Fechar esconde na bandeja (sair mesmo e pelo menu dela), a menos que a
  // pessoa tenha escolhido fechar de vez.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (!lerPreferencias().fecharParaBandeja) {
      isQuitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Link externo abre no navegador, nunca dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Impede navegacao para fora da aplicacao caso algum link escape.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? process.env.ELECTRON_RENDERER_URL : undefined;
    if (allowed && url.startsWith(allowed)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // A interface precisa saber trocar o icone de maximizar por restaurar.
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  /*
    Janela minimizada ou escondida na bandeja: a interface pausa o video que
    chega. Com `backgroundThrottling: false` a pagina continua "visivel" para
    o Chromium mesmo minimizada, entao so o processo principal sabe — e antes
    ninguem contava, e o video continuava vindo pela internet de casa
    (04-midia.md).
  */
  const avisarOculta = (oculta: boolean) => mainWindow?.webContents.send('window:oculta', oculta);
  mainWindow.on('minimize', () => avisarOculta(true));
  mainWindow.on('hide', () => avisarOculta(true));
  mainWindow.on('restore', () => avisarOculta(false));
  mainWindow.on('show', () => avisarOculta(false));

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resolveIcon()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(app.getName());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Abrir Kiroshi',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * Atualizacao automatica.
 *
 * O objetivo e o do Discord: a pessoa nunca baixa nada na mao. O aplicativo
 * procura sozinho, baixa em segundo plano e so avisa quando ja esta pronto,
 * com um botao para reiniciar. Quem ignorar o aviso recebe a versao nova no
 * proximo fechamento, porque o instalador roda na saida.
 *
 * Por que isso importa aqui e nao e luxo: sem atualizacao automatica, cada
 * correcao vira uma conversa — mandar o link, esperar baixar 82 MB, esperar
 * instalar, para cada pessoa. Um grupo de dez pessoas fica com dez versoes
 * diferentes, e problema de chamada passa a depender de quem esta em qual.
 *
 * O download nao e cancelado nem adiado durante chamada: o `.blockmap` faz o
 * electron-updater baixar so as partes que mudaram entre duas versoes, que
 * costuma ser uma fracao dos 82 MB.
 */
function setupAtualizacao(): void {
  // Em desenvolvimento nao ha versao publicada com que comparar, e o updater
  // lanca erro procurando um arquivo de configuracao que so existe no pacote.
  if (isDev) return;

  autoUpdater.autoDownload = true;
  // Se a pessoa nao clicar em reiniciar, a versao nova entra no proximo
  // fechamento — sem pedir nada, sem perguntar de novo. Tambem em silencio:
  // o instalador na saida ja roda sem interface.
  autoUpdater.autoInstallOnAppQuit = true;

  /*
    Registro em arquivo, e nao `logger = null`.

    Estava desligado, e o custo apareceu na primeira vez que algo deu errado:
    para descobrir por que a atualizacao parecia manual foi preciso vasculhar
    o diretorio de cache do updater e ler um JSON interno, porque o aplicativo
    nao contava nada sobre o que tinha feito.

    Um arquivo em `userData` nao incomoda ninguem e responde de uma vez as
    perguntas que sempre aparecem: procurou? achou? baixou? falhou por que?
  */
  const arquivoDeLog = join(app.getPath('userData'), 'atualizacao.log');
  const anotar = (nivel: string, args: unknown[]): void => {
    const linha = `${new Date().toISOString()} ${nivel} ${args
      .map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
    // Nunca deixa a escrita do log derrubar a atualizacao: disco cheio ou
    // permissao negada nao sao motivo para a pessoa ficar sem versao nova.
    appendFile(arquivoDeLog, linha).catch(() => undefined);
  };
  autoUpdater.logger = {
    info: (...a: unknown[]) => anotar('INFO ', a),
    warn: (...a: unknown[]) => anotar('AVISO', a),
    error: (...a: unknown[]) => anotar('ERRO ', a),
    debug: (...a: unknown[]) => anotar('DEBUG', a),
  };

  const avisar = (patch: Partial<typeof estadoDaAtualizacao>): void => {
    estadoDaAtualizacao = { ...estadoDaAtualizacao, ...patch };
    mainWindow?.webContents.send('atualizacao:mudou', estadoDaAtualizacao);
  };

  /**
   * Avisa sem nunca desfazer uma versao ja baixada.
   *
   * `pronta` e a unica fase que representa algo concreto no disco: o
   * instalador existe e vai rodar no proximo fechamento, aconteca o que
   * acontecer depois. Toda outra fase e passageira.
   *
   * Isto importa porque a verificacao roda a cada dez minutos. Uma queda de
   * rede entre duas verificacoes e rotina, e sem esta guarda ela mudaria a
   * fase para `erro` e sumiria com o aviso de reiniciar — a pessoa perderia o
   * atalho para uma atualizacao que ja estava pronta na maquina dela.
   */
  const avisarSemPerderOPronto = (patch: Partial<typeof estadoDaAtualizacao>): void => {
    if (estadoDaAtualizacao.fase === 'pronta') {
      // Guarda o motivo, mas mantem a fase: a interface continua oferecendo o
      // reinicio, e a falha aparece na tela de ajustes se alguem for olhar.
      avisar({ erro: patch.erro ?? estadoDaAtualizacao.erro });
      return;
    }
    avisar(patch);
  };

  autoUpdater.on('checking-for-update', () =>
    avisarSemPerderOPronto({ fase: 'procurando', erro: null }),
  );

  autoUpdater.on('update-available', (info) =>
    avisar({ fase: 'baixando', versao: info.version, progresso: 0, erro: null }),
  );

  autoUpdater.on('update-not-available', () =>
    avisarSemPerderOPronto({ fase: 'ocioso', progresso: 0 }),
  );

  autoUpdater.on('download-progress', (p) =>
    avisar({ fase: 'baixando', progresso: Math.round(p.percent) }),
  );

  autoUpdater.on('update-downloaded', (info) =>
    avisar({ fase: 'pronta', versao: info.version, progresso: 100, erro: null }),
  );

  autoUpdater.on('error', (erro) => {
    // Falha de atualizacao nunca pode atrapalhar quem esta usando: o app
    // continua igual, e a proxima verificacao tenta de novo.
    avisarSemPerderOPronto({
      fase: 'erro',
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  });

  const procurar = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };

  /*
    Com que frequencia procurar.

    Os valores sao curtos de proposito, e nao e desperdicio: a consulta baixa
    `latest.yml`, que tem 342 bytes. Mil consultas por dia custariam menos que
    uma unica foto no chat.

    O que dita o ritmo e a fase do projeto. Enquanto cada correcao importa —
    e agora cada uma esta resolvendo alguem sem voz — uma janela de horas
    significa gente usando versao com defeito ja corrigido, e problema de
    chamada vira "depende de quem esta em qual versao". Cinco segundos depois
    de abrir, e a cada dez minutos, faz a correcao chegar praticamente junto
    com a publicacao.

    Quando o projeto estabilizar, alongar estes dois numeros e a unica coisa
    que precisa mudar.
  */
  const AO_ABRIR = 5_000;
  const A_CADA = 10 * 60 * 1000;

  setTimeout(procurar, AO_ABRIR);
  setInterval(procurar, A_CADA);
}

/**
 * O som que acompanha a tela: o do Windows inteiro, MENOS o do proprio Kiroshi.
 *
 * O `loopback` puro grava tudo o que sai nas caixas, e isso inclui a chamada.
 * Quem assistia ouvia a propria voz de volta pela transmissao, com o atraso da
 * ida e volta: o dono relatou em 2026-09-25 um retorno "muito forte" assistindo
 * a tela de um amigo.
 *
 * `loopbackWithoutChrome` e um dispositivo do proprio Chromium. A tipagem do
 * Electron so lista `loopback` e `loopbackWithMute`, mas a string passa direto
 * como id do dispositivo. No Windows ele usa a captura por processo
 * (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK) excluindo a arvore do servico
 * de audio, que e quem toca todo som do app: chamada, soundboard, avisos.
 * Medido no Electron 38 com dois tons inaudiveis: o tocado pelo app sumiu da
 * captura (de -40 dB para -117 dB) e o de outro programa continuou (-39 dB).
 *
 * `loopbackWithMute` nao serve: ele cala as caixas de quem transmite, que
 * deixaria de ouvir a chamada e o proprio jogo.
 *
 * Sem volta para o `loopback` puro, de proposito. Onde a captura por processo
 * nao existe, a tela vai sem som e a pessoa e avisada: tela muda e melhor que
 * devolver a voz de todo mundo.
 */
const SOM_DA_TELA: string = 'loopbackWithoutChrome';

/**
 * A captura por processo existe a partir do Windows 10 2004 (build 19041). A
 * Microsoft documenta 20348, mas funciona antes: o OBS usa o mesmo corte.
 */
function windowsSeparaOSomDoApp(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number(release().split('.')[2]);
  return Number.isFinite(build) && build >= 19041;
}

/**
 * Captura de tela.
 *
 * O getDisplayMedia do Chromium abriria o seletor nativo, que nao combina com
 * a interface e nao permite escolher audio da janela. Interceptamos o pedido e
 * usamos a fonte que a interface ja escolheu no nosso proprio seletor.
 */
function setupDisplayMedia(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      if (!pendingScreenSource) {
        // Sem escolha previa, nao ha o que compartilhar.
        callback({});
        return;
      }

      const { id, withAudio } = pendingScreenSource;
      pendingScreenSource = null;

      void desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
        const source = sources.find((s) => s.id === id);
        if (!source) {
          callback({});
          return;
        }
        callback({
          video: source,
          // `withAudio` ja passou por `windowsSeparaOSomDoApp` no `screen:select`.
          ...(withAudio ? { audio: SOM_DA_TELA as 'loopback' } : {}),
        });
      });
    },
    // Necessario para que o handler receba tambem os pedidos com audio.
    { useSystemPicker: false },
  );
}

function registerIpc(): void {
  // ---- Janela ----
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  // O X da barra de titulo: esconde na bandeja, ou fecha de vez se a pessoa
  // escolheu (Configuracoes > Windows). Antes escondia sempre, e a escolha so
  // valia pelo Alt+F4.
  ipcMain.on('window:close', () => {
    if (lerPreferencias().fecharParaBandeja) {
      mainWindow?.hide();
      return;
    }
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  ipcMain.on('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  // ---- Atualizacao ----
  ipcMain.handle('atualizacao:estado', () => estadoDaAtualizacao);

  ipcMain.handle('atualizacao:procurar', async () => {
    if (isDev) return estadoDaAtualizacao;
    await autoUpdater.checkForUpdates().catch(() => undefined);
    return estadoDaAtualizacao;
  });

  ipcMain.on('atualizacao:instalar', () => {
    // `isQuitting` antes de tudo: sem isso o `close` da janela cancelaria a
    // saida e esconderia o app na bandeja, e a atualizacao nunca aplicaria.
    isQuitting = true;

    /*
      Os dois argumentos sao o que separa "atualizou sozinho" de "abriu um
      instalador na minha cara".

      Sem eles, `quitAndInstall()` usa `isSilent = false` — o padrao do
      electron-updater — e roda o instalador NSIS com janela, barra de
      progresso e botoes. Quem clicou em "Reiniciar agora" esperando alguns
      segundos recebe um assistente de instalacao para clicar, que e
      exatamente a coisa que a atualizacao automatica existia para eliminar.

        true (isSilent)         instala sem interface nenhuma
        true (isForceRunAfter)  reabre o aplicativo ao terminar

      Sem o segundo, o aplicativo fecharia e simplesmente nao voltaria.
    */
    autoUpdater.quitAndInstall(true, true);
  });

  // ---- Compartilhamento de tela ----
  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() ?? null,
    }));
  });

  // Devolve se o som do sistema vai junto: so onde o Windows deixa o Kiroshi fora dele.
  ipcMain.handle('screen:select', (_event, id: string, withAudio: boolean) => {
    const comSom = withAudio && windowsSeparaOSomDoApp();
    pendingScreenSource = { id, withAudio: comSom };
    return comSom;
  });

  // ---- Push-to-talk global ----
  ipcMain.handle('ptt:register', (_event, accelerator: string) => {
    globalShortcut.unregisterAll();
    if (!accelerator) return true;

    try {
      // globalShortcut nao entrega o soltar da tecla, entao o atalho global
      // alterna o microfone. Com a janela em foco, a interface usa keydown e
      // keyup e faz o push-to-talk de verdade.
      const ok = globalShortcut.register(accelerator, () => {
        mainWindow?.webContents.send('ptt:toggle');
      });
      return ok;
    } catch {
      return false;
    }
  });

  ipcMain.handle('ptt:unregister', () => {
    globalShortcut.unregisterAll();
    return true;
  });

  // ---- Notificacoes ----
  ipcMain.on('notify', (_event, payload: { title: string; body: string; silent?: boolean; alvo?: string }) => {
    if (!Notification.isSupported()) return;
    // Nao notifica quando a janela ja esta na frente da pessoa.
    if (mainWindow?.isFocused() && mainWindow.isVisible()) return;

    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent ?? false,
      icon: resolveIcon(),
    });
    notification.on('click', () => {
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
      // O clique abre a conversa da mensagem, e nao so a janela.
      if (payload.alvo) mainWindow?.webContents.send('notificacao:abrir', payload.alvo);
    });
    notification.show();
  });

  ipcMain.on('badge:set', (_event, count: number) => {
    if (process.platform === 'win32') {
      mainWindow?.setOverlayIcon(
        count > 0
          ? nativeImage.createFromPath(resolveIcon()).resize({ width: 16, height: 16 })
          : null,
        count > 0 ? `${count} nao lidas` : '',
      );
    } else {
      app.setBadgeCount(count);
    }
  });

  ipcMain.on('flash', () => {
    if (!mainWindow?.isFocused()) mainWindow?.flashFrame(true);
  });

  // ---- Inicio automatico ----
  ipcMain.handle('autostart:get', () => iniciaComOWindows());
  ipcMain.handle('autostart:set', (_event, enabled: boolean) => {
    definirInicioComOWindows(enabled);
    return iniciaComOWindows();
  });

  // ---- Preferencias do processo principal e atalhos globais ----
  ipcMain.handle('preferencias:ler', () => lerPreferencias());
  ipcMain.handle('preferencias:gravar', async (_event, patch: Partial<PreferenciasDoApp>) => {
    const iniciava = iniciaComOWindows();
    const preferencias = gravarPreferencias(patch);
    // Abrir escondido muda o que o Windows passa ao iniciar: regrava a entrada.
    if (patch.iniciarEscondido !== undefined && iniciava) definirInicioComOWindows(true);
    if (patch.atalhos) await configurarAtalhos(preferencias.atalhos, enviarAtalho);
    return preferencias;
  });
  ipcMain.handle('atalhos:ativos', () => atalhosGlobaisAtivos());

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:platform', () => process.platform);

  /*
    Login com Google.

    O trabalho de verdade esta em `electron/google.ts`; aqui so atravessa a
    ponte. `abrirEEsperar` devolve erro em vez de estourar para a interface
    poder dizer o que houve — cancelar no Google e desistir a tempo sao
    situacoes normais, nao defeitos.
  */
  ipcMain.handle('google:preparar', () => prepararRetorno());
  ipcMain.handle('google:abrir', async (_event, url: string) => {
    try {
      return { entrega: await abrirEEsperar(url), erro: null };
    } catch (erro) {
      return { entrega: null, erro: erro instanceof Error ? erro.message : 'falhou' };
    }
  });
  ipcMain.handle('google:cancelar', () => {
    cancelarEspera();
    return true;
  });
}

/*
  Iniciar com o Windows.

  A entrada do registro guarda o caminho E os argumentos. Antes ela era
  gravada com `--hidden` e lida sem argumento nenhum: no Windows a leitura
  voltava falsa e o interruptor aparecia desligado a cada reabertura. Agora
  le e grava do mesmo jeito, com ou sem `--hidden` conforme a escolha de
  abrir escondido.
*/
function argumentosDoInicio(): string[] {
  return lerPreferencias().iniciarEscondido ? ['--hidden'] : [];
}

function iniciaComOWindows(): boolean {
  return (
    app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin ||
    app.getLoginItemSettings({ args: [] }).openAtLogin
  );
}

function definirInicioComOWindows(ligado: boolean): void {
  // Tira as duas formas antes: trocar de "escondido" nao pode deixar duas entradas.
  app.setLoginItemSettings({ openAtLogin: false, args: ['--hidden'] });
  app.setLoginItemSettings({ openAtLogin: false, args: [] });
  if (ligado) app.setLoginItemSettings({ openAtLogin: true, args: argumentosDoInicio() });
}

function enviarAtalho(acao: AcaoDeAtalho, pressionado: boolean): void {
  mainWindow?.webContents.send('atalho', acao, pressionado);
}

app.whenReady().then(() => {
  // Sem isto o Windows usa o nome do executavel nas notificacoes.
  if (process.platform === 'win32') app.setAppUserModelId(__APP_ID__);

  /*
    Iniciar com o Windows vem ligado (pedido do dono, F7), escondido na
    bandeja: marca-se uma vez, na primeira abertura, e a pessoa desliga se
    quiser. So no Kiroshi normal — o Beta abrindo sozinho ao lado dele seria
    dois apps na bandeja de quem testa.

    Nem com a pasta de dados trocada (`--user-data-dir`): assim e o build de
    teste, aberto de uma pasta qualquer, e a entrada "Kiroshi" do registro e
    a mesma do Kiroshi instalado — o teste trocaria o que abre quando a pessoa
    liga o computador. Instalacao de verdade nunca passa esse argumento.
  */
  const buildDeTeste = app.commandLine.hasSwitch('user-data-dir');
  if (!isDev && !buildDeTeste && !__APP_ID__.endsWith('.beta') && primeiraExecucao()) definirInicioComOWindows(true);

  void configurarAtalhos(lerPreferencias().atalhos, enviarAtalho);

  setupAtualizacao();
  // Antes da janela: o autoteste do modelo roda logo que a interface abre.
  registrarProtocoloDosModelos();
  setupDisplayMedia();
  registerIpc();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // Um link kiroshi:// com o app ja aberto chega aqui, no argv da segunda instancia.
  const rota = linkDosArgumentos(argv);
  if (rota) mainWindow.webContents.send('link:abrir', rota);
});

app.on('window-all-closed', () => {
  // Continua na bandeja; sair e uma acao explicita.
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  pararAtalhos();
  globalShortcut.unregisterAll();
});

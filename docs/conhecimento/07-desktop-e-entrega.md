# Casca Electron, empacotamento e atualizacao

> Estado em 2026-09-24, versao 1.15.0. Levantado lendo o codigo, o
> `app.asar` gerado, o log do atualizador e o registro do Windows da maquina
> de desenvolvimento, sem executar o app. Pendencias de seguranca da casca
> ficam em `privado/seguranca.md` ate serem corrigidas.

Caminhos relativos a `packages/desktop/`.

---

## Os achados que mais pesam

1. **A atualizacao diferencial nunca funcionou.** `/baixar/:arquivo` nao aceita
   `Range` (`packages/server/src/routes/download.ts:131-174`), entao o
   electron-updater desiste do blockmap e baixa o instalador inteiro — ~93 MiB
   por maquina a cada versao, puxados do upload de casa que tambem carrega a
   midia do SFU. O log local registra 15 tentativas, todas com "Server doesn't
   support Accept-Ranges". O diferencial teria baixado 1,5 MB (2%) nas versoes
   comuns e 12 MB (13%) na 1.15.0.
2. **"Abrir junto com o computador" quebrado de dois jeitos.** Grava com
   `setLoginItemSettings({openAtLogin, args:['--hidden']})` e le com
   `getLoginItemSettings()` **sem** os mesmos `args` (`electron/main.ts:636-638`)
   — no Windows a leitura responde `false` mesmo com a entrada gravada (na
   maquina de desenvolvimento a chave `HKCU\...\Run\fun.arasaka.kiroshi` existe
   com `--hidden`). E `--hidden` nunca e lido: a janela sempre aparece.
3. **Icone da bandeja e das notificacoes falta no app instalado.** `resolveIcon()`
   aponta para `app.asar/build/icon.png` (`main.ts:191-193`) e o electron-builder
   deixa `build/` fora do asar. [nao conferido visualmente]
4. **Instalacao "para todos os usuarios" existe na pratica.** `oneClick:false` +
   `perMachine:false` mostra a pagina de escolha; a maquina de desenvolvimento
   esta em `C:\Program Files\Kiroshi` (chave em HKLM). O `latest.yml` nao marca
   `isAdminRightsRequired`, entao essas instalacoes provavelmente pedem UAC a
   cada atualizacao. O manual promete "nao precisa de admin".
5. **Nada e assinado.** SmartScreen avisa a cada versao nova. A unica garantia
   de integridade da atualizacao e o sha512 do `latest.yml`, da mesma origem.
6. **`deploy.sh` sempre reinicia o LiveKit** (`deploy/scripts/deploy.sh:251`) e
   apaga os blockmaps antigos (`:191-192`).
7. **Dev e app instalado dividem o `userData`** (`%APPDATA%\@kiroshi\desktop`,
   porque o `package.json` empacotado nao tem `productName`): mesma sessao, mesma
   trava de instancia unica.
8. **Clone limpo nao empacota nem faz deploy como documentado:**
   `deploy/.env.production.example` e ignorado por acidente (cai em `.env.*`; a
   excecao `!.env.example` nao cobre esse nome) e os icones de
   `packages/desktop/build/` tambem (cai em `build/`).

## Processo principal (`electron/main.ts`)

- **Janela unica** (`195-300`): 1280x800, minimo 940x560, sem moldura,
  fundo `#0b0d12`, `backgroundThrottling: false` (`227`). Fechar esconde na
  bandeja (`264-268`). O comentario cita "Ctrl+Q", que nao existe.
- **Bandeja** (`302-329`): "Abrir Kiroshi" e "Sair"; duplo clique abre.
- **Instancia unica** (`186-189`): `whenReady` fora do `else` — a segunda
  instancia pode chegar a criar janela e bandeja antes de sair [nao verificado].
  `second-instance` restaura sem olhar os argumentos.
- **Protocolos:** nao ha `kiroshi://`. O unico esquema e o interno
  `kiroshi-modelos://` (`67-81`, `131-162`), que serve `resources/modelos`.
- **Atalho global:** so o do push-to-talk (`577-597`), que alterna (o
  `globalShortcut` nao avisa quando a tecla e solta) e, no Windows, **prende a
  tecla** — ela deixa de chegar ao jogo. Hoje nem e registrado: o renderer nunca
  grava `kiroshi.ptt.accelerator`.
- **Notificacoes** (`600-633`): nao aparecem com a janela visivel e em foco;
  clique so restaura a janela. `flash` pisca a barra de tarefas. `badge:set`
  existe e ninguem chama. `setAppUserModelId('fun.arasaka.kiroshi')`.
- **WebRTC:** `setWebRTCIPHandlingPolicy('default')` (`259`) para usar todas as
  interfaces (e o que permite o caminho pelo Tailscale).
- **Captura de tela** (`477-505`): `setDisplayMediaRequestHandler` com a fonte
  escolhida no seletor proprio, `audio:'loopback'` no Windows.
- **Depuracao:** `remote-debugging-port=9222` so quando `!app.isPackaged`.

### Canais IPC

| Canal | O que faz |
|---|---|
| `window:minimize/maximize/close/isMaximized` | janela (fechar = esconder) |
| `app:quit`, `app:version`, `app:platform` | sair (sem uso), versao, `process.platform` |
| `atualizacao:estado/procurar/instalar` + evento `atualizacao:mudou` | atualizacao |
| `screen:sources`, `screen:select` | seletor de tela |
| `ptt:register/unregister` + evento `ptt:toggle` | atalho global |
| `notify`, `badge:set`, `flash` | notificacao, sobreposicao no icone, piscar |
| `autostart:get/set` | iniciar com o Windows |
| `google:preparar/abrir/cancelar` | loopback do OAuth |

### Login com Google (`electron/google.ts`)

Loopback sem PKCE (cliente confidencial — o segredo fica no servidor):
1. o app sobe HTTP em `127.0.0.1:<porta sorteada>/pronto`;
2. `POST /auth/google/start {intencao, retorno}`; o servidor so aceita loopback
   com porta, assina o `state` (JWT de 5 min) e devolve a URL do Google;
3. `shell.openExternal(url)` e espera ate 5 min;
4. o Google volta ao servidor, que troca o codigo, confere o `id_token` e guarda
   um bilhete de uso unico (2 min), redirecionando para o loopback;
5. `POST /auth/google/concluir` devolve os tokens.

Os tokens ficam em `localStorage['kiroshi.session']`, em texto.

## Empacotamento

| Item | Valor |
|---|---|
| Versoes | Electron 38.8.6, electron-builder 26.15.3, electron-updater 6.8.9, livekit-client 2.22.3, React 19.3, Vite 7.3, Zustand 5 |
| Alvo | NSIS x64 assistido (`oneClick:false`, `perMachine:false`), idioma 1046, `Kiroshi-Setup-${version}.exe` (`electron-builder.yml:41-66`) |
| Conteudo | `out/**` + `package.json` em asar; locales pt-BR e en-US; `resources/modelos` fora do asar |
| Publicacao | `generic`, `https://order.arasaka.fun/baixar`, canal `latest` (`77-80`) |
| Assinatura | nenhuma |
| `deleteAppDataOnUninstall` | `false` (so vale no instalador de um clique) |

Scripts (`package.json:8-16`): `dev` (modelos tolerante + `electron-vite dev`),
`build`, `typecheck`, `dist:win` (modelos verificados + build + NSIS),
`dist:dir` (so `win-unpacked`, mais rapido para testar), `modelos`, `test`.

`scripts/baixar-modelos.mjs` baixa os modelos de limpeza de ruido, confere
sha256 e estrutura do WASM, grava de forma atomica; `--verificar` falha se faltar
arquivo; `--tolerante` segue sem rede. Origens em
`resources/modelos/manifesto.json`: ONNX do GitHub fixado por commit, WASM de
`cdn.mezon.ai` fixado por hash (8,0 MB + 16,4 MB).

`.env.production` (versionado de proposito): so `VITE_KIROSHI_SERVER`. Ordem de
escolha do servidor no cliente: o digitado (`localStorage kiroshi.baseUrl`), o do
build, `http://localhost:4000`.

**Versao** vem de `app.getVersion()` (o `version` de `packages/desktop/package.json`),
tambem embutida como `__VERSAO__` e enviada no IDENTIFY. A linha **"Plataforma"**
dos Ajustes e `process.platform`, que no Windows e literalmente `win32` — nao e
uma versao (foi lido como "1.32").

`release*/` ocupam **9,5 GB** na maquina de desenvolvimento (1.1.4 a 1.15.0, ~370
MB cada). O `Kiroshi-Setup-1.14.0.exe` em `release/` nao e o publicado (a mesma
versao foi reconstruida com conteudo diferente).

## Atualizacao, como e hoje

1. `dist:win` gera `.exe`, `.exe.blockmap`, `latest.yml`.
2. `deploy.sh:175-205` escolhe o `.exe` mais recente por data em `release*/`,
   apaga os antigos no servidor, envia o `.exe` se o **tamanho** mudou (nao o
   hash), sempre envia `latest.yml` e `.blockmap`.
3. O servidor serve `/baixar` (o de maior versao), `/baixar/versao` (JSON) e
   `/baixar/:arquivo` (lista fechada, `no-store`, **sem Range**).
4. O cliente empacotado (`main.ts:348-468`): `autoDownload` e
   `autoInstallOnAppQuit` ligados; procura 5 s depois de abrir e a cada 10 min,
   sem jitter; log em `%APPDATA%\@kiroshi\desktop\atualizacao.log`.
5. Baixa inteiro (diferencial falha), confere sha512.
6. Faixa `AvisoDeAtualizacao` na fase `pronta`: "Reiniciar agora" / "Depois".
   **Nao avisa se a pessoa esta em chamada.**
7. `quitAndInstall(true, true)` roda o NSIS `--updated /S --force-run`. Sem
   protecao contra clique duplo (o log mostra dois disparos seguidos em
   2026-09-23 01:41 UTC).

"Quem ignorar recebe no proximo fechamento" so vale para quem sai pela bandeja —
fechar a janela so esconde.

Numeros do log local desde 2026-09-19: 595 verificacoes; 33 erros HTTP 502 e 1
de 530 (deploys e o travamento da maquina). Cadencia de publicacao: mais de 6
versoes por dia.

## Atualizador em segundo plano (estilo EA app) — estudo

Pedido do dono: um processo que inicia com o Windows e fica verificando e
instalando atualizacoes mesmo com o app fechado. O documento do EA app que ele
vai mandar entra aqui quando chegar.

| Opcao | Admin? | Funciona com o app fechado? | Custo / risco |
|---|---|---|---|
| `autoInstallOnAppQuit` (ja ligado) | nao, se por usuario | nao | quase nunca dispara (fechar = esconder) |
| **O proprio app na bandeja** (ja verifica a cada 10 min) + login com `--hidden` corrigido + **"instalar quando for seguro"** (fora de chamada, janela escondida/ociosa, ou logo apos o login) | nao | quase: com inicio automatico, roda sempre que ha sessao | baixo. Precisa reabrir escondido depois de instalar e nao matar chamada |
| Tarefa agendada por usuario chamando `Kiroshi.exe --atualizar` sem janela | por horario: nao; por logon: costuma pedir admin (verificar) | sim | criar/remover no NSIS; conflita com a trava de instancia unica; carrega um Electron inteiro por execucao; antivirus pode estranhar exe sem assinatura instalando exe sem assinatura |
| Processo auxiliar separado na bandeja | nao | sim | mais um binario para gerar e manter; repete o que o app ja faz |
| Servico do Windows (SYSTEM) | **sim**, e obriga instalacao para todos | sim | contradiz o desenho por usuario; servidor comprometido vira SYSTEM em todas as maquinas. **Nao recomendado** |

Restricoes para qualquer opcao: o NSIS mata o app aberto; instalacao para todos
exige elevacao (nao da silencioso de verdade); sem assinatura, instalar sem
ninguem presente amplia o estrago de um servidor comprometido; sem diferencial,
cada atualizacao custa ~93 MiB por maquina no upload de casa.

**Recomendacao, nesta ordem:**
1. `Range` em `/baixar/:arquivo` (+ `useMultipleRangeRequest:false` se o servidor
   so atender um intervalo por pedido) e manter 1–2 blockmaps antigos.
2. Consertar `--hidden` e `autostart:get` (mesmos `args`, ou
   `executableWillLaunchAtLogin`).
3. "Instalar quando for seguro" dentro do proprio app, com protecao contra
   clique duplo e contra chamada em andamento; jitter no intervalo.
4. Forcar instalacao por usuario e migrar quem esta em Program Files.
5. So entao, se ainda fizer falta, a tarefa agendada — e assinatura de codigo
   antes de qualquer instalacao sem ninguem presente.

A pesquisa de mercado ([09-referencia-discord.md](09-referencia-discord.md#11-atualizadores-em-segundo-plano))
chega ao mesmo lugar: Steam, Discord e Squirrel so atualizam com o app aberto; o
EA app e o Battle.net usam servico de sistema e sao criticados por isso (servico
que nao fecha, UAC no meio do jogo, CVEs repetidas); o modelo mais limpo de
"atualizado mesmo fechado" e o do Chrome por usuario — **tarefa agendada que acorda
de hora em hora e no logon, verifica e sai**, sem admin. A documentacao do
electron-builder cita uma opcao `autoInstallEvent: 'onNextLaunch'` (instalar no
proximo inicio), mas ela **nao existe no electron-updater 6.8.9 instalado** (grep
em `node_modules/electron-updater/out`, 2026-09-24) — "instalar no proximo inicio"
teria de ser feito a mao, ou exigir atualizar a dependencia.

## Documentacao que diverge do codigo

| Documentacao | Realidade |
|---|---|
| blockmap "baixa so o que mudou" | nunca funcionou |
| "inicia minimizado na bandeja" | `--hidden` ignorado |
| "instala para si, sem admin" | a pagina de modo aparece; ha instalacoes em HKLM |
| "Ctrl+Q" | nao existe |
| "desinstalar tira tudo" | `deleteAppDataOnUninstall: false` |
| "82 MB" | 93,2 MiB |
| copiar `deploy/.env.production.example` | arquivo nao versionado |
| `deploy.sh` "gera os segredos" | so copia o `.env` |
| a imagem nao carrega o CLI do Prisma | carrega (e o `CMD` precisa dele) |
| "dev nao tem isolamento nem preload" | tem os dois |
| `Order.exe` em `reset-app.mjs`, `screenshot.mjs` | `Kiroshi.exe` |
| `DEPLOY.md` | nao avisa que o deploy completo derruba chamadas |

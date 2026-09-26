# Voz, video e compartilhamento de tela

> Estado em 2026-09-24, versao 1.15.0. Duas fontes: leitura do codigo
> (`packages/desktop/src/voice`, `electron/main.ts`, `deploy/livekit.yaml`, o
> `livekit-client` instalado) e logs de producao de 72 h (LiveKit e
> `cloudflared`). **[I]** = deducao ou comportamento externo (Chromium, servidor
> LiveKit) que precisa ser medido.
>
> A supressao de ruido vai ser **refeita do zero** (F3). A limpeza por modelo
> saiu na 2.0.2, o primeiro passo do processo; o que esta aqui sobre ela e o
> ponto de partida do estudo, nao o plano.

Versoes: `livekit-client` 2.22.3, Electron 38.8.6 (~Chromium 140 [I]),
`livekit/livekit-server:v1.13`, `@sapphi-red/web-noise-suppressor` 0.4.1 (so o
portao, desde a 2.0.2). O `deepfilternet3-noise-filter` 1.3.0 saiu na 2.0.2.

---

## Resumo

1. **Quem assiste quase nunca recebe a camada de topo.** O `adaptiveStream`
   escolhe a camada pelo tamanho do quadro na tela. No palco ao lado do chat o
   espectador recebe **360p a 15 fps**; no canal de voz em janela normal, 720p30;
   1080p60 so em tela cheia ou maximizado a 100% de escala.
2. **O emissor esta pesado:** VP8 por software em 3 camadas (ate 11 Mbps no
   1080p60), sem `contentHint` (jogo tratado como "tela de documento"),
   `maintain-resolution` no modo padrao 1080p30 — somado ao DFN3 (~38% de um
   nucleo; retirado na 2.0.2), ao React re-renderizando o app 5x por segundo e
   a uma RTCPeerConnection descartavel criada a cada 2 s para diagnostico.
3. **Toda a saida do SFU sai pela internet de casa** (~9 Mbps por espectador no
   topo do 1080p60). Janela minimizada continua baixando video; atualizacoes
   automaticas (93 MiB por maquina, sem diferencial) usam o mesmo upload.
4. **Em producao, 4 de 7 participantes ativos passam pelo relay TURN** da
   Cloudflare, e sao eles que mais trocam de caminho ICE (ate 95 trocas em 72 h
   para uma pessoa). Do lado do servidor esse caminho atravessa NAT de casa +
   CGNAT, cujo mapeamento de porta muda.
5. **Nao existe nenhuma metrica de video**, nem no app nem no servidor. Hoje
   nao da para separar uma causa da outra — o primeiro passo e medir.
6. Varios ajustes de audio nao fazem o que o nome promete (tabela abaixo), e o
   **som da transmissao inclui a propria chamada** (quem assiste ouve a si mesmo
   com atraso).
7. **Chamada em DM:** o servidor ja emite token e estado de voz para DM; faltam
   o toque (aceitar/recusar) e toda a interface.

---

## Entrada de audio

Cadeia desde a 2.0.2 (`controller.ts`, `cadeia.ts`, `limpeza.ts`, `ruido.ts`):

1. **Dispositivo e restricoes:** `createLocalAudioTrack({ deviceId,
   ...restricoesDoNavegador(ajustes) })`: `noiseSuppression`, `voiceIsolation`,
   `echoCancellation` e `autoGainControl` exatamente como a pessoa escolheu
   (padrao: os quatro ligados). Id em texto puro vale como `ideal` — se o
   aparelho sumir, o Chromium escolhe outro sem avisar [I]. Nao pede
   `channelCount`, `sampleRate`, `latency`.
2. **Grafo proprio:** `AudioContext(48 kHz)` -> fonte -> `GainNode` que so
   repassa -> portao (`NoiseGateWorkletNode`, so no modo por voz) ->
   `MediaStreamDestination` -> `processedTrack` (`ApenasPortao`, `ruido.ts`). A
   faixa recebe antes um `AudioContext` falso suspenso so para passar na
   checagem do LiveKit (`prepararFaixaParaProcessador`).
3. **Falha:** se o portao nao montar, a faixa segue sem ele; a limpeza do
   navegador ja foi pedida na captura, entao nunca sai crua por engano.
4. **Publicacao:** Opus ate 64 kbps, DTX, RED, prioridade `high`.
5. **Mudo/PTT:** `mute()` desliga a faixa crua; o grafo segue ligado.
6. **Ajustes gravados pela 2.0.1:** quem tinha a limpeza por IA ligada volta a
   ter `noiseSuppression` ligado na primeira leitura (com a IA ele nao fazia
   efeito, e desligado ninguem notava); as chaves antigas somem
   (`migrarAjustesDaLimpezaPorModelo`).

Contextos de audio abertos numa chamada: o da sala (inutil com `webAudioMix:
false`), o de referencia suspenso, o do portao, o da saida, o dos avisos
sonoros, o do teste de microfone e um temporario a cada faixa criada.

### Ate a 2.0.1: a limpeza por modelo (retirada)

Ate a 2.0.1 a cadeia tinha um MODELO entre a fonte e o portao, escolhido por
uma cascata DeepFilterNet3 -> GTCRN -> navegador, com um autoteste do DFN3 no
inicio do app; com modelo, a captura pedia `noiseSuppression` e
`voiceIsolation` **false**, e se nenhum modelo pegasse `restartTrack` religava
os do navegador. Saiu na 2.0.2 por decisao do dono ("o que esta implementado
esta horrivel"; processo do F3). O que foi medido fica aqui como entrada do
estudo:

**DeepFilterNet3 na 2.0.1:** `DeepFilterNet3Core` do pacote 1.3.0; WASM de 16,4 MB +
modelo ONNX de 7,98 MB servidos por `kiroshi-modelos://dfn3`; 48 kHz; quadro de
480 amostras (10 ms) [I]; roda na thread de audio do renderer; ~38% do tempo
real na maquina de dev (autoteste aprova ate 60%); intensidade vai para
`df_set_atten_lim` **em dB** — de 30 a 100 soa igual, e o padrao 100 e "sem
limite" (voz de lata). Ligar/desligar republica o microfone e recompila 24 MB.
Reserva: GTCRN (modelo de 16 kHz [I] — voz abafada acima de ~8 kHz; o doc atual
diz 48 kHz, provavelmente errado). Faixa processada possivelmente estereo
(`MediaStreamDestination` tem 2 canais) [I].

**Por que o RNNoise "nunca rodou"** (commit `484b704`): `setProcessor` lanca erro
se a faixa nao tem `audioContext`, e ele so e atribuido dentro do `publishTrack`.
O codigo chamava antes de publicar, o erro virava `console.warn`, e como NS e
isolamento tinham sido desligados "para dar lugar ao modelo", o microfone saia
cru. Tambem: o Vite embutia o worklet do portao como `data:` (bloqueado pela CSP).

A tabela abaixo e da auditoria da 1.x (antes da interface nova); as linhas da
IA e da intensidade valiam ate a 2.0.1.

| Ajuste | Efeito real | Veredito |
|---|---|---|
| Limpeza por IA (DFN3) | modelo no grafo | funcionava quando o autoteste aprovava; soava mal pelos motivos acima. **Retirada na 2.0.2** |
| Intensidade | `df_set_atten_lim` em dB | parcial: so mudava algo entre 0 e ~30. **Retirada na 2.0.2** |
| Sensibilidade | portao: abre no limiar, fecha 6 dB abaixo, 300 ms de espera (`ruido.ts`) | funciona; corte seco sem rampa. Na interface nova o medidor ja e em dB, antes do portao e com a marca do limiar |
| Isolamento de voz | `voiceIsolation` | sem efeito com a IA ligada ate a 2.0.1; desde a 2.0.2 sempre pedido; efeito no Windows desconhecido [I] (a medir no F3) |
| Supressao de ruido | NS do WebRTC | sem efeito com a IA ligada ate a 2.0.1; desde a 2.0.2 e a supressao do Kiroshi |
| Cancelamento de eco | restricao repassada | funciona como restricao; eficacia depende do AEC enxergar o audio remoto, que sai por WebAudio e as vezes por outro dispositivo [I] |
| Ganho automatico | restricao repassada | funciona |
| Apertar para falar | `keydown`/`keyup` com a janela em foco | **atalho global nunca registrado** (`kiroshi.ptt.accelerator` nunca e gravado, `usePushToTalk.ts:21-22`); mesmo registrado, o alternador nao abriria o mic em modo PTT (`controller.ts:965`); trocar a tecla so vale apos reiniciar |
| Teste de microfone | mesma cascata da chamada | **quebra com volume geral > 100%** (`retorno.volume` > 1 lanca `IndexSizeError`, `SettingsScreen.tsx:863`); cada passo no volume reabre o mic e recria o DFN3; em chamada roda um segundo DFN3 |
| Volume de entrada | — | nao existe |
| Troca de microfone | republica | funciona, com corte audivel |

Corrida: `updateSettings` sem trava — dois cliques rapidos em ajustes que reabrem
o mic disparam dois `publishMicrophone` em paralelo (`controller.ts:1427-1447`).

## Saida de audio

`track.attach()` cria `<audio>` mudo; quem toca e o grafo: fonte -> `Gain` por
faixa -> compensacao 1,4 (+2,9 dB) -> `DynamicsCompressor` (-6 dB, razao 20,
ataque 3 ms, soltura 250 ms) -> destino (`saida.ts:159-196`).

- Volume geral 0–200% e por pessoa/transmissao: funcionam (teto de ganho 4).
- Dispositivo de saida: `AudioContext.setSinkId` para a chamada; o soundboard
  usa o elemento com volume travado em 1.
- **Avisos de entrada/saida** (`sons.ts`): contexto proprio no dispositivo
  **padrao** — ignoram dispositivo escolhido, volume geral e ensurdecer. O som de
  "saiu" toca tambem numa queda inesperada.
- **Limitador unico para voz e som de transmissao** [I no efeito]: jogo alto
  rebaixa a voz de todo mundo.
- **`TrackUnsubscribed` nao limpa** `audioElements` nem o grafo
  (`controller.ts:619-622`): parar de assistir deixa nos pendurados.
- **Som da transmissao incluia a chamada — consertado na 2.0.1.** O
  `audio: 'loopback'` capturava todo o audio do sistema, inclusive as vozes que o
  Kiroshi toca, e quem assistia ouvia a propria voz de volta (relato do dono,
  2026-09-25). Agora e `loopbackWithoutChrome`; ver a captura de tela abaixo.
- Qualidade `Lost` vira `'unknown'` e aparece como "Ainda medindo a conexao".

## Publicacao de video e tela

| Opcao da sala | Valor |
|---|---|
| `adaptiveStream` | `true`, sem `pixelDensity` (`controller.ts:510`) |
| `dynacast` | `true` |
| `singlePeerConnection` | `true` (padrao da 2.22.3) |
| `simulcast` | `true`; camera com camadas padrao h180/h360 |
| `videoCodec` | nao definido -> **VP8**; `backupCodec` sem efeito com VP8 |
| `audioPreset` | 64 kbps; `dtx` e `red` ligados (o som da tela desliga os dois, desde a 2.0.1) |
| `reconnectPolicy` | padrao (0, 0,3, 1,2, 2,7, 4,8 s e 5x 7 s) |
| `connect` | `autoSubscribe: true`, `maxRetries: 3`, ICE do servidor, `relay` so com `FORCE_TURN_RELAY` |

**Captura de tela:** duas etapas — `screen:select` por IPC, depois
`getDisplayMedia` com altura e fps `ideal/max`; o handler do processo principal
responde com a fonte escolhida (e chama `desktopCapturer.getSources` de novo,
gerando miniaturas de todas as janelas a cada pedido). Modos: 720p30,
**1080p30 (padrao)**, 1080p60. Se o pedido com som falhar, tenta sem som e avisa.

**Som da tela (2.0.1):** o sistema inteiro **menos o proprio Kiroshi**.
- `audio: 'loopbackWithoutChrome'` no handler (`SOM_DA_TELA`, `main.ts`). E um
  dispositivo do Chromium: a tipagem do Electron so lista `loopback` e
  `loopbackWithMute`, mas a string passa direto como id. No Windows ele ativa a
  captura por processo (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`) em modo
  `EXCLUDE_TARGET_PROCESS_TREE`, com o pid do servico de audio, que e quem toca
  todo som do app (`media/audio/win/audio_low_latency_input_win.cc`). Nao precisa
  de modulo nativo.
- Sem captura por processo (Windows antes do 10 2004, build 19041, o mesmo corte
  do OBS; a Microsoft documenta 20348), o `screen:select` devolve `false`, a
  tela vai muda e a pessoa le `SOM_DA_TELA_PEDE_WINDOWS_NOVO`. Nunca volta para o
  `loopback` puro, e o Chromium tambem nao volta sozinho: a ativacao falha e o
  pedido cai no "tenta sem som".
- `loopbackWithMute` nao serve: cala as caixas de quem transmite.
- Pedido **sem tratamento de voz** (`SOM_DA_TELA_COMO_VEIO`: `echoCancellation`,
  `noiseSuppression` e `autoGainControl` falsos). Sem isso o Chromium processava
  o som da tela como microfone e em mono.
- Publicado **sem DTX e sem RED** (os padroes do LiveKit para estereo; a sala liga
  os dois para o microfone): 64 kbps estereo no SFU (`audioFeatures`
  `TF_STEREO` e `TF_NO_DTX`), contra 131 kbps antes.

Medido em 2026-09-25 (Electron 38.8.6, Windows 11 25H2) com tons inaudiveis de
-40 dB: o app toca 18 kHz (WebAudio) e 17,25 kHz (`<audio>` com MediaStream, o
caminho da voz de quem esta na chamada); o PowerShell toca 18,75 kHz.

| Captura | Som do proprio app | Outro programa |
|---|---|---|
| `loopback` (antes) | -40 dB (entra inteiro) | -40 dB |
| `loopbackWithoutChrome` no Beta | -128 a -139 dB (silencio) | presente |
| Electron separado, ao mesmo tempo | o som do Beta aparece (-49 a -60 dB) | presente |
| padrao, com tratamento de voz | — | -41 a -46 dB, oscilando (no Beta ate -56); mono |
| sem tratamento de voz | — | -40,0 dB exatos; estereo |

A terceira linha e a prova de que o som do Beta sai de fato nas caixas: so a
captura do proprio Beta o deixa de fora. Os scripts ficaram no scratchpad da
sessao (`loopback/`); a receita esta na memoria do teste de voz local.

- **`contentHint` nunca definido** (`controller.ts:1180`, faixa criada com
  `new LocalVideoTrack`). [I] O Chromium trata como screencast: prefere manter
  resolucao e descarta quadro em cena de movimento.
- `degradationPreference`: `maintain-framerate` a 60 fps, `maintain-resolution`
  a 30 fps (`controller.ts:1218`) [I: conferir `sender.getParameters()`].
- `priority: 'high'` sem efeito (o LiveKit so aplica na camada 0).
- Bitrate inicial sem teto para tela: 90% da soma das camadas (`PCTransport.ts:69-75`).
- Sem switch de aceleracao por hardware; VP8 no Windows codifica por software [I].

| Modo | Camada baixa | Media | Topo | Soma no upload |
|---|---|---|---|---|
| 720p30 | 640x360 @15, 0,5 Mbps | — | 1280x720 @30, 1,5 | 2,0 Mbps |
| 1080p30 (padrao) | 640x360 @15, 0,5 | 1280x720 @30, 1,8 | 1920x1080 @30, 4,0 | 6,3 Mbps |
| 1080p60 | 640x360 @15, 0,5 | 1280x720 @30, 2,5 | 1920x1080 @60, 8,0 | **11,0 Mbps** |

O comentario "teto de 8 Mbps" (`qualidade.ts:27-28`) ignora as camadas de baixo.
Janela com menos de 720 px de altura em modo 1080p gera duas camadas iguais.

Camera: 1080p30 com recuo para 720p30; camadas 3 Mbps + 450 + 160 kbps;
`maintain-framerate`.

## Recepcao

`<video>` absoluto com `object-fit: contain` (`Stage.tsx:631-642`). Convite nao
aceito nao tem `<video>`; `setSubscribed(false)` evita o download.

O `adaptiveStream` mede o elemento x `pixelDensity`, que vale 1 com
`devicePixelRatio <= 2` — **ignora a escala de 125%/150% do Windows**
(`RemoteVideoTrack.ts:283-320`). O app nunca chama `setVideoQuality` nem
`setVideoDimensions`.

| Situacao | Altura do quadro [I] | Camada recebida | fps (modo 60 / 30) |
|---|---|---|---|
| Palco ao lado do chat, em destaque (padrao) | ~282 px | 360p | **15 / 15** |
| Palco do chat esticado ao maximo, janela 1080p | ~600–650 | 720p | 30 / 30 |
| Canal de voz, janela padrao 1280x800 | ~520 | 720p | 30 / 30 |
| Canal de voz maximizado, 1080p a 100% | ~760 | 1080p | 60 / 30 |
| O mesmo a 125% / 150% | ~550 / ~450 | 720p | 30 / 30 |
| Fita de miniaturas | 76 | 360p | 15 |

- **Trocar entre canal de voz e texto desmonta um `Stage` e monta outro**
  (`MainScreen.tsx:157-158` x `177-183`): o video e solto, marcado invisivel e
  visivel de novo — pausa, retoma e espera quadro-chave [I].
- Palco recolhido: altura 0 e `opacity: 0` — pausado; ao reabrir, espera
  quadro-chave.
- **Janela minimizada continua baixando** [I]: com `backgroundThrottling: false`,
  `visibilityState` fica `visible` e o `pauseVideoInBackground` nunca dispara.
- `setSubscribed(true)` reenviado a cada 200 ms enquanto a assinatura esta
  pendente; com `autoSubscribe: true`, toda transmissao nova e assinada por todos
  por ate 200 ms antes da recusa.

## Reconexao e falhas

- O LiveKit reconecta sozinho; `SignalReconnecting` nao e tratado. Na desconexao
  final, nao reentra automaticamente.
- `explicarQueda` so distingue `CLIENT_INITIATED`: qualquer outra razao (inclusive
  `SERVER_SHUTDOWN`, que todo deploy completo provoca) **culpa a rede da pessoa**.
- Token de 6 h; `/voice/refresh` existe e o cliente nunca chama (aceita o
  `refreshToken` que o LiveKit manda pela sinalizacao).
- **Estado de voz preso a sessao antiga:** depois de um novo IDENTIFY o cliente nao
  reenvia `VOICE_STATE_UPDATE`; o servidor ignora a saida pedida por outra sessao
  (`services/voice.ts:312`) — "fantasma" na lista de voz.
- Reinicio da API apaga todos os estados de voz com as salas do LiveKit ainda ativas.
- A cada 2 s o diagnostico cria uma RTCPeerConnection descartavel e coleta
  candidatos ICE (`controller.ts:679-685, 1749-1783`), a chamada inteira.

## Servidor de midia (`deploy/livekit.yaml`)

| Chave | Valor | Nota |
|---|---|---|
| `port` | 7880 | sinalizacao via tunel (`wss://voz.arasaka.fun`) |
| `rtc.udp_port` | 7881 | porta unica multiplexada |
| `rtc.tcp_port` | 7882 | ICE-TCP (nenhum par TCP apareceu em 72 h) |
| `rtc.use_external_ip` | false | sem STUN; `node_ip` ausente de proposito |
| `rtc.interfaces.includes` | fisica + Tailscale | trocadas pelo `deploy.sh` |
| `room` | `empty_timeout 60`, `departure_timeout 20`, `max_participants 25`, `auto_create` | |
| `audio` | `active_level 35`, `min_percentile 40`, `update_interval 400`, `smooth_intervals 4` | ~1,6 s de atraso no anel de quem fala |
| `video.dynacast_pause_delay` | 5s | o comentario nao descreve o que a chave faz |
| `limit` | sem limite | o comentario "a rede local e boa" esta errado: a saida vai pela internet de casa |

Nao configurado (padroes da v1.13 [I]): `congestion_control`,
`allow_tcp_fallback`, `pli_throttle`, `packet_buffer_size`, TURN embutido,
`room.enabled_codecs`, **`prometheus_port` (sem metricas)**. O servico no compose
nao tem limite nem prioridade de CPU.

## Caminhos de rede em producao (medido)

Arquitetura: sinalizacao (`order.arasaka.fun`, `voz.arasaka.fun`) pelo Cloudflare
Tunnel; midia direta por IPv6 na UDP 7881, pelo Tailscale para quem entra na rede
virtual, ou pelo **relay TURN da Cloudflare** (credenciais geradas pela API com
`CLOUDFLARE_TURN_*` — ja em uso, embora `ARQUITETURA.md` diga "sem IPv6, sem voz").

LiveKit, 72 h ate 2026-09-24:

- **234 trocas de par ICE** (`ice reconnected or switched pair`): 110 host-LAN do
  servidor <-> relay; 52 IPv6 <-> IPv6; 34 srflx <-> relay; 28 LAN <-> LAN;
  10 IPv6 <-> prflx. **Nenhum par TCP.**
- **4 de 7 participantes ativos usam relay** e concentram as trocas (uma pessoa:
  95 em 72 h). No lado do servidor o par com relay sai pelo NAT de casa + CGNAT;
  o `srflx` do servidor aparece com a porta mudando (55152 -> 55184 -> 55185), e
  cada porta nova vira um par novo.
- **57 retomadas de sessao RTC:** 32 `RR_SIGNAL_DISCONNECTED` (sinalizacao caiu —
  ela passa pelo tunel), 15 `RR_UNKNOWN`, 10 `RR_PUBLISHER_FAILED` (a conexao de
  quem publica falhou — para quem assiste, imagem congelada ate voltar). As de
  sinalizacao se concentram em 2026-09-22/23, antes dos consertos do cliente
  (`5b00783`, `bc4ad67`); depois disso, nenhuma.
- 1 `publish time out`; 8 `could not restart participant` (2026-09-22);
  pacotes fora de ordem na camada 2 (VP8) em 2026-09-24 05:44 UTC.

`cloudflared`, 72 h: 43 conexoes encerradas, 77 tentativas de reconexao, 25 falhas
de discagem QUIC, 51 erros no tratador de datagramas; rajada de 16 eventos em
2026-09-24 05:46–05:48 UTC, dois minutos depois das perdas fora de ordem no
LiveKit. Protocolo do tunel na epoca: **QUIC** (UDP), que atravessa o mesmo CGNAT.
Desde 2026-09-25 e **HTTP/2** (TCP), depois de uma conexao QUIC meio morta dar
524 a parte dos clientes (backlog F13).

Host (medias de 10 min do `sysstat`): CPU ociosa >= 97% nas janelas de uso; pico
de saida de ~5 Mbit/s e de entrada de ~9 Mbit/s. Media de 10 min esconde pico
curto — nao descarta saturacao.

## Banda de saida do SFU por espectador [I, estimativa]

Topo 1080p60: 8 Mbps + ~8% de cabecalhos + 1–5% de reenvios + ~0,15 do som
~= **9 Mbps por espectador**; entrada do emissor ~11,5 Mbps.

| Espectadores | Topo 1080p60 | Topo 1080p30 | Camada media 720p30 |
|---|---|---|---|
| 1 | ~9 Mbps | ~4,5 | ~2,7 |
| 3 | ~27 | ~13 | ~8 |
| 5 | ~45 | ~22 | ~14 |
| 9 | **~81** | ~40 | ~24 |

Corrigir a escolha de camada (hipotese 1) sem medir o upload de casa pode trocar
um gargalo pelo outro.

## Hipoteses para "as transmissoes estao travando muito"

Em ordem de probabilidade, ja cruzando codigo e producao:

| # | Hipotese | Evidencia | Como provar |
|---|---|---|---|
| 1 | **Camada escolhida pelo tamanho do quadro** (360p15 ao lado do chat) + video remontado ao trocar de tela | codigo (`controller.ts:510`, `Stage`), tabela acima | no espectador, `inbound-rtp.frameHeight`/`framesPerSecond`; mesma transmissao no palco do chat, no canal de voz e em tela cheia; A/B com `setVideoQuality(HIGH)` |
| 2 | **Caminho de rede instavel para quem usa relay** (NAT duplo + CGNAT remapeando) e reconexoes | logs: 4/7 no relay, ate 95 trocas; 10 `PUBLISHER_FAILED` | cruzar quem reclama com quem usa relay; `freezeCount` por espectador; eventos `Reconnecting` |
| 3 | **Emissor limitado por CPU** (VP8 software 3 camadas + DFN3 + re-render 5 Hz + sondagem ICE a cada 2 s + o jogo) | codigo | `qualityLimitationReason = cpu`; `totalEncodeTime/framesEncoded`; A/B com 720p30. O DFN3 saiu na 2.0.2: comparar antes e depois |
| 4 | **Jogo tratado como tela de documento** (`contentHint` vazio) | codigo | `media-source.frames - framesEncoded`, `hugeFramesSent`; A/B com `contentHint = 'motion'` |
| 5 | **Upload de casa** (SFU + tunel + atualizacoes de 93 MiB + janelas minimizadas baixando) | codigo, estimativa de banda | medir o upload; perda e jitter subindo **ao mesmo tempo em todos**; cruzar travadas com horarios de publicacao |
| 6 | **Upload do proprio emissor** (11 Mbps no 1080p60, comeco a 9,9 Mbps) | codigo | `availableOutgoingBitrate`; `qualityLimitationReason = bandwidth` |
| 7 | Rota ruim (Tailscale via DERP/TCP, IPv6 longo) | `DEPLOY.md:433-450` | endereco 100.x ou TCP no diagnostico |
| 8 | Pedidos de quadro-chave em rajada, camadas pausadas pelo dynacast | [I] | `pliCount`, `keyFramesEncoded` no emissor |
| 9 | Perda no proprio servidor (socket UDP unico, host compartilhado) | [I] | `RcvbufErrors` em `/proc/net/snmp`, `vmstat 1` |
| 10 | Quedas da sinalizacao pelo tunel QUIC | logs do `cloudflared` | correlacionar com `SignalReconnecting`; o tunel virou HTTP/2 em 2026-09-25, entao comparar as retomadas antes e depois |

Descartadas: "simulcast desligado" (esta ligado); "um receptor ruim derruba o
emissor" (o SFU isola, salvo por pedidos de quadro-chave).

**Metricas que faltam** (todas via `track.getRTCStatsReport()`, API publica):

| Lado | Metrica | Prova |
|---|---|---|
| Emissor | `media-source.frames/framesPerSecond` | a captura em si |
| Emissor | por camada: `active`, `frameHeight`, `framesPerSecond`, `targetBitrate`, `bytesSent` | camadas vivas |
| Emissor | `qualityLimitationReason` + duracoes | CPU ou banda |
| Emissor | `framesEncoded` x frames capturados, `hugeFramesSent`, `totalEncodeTime` | descarte e custo por quadro |
| Emissor | `nackCount`, `pliCount`, `retransmittedBytesSent`, `encoderImplementation` | reenvios, quadro-chave, software/hardware |
| Emissor | `remote-inbound-rtp` perda/RTT/jitter; `availableOutgoingBitrate` | trecho ate o SFU |
| Espectador | `inbound-rtp`: `frameHeight`, `framesPerSecond` | camada que chegou |
| Espectador | `freezeCount`, `totalFreezesDuration`, `pauseCount`, `framesDropped`, `jitterBufferDelay`, `packetsLost` | travada de verdade e onde |
| Eventos | `TrackStreamStateChanged`, `Reconnecting`, `SignalReconnecting` | pausas e quedas |
| Servidor | `prometheus_port` (so localhost), `/proc/net/snmp`, banda de saida por segundo | SFU, host, uplink |

## Chamada em DM

> **Feita na fatia 4 (2026-09-25).** Servidor em
> [03-servidor.md](03-servidor.md#voz-no-servidor); no app, o cartao de chamada
> recebida e o palco no topo da DM (`features/chamada/ChamadaRecebida.tsx`,
> `ChamadaNaConversa.tsx`). O toque e sintetizado como os outros avisos
> (`voice/sons.ts`) e ainda sai no dispositivo padrao, como eles (ajuste da
> fatia 5). O levantamento abaixo e de antes.

Ja existe no servidor: `isVoiceCapable` aceita DM e grupo
(`services/voice.ts:36-39`); `DM_PERMISSIONS` inclui CONNECT/SPEAK/STREAM; token
emitido para `channel_<dmId>`; VOICE_STATE_UPDATE vai aos participantes.

Falta no servidor: sinal de chamada (tocando, quem foi chamado, tempo limite,
recusa), mensagem de sistema "chamada perdida"/"chamada de X min", estados de voz
de DM no READY (`services/ready.ts:170`), encerrar a sala quando sobrar uma
pessoa, tirar da chamada quem sai do grupo ou e bloqueado.

Falta no cliente: botao de ligar no cabecalho da DM; chamada recebida (som,
notificacao nativa, `flashFrame`, aceitar/recusar); a visao de chamada para DM
(`MainScreen` so abre `VoiceChannelView` para `GUILD_VOICE`); indicador de
chamada ativa na lista de DMs. O toque vai a todas as sessoes; so o aparelho que
aceitar entra (`entrada.ts:154-156` ja garante).

## Divida tecnica e reaproveitamento

- `controller.ts` tem 1.895 linhas: sala, microfone, camera, tela, assinatura,
  saida, diagnostico, textos de erro, `localStorage`, dois temporizadores e efeito
  colateral no import. Estado por polling (emite a cada 200 ms mesmo sem mudanca).
- Diagnostico depende de campos privados do LiveKit.
- **`src/voice` e separavel da UI:** nao importa React; a UI consome por
  `subscribe`/`getState` (`hooks/useVoice.ts`). API publica boa para a interface
  nova: `joinChannel`, `leave`, `setMuted`, `setDeafened`, `setCamera`,
  `startScreenShare`, `assistirTransmissao`, `getVideoTrack`, `updateSettings`.
- Reaproveitar como esta (puros e testados): `entrada.ts` (guarda de corridas,
  ja pagou por dois defeitos publicados), `caminhos.ts`, `falhas.ts`, `palco.ts`,
  `saida.ts` (separando o limitador da voz e o da tela), `sons.ts` (com
  `setSinkId` e volume), `limpeza.ts`/`cadeia.ts` (a cascata nao depende do LiveKit).
- Reescrever: `ruido*.ts` (vai ser refeito), `qualidade.ts` (`contentHint`, teto do
  upload total, camada baixa acima de 15 fps), o controlador dividido em sessao,
  microfone, publicacao, assinatura e diagnostico.

## O que a pesquisa externa acrescenta

Detalhe e fontes em [09-referencia-discord.md](09-referencia-discord.md#10-transmissao-de-tela-estavel).

- **Simulcast na tela e obrigatorio no LiveKit:** tela com uma camada so fica fora
  do controle de banda do SFU — espectador com rede ruim congela em vez de ser
  rebaixado. O Kiroshi ja publica em simulcast; nao tirar.
- O Discord prefere **codificador de hardware** e so codifica com pelo menos um
  espectador. O Kiroshi hoje codifica VP8 por software; H.264 por hardware (ou
  VP9/AV1 onde houver) entra na lista de experimentos medidos.
- `contentHint`: `motion` para jogo (manter fps), `detail`/`text` para documento
  (manter resolucao) — escolher pelo que a pessoa vai transmitir, junto com a
  qualidade no seletor.
- **Eco na transmissao:** a solucao e captura de audio **por processo** (WASAPI
  `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`). Feito na 2.0.1 sem modulo nativo: o
  proprio Chromium ja tem o dispositivo `loopbackWithoutChrome`, que o Electron
  aceita embora nao documente (ver a captura de tela acima).
- Voz prioritaria, ensurdecer de verdade e mover no LiveKit auto-hospedado:
  `canPublishSources`, `canSubscribe: false` e token novo + reconexao (nao ha
  `MoveParticipant` fora do LiveKit Cloud).

## Regras de projeto para a interface nova (vem daqui)

1. O tamanho do quadro decide a qualidade: quem assiste pede a camada
   explicitamente (`setVideoQuality`) ou usa `pixelDensity: 'screen'`.
2. O `<video>` de uma transmissao **nunca e desmontado** ao trocar de tela ou de
   layout — mover o elemento, nao recria-lo.
3. Janela minimizada ou palco fechado **para de assinar** o video.
4. Diagnostico mostra metrica de video de verdade (camada recebida, fps, travadas,
   limitacao do emissor), sem sondar ICE a cada 2 s.
5. Estado da chamada por evento, nao por polling de 200 ms; niveis de audio
   separados do resto do estado para nao re-renderizar o app inteiro.

## O que a fatia 3 implementou (2026-09-25)

Na interface nova (Kiroshi Beta); a 1.x segue com a adaptacao automatica do
LiveKit. Conferido numa chamada entre duas instancias do Beta na mesma maquina,
com um LiveKit local (`--dev`): prova a escolha de camada, a pausa e o
`<video>`. **Nao prova a rede de producao** — isso so a telemetria vai medir.

| Regra | Como ficou | Conferido |
|---|---|---|
| 1. Camada pelo que a pessoa quer ver | `adaptiveStream` desligado; `voice/recepcao.ts` (testado) pede a camada pela altura REAL do quadro, com a escala do Windows: transmissao assistida nunca abaixo de 720p, 1080p a partir de 600 px reais; camera 1080p/360p/180p por 480/200 px. Escolha fixa por quadro: Automatica, Alta, Media, Baixa | quadro de 340 px: **720p29, 1,7 Mbps** (a 1.x mandava 360p15). "Alta": 1080p29, 3,6 Mbps, com 1 travada na troca de camada |
| 2. `<video>` nunca recriado | um elemento por pessoa e fonte (`features/chamada/videos.ts`), movido com `moveBefore` entre grade, destaque e mini palco | 58 quadros em 2 s durante a mudanca para o mini palco, o mesmo elemento |
| 3. Ninguem vendo = pausado no SFU | `setEnabled(false)` quando o quadro sai da tela, a janela minimiza (evento `window:oculta` do processo principal: com `backgroundThrottling: false` a pagina segue "visivel") ou o quadro desmonta (400 ms de folga para trocas de layout) | minimizado: 0 quadros, bytes parados, o emissor parou a camada; ao voltar, primeiro quadro em 201 ms |
| 4. Metrica de video de verdade, sem sondar ICE | ficha no quadro (`features/chamada/medicao.ts`, testado): resolucao, fps, banda e travadas em 30 s para quem assiste; camada de topo viva, banda somada e limitacao (CPU, rede) para quem transmite. Latencia do par ICE nomeado da propria conexao | emissor em 1080p30 com as 3 camadas: 6,2 Mbps; RTT 1 ms (local) |
| 5. Estado por evento | **nao feito** — o motor ainda emite a cada 200 ms | — |

O que vai passar, escolhido no seletor de tela (`qualidade.ts`, testado):
`contentHint` `motion` ou `detail`, preferencia de degradacao pela fluidez ou
pela nitidez, e as camadas:

| Captura 1080p | Camada baixa | Media | Topo |
|---|---|---|---|
| Movimento, 30 fps | 640x360 @30, 0,5 Mbps | 1280x720 @30, 1,8 | a captura |
| Movimento, 60 fps | 640x360 @30, 0,5 | 1280x720 @30, 2,5 | a captura |
| Detalhe | — | 1280x720 @5, 0,6 | a captura |

A camada baixa de movimento passou de 15 para 30 fps: quem cai para ela ja esta
sofrendo, e 15 fps num jogo e a travada. Texto a 360p nao se le, entao detalhe
nao tem camada de 360p.

Tambem da fatia:

- **Dynacast confirmado:** sem ninguem pedindo 1080p, o emissor para a camada de
  topo (de 6,2 para 2,2 Mbps).
- **Quem assiste** vai no atributo `assistindo` do participante; o quadro de quem
  transmite mostra quantos estao vendo.
- **Parar a transmissao travava** (a faixa era lida depois de despublicada e
  `screenSharing` ficava ligado) — defeito tambem da 1.x, consertado no motor.
- **Moderacao no SFU:** ver [03-servidor.md](03-servidor.md#voz-no-servidor). O
  app le `serverMute`/`serverDeaf` do token ao entrar: quem entra silenciado
  nao abre o microfone, e a moderacao nao se perde ao ser movido de canal.
- `explicarQueda` distingue `PARTICIPANT_REMOVED`: "Voce foi desconectado da
  chamada", e nao um diagnostico da rede.

# Referencia: como o Discord (e outros) resolvem o que vamos construir

> Pesquisa de 2026-09-24 em fontes oficiais (central de ajuda, documentacao de
> desenvolvedor, blog de engenharia, codigo do LiveKit) e de terceiros.
> Confianca: **[O]** oficial, **[T]** terceiros, **[NC]** nao confirmado.
> Rotulos de interface aparecem como `codigo`; textos longos estao parafraseados
> (nao copiar texto do Discord para o produto — escrever o nosso).
>
> Fontes abreviadas: `sup N` = `https://support.discord.com/hc/en-us/articles/N`
> (pt-BR: trocar `en-us` por `pt-br`); `dev:X` = `https://docs.discord.com/developers/X`;
> `lk:X` = `https://docs.livekit.io/X`.

---

## Contexto que importa

**Desde 2026-08-17 o Discord desligou Go Live, video em tempo real e
compartilhamento de tela para usuarios no Brasil** — em DM, grupo, canal de voz e
Stage. E ordem da ANPD ligada a uma investigacao do ECA Digital; o Discord chama
de temporario e nao da data de volta (sup 42704051358359) [O]. Bate com a origem
do projeto ("compartilhar tela e ligar a camera pararam de funcionar para eles").
Para o Kiroshi, transmissao de tela nao e um recurso a mais: e a razao de existir.

## 1. Chamadas em DM e grupo

| Ponto | Discord | Fonte |
|---|---|---|
| Iniciar | icones de telefone (`Start Voice Call`) e camera (`Start Video Call`) no topo da DM | sup 360041721052 [O] |
| Grupo | ate 10 membros; qualquer um inicia; a chamada fica aberta enquanto houver 1 pessoa | sup 223657667 [O] |
| Toque | iniciar toca para todos; da para tocar uma pessoa so (`Ring` no menu do membro) | tweet oficial 2018 [O] |
| Protocolo | `POST /channels/{id}/call/ring` (destinatarios) e `.../stop-ringing`; eventos `CALL_CREATE`/`CALL_UPDATE` com a lista `ringing` | docs.discord.food [T] |
| Receber | popup com `Join Call` e `Decline`; recusar para de tocar so para quem recusou | sup 217659737 [O] |
| Duracao do toque | nao documentada; relatos de 15–30 s | [NC] |
| Registro na conversa | mensagem de sistema: "fulano iniciou uma chamada" (com botao de entrar), depois a duracao; para quem nao atendeu, "chamada perdida" | docs.discord.food [T] |
| Video e tela | camera, grade/foco, pop-out, tela cheia; `Share Your Screen` > janela ou tela > `Go Live`; ate 50 espectadores; varias transmissoes ao mesmo tempo | sup 360040816151 [O] |
| Criptografia | audio e video de DM, grupo, voz e Go Live com E2EE obrigatorio desde 2026-03-02 | sup 25968222946071 [O] |

### Quem fica sozinho na chamada

- **Regra atual (desde ~abril de 2023): 3 minutos sozinho em chamada privada
  (DM ou grupo), desktop e celular, e a pessoa e desconectada.** Antes eram 5 min,
  so no desktop. [T — varios relatos 2019–2024 e captura de tela de 2024]
- **So chamadas privadas.** Canal de voz de servidor nao tem isso (la existe o
  canal AFK). Nao ha opcao para desligar; pedem isso desde 2019. [T]
- **O aviso:** mensagem efemera do bot na propria DM, visivel so para quem foi
  desconectado e dispensavel. Diz que a pessoa estava sozinha havia mais de 3
  minutos e que a "patrulha da banda" pediu para desconecta-la para economizar
  banda — e fecha com a piada de que banda nao da em arvore. A traducao oficial
  em pt-BR nao foi encontrada [NC].
- **Por que existe:** o proprio aviso fala em economizar banda; o Discord hospeda
  voz de graca e o SFU foi desenhado por custo (blog de engenharia de 2018:
  2,6 milhoes de usuarios simultaneos, 220 Gbps de saida) [O]. Do lado do usuario:
  gente que dorme na chamada gastando dados do celular, notebook ligado a noite
  toda [T]; microfone aberto esquecido quando alguem volta a ligar [NC].
- **Outros:** o Slack encerra o huddle quando o ultimo sai, sem timer de solidao [O].
- **No LiveKit:** `departure_timeout` (fecha a sala depois que todos saem) e
  `empty_timeout` (sala em que ninguem entrou) **nao cobrem uma pessoa sozinha**.
  Precisa de timer proprio: no servidor (webhook `participant_left` ou o proprio
  estado de voz + `RemoveParticipant`) ou no cliente [O].

**Para o Kiroshi faz sentido, e mais do que no Discord:** a saida do SFU e o
upload de casa, e uma pessoa sozinha numa DM com camera ou tela ligada nao serve
a ninguem. Proposta: 3 min sozinho em chamada de DM/grupo -> desconecta, com um
aviso nosso (texto proprio, no mesmo tom de humor); timer no servidor, que e quem
sabe com certeza quantos estao na sala.

### Canal AFK (servidores)

`Inactive Channel` + `Inactive Timeout` (1, 5, 15, 30 min ou 1 h): move e muta
quem fica ocioso. Nao vale para DM. (dev:resources/guild) [O]

## 2. Ajustes de servidor (abas atuais)

| Secao | Abas | Fonte |
|---|---|---|
| Servidor | `Server Profile` (nome, icone, banner, descricao), `Engagement` (canal de mensagens de sistema e o que ele anuncia, canal AFK, notificacao padrao), `Roles`, `Emoji`, `Stickers`, `Soundboard`, `Widget`, `Server Templates` (+ `Server Tag`, `Boost Perks`) | sup 30715364399511 [O] |
| Apps | `Integrations` (webhooks, bots), `App Directory` | sup 21334461140375 [O] |
| Moderacao | `Safety Setup` (verificacao, filtro de midia, 2FA para moderadores, protecao contra raid), `AutoMod`, `Audit Log`, `Bans` | sup 4421269296535 [O] |
| Gestao de membros | `Members` (lista com filtros e acoes), `Invites` (lista, revogar, pausar), `Access` (so convite / pedir para entrar / publico) | sup 15946797617431, 8458903738647 [O] |
| Fim | `Delete Server` (so o dono; pede 2FA ou o nome) | sup 213595197 [O] |

Moderacao que interessa a um grupo pequeno: castigo temporario (`Timeout
Members`: 60 s, 5 min, 10 min, 1 h, 1 dia, 1 semana), auditoria de 45 dias com
filtro por usuario e acao, banir apagando mensagens das ultimas N horas/dias.
AutoMod, verificacao e raid sao para comunidade publica. [O]

## 3. Cargos

**Grupos de permissao** (dev:topics/permissions; sup 214836687) [O]: Geral
(ver canais, gerenciar canais, gerenciar cargos, criar/gerenciar expressoes,
auditoria, webhooks, gerenciar servidor), Membros (criar convite, apelidos,
expulsar, banir, **castigar**), Texto (enviar, anexar, reagir, emojis/figurinhas
externos, mencionar todos, gerenciar mensagens, **fixar** e **ignorar modo lento**
— separados de "gerenciar mensagens" em 2025/2026 —, historico), Voz (conectar,
falar, video, soundboard, **usar deteccao de voz**, voz prioritaria, silenciar,
ensurdecer, mover, status do canal), Avancado (Administrador).

Diferencas em relacao ao Kiroshi: o Discord separa **criar** de **gerenciar**
expressoes, tem **castigo**, **fixar** e **ignorar modo lento** como bits proprios;
o Kiroshi tem `MANAGE_EMOJIS` unico e nao tem castigo.

**Hierarquia** [O]:
- so se age sobre quem tem o cargo mais alto **abaixo** do seu (cargo igual tambem
  bloqueia banir, expulsar, apelido);
- com `Manage Roles` se cria, edita, atribui e reordena so cargos abaixo do seu, e
  so se concede o que se tem;
- **cargo novo nasce logo acima do @everyone** (no Kiroshi nasce no topo — e por
  isso so o dono consegue criar);
- dono tem tudo; Administrador tem tudo e ignora sobrescritas;
- cor exibida = a do cargo mais alto que tem cor; limite de 250 cargos.

**Editor do cargo** [O]: abas `Display` (nome, cor, icone, "exibir separadamente",
"permitir que qualquer um mencione"), `Permissions` (com busca e "limpar
permissoes"), `Manage Members` (lista de quem tem o cargo, adicionar/remover) e
`View Server As Role` (ver o servidor como o cargo).

**Como se atribui cargo a um membro** [O]:
1. no perfil do membro, botao `+` na secao de cargos;
2. na aba `Manage Members` do proprio cargo;
3. clique direito no membro > `Roles` com caixas de marcar [NC];
4. pagina `Members` dos ajustes (coluna de cargos com `+`, filtros).

**Sobrescritas de canal** [O]: calculo em ordem (base -> @everyone do canal ->
todos os deny dos cargos -> todos os allow -> membro); sem `View Channel` nada
vale; sem `Connect` caem as outras de voz. Interface com tres estados por
permissao (negado / herda / liberado) e botao `Private Channel`. **Categoria:** o
canal fica "sincronizado" e copia a categoria; editado, deixa de seguir, e `Sync
Now` volta a sincronizar. **Nao ha heranca somada** — isso evita exatamente o
defeito de heranca invertida que o Kiroshi tem hoje.

## 4. Emojis, figurinhas, soundboard

| | Limite (sem impulso) | Arquivo |
|---|---|---|
| Emoji | 50 estaticos + 50 animados | 256 KB; 128x128 recomendado; nome 2+ caracteres |
| Figurinha | 5 | 320x320, ate 512 KB; animada ate 5 s |
| Som | 8 | MP3 ou Ogg, **ate 512 KB e 5,2 s**; volume 0–1; um emoji |

(blog oficial dez/2025; sup 4403089981975; sup 12612888127767) [O]

Soundboard: botao na barra de voz com favoritos e previa; tocar exige `Speak` +
`Use Soundboard`, estar conectado e sem mudo/surdo; 6 sons padrao; cada pessoa
controla o volume do soundboard nos proprios ajustes (0% cala); "sons de entrada"
(um som que toca quando voce entra na voz) e recurso pago; criar/editar/apagar vai
para a auditoria. Cooldown nao documentado (relato de 5 s por usuario [T]).

## 5. Convites

| Ponto | Discord | Fonte |
|---|---|---|
| Formato | `discord.gg/<codigo>` ou `discord.com/invite/<codigo>` | sup 360001556852 [O] |
| Validade | 30 min, 1 h, 6 h, 12 h, 1 dia, **7 dias (padrao)**, nunca | [T]; API 0–7 dias [O] |
| Usos | sem limite, 1, 5, 10, 25, 50, 100 | [T]; API 0–100 [O] |
| Membro temporario | expulso ao desconectar, salvo se receber cargo | sup 208866998 [O] |
| Mandar para amigos | a janela de convite lista amigos e grupos recentes com botao `Invite`, e o convite chega como DM; ou clique direito no amigo > `Invite to Server` | sup 204155938 [O] |
| Revogar | aba `Invites`: lista, apagar, pausar todos | sup 8458903738647 [O] |
| Canal | cada link leva ao canal de onde saiu | sup 204155938 [O] |
| API recente | convite que ja da cargos (`role_ids`) e convite restrito a certas pessoas | dev:resources/invite [O] |

**Do navegador para o app** [T]: a pagina de convite tenta falar com o app aberto
por WebSocket em `127.0.0.1` (portas 6463–6472); o app tambem registra o esquema
`discord://-/invite/<codigo>`. Sem o app, a pagina apresenta o Discord e oferece o
cadastro. O Chrome 142 passou a pedir permissao para site publico acessar
`localhost` — **esquema proprio e mais robusto que WebSocket local**.

No Electron: `app.setAsDefaultProtocolClient('kiroshi')` + a trava de instancia
unica; no Windows a URL chega no `argv` do evento `second-instance` [O].

## 6. Moderacao de voz

- Clique direito em quem esta em voz [O]: `Server Mute` (ninguem ouve a pessoa ate
  um moderador desfazer), `Server Deafen` (ela nao ouve ninguem, persistente),
  `Disconnect`, `Move To` (leva para outro canal mesmo sem `Connect` la).
  No desktop tambem se **arrasta** o avatar para outro canal [T].
- Estado de voz separa mudo/surdo **do servidor** de mudo/surdo **proprio** [O].
- **Voz prioritaria:** atalho proprio de apertar-para-falar; abaixa o volume dos
  outros enquanto a pessoa fala (quanto, nao documentado) [O].
- **`Use Voice Activity`:** sem ela, so apertar-para-falar (imposicao no cliente [NC]).
- **No LiveKit auto-hospedado** (lk:intro/basics/rooms-participants-tracks/participants) [O]:
  `RemoveParticipant` desconecta; `MutePublishedTrack` muta (desmutar remoto vem
  desligado); `UpdateParticipant` com `canPublishSources` sem microfone = mudo que
  sobrevive a reentrar; `canSubscribe: false` = **ensurdecer de verdade**;
  `MoveParticipant` so existe no LiveKit Cloud — **auto-hospedado, mover = token
  novo + o cliente reconecta**.

## 7. Notificacoes

- **Por servidor** [O]: `All Messages` / `Only @mentions` / `Nothing`; silenciar por
  15 min, 1 h, 3 h, 8 h, 24 h ou ate desligar; suprimir @everyone/@here e mencoes
  de cargo. **Por canal/categoria:** os mesmos niveis ou "usar o padrao do
  servidor". O dono do servidor define o padrao.
- **Mudo:** tira o ponto de nao lida e as notificacoes; mencoes ainda contam [O].
- **Nao perturbe cala toda notificacao de desktop** (sup 227779547) [O].
- **Ajustes do usuario:** ligar/desligar notificacao de desktop (os sons
  continuam), contador no icone, piscar a barra de tarefas, e uma lista de sons
  (mensagem, mudo, surdo, entrar/sair da voz, chamada recebida/feita, transmissao
  iniciada/encerrada, espectador entrou/saiu...) [T].
- Ponto branco = nao lida; vermelho com numero = mencoes; DM sempre com contador [O].

## 8. Conta

**Discord** [O]: cadastro com email, nome de exibicao, username, senha e data de
nascimento + CAPTCHA; username 2–32 (minusculas, numeros, `_`, `.`); senha minimo 8;
email verificado por link (sem verificar, o chat funciona, mas servidores com
verificacao bloqueiam falar); a conta nasce vazia (Inicio, "adicionar servidor",
lista de amigos vazia). **O Discord nao tem login com Google.**

**Apps com Google e senha definida depois:**

| App | Onde | Como prova |
|---|---|---|
| Notion | Ajustes > `Set a password` | so estar logado [O] |
| Slack | Conta > senha > redefinir por email | link por email [O] |
| Figma | tela de entrada > redefinir senha | link por email [O] |
| Linear | nao tem senha (link/codigo por email, Google, passkey) | — [O] |

**Boas praticas que valem para o F4:**
- identificar a conta Google pelo `sub`, nunca pelo email (OWASP ASVS 5.0) — o
  Kiroshi ja faz isso [O];
- **conta pre-sequestrada:** alguem cria conta com senha usando o email da
  vitima; a vitima depois entra com Google; se o servico juntar as contas pelo
  email, a senha do atacante continua valendo (USENIX Security 2022; 35 de 75
  servicos vulneraveis). Regra: **so vincular por email se o email local ja estiver
  verificado** [O];
- o Google so e autoridade sobre o email em `@gmail.com` ou Workspace com `hd`; e
  "entrar com Google de novo" nao prova que a pessoa acabou de digitar a senha
  (nao ha `prompt=login`). Para **redefinir** senha, o padrao do mercado e link ou
  codigo por email [O];
- NIST SP 800-63B-4 (2025): senha como fator unico com minimo de 15, ou 8 se houver
  2FA; aceitar ate 64+; sem regra de composicao; checar contra lista de senhas
  vazadas; adicionar credencial nova exige autenticacao e aviso por canal
  independente [O].

## 9. Ajustes de usuario relevantes

- **Voz e video** [O]: teste de microfone que devolve a voz (e muta a pessoa na
  chamada durante o teste); deteccao de voz com **sensibilidade automatica** ou
  manual (a barra deve ficar no amarelo quando calado); atraso de soltura do
  apertar-para-falar; supressao de ruido (Krisp, que desliga sozinha com CPU alta);
  eco e ganho automatico; atenuacao (abaixar os outros apps quando alguem fala).
- **Aparencia** [O]: tema com `Sync with computer`; mensagens `Default` ou
  `Compact` — **o compacto tira os avatares, reduz o espaco e poe a mensagem na
  mesma linha do nome**; espaco entre grupos de mensagem; tamanho do texto; zoom.
- **Movimento reduzido** [O]: `Sync with computer` e o padrao; ligar forca so no
  Discord. Na maquina do dono (animacoes do Windows desligadas), um app que segue
  o padrao fica parado — o mesmo que acontece no Kiroshi.
- **Windows** [O/T]: abrir com o computador, iniciar minimizado, fechar manda para a
  bandeja (Alt+F4 fecha).

## 10. Transmissao de tela estavel

- **Discord Go Live** [O, blog de engenharia 2024]: VP8 e H.264 (HEVC e AV1 em
  algumas plataformas), **prefere codificador de hardware**, nao usa simulcast
  (manda o que a conexao mais lenta aguenta), **so transmite com pelo menos um
  espectador**, derruba quadros quando a latencia sobe, audio so do processo
  compartilhado e dos filhos dele.
- **LiveKit** [O, codigo do SFU]: tela com **uma camada so fica fora do controle de
  banda** — espectador com rede ruim nao e rebaixado, congela. Com simulcast a tela
  e gerenciada e tem prioridade acima da camera. **Manter simulcast na tela.**
- Padroes do `livekit-client` [O]: tela em `h1080fps15`, VP8, simulcast; sem
  `screenShareSimulcastLayers` cria uma camada extra de metade da resolucao;
  `degradationPreference` padrao da tela = `maintain-resolution`; o evento
  `LocalTrackCpuConstrained` avisa falta de CPU.
- WebRTC [O]: `contentHint 'motion'` -> manter fps; `'detail'`/`'text'` -> manter
  resolucao. Captura de tela sem hint e tratada como screencast: mantem resolucao
  e derruba fps — a "travada" com texto nitido e esse comportamento, proposital.
- Referencia de bitrate (VMAF 85, 30 fps, jogo) [O]: 1080p VP8 5,5 Mbps (H.264 8,5;
  VP9 4,0; AV1 3,5); 720p VP8 2,5 (H.264 3,5; VP9 1,8; AV1 1,7).
- **Receita de partida** (ajustar medindo):

  | Uso | Codificacao | Hint e degradacao | Camada baixa |
  |---|---|---|---|
  | Texto e codigo | 1080p15 | `detail` + `maintain-resolution` | 720p5 |
  | Jogo | 720p60 ou 1080p30 | `motion` + `maintain-framerate` | 360p ou 540p a 30 fps |

- **Audio da transmissao:** o `loopback` do Electron pega todo o som do sistema,
  inclusive a chamada (eco para quem assiste). O eco se resolve com captura por
  processo (WASAPI `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`) [O], e o Chromium ja
  traz isso pronto: o dispositivo `loopbackWithoutChrome` exclui o proprio app.
  Feito na 2.0.1, sem modulo nativo (ver [04-midia.md](04-midia.md#publicacao-de-video-e-tela)).
  Fazer como o Discord numa janela (so o som daquele programa) seria o
  dispositivo `applicationLoopback` do mesmo codigo, que inclui a arvore de um
  processo [I: formato do id e pid da janela a descobrir].

## 11. Atualizadores em segundo plano

| Produto | O que roda com o app fechado | Admin | Frequencia |
|---|---|---|---|
| EA app | servico `EABackgroundService`, sobe no boot | na instalacao [NC] | "de vez em quando" |
| Steam | nada; atualiza ao abrir (servico so para tarefas privilegiadas) | na instalacao | ao abrir |
| Battle.net | processo `Agent.exe` + servico auxiliar no boot | UAC as vezes | — |
| Google Chrome (GoogleUpdater) | por usuario: **tarefa agendada** que acorda de hora em hora e no logon, verifica e sai | por usuario: nao | ~4,5 h |
| Squirrel.Windows / Discord | nada; `Update.exe` chamado pelo app | nao | com o app aberto |
| electron-updater (o do Kiroshi) | nada; modulo dentro do app | por usuario: nao | enquanto roda |
| MSIX | o proprio Windows, a cada 8 h | exige pacote assinado | 8 h |

Criticas conhecidas [T/O]: o servico do EA nao fecha com o app e perdeu o botao de
desligar; o do Battle.net foi instalado sem aviso; servicos SYSTEM de launcher
viraram vulnerabilidade repetidas vezes (CVEs no Steam, Origin, Battle.net, Google
Updater).

Recomendacao para o Kiroshi (bate com [07-desktop-e-entrega.md](07-desktop-e-entrega.md)):
electron-updater + NSIS **por usuario**; verificar ao abrir e a cada poucas horas na
bandeja; instalar no proximo inicio ou quando for seguro (a opcao
`autoInstallEvent: 'onNextLaunch'` citada na documentacao nao existe no
electron-updater 6.8.9 instalado — seria feito a mao). Se "atualizado mesmo fechado" virar requisito: **tarefa agendada do
proprio usuario** (logon + a cada N horas) que roda um verificador pequeno e sai,
como o GoogleUpdater. Evitar servico SYSTEM.

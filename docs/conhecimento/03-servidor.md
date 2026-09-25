# Servidor e pacote compartilhado

> Estado em 2026-09-24. Levantado lendo por inteiro `packages/server/src`,
> `packages/server/prisma`, `packages/server/test` e `packages/shared/src`.
> **[I]** = deducao que precisa ser confirmada rodando.
>
> Defeitos de **seguranca** ainda abertos nao sao descritos aqui (o
> repositorio e publico): ficam em `privado/seguranca.md` ate serem corrigidos
> e publicados. Os ja corrigidos estao na secao "Correcoes de seguranca".

## Correcoes de seguranca (publicadas em 2026-09-24, API no `6f493df`)

| O que era | O que ficou | Commit |
|---|---|---|
| O gateway entregava a todos os membros os eventos de canais privados (mensagens, edicoes, reacoes, fixadas, digitacao, voz) | eventos de canal so para quem tem VIEW_CHANNEL, com a mesma conta do REST (`lib/visibilidade.ts`, `services/entrega.ts`); quem perde acesso recebe CHANNEL_DELETE | `1d5e59f` |
| `?around=<id>` devolvia mensagem de qualquer canal ou DM | a mensagem-alvo tem que ser do proprio canal | `1d5e59f` |
| Anexo de mensagem apagada seguia servido | apagar mensagem (uma ou em massa) apaga linhas e arquivos | `1d5e59f` |
| Digitacao, ack e busca por servidor sem conferir permissao | digitacao exige VIEW + SEND (ou ser da DM); ack e busca exigem READ_MESSAGE_HISTORY | `1d5e59f` |
| VOICE_SERVER_UPDATE ia a todas as sessoes da conta | so a sessao que pediu (ou a gravada no VoiceState, ao mover) | `62dda74` |
| Expulso, banido, quem sai, servidor apagado, grupo, bloqueio: seguiam na chamada | `tirarDaVoz`: apaga o estado, avisa e remove do SFU | `62dda74` |
| `roomAdmin` no token de moderador dava a API do SFU ao cliente | fora do token; moderacao so pelo servidor | `62dda74` |
| Bloqueio nao valia em DM existente; bloquear quem te bloqueou apagava o bloqueio dele | DM 1:1 com bloqueio recusa mensagem e chamada; bloqueio preservado | `62dda74` |
| Sessao revogada, senha trocada ou conta excluida seguiam no gateway | IDENTIFY/RESUME conferem a sessao no banco; essas acoes fecham com 4004 | `93d9625` |
| Filtro de SSRF dos cartoes de link aceitava IPv4 embutido em IPv6; DNS resolvido duas vezes | classificador de enderecos proprio; conexao no IP ja conferido | `93d9625` |
| Limite por IP lia `X-Forwarded-For` de qualquer um | `CF-Connecting-IP` quando vem do cloudflared; `trustProxy` so para proxy local | `93d9625` |
| Payloads do gateway sem validacao | zod nos opcodes 2, 3, 4, 6, 8, 12 (4002 fora do formato) | `93d9625` |

Junto, confiabilidade: o RESUME passou a entregar o que aconteceu durante a
queda, e o fechamento atrasado de um socket antigo nao derruba mais a sessao
reanexada (`6f493df`); trocar direto de canal de voz nao derruba mais a
chamada nova no 1.15; o barramento Redis respeita o padrao assinado.

Caminhos: `S/` = `packages/server/src/`, `SH/` = `packages/shared/src/`,
`PR/` = `packages/server/prisma/`.

Servidor e shared chegaram inteiros no commit `1e86a65` (2026-09-22); os 14
commits seguintes so mexem no cliente. Nao ha historico fino para `git blame`.

---

## Stack

Node 22, TypeScript ESM, Fastify 5, `ws` 8, Prisma 6 + Postgres, zod 3, `jose`
(JWT HS256), argon2, otplib, qrcode, sharp, `livekit-server-sdk` 2, pino,
ioredis opcional. `@fastify/rate-limit` e `@fastify/static` estao no
`package.json` e nunca sao importados.

**Subida** (`S/index.ts:195-260`): conecta o banco -> barramento (memoria, ou
Redis com `REDIS_URL`) -> pasta de uploads -> **apaga todos os `VoiceState`** ->
Fastify `listen` -> gateway no mesmo servidor HTTP -> faxinas a cada 6 h
(anexos orfaos > 24 h, convites vencidos, auditoria > 90 dias). Migracoes rodam
no start do container (`prisma migrate deploy`).

**Fastify** (`S/index.ts:34-138`): `trustProxy: true`, corpo JSON ate 12 MB,
multipart ate 100 MB, CORS `CORS_ORIGINS ?? true`, erro central no formato
`{error:{code,message,details?}}` (`S/errors.ts:78-86`), limite global por IP.

## Rotas REST (114 + WebSocket)

Prefixo `/api/v1`. "auth" = so JWT, sem banco (`S/auth/middleware.ts:26-32`);
"fresh" = JWT + sessao existente no banco + conta ativa (`:39-58`).

| Modulo | Rotas |
|---|---|
| Raiz | `GET /health`, `GET /api/info` (nome, versao do gateway, voz, cadastro aberto, limites), paginas `/`, `/privacidade`, `/termos`, `/convite/:codigo` (o link do convite, fatia 6), `POST /uploads`, `GET /attachments/*` (a URL e a capacidade), `GET /baixar`, `/baixar/versao`, `/baixar/:arquivo`, WS `/gateway` |
| Auth `S/routes/auth.ts` | register, login, login/mfa, refresh, logout, logout/all, sessions (listar/revogar), password, totp setup/enable/disable/backup-codes |
| Google `S/routes/auth-google.ts` | `GET /auth/google`, `/disponivel`, `POST /start`, `GET /callback`, `POST /concluir`, `/registrar`, `/senha`, `DELETE /auth/google` |
| Usuarios `S/routes/users.ts` | `@me` (ler/editar/username/presenca/apagar), `/:id`, `by-username`, ajustes de notificacao por guild e por canal |
| Social `S/routes/relationships.ts` | amizades (pedir/aceitar/remover/bloquear), DMs e grupos (criar, renomear, adicionar/remover, fechar) |
| Servidores `S/routes/guilds.ts` | CRUD, sair, transferir posse, membros (listar/editar/expulsar), **dar e tirar um cargo** (`PUT`/`DELETE /guilds/:g/members/:m/roles/:r`), bans, cargos (CRUD + reordenar), convites, auditoria (filtro `actorId` e `action`) |
| Canais `S/routes/channels.ts` | listar visiveis, CRUD, reordenar, sobrescritas de permissao, **sincronizar com a categoria** (`DELETE /channels/:c/permissions`) |
| Mensagens `S/routes/messages.ts` | historico, enviar, editar, apagar, bulk-delete, reacoes, fixadas, ack, busca por guild e por canal |
| Convites `S/routes/invites.ts` | preview publico, aceitar, revogar |
| Voz `S/routes/voice.ts` | join/leave/refresh, estados do canal, tocar som do soundboard |
| Expressoes `S/routes/expressions.ts` | emojis, figurinhas, sons (e `PATCH` do som: nome, emoji, volume) |

**Ja existe no servidor e a interface nao usa:** grupos de DM. (Mover,
silenciar, ensurdecer e tocar soundboard a interface nova usa desde a fatia 3;
notificacoes por guild/canal, bloquear e revogar sessoes desde as fatias 4 e 5;
posse, bans, cargos, convites, auditoria, canais, sobrescritas e apelidos desde
a fatia 6.) A 1.x continua sem nada disso.

## Gateway (`S/gateway/`)

- `/gateway`, quadro maximo 256 KB, sem compressao. `HELLO
  {heartbeatInterval: 41250}`; sem IDENTIFY em 30 s fecha com 4003.
- Opcodes cliente -> servidor: 1 HEARTBEAT, 2 IDENTIFY, 3 PRESENCE_UPDATE,
  4 VOICE_STATE_UPDATE, 6 RESUME, 8 REQUEST_GUILD_MEMBERS, 12 TYPING. Servidor ->
  cliente: 0 DISPATCH, 9 INVALID_SESSION, 10 HELLO, 11 ACK. **RECONNECT (7)
  nunca e enviado.** Nenhum payload do gateway passa por zod.
- Fechamentos: 4000 (qualquer excecao), 4001, 4002, 4004, 4005, 4008 (>120
  msg/min), 4009 (sem heartbeat por 82,5 s), 4010 (sessao retomada em outro
  socket).
- READY (`S/services/ready.ts:39-136`): usuario, guilds com canais visiveis,
  cargos, ate 1000 membros, emojis, figurinhas, sons, voiceStates; DMs abertas,
  relacoes, readStates, presencas.
- Retomada: buffer de 512 eventos por sessao; RESUME vale ate ~2,5 min.
  VOICE_SERVER_UPDATE, TYPING_START e SPEAKING_UPDATE nao entram no buffer.
- **Defeito (corrigido em `6f493df`): o RESUME perdia eventos.** `dispatchToUser/Guild/Channel` pulavam
  sessoes com socket fechado antes de chamar `dispatch` (`S/gateway/registry.ts:206,
  225, 246`); o evento nao entra no buffer e o RESUME devolve `replayed: 0`.
  Contradiz `docs/ARQUITETURA.md:210-213`.
- **Defeito (corrigido em `6f493df`):** RESUME que troca um socket ainda aberto
  (`server.ts:295-299`) — o `close` atrasado do socket antigo marca a sessao
  reanexada como desconectada; ~2 min depois `pruneExpired` a remove, tira da
  voz e pode marcar offline, com o socket novo aberto e surdo.
- Presenca em memoria por usuario, nao por sessao (vale o ultimo aparelho).
  "Invisivel" nao muda nada (`server.ts:480-482`); `activity` nunca e gravada.
- Barramento Redis (`S/bus.ts`): rodar em varios processos **nao funciona** de
  fato [I] — presenca, rate limit, bilhetes do Google e inscricoes sao locais.

## Modelo de dados (`PR/schema.prisma`)

Ids snowflake em texto (42 bits de ms desde 2024-01-01, 5 worker, 5 processo,
12 sequencia — `SH/snowflake.ts`). Permissoes em `BigInt`, trafegam como string.

| Modelo | Pontos-chave |
|---|---|
| User | email/username unicos; `passwordHash?` (nulo = so Google); perfil; status; `totpSecret` + `backupCodes` (hash); `disabledAt` |
| LinkedAccount | GOOGLE por `sub`; unico por conta e por provedor |
| Session | refresh em sha256, userAgent, IP, `expiresAt` |
| Relationship | PENDING / ACCEPTED / BLOCKED |
| Guild | `ownerId` RESTRICT; `systemChannelId` sem FK |
| Role / MemberRole | `position`, `permissions`, `hoist`, `mentionable`, `managed` |
| GuildMember | apelido, `serverMuted`, `serverDeafened` |
| Channel | 6 tipos; `parentId`; `rateLimitPerUser`; `bitrate`/`userLimit`; grupo tem `ownerId`/`iconUrl` |
| PermissionOverwrite | (canal, alvo ROLE/MEMBER), allow/deny |
| Message | <= 4000 caracteres; REPLY; mencoes Json; embeds Json; exclusao logica |
| Attachment | `storageKey`; dimensoes; placeholder |
| Emoji / Sticker / SoundboardSound | unico (guild, nome); **URL absoluta** |
| Invite | `code` PK, `uses`/`maxUses` (0 = ilimitado), `expiresAt`, `channelId` sem uso |
| VoiceState | PK `userId` (um canal por conta) |
| ReadState | `lastReadMessageId`, `mentionCount` |
| UserGuildSettings / UserChannelSettings | `muted`, `notificationLevel` — **ninguem le** |
| AuditLogEntry | 16 acoes, apagadas em 90 dias |

Migracoes: `inicial`; `placeholder_sem_limite` (VARCHAR(64) fazia todo envio de
imagem falhar); `conta_do_google` (senha opcional + LinkedAccount).

Atencao: trocar `PUBLIC_BASE_URL` quebra avatares, icones, emojis, figurinhas e
sons (URL absoluta em `storage.ts:203`). Paginacao compara ids como **texto**
(`messages.ts:470-507`) — funciona enquanto todos tiverem 18 digitos (~ate
julho de 2031).

## Conta e autenticacao

- **Cadastro** (`auth.ts:71-129`): com `ALLOW_OPEN_REGISTRATION=false` (producao
  hoje) exige convite, e a conta **entra sozinha no servidor do convite**. Com
  cadastro aberto, o convite e ignorado e a conta nasce sem servidor. Argon2id
  64 MiB, t=3, p=4. **Email nao e verificado.**
- **Login** por email ou username; tempo igualado para usuario inexistente. Com
  2FA: 401 `MFA_REQUIRED` + `mfaToken` (5 min) e termina em `/auth/login/mfa`.
- **Tokens:** access JWT 15 min `{sub, sid}`; refresh opaco 60 dias, sha256,
  rotacionado a cada uso (sem deteccao de reuso). Sessoes vencidas nunca sao
  apagadas do banco.
- **2FA:** TOTP +-1 passo; 10 codigos de recuperacao em argon2. Desligar o 2FA
  exige TOTP — quem perdeu o celular entra com codigo de recuperacao mas **nao
  consegue desligar**, e o CLI nao tem reset.
- **Trocar senha** (`auth.ts:306-327`): exige a atual se houver; conta so-Google
  define a primeira sem ela; derruba as outras sessoes.
- **Esqueci a senha:** nao ha email (o servidor nao envia email nenhum).
  `/auth/google/senha` redefine sem a antiga, mas so logado e com o Google ja
  vinculado. **Sem Google vinculado, nao ha recuperacao.**
- **Google** (`S/auth/google.ts`, `S/routes/auth-google.ts`): loopback
  `127.0.0.1`/`[::1]` em lista branca, `state` JWT de 5 min,
  `prompt=select_account`, troca de codigo so no servidor, id_token conferido no
  JWKS, bilhete de uso unico de 2 min. Entra so por vinculo explicito (`sub`),
  nunca casando email. **Criar conta com Google ja existe** (`/registrar`): conta
  sem senha, email do Google se verificado, respeita convite se o cadastro e
  fechado. Desvincular e recusado se a conta nao tem senha.
  Defeitos: username criado pelo Google aceita `-` (`:120`), que o resto do
  sistema recusa (nao da para mandar amizade a essa pessoa); senha pelo Google
  aceita 200 caracteres, login so 128; vincular troca em silencio um Google ja
  vinculado.
- **Excluir conta** (`users.ts:253-287`): na pratica **desativa** — nome vira
  "Conta apagada", email trocado, perfil e 2FA limpos. Ficam: username
  (reservado para sempre), hash da senha, **vinculo com o Google** (a conta
  Google fica presa numa conta morta), participacoes, DMs, amizades, mensagens,
  anexos. A pagina `/privacidade` promete apagar mensagens, anexos e relacoes —
  **nao apaga** (`paginas.ts:274-275`). Ponto de LGPD.

## Social

Amizade por username (pedido cruzado vira amizade na hora). DM 1:1 unica por
par; grupos ate 10. Nao exige amizade para abrir DM. "Fechar" so em DM 1:1.
`mentionCount` sobe com mencao direta, cargo, @everyone/@here e **toda
mensagem de DM**. O "nao lido" e calculado no cliente.

## Servidores, canais, membros

- Criar guild cria o cargo `everyone` (id = id da guild) e, por padrao, duas
  categorias + `#geral` + voz "Geral".
- Canais: `nsfw`, `bitrate` e `GUILD_ANNOUNCEMENT` nao tem efeito; canal de
  voz aceita mensagem (e a "conversa da chamada" do Beta). Desde a fatia 6 o
  PATCH recusa categoria dentro de categoria (o POST ja recusava) e o reordenar
  so aceita como pai uma categoria do proprio servidor.
- Expulsar/banir exigem a permissao e hierarquia; banir aceita quem nem e membro;
  banir nao apaga mensagens.
- Transferir posse: desde a fatia 6 os erros de negocio saem com codigo (400/403/404), e quem entrega a posse deixa de ver na hora o canal privado que so via por ser dono.
- Apagar guild: cascata no banco, arquivos ficam no disco.
- Auditoria: desde a fatia 6 grava tambem reordenar cargos e canais, dar e
  tirar cargo (`MEMBER_ROLE_UPDATE`), criar e revogar convite, silenciar,
  ensurdecer, mover e desconectar, tirar e sincronizar sobrescritas, renomear
  emoji, mudar e apagar som. Nao grava figurinhas nem apagar mensagem alheia. A
  rota filtra por quem fez e pela acao, e traz a pessoa alvo mesmo que ela ja
  tenha saido.

## Convites

Codigo de 8 caracteres num alfabeto de 55 sem ambiguos
(`services/invites.ts:12-19`). `maxAgeSecs` 0–30 dias (padrao 7 d, 0 = nunca),
`maxUses` 0–100 (0 = ilimitado). Criar exige CREATE_INVITE; listar, MANAGE_GUILD
(a lista traz quem criou).

Aceitar (fatia 6): quem ja e membro nao gasta uso; o uso e **reservado numa conta
so no banco** (`updateMany` que so soma se ainda houver uso e validade) antes de
criar o membro, e volta se a entrada falhar ou for banida — antes era ler, entrar
e somar, e dois aceitando um convite de 1 uso entravam os dois. A resposta traz o
canal de onde o convite saiu, se a pessoa o ve.

**Link** (fatia 6): `GET /convite/:codigo` (em `routes/paginas.ts`) e a pagina que
se manda pelo WhatsApp — servidor, quem convidou, online, o botao
`kiroshi://convite/<codigo>`, o codigo para colar num app antigo e o instalador;
com etiquetas `og:` para o link aparecer com nome e icone. Convite vencido,
esgotado ou revogado da a pagina "este convite nao vale mais" (404). Tudo o que
vem do banco entra escapado no HTML. O protocolo e registrado pelo instalador do
Beta ([07](07-desktop-e-entrega.md)).

## Cargos e permissoes

Resolucao igual a do Discord (`SH/permissions.ts:156-212`): dono tem tudo;
OR dos cargos (everyone sempre entra); ADMINISTRATOR expande tudo e ignora
canais; no canal: everyone (deny, allow) -> cargos agregados (todos os deny,
depois todos os allow) -> membro; sem VIEW_CHANNEL zera; sem
READ_MESSAGE_HISTORY perde MANAGE_MESSAGES.

Hierarquia: maior `position` = mais alto; so se age sobre quem esta
estritamente abaixo; nao se concede bit que nao se tem.

| Bit | Nome | Estado |
|---|---|---|
| 0 | VIEW_CHANNEL | aplicado no REST (ver nota de seguranca) |
| 1 | MANAGE_CHANNELS | funciona no servidor; sem UI de canais/sobrescritas |
| 2 | MANAGE_ROLES | funciona desde a fatia 6: criar (nasce acima do everyone), editar, reordenar, dar e tirar um cargo de cada vez |
| 3 | MANAGE_GUILD | funciona |
| 4 | ADMINISTRATOR | funciona (mas nao cria cargo, e segue a hierarquia) |
| 5 | KICK_MEMBERS | funciona (nao tira da voz) |
| 6 | BAN_MEMBERS | funciona; listar/desbanir sem UI |
| 7 | CREATE_INVITE | funciona |
| 8 | CHANGE_NICKNAME | so no servidor |
| 9 | MANAGE_NICKNAMES | so no servidor |
| 10 | SEND_MESSAGES | funciona |
| 11 | READ_MESSAGE_HISTORY | parcial: a busca por guild so olha VIEW_CHANNEL |
| 12 | MANAGE_MESSAGES | funciona |
| 13 | EMBED_LINKS | funciona |
| 14 | ATTACH_FILES | parcial: `/uploads` nao exige nada, a checagem e ao vincular |
| 15 | ADD_REACTIONS | funciona |
| 16 | MENTION_EVERYONE | funciona (@here = @everyone) |
| 17 | USE_EXTERNAL_EMOJIS | parcial: so em reacoes, nao no texto |
| 18 | CONNECT | funciona |
| 19 | SPEAK | funciona (vai no token do SFU) |
| 20 | STREAM | funciona (camera e tela) |
| 21 | USE_VAD | **nao implementado** |
| 22 | PRIORITY_SPEAKER | **nao implementado** |
| 23 | MUTE_MEMBERS | funciona: tira o microfone das permissoes no SFU na hora; o token de entrada ja sai sem ele |
| 24 | DEAFEN_MEMBERS | funciona: tira o microfone no SFU e o app corta o som |
| 25 | MOVE_MEMBERS | funciona: token da sala nova antes de sair da antiga; destino sem CONNECT e recusado |
| 26 | MANAGE_EMOJIS | funciona para emoji; figurinha nao chega a ninguem |
| 27 | USE_SOUNDBOARD | funciona (barra da chamada, Beta); silenciado ou ensurdecido nao toca |
| 28 | MANAGE_SOUNDBOARD | funciona |
| 29 | VIEW_AUDIT_LOG | so no servidor |
| 30 | MANAGE_WEBHOOKS | **nao implementado** (nao ha modelo nem rota) |

`@everyone` nasce com: VIEW, SEND, HISTORY, EMBED, ATTACH, REACTIONS,
EXTERNAL_EMOJIS, CREATE_INVITE, CHANGE_NICKNAME, CONNECT, SPEAK, STREAM, USE_VAD,
USE_SOUNDBOARD (`SH/permissions.ts:69-83`).

Consertos de cargos (fatia 6; o e2e cobre cada um):
- **Criar cargo** poe o novo na posicao 1, logo acima do everyone, e sobe os
  outros um degrau — como o Discord. Antes nascia no topo e a hierarquia exigia
  que ficasse abaixo do autor: so o dono conseguia.
- **Dar e tirar um cargo:** `PUT`/`DELETE /guilds/:g/members/:m/roles/:r`. Dar
  exige o cargo abaixo do seu e sem permissao que voce nao tem; tirar, so a
  hierarquia. O `PATCH` com a lista completa continua (a 1.x).
- **Quem ganha ou perde canal na hora** (`services/acesso.ts`): dar ou tirar
  cargo, mudar as permissoes de um cargo, apaga-lo ou passar a posse compara quem
  ve cada canal antes e depois; quem passou a ver recebe o canal, quem deixou de
  ver recebe o `CHANNEL_DELETE` e sai da voz daquele canal. Antes o canal novo so
  aparecia depois de reconectar.
- **Heranca da categoria** (`mesclarSobrescritas`, em `SH/permissions.ts`): o
  canal herda as sobrescritas da categoria e o que ele diz vence, bit a bit, para
  cada alvo. Antes as duas listas eram emendadas e, para o everyone e para
  pessoas, valia a da categoria (o `find` pegava a primeira). Servidor
  (REST e gateway) e cliente usam a mesma funcao. Producao tinha 0 sobrescritas:
  nada mudou para ninguem.
- **Reordenar** (`lib/cargos.ts`): recusa o everyone e ids repetidos, renumera
  1..n (fim das posicoes repetidas) e so conta como movido quem mudou de lugar
  na ordem — o cliente manda a lista inteira sem esbarrar nos cargos de cima.
- **Editar** confere so os bits que mudam (antes nao dava nem para trocar a cor
  de um cargo com bit que o autor nao tem). **Apagar** confere so a hierarquia e
  limpa as sobrescritas que citavam o cargo.

Ainda: `mentionable` e decorativo (a tela nao mostra); `hoist` e do cliente (a
lista de membros do Beta agrupa por ele).

## Emojis, figurinhas, soundboard

- Imagens: data URL -> sharp -> webp em `STORAGE_DIR/ab/<32hex>.webp`. Nada e
  apagado do disco ao remover.
- **Emoji:** `[a-zA-Z0-9_]{2,32}`, 128 px, ate 512 KB, 200 por guild, GIF vira
  webp animado. No texto (`<:nome:id>`) o servidor nao valida.
- **Figurinha: nao funciona** — `stickerId` gravado sem validar (id invalido da
  500), a mensagem serializada nao tem o campo, o cliente nunca envia.
- **Soundboard:** MP3/OGG/WAV/WebM ate 2 MB, 100 por guild. Desde a fatia 6 a
  duracao chega de quem envia (o Beta decodifica antes de subir; o schema recusa
  acima de 5,25 s) e o teto de 5 s (`SH/constants.ts:28`) vale **na hora de
  tocar**, em todo cliente novo (`voice/controller.ts`, `playSound`) — o servidor
  nao decodifica audio, e um som longo enviado por outro caminho para no mesmo
  limite. `audio/mpeg` passou a virar `.mp3` (os `.mpeg` antigos agora saem como
  audio). `PATCH` muda nome, emoji e volume. Tocar: exige estar no canal; emite
  VOICE_CHANNEL_EFFECT e **cada cliente toca o arquivo** (nao passa pelo SFU). Nao
  funciona em DM.

## Mensagens

Envio (`messages.ts:43-189`): permissoes -> modo lento -> anexos -> mencoes
validadas -> resposta so no mesmo canal -> cartoes de link **sincronos** (ate 3
URLs, 5 s por salto, 4 saltos) -> transacao -> distribuicao (falha vira log).
Anexos: ate 100 MB em memoria, extensoes executaveis bloqueadas, MIME do
cliente, miniatura de 16 px; servidos com `CSP: sandbox` + `nosniff`, sem Range.
Reacoes: 20 emojis distintos. Edicao sem historico. Exclusao logica. Fixadas
ate 50; em servidor exige MANAGE_MESSAGES, em DM qualquer participante fixa
(desde 2026-09-25 — antes a DM caia na regra do servidor e sempre recusava).
Busca `ILIKE`; filtro `has` aceito e ignorado.

## Notificacoes

Ajustes por guild e canal existem no banco e na API (`users.ts:172-250`) e **o
servidor nao usa em lugar nenhum**; o cliente nunca chama. Nao ha push de
nenhum tipo. Hoje toda notificacao e decidida no cliente.

## Notificacoes e seguranca da conta (fatia 5)

- `GET /users/@me/settings` devolve `{ guilds, channels }`. Antes cada servidor
  voltava com os ajustes de TODOS os canais da pessoa (o filtro era
  `() => true`) e os de DM so apareciam se houvesse algum servidor.
- Os `PATCH` de servidor e canal aceitam `mutedUntil` (silenciar por tempo;
  migracao `silenciar_por_tempo`) e avisam os outros aparelhos
  (`USER_GUILD_SETTINGS_UPDATE`, `USER_CHANNEL_SETTINGS_UPDATE`). O READY traz
  `notificationSettings`.
- Quem decide notificar continua sendo o cliente; o servidor so guarda.
- `GET /users/@me/security` diz se a conta tem senha (quem entrou pelo Google
  pode nao ter), sem o hash.
- Ativar e desativar o 2FA emitem `USER_UPDATE`: a tela ficava em "Ativar" ate
  reconectar.

## Voz no servidor

- Token (`createVoiceToken`, `services/voice.ts`): sala `channel_<id>` (vale
  para guild, DM e grupo), identidade = `userId` (uma conexao por conta), TTL
  6 h. Fontes por `lib/direitos-de-voz.ts` (testado): microfone com SPEAK e sem
  moderacao, camera e tela com STREAM. `canUpdateOwnMetadata` para a lista de
  quem assiste (atributo `assistindo`). Sem `roomAdmin` desde `62dda74`. O
  aviso do token (`/voice/join`, `/voice/refresh`, `VOICE_SERVER_UPDATE`) leva
  `serverMute`/`serverDeaf`, para o app nao tentar abrir o microfone de quem
  esta moderado. `bitrate` nao entra no token.
- Moderacao (`setServerMute`, `setServerDeafen`): troca as permissoes do
  participante no SFU na hora (`updateParticipant`, que substitui o conjunto
  inteiro) e o SFU derruba o microfone; o app obedece pelo estado de voz.
  Antes, silenciar so mutava as faixas no ar (sair e entrar escapava) e
  ensurdecer so gravava no banco.
- Dois caminhos: REST `/voice/join` (so token, sem VoiceState, ignora
  `userLimit`) e opcode 4 (cria VoiceState, checa CONNECT e limite, emite
  VOICE_STATE_UPDATE e VOICE_SERVER_UPDATE). **Erro no opcode 4 fecha o
  WebSocket com 4000.**
- **Nao ha sincronizacao com o LiveKit** (nem webhook, nem polling). O VoiceState
  so muda por opcode/mover/desconectar, e e apagado inteiro no boot.
- **VOICE_SERVER_UPDATE vai para todas as sessoes da conta** (`voice.ts:266`) —
  foi a causa do commit `bc4ad67` ("um segundo aparelho entrava na chamada
  sozinho"). O cliente se protegeu; o servidor nao mudou.
- **Chamada em DM** (`services/chamadas.ts`, fatia 4): existe enquanto houver
  alguem na voz da conversa. Entrar na voz de uma DM sem chamada cria a
  chamada, grava a mensagem de sistema (tipo CALL, com `call` =
  participantes e fim, coluna nova da migracao `chamada_na_mensagem`) e toca
  para os outros (`lib/chamada.ts`, testado: nao toca para quem tem bloqueio
  com quem liga). Eventos CALL_CREATE/UPDATE/DELETE para todos da conversa; o
  toque para ao entrar, ao recusar (`POST /channels/:c/call/stop-ringing`) e
  em 30 s; quem esta na chamada toca de novo (`POST .../call/ring`). Sozinho
  por 3 min, o servidor tira da voz com `leaveReason: 'ALONE_TIMEOUT'`. Estado
  em memoria, com uma fila por conversa. O READY traz `privateVoiceStates` e
  `calls`. Tirar da chamada quem sai do grupo ou e bloqueado ja existia
  (`tirarDaVoz`).
- Mover (`moveMember`): o token da sala nova vem antes de tudo (e ele confere o
  CONNECT do alvo; sem ele, 403 e nada muda) e e entregue antes de a pessoa sair
  da sala antiga. O app troca de sala sozinho; 5 s depois o servidor tira da
  antiga quem nao obedeceu, se nao voltou para ela. Antes a remocao vinha
  primeiro, o app sem sala recusava o token, e a pessoa ficava desconectada
  aparecendo no canal novo.
- TURN (`services/turn.ts`): `TURN_SERVERS` tem prioridade; sem ele, usa o TURN
  gerenciado da Cloudflare (`CLOUDFLARE_TURN_KEY_ID` / `_API_TOKEN`), com cache.

Commit `5b00783`: o cliente chamava `connect` duas vezes (clique + eco do
VOICE_SERVER_UPDATE) e entrava de novo — no LiveKit apareciam 3 entradas, duas
fechadas por DUPLICATE_IDENTITY. `entrada.ts` passou a ignorar pedido repetido.

## CLI de administracao (`S/admin.ts`)

`convite [servidor] [--usos N] [--dias N]`, `contas`, `servidores`, `convites`,
`revogar <codigo>`, `remover <usuario> [--confirmar]` (exclusao real em
cascata; falha para dono de servidor). Faltam: resetar senha, resetar 2FA,
desativar/reativar, transferir servidor, ver quem esta em chamada (o script
`linhas-sfu` vive avulso no host e some a cada deploy — deve virar comando).

## Variaveis de ambiente

`NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`, `DATABASE_URL`, `JWT_SECRET` (trocar
desloga todos), `REDIS_URL`, `LIVEKIT_URL`/`_API_KEY`/`_API_SECRET` (as tres
ligam a voz), `TURN_SERVERS`, `CLOUDFLARE_TURN_KEY_ID`/`_API_TOKEN`,
`FORCE_TURN_RELAY`, `GOOGLE_CLIENT_ID`/`_SECRET`, `CONTATO_PRIVACIDADE`,
`STORAGE_DIR`, `PUBLIC_BASE_URL`, `ALLOW_OPEN_REGISTRATION`, `CORS_ORIGINS`,
`KIROSHI_ENV_FILE`, `KIROSHI_DOWNLOAD_DIR`, `GOOGLE_SITE_VERIFICATION`,
`KIROSHI_SEED`/`_SEED_PASSWORD`/`_ALLOW_RESET`.
`KIROSHI_WORKER_ID` e declarada e nunca usada (o snowflake le `ORDER_WORKER_ID`,
`SH/snowflake.ts:88`). O `.env.example` nao lista `CLOUDFLARE_TURN_*`,
`LOG_LEVEL` nem `KIROSHI_DOWNLOAD_DIR`.

## Rate limit (em memoria, zera no restart)

| Regra | Limite |
|---|---|
| Global por IP | 120/min |
| Login, MFA, start do Google, senha pelo Google | 8 / 5 min por IP |
| Cadastro | 4/h por IP |
| Criar servidor | 5/h por usuario |
| Upload | 30/min por usuario |
| Enviar mensagem | 10 / 10 s por usuario e canal |
| Reagir | 20 / 10 s |
| Gateway | 120 msg/min por conexao |

Sem limite proprio: refresh, aceitar convite, pedido de amizade, criar DM,
soundboard, busca, voz.

## Testes

- Unidade (vitest): 123 no servidor + shared — permissoes (27), markdown (22),
  snowflake (18), tokens (10), senha (9), Google loopback (13), provas do Google
  (11), TURN (13). **Sem teste:** rotas, servicos com banco, gateway, SSRF.
- `test/e2e.mjs` (124 checagens em 2026-09-25, API local com seed): login,
  READY, mensagem em tempo real, nonce, historico, edicao, reacao, permissoes,
  convite, token de voz, chamada em DM, notificacoes, canal privado pelo gateway
  e, desde a fatia 6, cargos (criar sem ser dono, dar e tirar um, canal que o
  cargo abre), heranca da categoria, sincronizar, convite de 1 uso concorrido,
  a pagina do convite, filtros da auditoria e a posse. **Nao cobre 2FA** (o
  README diz que cobre), upload, busca, pins, RESUME. Fixo na 4000; para a API
  de teste na 4001, rodar uma copia com a porta trocada.
- `lib/cargos.test.ts` (11): a regra de reordenar cargos, sem banco.
- `test/producao.mjs` (~21, publico pelo tunel) e `test/fumaca-producao.mjs`
  (~29, contas descartaveis em producao; as contas ficam desativadas e seguram
  os usernames para sempre).

## Defeitos funcionais (sem os de seguranca)

1. ~~RESUME perde eventos~~ — corrigido em `6f493df`.
2. ~~Herança de sobrescritas da categoria invertida~~ — corrigido na fatia 6.
3. ~~So o dono cria cargos~~ — corrigido na fatia 6.
4. ~~Atribuir cargo: sem UI e sem rota incremental~~ — corrigido na fatia 6.
5. Figurinhas nunca chegam.
6. Erro no opcode de voz fecha o socket.
7. ~~Mover fantasma~~ — corrigido na fatia 3; join REST ignora limite e nao cria estado.
8. ~~Deafen sem efeito; mute nao persiste no SFU~~ — corrigido na fatia 3.
9. Busca: `has` ignorado.
10. DM: MESSAGE_CREATE chega duplicado (`messages.ts:266-272`); ~~sem voz no
    READY~~ e ~~sem fixar~~ corrigidos (fatias 4 e 2).
11. Ajustes de notificacao sem efeito.
12. ~~Transferir posse da 500~~ — corrigido na fatia 6.
13. Exclusao de conta incompleta; Google preso a conta morta; `/privacidade` promete o que nao faz.
14. 2FA sem recuperacao completa.
15. Username com `-` e senha de 129–200 caracteres pelo Google.
16. ~~Categoria dentro de categoria; `parentId` de outra guild; reordenar `everyone`~~ — corrigido na fatia 6.
17. Presenca: invisivel, varios aparelhos, `activity`.
18. Arquivos orfaos no disco; sessoes vencidas nunca apagadas.
19. Ids comparados como texto (quebra ~2031).
20. ~~Soundboard: duracao e `.mpeg`~~ — corrigido na fatia 6 (a duracao medida pelo app, o teto aplicado ao tocar).
21. ~~Convites: contagem nao atomica, `channelId` sem uso, sem deep link~~ — corrigido na fatia 6.

## Documentacao que diverge do codigo

- `README.md`: e2e "cobre 2FA" (nao), "figurinhas" (nao funcionam), "deteccao de
  voz" (USE_VAD nao existe), "silenciar e mover" (parcial).
- `docs/ARQUITETURA.md`: RESUME "recebe so o que perdeu" (nao); Redis "sem outra
  mudanca" (nao); "dois eventos fora do buffer" (sao tres); "sem IPv6, sem voz"
  (ja existe TURN da Cloudflare).
- `/privacidade`: exclusao apaga tudo (nao); registra "quem estava conectado e
  por quanto tempo" (nao ha historico de chamadas); nao diz que a auditoria some
  em 90 dias.
- Pagina `/`: "servidor fechado" fixo no HTML.

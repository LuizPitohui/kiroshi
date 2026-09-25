# Arquitetura, convencoes e comandos

> Visao de ponta a ponta para quem chega agora. As decisoes originais e o
> motivo de cada uma estao em [../ARQUITETURA.md](../ARQUITETURA.md); aqui fica o
> que o codigo e hoje, as convencoes e como trabalhar nele.

---

## O produto

Clone auto-hospedado do Discord para um grupo fechado (~10 amigos) que saiu do
Discord quando compartilhar tela e camera pararam de funcionar para eles. Cada
pessoa instala um executavel Windows (`https://order.arasaka.fun/baixar`).
**Compartilhar tela e o recurso principal.**

Escala real em producao (2026-09-24): 19 contas (algumas de teste, desativadas),
1 servidor, 10 membros, 7 canais, 44 mensagens (todas da ultima semana),
7 amizades, 4 contas com Google vinculado, 0 emojis, 0 sons, 0 cargos atribuidos.
O uso e voz e tela; texto e leve.

## Pacotes

```
packages/
  shared/    tipos, protocolo do gateway, permissoes, validacao (zod), markdown, snowflake
  server/    Fastify (REST) + ws (gateway) + Prisma/Postgres + integracao LiveKit
  desktop/   Electron + React 19 + Vite + Zustand
deploy/      Dockerfile.server, docker-compose.yml, livekit.yaml, scripts/deploy.sh
docs/        ARQUITETURA, DEPLOY, MANUAL, SUPRESSAO-DE-RUIDO, conhecimento/ (esta base)
```

`@kiroshi/shared` e usado pelas duas pontas: o servidor autoriza com a mesma
funcao de permissao que o cliente usa para decidir o que mostrar. Mudar o
protocolo quebra a compilacao das duas pontas.

| Camada | Tecnologia |
|---|---|
| Servidor | Node 22, TypeScript ESM, Fastify 5, `ws` 8, Prisma 6, Postgres (container compartilhado), argon2, jose, otplib, sharp, livekit-server-sdk 2, pino |
| SFU | LiveKit server v1.13 (container, rede do host) |
| Cliente | Electron 38.8.6, React 19.3, Zustand 5, Vite 7.3, electron-vite 5, livekit-client 2.22.3, electron-updater 6.8.9 |
| Empacotamento | electron-builder 26 (NSIS x64) |
| Testes | vitest 3 (unidade), scripts Node + CDP (interface), e2e contra API local |

## Fluxos principais

**Entrar:** `POST /auth/login` (ou Google por loopback) -> access JWT 15 min +
refresh 60 dias em `localStorage` -> WebSocket `/gateway`: HELLO -> IDENTIFY ->
READY (tudo o que a pessoa ve) -> eventos. Queda: RESUME com o ultimo `seq`
(buffer de 512 eventos, ~2,5 min).

**Mensagem:** o `Composer` cria a mensagem local com snowflake + `nonce` (envio
otimista) -> `POST /channels/:c/messages` -> o servidor grava e despacha
`MESSAGE_CREATE` com o mesmo `nonce` -> o store troca a temporaria pela real.

**Voz:** clique no canal -> opcode 4 `VOICE_STATE_UPDATE` no gateway -> o
servidor grava o `VoiceState`, emite `VOICE_STATE_UPDATE` e `VOICE_SERVER_UPDATE`
(token LiveKit de 6 h, sala `channel_<id>`) -> `voice.connect` -> LiveKit
(sinalizacao `wss://voz.arasaka.fun` pelo tunel; midia por IPv6 direto,
Tailscale ou relay TURN da Cloudflare).

**Tela:** seletor proprio (`screen:sources` por IPC) -> `screen:select` ->
`getDisplayMedia` atendido pelo `setDisplayMediaRequestHandler` com a fonte
escolhida e `audio: 'loopback'` -> faixa publicada com 2–3 camadas de simulcast
-> quem assiste clica "Assistir" (a assinatura e opt-in).

## Convencoes do repositorio

- **Idioma:** portugues **sem acento** em comentarios, documentacao, mensagens de
  commit e (hoje) textos da interface. Identificadores misturam: codigo antigo em
  ingles (`createWindow`, IPC `window:*`), novo em portugues (`pastaDosModelos`,
  IPC `atualizacao:*`).
- **Comentarios** longos, explicando o *porque*, com a medida que motivou a
  decisao. Correcoes importantes ficam registradas em comentario (ver lista em
  [05-front-end-atual.md](05-front-end-atual.md#correcoes-que-so-existem-em-comentario-nao-perder)).
- **Estilo:** 2 espacos, aspas simples, ponto e virgula, virgula final, ~100
  colunas, `void` em promessa solta, extensao `.js` nos imports TS.
- **Sem ESLint, Prettier, EditorConfig, hooks nem CI.**
- **TypeScript** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `isolatedModules`, ES2022, `moduleResolution: bundler`. Desktop tem
  `tsconfig.node.json` (electron) e `tsconfig.web.json` (interface).
- **Testes** `*.test.ts` junto do codigo; roteiros em `packages/*/test/*.mjs` com
  nome em portugues.
- **Commits:** assunto descreve o efeito observado, nao imperativo nem
  conventional commits (ex.: "A chamada caia porque o cliente se derrubava
  sozinho"); corpo longo com a causa medida; costuma fechar com o placar da
  verificacao ("Vitrine: N verificacoes, M testes, typecheck limpo").
  **Autor: Luiz Fernando. Sem linha `Co-Authored-By`** (pedido do dono em
  2026-09-24; os 15 commits anteriores tem a linha e ja estao no GitHub).
- **Versao:** manual, so em `packages/desktop/package.json` (menor para quase
  tudo, patch para conserto pequeno). Raiz, servidor e shared ficam em 1.0.0. Sem
  tags, sem CHANGELOG.

## Comandos

```bash
npm install                                  # raiz (workspaces)
npm run dev:server                           # API em :4000 (precisa de Postgres e packages/server/.env)
npm run dev:desktop                          # Electron em dev (CDP na 9222)
npx vite --config packages/desktop/vite.web.config.ts --port 5273   # interface no navegador; ?vitrine
npm test                                     # vitest em todos os pacotes
npm run typecheck                            # tsc nos tres pacotes (servidor precisa do shared compilado)
npm run dist:dir -w @kiroshi/desktop         # empacota so win-unpacked (rapido para testar)
npm run dist:win -w @kiroshi/desktop         # instalador NSIS em packages/desktop/release/
npm run dist:beta -w @kiroshi/desktop        # Kiroshi Beta (interface nova), em release-beta/
npx vite --config packages/desktop/vite.web.config.ts --port 5273   # ?nova = interface nova; ?nova&vitrine = catalogo
./deploy/scripts/deploy-api.sh               # publica SO a API (padrao para mudanca de servidor)
./deploy/scripts/deploy.sh <host-ssh>        # deploy completo — REINICIA O LIVEKIT (ver 08-producao.md)
```

O app empacotado le do asar: `npm run build` sozinho nao muda o que o
`win-unpacked` roda. Em dev, `npx electron out/main/index.js` basta para dirigir
por CDP. Dev e app instalado dividem o mesmo `userData` (mesma sessao, mesma
trava de instancia unica) — para testar o empacotado, passar `--user-data-dir`
proprio e outra porta de depuracao.

Na maquina de desenvolvimento: animacoes do Windows desligadas
(`prefers-reduced-motion` casa) e so cameras virtuais (falham com
`NotReadableError` se nada as alimenta).

## Linha de base (2026-09-24)

- `npm test`: **391 testes passando** — shared 67 (3 arquivos), server 56
  (5 arquivos), desktop 268 (15 arquivos).
- `npm run typecheck`: limpo nos tres pacotes.
- Arquivo temporario versionado por engano:
  `packages/desktop/src/components/emoji-palavras.test.ts.tmp.34664.9a598b2eb32b`.
- `packages/desktop/test/.foto.mjs` nao versionado (avaliador generico por CDP).

## Testes

**Unidade** (vitest): so logica pura. Nenhum teste monta componente, e rotas,
servicos com banco, gateway e SSRF nao tem teste.

**Scripts** (`packages/*/test/`), classificados por risco:

| Risco | Scripts |
|---|---|
| **Derruba producao** | `queda-de-voz.mjs <host>` (para o SFU por ~1 min via SSH); `relay.mjs` (exige `FORCE_TURN_RELAY=true` no servidor, tira a voz de todos) |
| **Age com a conta real em producao** | `verificar-instalador.mjs` (abre o `win-unpacked` sem `--user-data-dir`, limpa o `localStorage` do app instalado, entra em voz); `depurar-ice`, `depurar-publicacao`, `matriz-publicacao`, `medir-publicacao`, `tracar-sinalizacao` (entram em voz e publicam camera); `driver-voz`, `palco`, `voz-com-console` (entram na chamada); `conversa.mjs` (manda mensagens e fixa); `producao.mjs` com usuario; `fumaca-producao.mjs` (cria contas pelo convite); `fixar.mjs` (cria servidor em producao) |
| Destrutivo local | `reset-app.mjs` (limpa o `localStorage`); `server/test/reset-db.mjs` (`TRUNCATE` em tudo no `DATABASE_URL` — **o banco de dev mora no mesmo Postgres de producao**) |
| Seguros | `vitrine.mjs` (usar primeiro), `modais`, `movimento`, `responsivo`, `olhar`, `screenshot`, `console`, `inspecionar-html`, `estado-voz`, `enderecos*`, `depurar-quadros`, `depurar-midia`, `ver-ajustes`, `piscar`, `politica-de-rede.cjs`; `server/test/e2e.mjs` (fixo em `127.0.0.1:4000`) |

Regra: provar na vitrine primeiro; se precisar de conta, uma conta de teste com
**servidor proprio**, nunca dentro do servidor do grupo, e nunca entrar em voz la.
Varios scripts apontam por padrao para producao — passar o servidor explicitamente.

**A reescrita do front-end quebra todos os scripts de interface** (dependem de
classes e `data-*`). Precisam ser refeitos junto, de preferencia sobre atributos
de teste estaveis.

## Onde esta cada coisa

| Assunto | Arquivo |
|---|---|
| Permissoes (uma funcao para as duas pontas) | `packages/shared/src/permissions.ts` |
| Protocolo do gateway | `packages/shared/src/gateway.ts` |
| Rotas | `packages/server/src/routes/*.ts` |
| Gateway | `packages/server/src/gateway/{server,registry,session,events}.ts` |
| Voz no servidor | `packages/server/src/services/voice.ts`, `services/turn.ts` |
| Mensagens | `packages/server/src/services/messages.ts` |
| Google | `packages/server/src/auth/google.ts`, `routes/auth-google.ts`, `packages/desktop/electron/google.ts` |
| Esquema | `packages/server/prisma/schema.prisma` |
| CLI de admin | `packages/server/src/admin.ts` |
| Processo principal | `packages/desktop/electron/main.ts` |
| Ponte | `packages/desktop/electron/preload.ts`, `src/lib/bridge.ts` |
| Store | `packages/desktop/src/store/index.ts` |
| Eventos do gateway -> store + notificacoes | `packages/desktop/src/api/events.ts` |
| Voz no cliente | `packages/desktop/src/voice/controller.ts` (+ modulos puros ao lado) |
| Ajustes | `packages/desktop/src/screens/SettingsScreen.tsx`, `components/modals/GuildSettingsModal.tsx` |
| Estilos | `packages/desktop/src/styles/{global,componentes}.css` |
| SFU | `deploy/livekit.yaml` |
| Interface nova (Beta): entrada, rotas, tema | `packages/desktop/src/app/` |
| Interface nova: sistema de design | `packages/desktop/src/design/` (tokens, assinatura, primitivos) |
| Interface nova: telas | `packages/desktop/src/features/` (casca, conversa, ajustes, entrada, vitrine) |
| Markdown, autocompletar e mencoes (puros, testados) | `packages/desktop/src/features/conversa/{markdown,mencoes,linhas}.ts` |
| Deploy | `deploy/scripts/deploy.sh`, `docs/DEPLOY.md` |

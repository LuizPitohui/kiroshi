# Front-end atual (o que vai ser substituido)

> Estado em 2026-09-24, versao 1.15.0. Levantado lendo o codigo inteiro de
> `packages/desktop/src` e a ponte com o Electron, sem executar. Onde esta
> marcado **[I]**, e deducao forte que precisa ser confirmada rodando.
>
> Serve para duas coisas: saber o que da para reaproveitar na reescrita, e
> nao perder as correcoes que so estao documentadas em comentario.

Caminhos relativos a `packages/desktop/`.

---

## Em uma frase

React 19 + Zustand 5, sem roteador, com um store normalizado bom e testado, e
uma camada visual de ~7 mil linhas de CSS global empilhadas em camadas de
restilo, com 196 `style={{}}` inline e arquivos gigantes (`SettingsScreen.tsx`
tem 1.783 linhas).

## Arvore

```
main.tsx     installBridge() -> movimento -> densidade -> global.css + componentes.css
App.tsx
 |- TitleBar                      sempre (34 px, arrastavel, botoes da janela)
 |- Anunciador                    sempre (duas regioes aria-live)
 |- ?vitrine -> VitrineScreen     retorna antes do resto
 |- AvisoDeAtualizacao            faixa ambar "versao pronta"
 `- autenticado ? MainScreen : AuthScreen
MainScreen
 |- AppShell
 |   |- rail     GlobalRail (Inicio, servidores em hexagono, "+")
 |   |- sidebar  NavColumn (servidor: GuildMenu, arvore de canais, pessoas na voz)
 |   |           ou DirectMessageList (sem servidor)
 |   |- main     SocialHome | VoiceChannelView | CallDock + CallStatus + Stage + ChatArea
 |   |- panel    ChatArea lateral (voz) | PresenceColumn -> MemberCard / CartaoDePessoa
 |   |- dock     HudBar (identidade, StatusMenu, controles, latencia, engrenagem)
 |   `- BarraDeEstado (ELO . RTT . VOZ . SALA . TRANSMITINDO . relogio)
 `- SettingsScreen (sobreposicao de janela inteira, estado local do MainScreen)
```

**Sem roteador.** "Onde estou" vive no store (`selectedGuildId`,
`selectedChannelId`, `lastChannelByGuild` — `src/store/index.ts:82-86`).
Ajustes e modais sao `useState` locais. Nao ha voltar/avancar nem link direto;
clicar numa notificacao so traz a janela para frente (`electron/main.ts:611-614`).

## Camadas que prestam (reaproveitar)

| Camada | Arquivos | Por que presta |
|---|---|---|
| Cliente REST | `src/api/client.ts` | renovacao de token com uma promessa compartilhada, 401 -> renova e repete, erros com codigo estavel, upload com progresso |
| Gateway | `src/api/gateway.ts`, `src/api/queda.ts`, `src/api/sessao.ts` | HELLO/IDENTIFY/RESUME, heartbeat com deteccao de conexao zumbi, backoff com jitter, politica por codigo de fechamento, testado |
| Eventos -> store | `src/api/events.ts` | ~35 eventos num arquivo so; tambem decide notificacao |
| Store | `src/store/index.ts` | tudo em `Map` por id, envio otimista por `nonce`, seletores de lista com `useShallow` |
| Logica pura | `src/lib/*` | `anunciar`, `estado`, `leitura`, `naoLidas`, `tempo` — com testes |
| Voz | `src/voice/*` + `useVoice` | singleton fora do React, exposto por `useSyncExternalStore`; separavel da UI |
| Camadas | `src/components/ui/sobreposicao.ts` (`useCamada`) | Esc fecha so o topo, prende e devolve o foco |
| Markdown | `src/components/MessageContent.tsx`, `@kiroshi/shared/markdown` | spoiler, mencoes, codigo |
| Ponte | `electron/preload.ts`, `src/lib/bridge.ts` | superficie nomeada + substituto para navegador |

Superficie da ponte (`window.kiroshi`, `electron/preload.ts:35-132`): `window`
(min/max/fechar), `google` (preparar/abrirEEsperar/cancelar), `app`
(quit/version/platform), `screen` (sources/select), `pushToTalk`
(register/unregister/onToggle), `notifications` (show/setBadge/flash),
`autostart` (get/set), `atualizacao` (estado/procurar/instalarEReiniciar/aoMudar).
No navegador tudo vira no-op (`src/lib/bridge.ts:12-72`).

## Logica de negocio escondida em componente (extrair antes de reescrever)

- `Composer.tsx:61-227` — envio otimista com snowflake real + `nonce`, upload
  antecipado, rascunho por canal em `sessionStorage`, limite do sinal de
  digitacao.
- `ChatArea.tsx:78-201` — paginacao do historico, confirmacao de leitura
  (`hasFocus` + 700 ms), divisor de nao lidas congelado.
- Entrar na voz repetido em `NavColumn.tsx:222-253`, `VoiceChannelView.tsx:42-54`,
  `CallStatus.tsx:100`; sair em `CallControls.tsx:51-61`.
- Teste de microfone orquestrado dentro de `SettingsScreen.tsx:779-916`.
- Tema aplicado num `useEffect` do App, sem modulo proprio.
- Hierarquia de moderacao no `MemberCard`; agrupamento por cargo na `PresenceColumn`.
- Uploads por `FileReader`/data URL em tres lugares.
- Abrir DM duplicado (`SocialHome.tsx:65-77`, `DirectMessageList.tsx:25-42`).

## Correcoes que so existem em comentario (nao perder)

| O que | Onde |
|---|---|
| Divisor de nao lidas congelado ao abrir o canal | `ChatArea.tsx:59-91` |
| Id otimista precisa ser snowflake de verdade (ordem) | `Composer.tsx:164-178` |
| Foco devolvido capturando o clique | `ui/sobreposicao.ts:31-70` |
| Regioes `aria-live` montadas antes do primeiro anuncio | `App.tsx:65-73` |
| Elemento de video nunca desmonta ao trocar grade/destaque (senao pisca) | `Stage.tsx`, `test/palco.mjs` |
| `backgroundThrottling: false` (app fica atras de jogo em tela cheia) | `electron/main.ts:227` |
| `beforeunload` da UnsavedBar trava recarga se a barra estiver visivel | `ui/UnsavedBar.tsx:60-68` |
| Seletor que monta lista nova a cada chamada derruba o React (Zustand v5) | `docs/ARQUITETURA.md`, hooks `useGuildList` etc. |

## Sistema visual

**Tamanho.** `src/styles/global.css` 4.054 linhas + `componentes.css` 3.009,
carregado depois. `.btn`, `.channel`, `.rail` e a barra de rolagem sao
definidos duas vezes; ha regras mortas e guerras de especificidade registradas
em comentario (`componentes.css:2365-2383`).

**Tokens** (`global.css:137-417`):

| Grupo | Valores |
|---|---|
| Superficies | `--bg-canvas #0e141c`, `--bg-sidebar #151d28`, `--bg-surface #1c2634`, `--bg-elevated #253243` |
| Bordas | `#263243`, forte `#3c5068` |
| Texto | `#eef4ff` / `#a8b8cc` / `#7f91a8` |
| Acento | ciano `#20e0d0`; violeta `#8b7cff` definido e sem uso |
| Estados | sucesso `#45d69a`, aviso `#ffc568`, perigo `#ff687d`, `--red-solido #dc2626` |
| Forma | raios 2/3/4 px + pilula; chanfro por `clip-path` 9 e 6 px |
| Medidas | rail 72, nav 256, cabecalho 44, painel 320, presenca 224, titulo 34, HUD 64 |
| Movimento | 80/120/220 ms, `cubic-bezier(0.2,0.8,0.25,1)` |
| Tipografia | Inter (texto), JetBrains Mono (dado tecnico, rotulos em caixa alta), Rajdhani (titulos); arquivos em `src/styles/fontes/`; escala 15/14/13/12/20/28 |

Aliases antigos (`--void`, `--optic`...) convivem com os nomes semanticos.

**O que ja e "cyberpunk":** grafite azulado com ciano "optico", cantos quase
retos com chanfro, servidores em hexagono, colchetes de canto (`.mira`),
rotulos mono em caixa alta, conversa como "log de transmissao" (coluna de
horario, regua vertical, ambar para mencao, ciano para fixada), grade de fundo
na tela de entrada, faixa de instrumento no rodape.

**Tema.** `data-theme` no `<html>`, `:root[data-theme='light']` redefine os
tokens. Aplicado depois do primeiro desenho **[I: pisca escuro para quem usa
claro]**. Sem "seguir o sistema". Cores fixas ignoram o tema (trilho `#0a0f16`,
`global.css:3860`).

**Movimento.** `src/lib/movimento.ts` grava `kiroshi.movimento` e pinta
`data-mov` antes do primeiro render. Sem atributo vale `prefers-reduced-motion`;
`completo` anula a supressao, `reduzido` suprime sempre (`global.css:3495-3513`).
Funciona, mas libera pouca coisa (transicoes de 80–220 ms, deslize de 6 px).

**Densidade.** `src/lib/leitura.ts:26-74` grava `kiroshi.densidade` e pinta
`data-densidade`. O efeito visivel foi removido no commit `f1145e5`; sobrou CSS
de 1–3 px. Ver [06-auditoria-de-ajustes.md](06-auditoria-de-ajustes.md).

**Larguras** (`ui/AppShell.tsx:19-40`): >= 1440 tudo em colunas; >= 1024 o
painel vira gaveta; >= 768 os canais tambem; < 768 o rail some (so com zoom,
a janela tem minimo 940 px).

**Componentes de `components/ui` sem uso no produto:** `ContextMenu`,
`SettingsSection`, `Switch` (o acessivel), `Toast` — o provedor so e montado na
vitrine, entao **o produto nao tem toast**.

## Acessibilidade

Existe e e bom: regioes faladas permanentes com fila e agrupamento
(`Anunciador`, `lib/anunciar.ts`, `useAnunciarMensagens`, `useAnunciarChamada`),
"Pular para a conversa", marcos `nav`/`main`/`aside`, `useCamada` com foco
preso e devolvido, `:focus-visible`.

Lacunas: acoes da mensagem so no `:hover` (`global.css:1691-1704`), fora do
alcance de teclado e leitor de tela; lista de DMs feita de `div` sem papel;
Ajustes sem `role=dialog` e sem prender foco; `select`s sem rotulo; nenhum atalho
global (trocar canal, mutar).

## Divida tecnica que pesa

- **Desempenho:** 19 `useStore()` sem seletor, inclusive em `MessageItem` (uma
  assinatura por mensagem). **[I]** A lista inteira re-renderiza a cada evento
  de presenca, digitacao ou reacao.
- **Erros engolidos:** 25 `.catch(() => undefined)` em componentes e telas.
  O usuario clica, falha, e nada aparece.
- **Codigo morto:** `useDensidade`, `setBadge`, atalho global do push-to-talk,
  `useChannelPermissions`/`useCan`/`useCanInChannel`, `requestGuildMembers`.
- **Sessao:** tokens em `localStorage`; sair nao chama `/auth/logout`, entao a
  sessao continua valida no servidor.
- **Arquivo temporario versionado por engano:**
  `src/components/emoji-palavras.test.ts.tmp.34664.9a598b2eb32b`.
- **So em desenvolvimento, a conversa pode ficar presa no "carregando".** O
  efeito de carga do `ChatArea` marca `loading` e cancela a resposta na
  limpeza; o StrictMode do React roda o efeito duas vezes na montagem, a
  segunda ve `loading` e nao busca, e a primeira resposta e descartada. No app
  empacotado nao acontece (StrictMode nao repete efeitos em producao). A
  conversa nova (`features/conversa/acoes.ts`) nao cancela a carga e nao tem o
  problema.

## Testes da interface

- Unitarios (vitest, `npm test`): 15 arquivos, so logica pura — nenhum monta
  componente.
- Scripts CDP em `test/` (fora do `npm test`): dirigem o app aberto com
  depuracao na 9222. Dependem de classes e `data-*` (`.channel`, `.msg`,
  `.rail-slot`, `data-vitrine`, `data-tipo`, `data-guild`) — **a reescrita
  quebra todos**; precisam ser refeitos junto.
- Varios scripts apontam por padrao para `https://order.arasaka.fun`. Pela regra
  da conta de teste isolada, testar contra servidor proprio.
- Inventario completo dos scripts em [02-arquitetura.md](02-arquitetura.md#testes).

## Vitrine

`?vitrine` na URL monta so a `VitrineScreen` (`App.tsx:49-60`): galeria dos
componentes com enderecos `data-vitrine`, alvo de `test/vitrine.mjs`, sem
servidor nem dados. No navegador: `npx vite --config
packages/desktop/vite.web.config.ts` (porta 5273, configuracao `order-ui` do
`.claude/launch.json`). Ressalva: os efeitos do App rodam antes do retorno da
vitrine — com sessao guardada, o gateway conecta de verdade.

## Estimativa da reescrita (feita na auditoria)

| Area | Dias-pessoa |
|---|---|
| Fundacao visual (tokens, tema real, movimento, densidade, casca) | 6–9 |
| Primitivas `ui/*` | 3–4 |
| Conversa (lista, mensagem, markdown, compositor, emoji, fixadas, busca) | 7–10 |
| Chamada, so interface (palco, quadros, controles, seletor de tela) | 5–8 |
| Navegacao e social (canais, DM, inicio, presenca, cartoes) | 4–6 |
| Ajustes do usuario, consertando os quebrados | 5–7 |
| Ajustes do servidor completos (servidor ja pronto) | 8–12 |
| Entrada e conta (cadastro aberto, recuperacao) | 2–4 |
| Testes (vitrine, CDP, testes de componente) | 4–6 |
| **Total** | **~45–65** |

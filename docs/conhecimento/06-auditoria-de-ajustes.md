# Auditoria dos ajustes

> Estado em 2026-09-24, versao 1.15.0. Cada controle da tela de ajustes do
> usuario (`packages/desktop/src/screens/SettingsScreen.tsx`), dos ajustes do
> servidor (`components/modals/GuildSettingsModal.tsx`) e do convite
> (`components/modals/InviteModal.tsx`), rastreado ate o efeito real — no
> cliente, no processo principal e no servidor. Na ordem em que o dono
> descreveu cada um.
>
> Vereditos: **FUNCIONA**, **PARCIAL**, **DECORATIVO** (nao tem efeito),
> **QUEBRADO**, **NAO EXISTE**. **[I]** = deducao que precisa ser confirmada
> rodando.

---

## Ajustes do usuario

### Seguranca

| Controle | Veredito | O que acontece | Proposta |
|---|---|---|---|
| Verificacao em duas etapas | PARCIAL | ativa de verdade e mostra 10 codigos, mas o servidor nao emite `USER_UPDATE`: a tela continua em "Ativar" ate reconectar, e clicar de novo falha calado (`auth.ts:334-379`) | emitir `USER_UPDATE`; tela reage |
| 2FA em conta criada pelo Google | QUEBRADO | a tela exige senha, o servidor aceita sem (`auth.ts:57-67`) | pedir senha so se a conta tiver |
| Vincular/desvincular Google | FUNCIONA | so aparece se o servidor tem Google; desvincular e recusado sem senha. Erros nunca aparecem (o `error` da secao so e desenhado nos paineis de 2FA) | mostrar erros |
| **Trocar senha (atual + nova)** | **FUNCIONA** | `POST /auth/password`; derruba as outras sessoes. Sem campo de confirmacao nem estado "ocupado" | confirmacao + estado |
| **"Esqueci a senha — confirmar pelo Google"** | PARCIAL | so logado, dentro de Ajustes, e so com Google ja vinculado; apaga TODAS as sessoes; erros invisiveis. **Nao existe recuperacao na tela de entrada** e sem Google nao ha recuperacao nenhuma (o servidor nao envia email) | recuperacao na tela de entrada (Google agora; email exige um servidor de envio — decidir) |
| Sair da conta | PARCIAL | nao chama `/auth/logout` (a sessao continua valida no servidor); [I] nao sai da chamada | revogar + sair da voz |
| Sessoes/dispositivos | NAO EXISTE na UI | o servidor lista e revoga (`GET/DELETE /auth/sessions`) | tela de dispositivos |

### Voz e video

| Controle | Veredito | O que acontece | Proposta |
|---|---|---|---|
| **Testar microfone** | PARCIAL / QUEBRADO > 100% | mesma cascata da chamada; com volume geral acima de 100% o `retorno.volume` > 1 lanca excecao e o teste fecha calado (`SettingsScreen.tsx:863`); cada passo no volume reabre o mic | rotear o retorno pelo grafo de saida |
| **Volume geral** 0–200% | FUNCIONA | ganho geral x individual, limitador | manter |
| **Modo de entrada / microfone** | FUNCIONA | reabre o mic; troca silenciosa se o aparelho sumir | avisar troca |
| Saida de audio | PARCIAL | vale para vozes; nao para avisos sonoros nem soundboard | tudo pelo mesmo destino |
| **Sensibilidade do microfone** | FUNCIONA (mal percebida) | portao ao vivo (`controller.ts:1454-1466`); corte seco; o medidor do teste e linear, depois do portao, sem marca do limiar — impossivel calibrar no olho | medidor em dB antes do portao, com a marca do limiar e modo automatico |
| Tecla do apertar-para-falar | PARCIAL + DECORATIVO | so com a janela em foco; o atalho global nunca e registrado; trocar a tecla exige reiniciar | refazer (ver [04-midia.md](04-midia.md)) |
| **Aviso sonoro de entrada e saida** | FUNCIONA, mas **deixa de ser opcao** | toca no dispositivo padrao com volume fixo, ignorando saida/volume/ensurdecer | decisao do dono: sempre ligado, como no Discord — tirar o interruptor e passar os sons pela saida da chamada |
| **Limpeza por IA (DeepFilterNet3)** | FUNCIONA tecnicamente, soa mal | ver [04-midia.md](04-midia.md) | **refazer do zero** (fase propria) |
| Intensidade da limpeza | PARCIAL | escala em dB; de 30 a 100 soa igual | idem |
| **Isolamento de voz** | DECORATIVO com IA ligada | forcado a `false` (`limpeza.ts:139-140`) | idem |
| **Supressao de ruido** | DECORATIVO com IA ligada | idem | idem |
| **Cancelamento de eco** | FUNCIONA como restricao | eficacia nao medida [I] | idem |
| **Ganho automatico** | FUNCIONA | | idem |
| **Diagnostico** | FUNCIONA, limitado | IPv6/VPN sempre; caminho, latencia e perda so em chamada; nenhuma metrica de video; depende de interno do LiveKit | refazer com metricas de video (camada recebida, fps, travadas, limitacao do emissor) |
| Camera | NAO EXISTE | a lista de cameras e carregada e nunca exibida | escolher camera + previa |

### Conversas

| Controle | Veredito | O que acontece | Proposta |
|---|---|---|---|
| **Densidade confortavel/compacto** | QUEBRADO na pratica | o efeito visivel (avatar 40 -> 28 px) foi removido no commit `f1145e5`; `useDensidade` ninguem importa; sobrou CSS de 1–3 px e [I] o horario fica cortado no compacto (`componentes.css:1480-1486`) | redesenhar no front-end novo com diferenca real (agrupamento, avatar, espacamento) |
| **Enter / Shift+Enter** | FUNCIONA | padrao: Enter envia, Shift+Enter quebra linha; a edicao de mensagem ignora a escolha | dono prefere so o padrao: **tirar a opcao** |

### Notificacoes

| Controle | Veredito | O que acontece | Proposta |
|---|---|---|---|
| **Abrir junto com o computador** | **QUEBRADO** | grava com `args:['--hidden']` e le **sem** os `args` (`electron/main.ts:636-638`): no Windows a leitura volta `false` e o interruptor aparece desligado ao reabrir. `--hidden` nunca e lido: a janela sempre aparece | ler com os mesmos `args`; tratar `--hidden`; ligado por padrao na instalacao |
| **Notificacoes do Windows** | PARCIAL, **sem nenhum ajuste** | disparam so para DM, mencao direta, mencao a cargo seu e @everyone/@here (`src/api/events.ts:187-222`); nunca com a janela em foco; mensagem comum de servidor nunca notifica; "Nao perturbe" promete silenciar e nao silencia; clicar so traz a janela (nao abre o canal); **o icone falta no app instalado** | notificacao por servidor/canal (todas / mencoes / nada) usando as rotas que ja existem no servidor; silenciar por tempo; NP respeitado; clique abre a conversa; contador na barra de tarefas |

### Aparencia e movimento

| Controle | Veredito | O que acontece | Proposta |
|---|---|---|---|
| Tema escuro/claro | PARCIAL | funciona; aplicado depois do primeiro desenho [I: pisca]; sem "seguir o sistema"; cores fixas ignoram o tema | tema no sistema de tokens novo, antes do primeiro desenho |
| **Movimento (seguir o sistema / completo / sem movimento)** | FUNCIONA, efeito sutil | o mecanismo esta certo (`global.css:3495-3513`), mas "completo" libera pouco (80–220 ms, 6 px); na maquina do dono (animacoes do Windows desligadas) "seguir" = parado. Excecoes: o ponto "TRANSMITINDO" ignora a escolha; "sem movimento" nao segura a rolagem suave em JS | definir de novo junto com o design novo (se o novo tiver movimento que valha a escolha) |

### Sobre e atualizacoes

| Linha | Veredito | Origem |
|---|---|---|
| Versao 1.15 | FUNCIONA | `app.getVersion()` <- `packages/desktop/package.json` |
| "Plataforma 1.32" | informativo | e `process.platform` = **`win32`**, nao uma versao |
| Servidor | FUNCIONA | `api.getBaseUrl()`; as atualizacoes vem de URL fixa no build (`https://order.arasaka.fun/baixar`) |
| Verificar -> baixar -> reiniciar | FUNCIONA | procura 5 s apos abrir e a cada 10 min; baixa sozinho; "Reiniciar agora" silencioso e reabre. Mas: sem diferencial (93 MiB por vez), nao avisa se esta em chamada, sem protecao contra clique duplo. Ver [07-desktop-e-entrega.md](07-desktop-e-entrega.md) |

---

## Ajustes do servidor

Acesso so pelo menu do servidor e so com MANAGE_GUILD. **Existem so quatro abas:
Visao geral, Cargos, Emojis, Soundboard.** Nao existem (e o servidor ja tem rota
para todas): Membros, Convites, Banimentos, Registro de auditoria, canais
(editar/apagar/reordenar), permissoes por canal, transferir posse, canal do
sistema.

### Convidar pessoas (`InviteModal`)

| Controle | Veredito | O que acontece |
|---|---|---|
| Codigo (7 dias, 1 uso, gerado ao abrir) | FUNCIONA | cada abertura cria um convite novo |
| Copiar | FUNCIONA | copia so o **codigo** |
| Expira em (30 min / 6 h / 1 d / 7 d / nunca) e usos (1 / 5 / 10 / 25 / sem limite) | FUNCIONA | so valem em "Gerar com estas opcoes"; o anterior continua valido |
| Lista / revogar | NAO EXISTE na UI | servidor tem `GET /guilds/:g/invites`, `DELETE /invites/:code` |

Proposta (pedido do dono): convite vira **link** (`https://order.arasaka.fun/convite/<codigo>`)
que abre o app (protocolo `kiroshi://`) ou uma pagina no navegador;
enviar direto para amigos pela DM na propria janela; lista de convites ativos com
revogacao; manter validade e usos.

### Visao geral

Icone, nome, descricao: **FUNCIONA**. Os campos nao recarregam se outra pessoa
alterar ao mesmo tempo.

### Cargos

| Controle | Veredito | O que acontece |
|---|---|---|
| Criar cargo | **FUNCIONA SO PARA O DONO** | nasce no topo da hierarquia e o servidor exige posicao abaixo do autor — impossivel para qualquer outro, inclusive ADMINISTRATOR; o erro e engolido |
| Nome, cor | FUNCIONA / PARCIAL | cor so salva quando o foco sai do seletor |
| Exibir separadamente | PARCIAL | agrupa na lista de membros, mas como ninguem consegue dar cargo, nao agrupa ninguem |
| Pode ser mencionado | DECORATIVO | ninguem le; qualquer membro menciona qualquer cargo |
| 31 permissoes | 28 checadas no servidor; **USE_VAD, PRIORITY_SPEAKER, MANAGE_WEBHOOKS nao fazem nada** | detalhe por bit em [03-servidor.md](03-servidor.md#cargos-e-permissoes) |
| **Dar cargo a um membro** | **NAO EXISTE em lugar nenhum da interface** | so pela API (`PATCH /guilds/:g/members/:m {roleIds}`, lista completa) — por isso ha 0 cargos atribuidos em producao |
| Apagar cargo | FUNCIONA | erro engolido |

O que o dono relatou e o que causa cada um:

| Relato | Causa |
|---|---|
| "nao consigo gerenciar emoji" | a aba Emojis funciona para quem tem MANAGE_GUILD **e** MANAGE_EMOJIS; quem so tem o cargo ADM nao chega a ela porque **o cargo nunca foi atribuido** |
| "nao consigo mover um membro de uma call pra outra" | a interface so tem "Desconectar da voz"; mover existe so na API |
| "nao consigo ensurdecer" | nao ha botao; no servidor, ensurdecer so grava no banco (nada no SFU) |
| "nao consigo dar o cargo ADM para uma pessoa" | nao ha tela para isso |

No Kiroshi Beta (fatia 3 do F1, 2026-09-25): mover (cartao da pessoa na chamada
e arrastar na navegacao), silenciar e ensurdecer no servidor com efeito no SFU.

Onde a moderacao existe hoje: clique esquerdo na lista de membros (so em canal de
texto) abre o `MemberCard` com "Silenciar no servidor", "Desconectar da voz",
"Expulsar", "Banir" — sem confirmacao e com erros engolidos. Clique direito abre
o `CartaoDePessoa` (perfil, volumes locais, amizade), sem moderacao. A lista de
pessoas na voz da coluna de canais nao tem interacao.

### Emojis

| Controle | Veredito |
|---|---|
| Enviar / apagar | **FUNCIONA** (limite de 512 KB; apagar sem confirmacao) |
| Usar no texto | **FUNCIONA** pelo seletor de emoji |

Nunca foi usado em producao (0 emojis).

### Soundboard

| Controle | Veredito | O que acontece |
|---|---|---|
| Enviar / Ouvir / apagar | PARCIAL | a biblioteca funciona; "Ouvir" toca no aparelho padrao |
| **Tocar um som na chamada** | **NAO EXISTE na UI** | o servidor tem `POST /channels/:c/soundboard`, e nenhuma tela chama |
| Limites | PARCIAL | o limite de 5 s nao e aplicado; MP3 servido como `octet-stream` |

Nunca foi usado em producao (0 sons).

No Kiroshi Beta (fatia 3): tocar na chamada pela barra (botao SONS), com
permissao, moderacao e espera entre sons.

### Figurinhas

Existem no servidor e **nao funcionam** (nao chegam a ninguem). Sem UI.

---

## Menus e acoes que faltam (fora da tela de ajustes)

- Mencoes: sem autocompletar; so `@everyone`/`@here` funcionam na pratica (as
  outras exigem digitar `<@id>` a mao).
- DM: sem botao de chamada; sem remover amigo, bloquear, criar grupo, fechar DM
  (todas existem no servidor). No Beta (fatia 4): chamada, desfazer amizade,
  bloquear e fechar DM; criar grupo ainda nao.
- Pedidos de amizade enviados nao aparecem em lugar nenhum.
- Acoes da mensagem so no `:hover` (inalcancaveis por teclado).
- O produto **nao tem toast**: o provedor so e montado na vitrine. Por isso tantos
  erros sao engolidos sem aviso.

# Pedidos do dono e backlog

> Tudo o que o dono (Luiz Fernando) pediu em 2026-09-24, organizado em frentes
> de trabalho, com o que o estudo encontrou e a proposta de cada uma. E o
> documento para decidir o que vem a seguir. Atualizar o **Estado** de cada
> frente conforme andar.

---

## Como o trabalho foi combinado

1. **Estudo completo + base de conhecimento** — esta pasta. *Feito em 2026-09-24.*
2. **Front-end refeito do zero**, visual cyberpunk. Primeiro um **documento de
   design** para o dono ler e aprovar; so depois codigo. O dono vai mandar o link
   de um projeto de referencia ("para ter ideia", nao para copiar).
3. **Supressao de ruido refeita do zero**, depois do front-end: retirar o atual,
   estudar, plano **comprovado**, so entao implementar e testar.

Padrao exigido: engenheiro senior. Eu cuido do ciclo inteiro, inclusive producao
e deploy. Commits com autor Luiz Fernando, sem assinatura minha.

**Contexto:** desde 2026-08-17 o Discord desligou Go Live, video e
compartilhamento de tela para usuarios no Brasil (ordem da ANPD, sem data de
volta — [09-referencia-discord.md](09-referencia-discord.md#contexto-que-importa)).
Transmissao de tela estavel nao e um recurso a mais do Kiroshi: e a razao de ele
existir. Isso pesa na ordem de F2.

---

## F1 — Front-end novo

**Pedido:** refazer o front-end inteiro, sem se apegar a nada do atual. Visual
cyberpunk na linha dos outros projetos do dono. Documentar antes para aprovacao.

**O que o estudo encontrou** ([05-front-end-atual.md](05-front-end-atual.md)): as
camadas de dados (API, gateway, store, voz, logica pura) sao boas e testadas; a
camada visual e o problema (7 mil linhas de CSS em camadas de restilo, arquivos
gigantes, erros engolidos, sem toast, re-render do app inteiro a cada evento).
Estimativa da auditoria: ~45–65 dias-pessoa para tudo.

**Proposta:** reescrever a camada de interface inteira (componentes, estilos,
navegacao, ajustes) sobre as camadas de dados atuais, extraindo antes a logica
de negocio escondida em componentes. Sistema de design com tokens, tema e
movimento de verdade, componentes testados, roteamento interno com link direto
(necessario para notificacao que abre a conversa e para convite por link).

**Depende de:** link de referencia do dono -> documento de design -> aprovacao.

**Estado:** design aprovado em 2026-09-24 — identidade em **vermelho Arasaka**
(escolha do dono), resto da proposta adotado: [10-front-end-novo.md](10-front-end-novo.md).
**Fatia 1 (fundacao) entregue em 2026-09-25, no Kiroshi Beta**
(`npm run dist:beta`; instala ao lado do normal, pasta de dados propria):
tokens, tema claro/escuro antes do primeiro desenho, movimento em tres niveis,
primitivos (Radix + Tailwind v4), vitrine (`?nova&vitrine`), rotas por hash,
casca com dados reais (titulo, trilho, navegacao com categorias e voz, painel
da voz, identidade, membros, barra de estado) e a entrada (email/usuario,
senha, 2FA). As duas interfaces convivem no mesmo codigo; o instalador de
todos segue sem nenhum codigo da nova.

**Fatia 2 (conversa) entregue em 2026-09-25, no Kiroshi Beta**
(`src/features/conversa/`): canais de texto, DMs e a conversa dos canais de voz.
Paridade com a 1.x (historico paginado, divisor de novas congelado, marcar como
lido, anexos com progresso, cartoes de link, reacoes, responder, editar,
fixar, apagar, busca, fixadas, quem digita, rascunho por canal) mais:

- **densidade real** — confortavel e compacta, escolhida em Configuracoes >
  Aparencia (a unica pagina de ajustes por enquanto, junto com tema e movimento);
- **autocompletar** de `@pessoa`, `@cargo`, `#canal` e `:emoji:`, aberto em cima
  do cursor; o campo mostra nomes e a troca pelas marcas acontece no envio
  (`mencoes.ts`, testado);
- **acoes por teclado** — Shift+Tab do compositor entra nas mensagens, setas
  navegam, Enter abre o menu, E/R/P/+/Del agem, Esc volta; clique com o botao
  direito abre o mesmo menu; letra digitada fora de um campo vai para o
  compositor;
- **Enter envia, Shift+Enter quebra linha**, sem opcao (decisao do dono);
- markdown refeito como arvore (`markdown.ts`): link com `_` nao quebra mais,
  negrito passa por cima de codigo, `nome_do_arquivo` nao vira italico, escape
  com barra, `>>>`, `@everyone` destacado pela regra do servidor;
- nada engolido: editar, apagar, reagir e fixar mostram o motivo da falha;
- reacao com emoji do servidor funciona (a 1.x mandava a marca como texto);
- contador de mencoes sobe ao vivo (antes so no READY) — vale para as duas
  interfaces;
- no servidor: **fixar em DM** passou a funcionar (a regra exigia
  MANAGE_MESSAGES, que o conjunto da DM nao tem).

**Fatia 3 (chamada e palco) entregue em 2026-09-25, no Kiroshi Beta**
(`src/features/chamada/`): a tela do canal de voz, o palco e os controles, com
os consertos de F2 do lado do cliente, conferidos numa chamada entre duas
instancias do Beta e um LiveKit local
([04-midia.md](04-midia.md#o-que-a-fatia-3-implementou-2026-09-25)):

- **o `<video>` nao e recriado** — um elemento por transmissao e por camera,
  que muda de lugar entre grade, destaque e mini palco sem pausar;
- **a camada e escolhida pelo app**: quem assiste uma transmissao nunca recebe
  menos que 720p (1080p com o quadro alto), e o que ninguem ve e pausado no
  servidor — inclusive com a janela minimizada. Num quadro de 340 px chegou
  720p29, onde a 1.x entregava 360p15;
- **o que vai passar**, escolhido ao transmitir: movimento (jogo, video) ou
  detalhe (texto, codigo), que muda a dica do codificador, as camadas e o que
  ceder primeiro;
- **qualidade medida no proprio quadro**: resolucao, fps, banda e travadas para
  quem assiste; camada enviada, banda e limitacao (CPU ou rede) para quem
  transmite;
- convite para assistir, contagem de quem assiste, destaque com fita, grade,
  tela cheia, volume por pessoa e por transmissao, mini palco nas outras telas
  e a conversa do canal de voz ao lado;
- **soundboard tocavel** na barra da chamada;
- **moderacao de voz de verdade**: silenciar e ensurdecer valem no SFU na hora
  e sobrevivem a sair e entrar e a troca de canal; mover funciona (antes a
  pessoa ficava desconectada) e recusa canal onde ela nao pode entrar; arrastar
  alguem para outro canal na navegacao; quem e desconectado ve o motivo;
- no motor de voz, que as duas interfaces usam: parar a transmissao nao trava
  mais, e a latencia sai do par ICE da propria conexao (sem a conexao
  descartavel a cada 2 s).

Fica para depois: telemetria enviada ao servidor (as medidas ficam na tela) e o
estado do motor por evento (regra 5 de 04-midia).

**Fatia 4 (inicio, amigos e DM) entregue em 2026-09-25, no Kiroshi Beta**
(`src/features/inicio/`, `src/features/chamada/`), com a chamada em DM de F5:

- **Inicio** com os amigos em quatro abas (online, todos, pendentes com os
  recebidos primeiro, bloqueados), busca, adicionar pelo nome de usuario, e em
  cada linha conversar, ligar, ligar com video, desfazer amizade e bloquear
  (com confirmacao); o quadro **agora** mostra que amigos estao em chamada e
  onde, com um clique para ir;
- **conversas diretas** na navegacao com o indicador de chamada ("em chamada",
  "te chamando"), onde o outro lado esta em chamada num servidor, e fechar a
  conversa;
- **ligar e atender**: botoes no cabecalho da DM; o cartao de **chamada
  recebida** (a holochamada do desenho) com toque, notificacao do Windows e
  piscar da janela; o toque para em todos os aparelhos ao atender ou recusar
  num deles, e acaba sozinho em 30 s; quem liga ouve o "chamando" e pode chamar
  de novo;
- **a chamada no topo da conversa**, com o mesmo palco e os mesmos controles do
  canal de voz, e a faixa para entrar quando ha chamada sem voce;
- **registro na conversa**: "iniciou uma chamada", "durou 12 minutos",
  "chamada perdida";
- **a regra dos 3 minutos**: sozinho numa chamada de DM, o servidor desliga, e o
  aviso fica na tela ate a pessoa voltar (texto nosso).

Tambem entraram duas faltas achadas no teste da fatia 3: o som de entrar e
sair da chamada nao existia na interface nova (agora sempre ligado, decisao do
dono), e camera e transmissao nunca chegavam ao servidor, nas duas interfaces
— ninguem via na lista quem estava com camera ou ao vivo.

**Fatia 5 (ajustes do usuario) entregue em 2026-09-25, no Kiroshi Beta**
(`src/features/ajustes/`): as dez paginas do desenho, em tres grupos, e
nenhuma decorativa.

- **Meu perfil** (foto, nome de exibicao, pronomes, bio, status e frase) e
  **Conta e seguranca** (senha com confirmacao, ou definir a primeira para
  quem entrou pelo Google; verificacao em duas etapas com QR e codigos de
  reserva; Google; **aparelhos conectados** com desconectar; sair de verdade;
  excluir a conta digitando o usuario).
- **Voz e video**: dispositivos, volume ate 200%, modo de entrada, **medidor em
  dB com a marca do limiar**, medido entre a limpeza e o portao (o antigo media
  depois do portao e nao dava para calibrar), teste com "ouvir minha voz" (sem
  o estouro acima de 100% da 1.x), camera com previa. Da limpeza de ruido, so o
  que funciona hoje; o resto e F3.
- **Transmissao**: o padrao do seletor de tela.
- **Notificacoes** (F7): Windows, piscar, contador no icone; nivel por servidor
  e por canal (todas, so mencoes, nada) e silenciar por 15 min, 1 h, 8 h, 24 h
  ou ate reativar — no clique direito de canais e DMs e no menu do servidor;
  "Nao perturbe" respeitado; clique na notificacao abre a conversa.
- **Atalhos globais** (falar segurando, mutar, ensurdecer) pela escuta do
  teclado do Windows (`uiohook-napi`, aprovada pelo dono): funcionam com o jogo
  na frente e nao tomam a tecla dele; botao lateral do mouse tambem serve.
- **Windows** (F7): iniciar com o Windows consertado (lido e gravado do mesmo
  jeito), abrir escondido na bandeja de verdade, e a escolha do que o X faz;
  ligado por padrao no Kiroshi normal, na primeira abertura.
- **Sobre e atualizacoes** e **Diagnostico** (IPv6, rede virtual, caminho,
  latencia e perda, com relatorio para copiar).

**Fatia 6 (ajustes do servidor, cargos, convites por link) entregue em
2026-09-25, no Kiroshi Beta** (`src/features/servidor/` e `src/features/pessoas/`):
as queixas de cargo do F9 resolvidas, e o convite virou link (F8).

- **Ajustes do servidor** como o Discord organiza (secao 4.7 do desenho): Visao
  geral (icone, nome, descricao), Membros (busca, filtro por cargo, cargos com
  `+`, apelido, expulsar, banir, passar a posse), **Cargos** (lista que se
  reordena arrastando ou com Alt + setas; editor com Exibicao, Permissoes e
  Membros), Convites (quem criou, usos, validade, revogar), Banimentos (motivo,
  tirar), **Canais** (arvore com criar, reordenar, mudar de categoria, apagar,
  modo lento e limite da sala; permissoes por canal em **tres estados** — negar,
  herdar, permitir — com o que o "herdar" vale naquele momento, "sincronizado com
  a categoria" e canal privado), Emojis e Soundboard (enviar varios, renomear,
  apagar; som com a duracao medida e o limite de 5 s), Registro de auditoria
  (filtro por pessoa e acao, em frases) e Excluir servidor (so o dono, digitando
  o nome). Cada pagina aparece so para quem tem a permissao que o servidor pede.
- **Dar cargo** tambem pelo perfil da pessoa (`+` nos cargos; o perfil abre no
  nome da mensagem e na lista de membros) e pelo clique direito (submenu Cargos
  com caixas de marcar). So aparece o que o servidor aceita: cargo abaixo do seu,
  sem permissao que voce nao tem, em quem esta abaixo de voce.
- **Lista de membros** agrupada pelo cargo destacado mais alto, nome na cor do
  cargo, coroa no dono.
- **Convite como link** (F8): a janela "Convidar pessoas" com o link, validade e
  usos, e os amigos com o botao que manda o link pela DM; a pagina
  `/convite/<codigo>` no navegador; o protocolo `kiroshi://` (registrado pelo
  instalador do Beta) abre o app direto no convite; o `+` do trilho cria
  servidor ou entra colando o link. O Kiroshi 1.x ja aceita o link colado.
- No menu do servidor: convidar, criar canal e categoria, mudar o proprio
  apelido e sair do servidor.

Os consertos de servidor desta fatia estao em
[03-servidor.md](03-servidor.md#cargos-e-permissoes). De fora ficaram, porque o
servidor nao faz nada com eles: canal de sistema e notificacao padrao do
servidor, "ver como este cargo", e figurinhas.

**Fatia 7 (entrada e conta) entregue em 2026-09-25, no Kiroshi Beta**
(`src/features/entrada/`): o F4 inteiro, com as decisoes do dono — cadastro
aberto e recuperacao so pelo Google.

- **Entrada** (secao 4.1 do desenho): entrar, criar conta (email, usuario, nome,
  senha repetida; o nome reservado e a senha curta aparecem antes de enviar),
  continuar com o Google (entra, pede o 2FA, ou oferece criar a conta com um
  nome de usuario ja sugerido), esqueci a senha (pelo Google vinculado) e o
  segundo fator, que vale para os tres caminhos. Com o cadastro fechado, o campo
  de convite aparece sozinho.
- **Chegando pelo link de convite sem conta**, a tela mostra o convite e a
  conta nova ja nasce dentro do servidor — o `kiroshi://` passou a valer antes
  do login.
- **Conta nova cai no "Sua rede comeca aqui"**: adicionar amigo, entrar num
  servidor com convite ou criar um.
- **"Defina uma senha"**: faixa fixa e dispensavel para quem so entra pelo
  Google; some sozinha quando a senha e definida.
- **2FA**: desliga com um codigo de recuperacao (quem perdeu o celular ficava
  preso com o 2FA ligado).

Com isso as sete fatias do desenho estao no Beta.

**A troca (2026-09-25, aprovada pelo dono):** a interface nova virou a do
Kiroshi de todo mundo na **2.0.0**, pela atualizacao automatica
([07](07-desktop-e-entrega.md)). O Beta segue como canal de teste. A 1.x fica
no codigo como reserva de emergencia e sai depois de algumas semanas sem
problema. Proximo: F3 (supressao de ruido do zero).

## F2 — Estabilidade das transmissoes

**Pedido:** "as transmissoes estao travando muito".

**O que o estudo encontrou** ([04-midia.md](04-midia.md)):
- quem assiste recebe a camada pelo tamanho do quadro — **360p a 15 fps** no palco
  ao lado do chat; 1080p60 so em tela cheia;
- o `<video>` e remontado ao trocar de tela (pausa + espera de quadro-chave);
- emissor pesado (VP8 por software, 3 camadas, sem `contentHint`, DFN3, re-render
  5 Hz, sondagem ICE a cada 2 s);
- em producao, **4 de 7 participantes passam pelo relay TURN** e concentram as
  trocas de caminho ICE (ate 95 em 72 h); 10 falhas da conexao de quem publica;
- toda a saida do SFU sai pelo upload de casa (~9 Mbps por espectador no 1080p60);
- **nenhuma metrica de video** existe hoje.

**Proposta:**
1. **Medir primeiro:** telemetria de `getStats` no emissor e no espectador (camada
   recebida, fps, travadas, `qualityLimitationReason`), Prometheus do LiveKit em
   localhost, medida do upload de casa. Sem isso, qualquer conserto e palpite.
2. Consertos que ja tem evidencia e entram junto com o front-end novo (o palco e
   interface): pedir a camada certa a quem assiste; nunca desmontar o `<video>`;
   parar de assinar com a janela minimizada; `contentHint` por tipo de conteudo;
   tirar a sondagem de 2 s e o re-render de 5 Hz.
3. Caminho de rede de quem usa relay: depois de medir, avaliar opcoes (inclusive
   levar o SFU para uma VPS com IP publico — **decisao do dono**, muda a premissa
   "tudo em casa").

**Estado:** os consertos do item 2 entraram na fatia 3 do F1 e, desde a 2.0.0,
estao no Kiroshi de todo mundo; a medida aparece no proprio quadro. Falta o resto
do item 1 (telemetria enviada ao servidor, Prometheus do LiveKit, upload de casa)
e o item 3.

**Retorno da voz pela transmissao (2026-09-25, 2.0.1).** Pedido do dono: "a
transmissao nunca pode pegar o audio do proprio Kiroshi pois da um retorno muito
forte" (ele assistiu a tela de um amigo e ouviu a propria voz de volta). O som da
tela saia do `loopback`, que grava tudo o que toca nas caixas de quem transmite,
inclusive a chamada. Conserto: o dispositivo `loopbackWithoutChrome` do Chromium,
que no Windows captura o sistema inteiro menos a arvore do servico de audio do
proprio app (ver [04-midia.md](04-midia.md#publicacao-de-video-e-tela)). Onde o
Windows nao tem captura por processo (antes do 10 2004), a tela vai sem som e a
pessoa le o motivo: nunca volta para o `loopback` puro. Junto, dois defeitos do
mesmo som, achados na medicao: o Chromium tratava o som da tela como microfone
(eco, ruido e ganho automatico, e em mono), e a faixa saia com DTX e RED (131
kbps em vez de 64). O conserto vale quando **quem transmite** esta na 2.0.1.

## F3 — Supressao de ruido do zero

**Pedido:** "o que esta implementado esta horrivel"; retirar, estudar, plano
comprovado, implementar, testar. Depois do front-end.

**Ponto de partida** ([04-midia.md](04-midia.md#entrada-de-audio),
[../SUPRESSAO-DE-RUIDO.md](../SUPRESSAO-DE-RUIDO.md)): DFN3 roda, mas com
intensidade em dB mal escalada (padrao "sem limite" = voz de lata), portao seco
sem rampa, reserva GTCRN de 16 kHz (abafada), ~38% de um nucleo, grafo processando
silencio quando mudo; isolamento e supressao do navegador sem efeito com a IA
ligada; latencia nunca medida. O plano novo precisa de metricas objetivas (antes
e depois, em gravacoes de referencia) e de um criterio de aceitacao definido antes
de codar.

**Estado (2026-09-25):**
1. **Retirar — feito na 2.0.2.** Saiu a limpeza por modelo inteira: DeepFilterNet3
   (pacote, 24 MB de arquivos no instalador, protocolo `kiroshi-modelos://`,
   autoteste), GTCRN, a cascata e os ajustes "Limpeza por IA" e "Intensidade".
   Ficam a supressao, o isolamento, o eco e o ganho do navegador, e o portao do
   modo por voz (sensibilidade de entrada, nao supressao). Quem tinha a IA
   ligada volta a ter a supressao do navegador ligada. A CSP perdeu
   `wasm-unsafe-eval`, `blob:` e `kiroshi-modelos:`.
2. **Estudar e plano comprovado — em andamento.** O documento vai para o dono
   ler antes de qualquer codigo: candidatos, gravacoes de referencia, metricas
   objetivas, criterio de aceitacao.
3. Implementar e testar — so depois da aprovacao.

## F4 — Conta: cadastro sem convite, com Google

**Pedido:** criar conta sem "chave do servidor", como no Discord — conta nasce
vazia, sem amigos nem servidores. Poder criar com Google (pega o email); fica um
aviso pendente para definir senha, para quem quiser entrar com email e senha.

**O que o estudo encontrou** ([03-servidor.md](03-servidor.md#conta-e-autenticacao)):
- o "codigo de convite" obrigatorio vem de `ALLOW_OPEN_REGISTRATION=false`; com
  `true`, o convite e ignorado e o cliente ja cai na tela vazia ("Sua rede comeca
  aqui");
- **criar conta com Google ja existe** (`/auth/google/registrar`, conta sem senha);
- definir a primeira senha sem a atual ja existe (conta so-Google);
- faltam: aviso pendente "defina uma senha", recuperacao de senha na tela de
  entrada, verificacao de email e qualquer protecao contra cadastro em massa
  (hoje so 4 cadastros/h por IP); username criado pelo Google aceita `-`, que o
  resto do sistema recusa.

**Cuidados de seguranca (pesquisados):** identificar a conta Google pelo `sub`
(ja e assim); nunca juntar uma conta de senha com uma do Google so porque o email
bate, a menos que o email local esteja verificado (ataque de conta
pre-sequestrada); "entrar com Google de novo" nao prova quem esta digitando — o
padrao do mercado para **redefinir** senha e link ou codigo por email. Definir a
**primeira** senha de uma conta so-Google estando logado e o padrao (Notion).

**Decisoes do dono (2026-09-25):** cadastro **aberto** para qualquer um;
recuperacao de senha **so pelo Google** (sem servico de email).

**Estado:** feito na fatia 7 do F1 (Beta e servidor). Conta nova com email e
senha ou com o Google, sem convite; com convite (chegando pelo link), a conta ja
nasce dentro do servidor. "Esqueci a senha" pelo Google vinculado, sem estar
logado: confirma pelo Google, escolhe a senha nova e entra (com 2FA, pede o
codigo do app). Aviso fixo e dispensavel "defina uma senha" para quem entrou
pelo Google. Protecoes do cadastro aberto: teto de contas novas por hora no
servidor inteiro, nomes reservados, teto de pedidos de amizade, e DM so entre
amigos, gente com servidor em comum ou quem ja tinha conversa. Continua sem
verificacao de email (nao ha como mandar email). Quem nao tem Google vinculado
e esquece a senha depende de quem administra.

## F5 — Chamada em DM + quem fica sozinho

**Pedido:** ligar para um amigo na DM, com video e tela, como num canal de voz. E
estudar por que o Discord desconecta quem fica sozinho na chamada depois que o
outro sai (com o aviso de humor) e implementar se fizer sentido.

**O que o estudo encontrou** ([04-midia.md](04-midia.md#chamada-em-dm)): o
servidor ja emite token e estado de voz para DM e grupo; faltam o sinal de
chamada (tocar, aceitar, recusar, tempo limite), mensagem de sistema de chamada,
estado de voz de DM no READY, encerrar a sala quando sobrar uma pessoa, e toda a
interface. Referencia do Discord em [09-referencia-discord.md](09-referencia-discord.md).

**Quem fica sozinho (pesquisado):** o Discord desconecta depois de **3 minutos**
sozinho, **so em chamada privada** (DM e grupo; canal de servidor nao), sem opcao
de desligar, com uma mensagem efemera de humor na propria DM. O motivo declarado e
economizar banda (o Discord paga a voz de todo mundo); do lado do usuario, evita
chamada esquecida gastando dados e bateria. No Kiroshi o motivo e mais forte: a
saida do SFU e o upload de casa. O LiveKit nao tem isso pronto (`departure_timeout`
e `empty_timeout` nao cobrem uma pessoa sozinha).

**Proposta:** chamada em DM/grupo com botao de voz e de video no cabecalho, toque
com aceitar/recusar e tempo limite, mensagem de sistema de chamada (iniciada,
duracao, perdida), video e tela iguais aos do canal de voz; e desconexao apos 3 min
sozinho, com timer no servidor e aviso com texto nosso no mesmo tom.

**Estado:** feito na fatia 4 do F1 (Beta e servidor). O servidor faz tocar,
parar de tocar, registrar e desligar quem fica sozinho (`services/chamadas.ts`);
ligar e atender sao entrar na voz da conversa, pelo caminho de sempre. Tempo do
toque e da solidao configuraveis so para teste (`DM_CALL_RING_SECONDS`,
`DM_CALL_ALONE_SECONDS`).

## F6 — Ajustes do usuario que nao funcionam

Tabela completa em [06-auditoria-de-ajustes.md](06-auditoria-de-ajustes.md).
Resumo do que o dono citou:

| Ajuste | Veredito | Destino |
|---|---|---|
| Trocar senha | funciona | manter, com confirmacao |
| Esqueci a senha pelo Google | parcial (so logado, erros invisiveis) | F4 |
| Testar microfone | quebra com volume > 100% | F1/F3 |
| Sensibilidade do microfone | funciona, mas impossivel calibrar | medidor em dB com a marca do limiar |
| Aviso sonoro de entrada/saida | funciona | **deixa de ser opcao** (sempre ligado) |
| DFN3, isolamento, supressao, eco, ganho | ver auditoria | F3 |
| Diagnostico | limitado | refazer com metricas de video (F2) |
| Densidade | quebrado na pratica | redesenhar em F1 |
| Enter / Shift+Enter | funciona | **tirar a opcao** (Enter envia, Shift+Enter quebra linha) |
| Notificacoes | sem nenhum ajuste | F7 |
| Abrir junto com o computador | quebrado | F7 |
| Tema | funciona | F1 |
| Movimento | funciona, efeito sutil | redefinir em F1 |
| Atualizacoes | funciona | manter; melhorias em F11 |

## F7 — Notificacoes do Windows e iniciar com o computador

**Pedido:** notificar no Windows mensagem de servidor e de DM, como o Discord.
"Abrir junto com o computador" funcionando e ligado.

**O que o estudo encontrou:** hoje so notifica DM, mencao direta, mencao a cargo e
@everyone; mensagem comum de servidor nunca; "Nao perturbe" nao silencia; clicar
nao abre a conversa; o icone falta no app instalado; o servidor ja tem ajustes de
notificacao por servidor/canal que ninguem usa. Autostart: le sem os mesmos
`args` com que grava, e `--hidden` e ignorado.

**Proposta:** niveis por servidor e canal (todas / so mencoes / nada), silenciar
por tempo, NP respeitado, clique abre a conversa, contador na barra de tarefas;
autostart consertado, abrindo escondido na bandeja, ligado por padrao.

**Estado:** feito na fatia 5 do F1 (Beta e servidor). A regra de quando notificar
e pura e testada (`src/lib/notificar.ts`); os ajustes por servidor e canal
ficam na conta e valem em todos os aparelhos. Mensagem comum de servidor passa
a notificar (nivel "todas" por padrao, como o dono pediu).

## F8 — Convite como link

**Pedido:** em vez de codigo, como no Discord: mandar para amigos pela DM ou gerar
um link, com validade opcional e numero de usos (1, 5, 10, 20...); o link abre no
app ou no navegador. Isso leva a uma **versao web** do Kiroshi — pode ficar para
depois.

**O que o estudo encontrou:** validade e usos ja funcionam; o codigo ja e curto e
sem ambiguos; falta tudo o que faz dele um link — pagina `/convite/<codigo>`,
protocolo `kiroshi://`, enviar por DM na janela, lista/revogacao na interface.
A interface ja roda no navegador (`vite.web.config.ts`, substituto da ponte), o
que torna a versao web viavel mais adiante.

**Estado:** feito na fatia 6 do F1 (Beta e servidor). Link
`order.arasaka.fun/convite/<codigo>` com pagina no navegador (servidor, quem
convidou, online, o codigo para quem tem app antigo, e o instalador), protocolo
`kiroshi://convite/<codigo>` registrado pelo instalador do Beta, janela de
convite com validade e usos do Discord e envio pela DM, lista e revogacao nos
ajustes. O uso do convite passou a ser reservado numa conta so no banco (dois
aceitando um convite de 1 uso ao mesmo tempo nao entram os dois). Versao web:
ainda depois.

## F9 — Cargos e moderacao de verdade

**Pedido:** as permissoes de cargo nao funcionam; nao da para dar o cargo ADM a
ninguem; nao da para mover, ensurdecer, gerenciar emoji. Pesquisar como o Discord
(e outras plataformas) organiza os ajustes de servidor.

**O que o estudo encontrou** ([03-servidor.md](03-servidor.md#cargos-e-permissoes)):
28 dos 31 bits sao checados no servidor; o que falta e sobretudo **interface**:
nao ha tela para dar cargo (0 cargos atribuidos em producao), nem para mover,
ensurdecer, apelidos, bans, convites, auditoria, canais, permissoes por canal. No
servidor: criar cargo so funciona para o dono; heranca de sobrescritas de
categoria invertida; atribuir cargo so com a lista completa; ensurdecer so no
banco; USE_VAD, PRIORITY_SPEAKER e MANAGE_WEBHOOKS nao existem.

**Proposta:** ajustes de servidor completos no front-end novo (Visao geral,
Cargos com lista de membros por cargo, Membros, Convites, Banimentos, Auditoria,
Canais e permissoes, Emojis, Soundboard), com os consertos no servidor e
moderacao de voz de verdade (mover, silenciar e ensurdecer aplicados no SFU).
Referencia em [09-referencia-discord.md](09-referencia-discord.md).

**Estado:** moderacao de voz feita na fatia 3 do F1 (Beta e servidor): silenciar
e ensurdecer tiram o microfone no SFU na hora, e o token de entrada ja sai sem
ele; mover funciona e recusa destino sem CONNECT. **Ajustes de servidor e cargos
feitos na fatia 6** (Beta e servidor): qualquer um com Gerenciar cargos cria
cargo (nasce logo acima do everyone), da e tira um cargo de cada vez, e o canal
que o cargo abre aparece (ou some) na hora para quem ganhou ou perdeu; heranca
da categoria certa; telas para tudo o que so existia na API. USE_VAD,
PRIORITY_SPEAKER e MANAGE_WEBHOOKS continuam sem efeito — e nao aparecem na tela.

## F10 — Emojis, soundboard, figurinhas

Emojis funcionam (nunca foram usados). Soundboard: a biblioteca funciona e
**nenhuma tela toca um som na chamada**; limite de duracao nao aplicado.
Figurinhas nao funcionam. Proposta: soundboard na barra da chamada, com volume,
limites e permissao; figurinhas consertadas ou retiradas.

**Estado:** tocar na chamada feito na fatia 3 do F1 (Beta), com permissao,
moderacao e espera entre sons. **Gerenciamento feito na fatia 6**: Emojis e
Soundboard nos ajustes do servidor; o som tem a duracao medida no envio (o app
decodifica) e o limite de 5 s vale tambem na hora de tocar, em todo cliente
novo; MP3 passou a ser gravado como `.mp3`. Figurinhas: ainda quebradas no
servidor, e fora da interface.

## F11 — Atualizacao e atualizador em segundo plano

**Pedido:** a aba de atualizacoes esta boa. Estudar um atualizador em segundo
plano como o do EA app (inicia com o Windows, procura atualizacao sempre). O dono
vai mandar um documento sobre o EA app.

**O que o estudo encontrou** ([07-desktop-e-entrega.md](07-desktop-e-entrega.md)):
o diferencial nunca funcionou (sem `Range`: 93 MiB por atualizacao); ha
instalacoes em "todos os usuarios" que provavelmente pedem UAC; nada e assinado;
nao avisa se a pessoa esta em chamada.

**Proposta, em ordem:** `Range` no servidor -> autostart consertado com `--hidden`
-> "instalar quando for seguro" no proprio app (fora de chamada) -> instalacao
sempre por usuario -> so entao, se ainda fizer falta, tarefa agendada; assinatura
de codigo antes de qualquer instalacao sem ninguem presente. Servico do Windows
nao recomendado.

## F12 — Seguranca

Achados de servidor, casca e host estao em `privado/seguranca.md` (fora do git —
o repositorio e publico). Tres sao pequenos e afetam privacidade entre membros do
grupo; a proposta e corrigi-los antes do front-end, num deploy marcado para um
horario sem ninguem em chamada. Os do host mexem em todos os projetos do dono e
dependem dele.

## F13 — Operacao

Metricas (LiveKit e cliente), backup automatico do banco, deploy que nao reinicia
o LiveKit quando so a API mudou, comando versionado de "quem esta em chamada",
`.env.production.example` e icones versionados (hoje um clone limpo nao empacota).

**Tunel meio morto (2026-09-25, ~20:30 a 20:55 UTC).** O Kiroshi do dono mostrou
"524" ao procurar a atualizacao. Parte dos pedidos a `order.arasaka.fun` e
`voz.arasaka.fun` ficava sem resposta: a borda da Cloudflare aceitava a conexao
(TLS em 0,2 s) e esperava o servidor ate desistir, sem o pedido chegar ao
`cloudflared` (nenhum pedido em andamento durante a trava). Nao era banda (upload
a 10 kbps) nem a API (3 ms direto na 4000). Dependia de quem pedia: da maquina do
dono, 6 de 6 travavam; do proprio servidor, 5 de 5 passavam. A Cloudflare escolhe
a conexao do tunel pela origem do pedido, e uma das quatro estava meio morta, com
o `/ready` do `cloudflared` dizendo 4 conexoes prontas. `systemctl restart
cloudflared` refez as quatro e resolveu (18 de 18 depois). Pelo mesmo caminho
falhavam as chamadas da API ao LiveKit (`LIVEKIT_URL` e `wss://voz.arasaka.fun`)
e downloads da 2.0.1 ("stream canceled by remote"); ninguem estava em chamada.

A causa de fundo e o transporte: o `cloudflared` usava QUIC (UDP) atras do CGNAT,
e as conexoes morriam por "no recent network activity" todo dia (de 2 a 19 vezes
por dia na ultima semana; 36 pedidos com falha so no dia 25).

**Trocado para HTTP/2 (TCP) no mesmo dia, com a aprovacao do dono** (o tunel
serve todos os projetos do servidor, entao era a decisao delegada 5; custo
nenhum, o tunel e gratuito nos dois protocolos). Sobrescrita do systemd em
`/etc/systemd/system/cloudflared.service.d/protocolo.conf` com
`Environment=TUNNEL_TRANSPORT_PROTOCOL=http2`; para voltar, apagar o arquivo,
`systemctl daemon-reload` e `systemctl restart cloudflared`. Conferido depois:
as quatro conexoes em `protocol=http2`, 18 de 18 pedidos, WebSocket do gateway
(HELLO em 0,65 s), sinalizacao do LiveKit (401 para token invalido), instalador
inteiro em 3,3 s. O roteamento de rede privada (WARP), unico recurso que exige
QUIC, esta desligado. **A conferir em alguns dias:** as quedas de conexao no log
e as retomadas por queda de sinalizacao do LiveKit (hipotese 10 do
[04-midia.md](04-midia.md)). O `financeiro-une` ja respondia 502 antes da troca:
nada escuta nas portas 8050/8051 do servidor.

## F14 — Documentacao desatualizada

README, ARQUITETURA, MANUAL, DEPLOY e a pagina `/privacidade` divergem do codigo
em varios pontos (listas em [03-servidor.md](03-servidor.md#documentacao-que-diverge-do-codigo)
e [07-desktop-e-entrega.md](07-desktop-e-entrega.md#documentacao-que-diverge-do-codigo)).
A pagina de privacidade promete apagar mensagens e anexos na exclusao de conta e
nao apaga — ponto de LGPD.

---

## Decisoes ja tomadas pelo dono

- Front-end primeiro; supressao de ruido depois; web depois.
- Nao se apegar ao front-end atual.
- Aviso sonoro de entrada e saida e padrao do sistema, sem opcao.
- Enter envia, Shift+Enter quebra linha — sem opcao.
- "Abrir junto com o computador" deve existir, funcionar e ficar ligado.
- Convite por link, com validade e numero de usos.
- O container `atm11` e o teto de memoria dele nao se discutem.
- Commits como Luiz Fernando, sem assinatura do Claude.

## Decisoes delegadas (2026-09-24)

O dono mandou a referencia (`https://nexus.arasaka.fun/`) e disse "o resto voce
decide". O que foi decidido, e por que:

| # | Questao | Decisao |
|---|---|---|
| 1 | Referencia do visual | Arasaka Nexus (`arasaka-nexus/frontend/DESIGN.md` + o site). Aplicada em [10-front-end-novo.md](10-front-end-novo.md) |
| 2 | Documento do EA app | nao veio; seguir a recomendacao do estudo ([07](07-desktop-e-entrega.md#atualizador-em-segundo-plano-estilo-ea-app--estudo)) |
| 3 | Repositorio publico | mantido; detalhe sensivel so em `privado/` |
| 4 | Falhas de privacidade do servidor | corrigir **antes** do front-end; publicar so a API (sem reiniciar o LiveKit), num momento sem ninguem em chamada |
| 5 | Endurecimento do host | e configuracao de seguranca do sistema e mexe em todos os projetos: fica com o dono, com o roteiro pronto em `privado/seguranca.md` |
| 6 | Cadastro aberto | sim, como o Discord, com protecoes: limite por IP (ja existe), DM so entre amigos ou quem divide servidor (hoje qualquer um manda DM para qualquer um), username sem `-`. Recuperacao de senha pelo Google agora; por email quando houver servico de envio |
| 7 | Quem reclama das travadas | medir (telemetria de F2) em vez de perguntar |
| 8 | Acento na interface | sim — o Nexus usa ("Catalogo", "Mangas") |

## Perguntas em aberto

As de design, em [10-front-end-novo.md](10-front-end-novo.md#9-o-que-preciso-que-voce-decida):
cor da identidade (A vermelho ou B ciano), disposicao da janela, "agente",
intensidade dos efeitos.

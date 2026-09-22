# Arquitetura do Kiroshi

Este documento explica **por que** o Kiroshi e do jeito que e. O que ele faz esta
no codigo; o que esta aqui sao as decisoes que o codigo nao consegue contar
sozinho, e as que foram tomadas contra a opcao obvia.

---

## O problema

Dez amigos usavam Discord. Compartilhar tela e ligar a camera pararam de
funcionar para eles. Precisavam de substituto proprio, em servidor proprio,
com instalador que cada um roda uma vez.

Isso muda quase tudo em relacao a "clonar o Discord":

- **Dez pessoas, nao dez milhoes.** A engenharia que o Discord precisa —
  Cassandra, sharding de gateway, Elixir — existe para resolver problemas de
  escala que aqui nao existem. Copiar aquilo seria pagar o custo sem receber
  o beneficio.
- **Compartilhar tela e o recurso principal**, nao um extra. Foi a falha dele
  que motivou o projeto.
- **Um servidor so, atras de CGNAT.** Isso foi o que mais moldou o desenho.

---

## Escolhas do produto

### O que entrou

Contas com 2FA, servidores, canais de texto e voz, cargos com permissoes por
canal, mensagens completas (markdown, anexos, reacoes, respostas, mencoes,
fixadas, busca), presenca, amizades, DMs individuais e em grupo, voz, video,
compartilhamento de tela, emojis e sons customizados.

### O que ficou de fora, e por que

| Recurso | Motivo |
|---|---|
| Nitro / assinatura | Cobrar de dez amigos em um servidor que ja e seu nao faz sentido. Os limites que o Nitro remove ja estao generosos. |
| Descoberta de servidores | Serve para achar comunidades publicas. Aqui todos ja se conhecem. |
| Threads e foruns | Organizam conversa de centenas de pessoas. Com dez, um canal resolve. |
| Bots e webhooks | Util, mas nao era o que estava quebrado. A API REST ja esta pronta para isso quando fizer falta. |
| AutoMod | Modera desconhecidos. Nao ha desconhecidos. |
| Apps mobile | Foi pedido desktop. |
| Cassandra / ScyllaDB | Resolve trilhoes de mensagens. O Postgres aguenta bilhoes sem suar. |

Nada disso e impossivel de adicionar — o modelo de dados e o protocolo foram
desenhados sem fechar essas portas. Sao decisoes de "agora nao", nao de
"nunca".

---

## As tres decisoes que importam

### 1. Por que a midia nao passa pelo tunel

O servidor esta atras de CGNAT: IPv4 compartilhado, sem encaminhamento de
portas. Foi verificado, nao suposto — a porta do Terraria, aberta na maquina,
nao responde de fora. O Cloudflare Tunnel resolve isso para HTTP porque o
servidor abre a conexao para fora.

Mas WebRTC usa UDP, e o Cloudflare Tunnel nao transporta UDP. Essa e uma
restricao dura, nao um detalhe de configuracao.

Os caminhos possiveis eram:

| Caminho | Veredito |
|---|---|
| Abrir porta no roteador | Impossivel, CGNAT |
| Relay TURN gerenciado | Funciona, mas acrescenta latencia e um servico externo |
| Tunel UDP (playit.gg) | Funciona, mesma latencia extra |
| **IPv6 direto** | **Escolhido** |

A maquina tem IPv6 publico. Faltava saber se estava alcancavel de fora, e isso
so se descobre testando de fora. O teste foi subir um listener e pedir a um
servico em outra rede que se conectasse. A conexao chegou.

Entao: sinalizacao pelo tunel, midia direta por IPv6.

```
  Cliente                                               arasaka
  -------                                               -------
  REST + WebSocket  ->  Cloudflare Tunnel (TLS)  ->  127.0.0.1:4000
  Audio/video/tela  ->  IPv6 direto (UDP 7881)   ->  [2804:...]:7881
```

Isso tem um efeito colateral bom: a midia nao so funciona, funciona **melhor**,
porque nao ha intermediario entre as pessoas e o servidor.

O risco conhecido: quem estiver sem IPv6 nao fecha a chamada. O `.env` tem
`TURN_SERVERS` preparado para esse caso, desligado por padrao — ligar um relay
para todo mundo por causa de um seria piorar para nove.

### 2. Por que LiveKit e nao mediasoup

Ambos sao SFU de codigo aberto. O mediasoup da mais controle; o LiveKit entrega
mais pronto.

O que decidiu:

- **O mediasoup compila codigo nativo** (meson, ninja, Python). No Windows,
  onde este projeto foi desenvolvido, isso e uma fonte constante de atrito. O
  LiveKit e um binario Go em um container.
- **Com mediasoup, toda a sinalizacao e trabalho seu**: negociar transporte,
  producers, consumers, renegociar quando alguem liga a camera. Sao centenas de
  linhas onde cada erro vira "a chamada caiu e nao sei por que".
- **Simulcast e camada adaptativa vem prontos** no LiveKit. Quem esta com
  internet ruim recebe uma qualidade menor sem afetar os outros — exatamente o
  que importa quando alguem transmite um jogo.

O que se perde: menos controle fino sobre o pipeline. Para dez pessoas em uma
call, isso nao aparece.

### 3. Por que nao ha Redis

A recomendacao padrao para um app de tempo real inclui Redis para presenca,
pub/sub entre processos e rate limit. Aqui o servidor e um processo so.

Com um processo:

- pub/sub entre processos nao tem entre quem;
- presenca em memoria e mais rapida e nao pode dessincronizar;
- rate limit em memoria e exato, sem ida e volta na rede.

Redis so acrescentaria uma peca para manter, monitorar e que pode cair.

Mas a porta ficou aberta: `src/bus.ts` define uma interface `Bus` com duas
implementacoes. Sem `REDIS_URL`, usa memoria. Com `REDIS_URL`, usa Redis
pub/sub. Nenhuma outra linha do sistema muda. Se um dia houver mais de uma
instancia, e uma variavel de ambiente.

---

## Como esta organizado

```
packages/
  shared/    tipos, protocolo, permissoes, validacao
  server/    API REST + gateway WebSocket + integracao com o SFU
  desktop/   Electron + React
```

### Por que um pacote compartilhado

Cliente e servidor precisam concordar sobre muita coisa: o formato de cada
evento, o significado de cada bit de permissao, o limite de cada campo. Quando
essas definicoes existem em dois lugares, elas divergem — e a divergencia
aparece como bug em producao, nao como erro de compilacao.

Com `@kiroshi/shared`, mudar o protocolo quebra a compilacao das duas pontas na
mesma hora.

O caso mais claro e o de permissoes. A funcao que decide se alguem pode falar
em um canal vive em `shared/permissions.ts`. O servidor a usa para autorizar; o
cliente, para decidir se mostra o botao. Sao a mesma funcao, com os mesmos 27
testes. Se fossem duas, mais cedo ou mais tarde o cliente mostraria um botao
que o servidor recusa.

> O cliente calcular permissoes e conveniencia de interface, nunca seguranca.
> Todo pedido e reavaliado no servidor. Esconder um botao evita frustracao;
> nao evita um cliente modificado.

### Permissoes

Bitfield de 64 bits em `BigInt`, resolvido na mesma ordem do Discord:

1. dono do servidor recebe tudo;
2. cargo everyone;
3. OR dos cargos do membro;
4. `ADMINISTRATOR` expande para tudo e ignora canais;
5. overwrite de canal para everyone (deny, depois allow);
6. overwrites dos cargos, agregados (todos os deny, depois todos os allow);
7. overwrite do proprio membro.

O passo 6 nao e obvio: os deny de **todos** os cargos sao aplicados antes de
qualquer allow. Sem isso, um cargo que nega escrita em um canal cancelaria um
cargo que permite, dependendo da ordem em que fossem processados — e a ordem
nao e estavel.

`BigInt` nao sobrevive a `JSON.stringify`. Permissoes trafegam como string
decimal, e `serialize`/`deserialize` cuidam da conversao em um lugar so.

### Ids

Snowflake: 42 bits de tempo, 5 de worker, 5 de processo, 12 de sequencia.

O que isso da de graca:

- **ordem cronologica sem coluna de data** — paginar e `WHERE id < ?`;
- **geracao sem coordenacao** — nao ha ida ao banco para pegar o proximo id;
- **momento de criacao dentro do id** — `timestampOf(id)`.

Duas armadilhas, ambas tratadas:

- Ordenar id como **string** da errado ("9" > "10"). Existe `compareIds`, e o
  teste que prova isso.
- Se o relogio voltar (NTP), um gerador ingenuo repete ids. O gerador daqui
  segura o ultimo timestamp conhecido ate o relogio alcancar.

### Gateway

WebSocket com `HELLO -> IDENTIFY -> READY -> eventos`, heartbeat, e retomada.

A retomada e o que faz diferenca no uso real. Um app de voz fica aberto o dia
inteiro: a maquina hiberna, o wifi troca de ponto, o tunel reinicia. Sem
retomada, cada evento desses recarregaria o estado inteiro e piscaria a
interface.

Cada sessao guarda um buffer dos ultimos 512 eventos. Ao reconectar, o cliente
manda `RESUME` com o ultimo numero de sequencia que viu e recebe so o que
perdeu. Se o buffer ja passou daquele ponto, o servidor responde
`INVALID_SESSION` e o cliente refaz do zero.

Dois eventos nunca entram no buffer: `VOICE_SERVER_UPDATE`, porque carrega um
token de vida curta que ja teria expirado, e `TYPING_START`, porque "fulano
estava digitando ha dois minutos" nao e informacao.

### Mensagens

**Exclusao e logica.** Uma resposta cita a mensagem original; se a original
sumisse da tabela, a resposta apontaria para o nada. A linha fica com
`deletedAt` e o serializador devolve conteudo vazio.

**Mencoes sao contadas no envio, nao na leitura.** Responder "quantas mensagens
novas me citam" varrendo o historico fica caro rapido. No envio, quem foi
citado tem um contador incrementado.

**Mencoes sao validadas contra a realidade.** Um `<@123>` digitado a mao, ou de
alguem que saiu do servidor, nao vira registro. Sem esse filtro o envio
quebrava com erro de chave estrangeira **depois** da mensagem ja ter sido
criada e distribuida — o remetente via "falhou" para algo que todos receberam.

**O fan-out nao pode derrubar o envio.** Quando a distribuicao comeca, a
mensagem ja existe e ja e visivel. Uma falha ali vira log, nao erro de
resposta: devolver 500 faria o cliente mostrar erro e reenviar, duplicando.

### Envio otimista

A mensagem aparece na hora, com id temporario e um `nonce`. O servidor devolve
o mesmo `nonce` no `MESSAGE_CREATE`, e o cliente troca a temporaria pela real.
Se o envio falhar, a temporaria some e o texto volta para a caixa — perder o
que a pessoa escreveu e pior que mostrar um erro.

---

## Decisoes do cliente

### Electron, e por que nao um site

Compartilhamento de tela precisa listar as janelas do sistema, e navegador nao
faz isso. Tambem: notificacao nativa, bandeja, atalho global, iniciar com o
computador. E foi o que foi pedido.

**Isolamento de contexto ligado**, `nodeIntegration` desligado. A interface nao
tem acesso a `node`; tudo passa por uma ponte com funcoes nomeadas no preload.
Se algo nao esta la, a interface nao consegue fazer.

**Por isso `process` nao existe no renderer** — e o codigo compartilhado
precisou levar isso em conta. Um `process.env` no escopo de modulo derrubava a
interface inteira na inicializacao.

### Captura de tela em duas etapas

O `getDisplayMedia` do Chromium abriria o seletor nativo, que nao combina com
a interface e nao permite escolher audio da janela. Entao: a interface mostra o
proprio seletor, avisa o processo principal qual fonte foi escolhida, e o
handler do `setDisplayMediaRequestHandler` responde com ela.

A qualidade e escolhida junto com a janela, nao nos ajustes, porque a escolha
depende do que se vai transmitir: jogo pede 60 fps, planilha pede resolucao.

### Push-to-talk

Duas camadas, porque nenhuma cobre tudo:

- **Janela em foco:** `keydown` e `keyup`, microfone aberto enquanto a tecla
  esta pressionada. E o comportamento correto.
- **Jogo em foco:** o sistema nao entrega `keyup` para atalho global. A mesma
  tecla passa a alternar o microfone.

A alternativa seria um modulo nativo de captura de teclado. Nao compensa o
custo de manutencao e de distribuicao para o ganho.

### Estado da interface

Zustand com tudo normalizado em `Map` por id. O gateway manda atualizacoes
pontuais; procurar dentro de listas aninhadas a cada evento sairia caro e
cheio de casos especiais.

**A armadilha:** o Zustand v5 compara o resultado do seletor com `Object.is`.
Um seletor que monta uma lista nova a cada chamada nunca devolve algo igual ao
anterior, entao o componente renderiza, o seletor roda de novo, cria outra
lista, e o React aborta com "maximum update depth exceeded".

Todos os seletores de lista passam por `useShallow`, e ficam agrupados em
hooks nomeados (`useGuildList`, `useChannelsOfGuild`) para que ninguem precise
lembrar disso ao adicionar o proximo.

### Ensurdecer

Nao e "mutar o alto-falante". Cada faixa remota e silenciada individualmente,
o que mantem o indicador de quem esta falando funcionando: a pessoa continua
vendo a conversa acontecer.

---

## Seguranca

| Area | Decisao |
|---|---|
| Senhas | Argon2id, 64 MiB, 3 passagens. ~60 ms por verificacao. |
| Usuario inexistente | Gasta o mesmo tempo de uma verificacao real, para nao revelar quem tem conta. |
| Token de acesso | JWT de 15 minutos. Nao consulta o banco no caminho feliz. |
| Token de renovacao | Opaco, 60 dias, guardado com SHA-256 e **rotacionado a cada uso**. Se alguem capturar um, ele morre no proximo refresh. |
| 2FA | TOTP com janela de um passo. SMS ficou de fora: depende de gateway pago e e vulneravel a troca de chip. |
| Codigos de recuperacao | Guardados com hash, como senha. Valem uma vez. |
| Preview de link | Resolve o DNS antes e recusa endereco privado, de loopback ou de link-local, inclusive apos redirecionamento. Sem isso, postar `http://192.168.0.1` faria o servidor sondar a rede interna. |
| Anexos | Nome no disco nunca vem do usuario. Servidos com `Content-Security-Policy: sandbox` e `nosniff`, para que um SVG enviado como anexo nao execute script. |
| Extensoes bloqueadas | `.exe`, `.bat`, `.dll` e companhia sao recusados no upload. |
| Operacoes sensiveis | Trocar senha, mexer no 2FA, apagar servidor confirmam a sessao no banco, nao so o JWT. |

---

## Limites conhecidos

**Sem IPv6, sem voz.** Ate ligar um relay. Foi decisao consciente: relay para
todos seria pior para quem tem IPv6, que e a maioria.

**Um processo so.** Se cair, todos caem. Com `restart: unless-stopped` a volta
e automatica, e `pruneExpiredInvites`/`clearStaleVoiceStates` limpam o que
ficou pela metade. Para dez pessoas, aceitavel.

**Busca com `LIKE`.** Funciona bem ate algumas centenas de milhares de
mensagens. Depois, o caminho e o indice de texto completo do Postgres — nao
um servico de busca separado.

**Sem entrega garantida de eventos.** Se a sessao expirar durante uma queda
longa, o cliente refaz o estado do zero em vez de receber o que perdeu. E o
comportamento certo: reconstruir e barato e nao acumula divida.

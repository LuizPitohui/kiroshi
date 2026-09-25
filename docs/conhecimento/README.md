# Base de conhecimento do Kiroshi

Tudo o que foi levantado no estudo completo de 2026-09-24 (codigo inteiro,
producao e referencias externas), para orientar a reescrita do front-end, a
estabilidade das transmissoes, a supressao de ruido e as funcionalidades novas.

Os documentos antigos de `docs/` (ARQUITETURA, DEPLOY, MANUAL,
SUPRESSAO-DE-RUIDO) continuam valendo para o *porque* das decisoes; onde o codigo
divergiu deles, esta base registra.

| Documento | Para que serve |
|---|---|
| [01-pedidos-e-backlog.md](01-pedidos-e-backlog.md) | **Comece aqui.** Os pedidos do dono em frentes de trabalho, com achados, propostas, decisoes e perguntas em aberto |
| [02-arquitetura.md](02-arquitetura.md) | Visao de ponta a ponta, convencoes, comandos, linha de base, testes e seus riscos |
| [03-servidor.md](03-servidor.md) | API, gateway, modelo de dados, conta, cargos e permissoes (bit a bit), convites, expressoes, voz no servidor |
| [04-midia.md](04-midia.md) | Voz, video e tela: cadeia de audio, camadas, recepcao, caminhos de rede em producao, hipoteses dos travamentos, chamada em DM |
| [05-front-end-atual.md](05-front-end-atual.md) | O front-end que vai ser substituido: o que reaproveitar, o que nao perder, o sistema visual atual |
| [06-auditoria-de-ajustes.md](06-auditoria-de-ajustes.md) | Cada ajuste do usuario e do servidor: funciona, parcial, decorativo ou quebrado — e o que fazer |
| [07-desktop-e-entrega.md](07-desktop-e-entrega.md) | Electron, empacotamento, atualizacao e o estudo do atualizador em segundo plano |
| [08-producao.md](08-producao.md) | Topologia, regras de ouro de deploy, estabilidade observada, comandos de diagnostico |
| [09-referencia-discord.md](09-referencia-discord.md) | Como o Discord resolve cada coisa que vamos construir (chamada em DM, cargos, convites, soundboard, notificacoes, conta) |
| [10-front-end-novo.md](10-front-end-novo.md) | **Design do front-end novo (aprovado, vermelho Arasaka)** — identidade, linguagem visual, telas, arquitetura, plano de entrega; com o [prototipo](prototipo/index.html) |

`privado/` (fora do git — o repositorio e publico): enderecos e dados brutos de
producao, a lista dos outros servicos do host e as pendencias de seguranca ainda
abertas.

## Painel (atualizado em 2026-09-25)

| Area | Estado |
|---|---|
| Versao publicada | 1.15.0 (2026-09-23) |
| Testes | 499 unitarios passando (shared 67, servidor 128, desktop 304); e2e 80/80; typecheck limpo |
| Conversa (texto) | funciona; sem autocompletar mencao; acoes da mensagem so no hover |
| Voz | funciona; ajustes de audio em boa parte sem efeito; PTT global quebrado |
| Transmissao de tela | **trava** — espectador recebe 360p15 ao lado do chat; caminho de rede instavel para quem usa relay; sem metricas |
| Supressao de ruido | DFN3 roda, soa mal; vai ser refeita |
| Chamada em DM | so no servidor, sem interface nem toque |
| Cargos | criar so o dono; **dar cargo nao existe na interface**; 3 permissoes sem efeito |
| Convites | codigo com validade/usos; sem link, sem lista na interface |
| Notificacoes | so DM e mencoes; sem ajustes; icone falta no app instalado |
| Iniciar com o Windows | quebrado |
| Atualizacao automatica | funciona, mas baixa 93 MiB inteiros por versao |
| Cadastro | so com convite (`ALLOW_OPEN_REGISTRATION=false`); criar com Google ja existe no servidor |
| Seguranca | servidor: 13 falhas corrigidas e publicadas (API `6f493df`); abertas: casca Electron e host (ver `privado/`) |
| Front-end novo | design aprovado (vermelho Arasaka); fatia 1 (fundacao + casca) no Kiroshi Beta |

## Como manter

- Cada documento diz no topo a data e a versao do levantamento. Ao mudar algo
  que ele descreve, atualizar o documento no mesmo commit.
- Achado de seguranca vai para `privado/seguranca.md` e so vira publico depois de
  corrigido e publicado.
- Referencia a codigo sempre como `arquivo:linha` a partir da raiz do pacote
  indicado no documento. Linhas envelhecem: conferir antes de confiar.
- Portugues sem acento, como o resto do repositorio.

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
| Versao publicada | **2.0.1** (2026-09-25): o som da transmissao sem o retorno da chamada. A 2.0.0 trouxe a interface nova para todos. Beta 1.16.x segue como canal de teste |
| Testes | 742 unitarios passando (shared 79, servidor 153, desktop 510); e2e 136/136; typecheck limpo |
| Conversa (texto) | autocompletar de mencao, canal e emoji; acoes por teclado; densidade confortavel e compacta |
| Voz | silenciar, ensurdecer e mover valem no SFU; soundboard toca na chamada (5 s no maximo); atalhos globais de verdade (falar segurando, mutar, ensurdecer) |
| Transmissao de tela | som do computador sem o do proprio Kiroshi (quem assiste nao ouve a propria voz de volta), sem tratamento de voz e em estereo (2.0.1); nunca abaixo de 720p para quem assiste, `<video>` sem recriar, pausa minimizado, qualidade medida no quadro. Telemetria enviada ao servidor e rede de quem usa relay: a fazer (F2) |
| Supressao de ruido | DFN3 roda, soa mal; vai ser refeita (F3, o proximo) |
| Chamada em DM | ligar e atender com toque, recusar, registro na conversa, desliga quem fica 3 min sozinho |
| Cargos | ajustes do servidor completos; dar cargo pelo perfil, pelo clique direito e nos ajustes; permissoes por canal em tres estados; 3 bits sem efeito ficam fora da tela |
| Convites | link `order.arasaka.fun/convite/<codigo>` com pagina no navegador, `kiroshi://` (registrado pelo instalador do Kiroshi), janela com validade e usos, envio pela DM, lista e revogacao |
| Notificacoes | nivel por servidor e canal, silenciar por tempo, Nao perturbe, clique abre a conversa, contador no icone |
| Iniciar com o Windows | consertado, liga na primeira abertura da 2.0.0 e abre escondido na bandeja |
| Atualizacao automatica | funciona, mas baixa 93 MiB inteiros por versao (F11) |
| Cadastro | aberto (decisao do dono, 2026-09-25): email e senha ou Google, sem convite; com o link de convite a conta ja nasce no servidor. Recuperacao so pelo Google vinculado. Protecoes: teto por IP e global, nomes reservados, teto de pedidos de amizade, DM so com vinculo |
| Seguranca | servidor: 13 falhas corrigidas e publicadas (API `6f493df`); abertas: casca Electron e host (ver `privado/`) |
| Front-end novo | as sete fatias do desenho prontas e publicadas para todos na 2.0.0; a 1.x fica no codigo como reserva de emergencia por algumas semanas |

## Como manter

- Cada documento diz no topo a data e a versao do levantamento. Ao mudar algo
  que ele descreve, atualizar o documento no mesmo commit.
- Achado de seguranca vai para `privado/seguranca.md` e so vira publico depois de
  corrigido e publicado.
- Referencia a codigo sempre como `arquivo:linha` a partir da raiz do pacote
  indicado no documento. Linhas envelhecem: conferir antes de confiar.
- Portugues sem acento, como o resto do repositorio.

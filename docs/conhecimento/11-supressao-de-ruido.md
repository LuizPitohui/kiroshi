# 11 — Supressao de ruido do zero (F3): estudo e plano

> Pedido do dono: "o que esta implementado esta horrivel". Processo exigido:
> **retirar a atual, estudar, plano comprovado, so entao implementar e testar**.
> Este documento e o estudo; o plano so vira codigo depois de o dono ler e
> aprovar. Estado em 2026-09-25: retirada feita (2.0.2), rodada 1 de medicoes
> feita, rodada 2 (com fala e ruido reais) esperando a gravacao do dono ou a
> permissao para baixar material publico (secao 7).

## 1. O que havia e por que soava mal

Ate a 2.0.1 o microfone passava por uma cascata DeepFilterNet3 -> GTCRN ->
navegador, com um portao por nivel no fim ([04-midia.md](04-midia.md#entrada-de-audio),
[../SUPRESSAO-DE-RUIDO.md](../SUPRESSAO-DE-RUIDO.md)). O que foi medido:

- **Voz de lata.** A "intensidade" ia direto para o limite de atenuacao do
  DFN3 em dB, e o padrao 100 era "sem limite": o modelo apagava tudo que
  julgava ruido, inclusive pedaco de voz. De 30 a 100 soava igual.
- **Portao seco.** Abre e fecha sem rampa, por nivel, e corta comeco e fim de
  palavra de quem fala baixo.
- **Reserva abafada.** O GTCRN trabalha a 16 kHz: tudo acima de 8 kHz some.
- **Falha calada.** Se o DFN3 nao carrega, o pacote repassa o som sem avisar
  (visto de novo nesta bancada, secao 4).
- **Supressao do navegador desligada** sempre que havia modelo, e o
  "isolamento de voz" tambem.

## 2. O que o Kiroshi precisa

| Requisito | Por que |
|---|---|
| Tirar **teclado e clique de mouse** | foi a reclamacao que motivou o DFN3; o supressor do navegador nao pega |
| Tirar ruido constante (ventilador, ar-condicionado) | o basico |
| **Voz natural, banda cheia** (48 kHz) | o Opus da chamada vai ate 20 kHz; voz abafada ou metalica e o problema de hoje |
| **Pouco processador** | quem fala esta com jogo aberto e as vezes transmitindo a tela (VP8 por software) |
| **Pouca latencia** (ate 40 ms somados) | conversa com atraso atrapalha jogo em equipe |
| **Nunca falhar calado** | a limpeza que "nao carregou" tem que aparecer e cair para a do navegador |
| Deteccao de voz melhor que nivel | o portao atual abre com teclado alto e corta quem fala baixo |

Fora do escopo: **eco** (som das caixas voltando pelo microfone) e cancelamento
de eco, que e outra etapa do processamento; e **outra pessoa falando** perto do
microfone, que nenhum supressor desta familia separa (a coluna "Conversa" da secao 5).

## 3. Candidatos

| Motor | Tipo | Taxa | Onde roda | Situacao |
|---|---|---|---|---|
| WebRTC NS (navegador) | classico, estima o piso de ruido | 48 kHz | dentro do Chromium, na captura | **o da 2.0.2** |
| Speex | classico | 48 kHz | WASM num AudioWorklet | ja na biblioteca do portao |
| RNNoise 0.1 | rede pequena (Xiph, 2018) | 48 kHz | WASM num AudioWorklet | ja na biblioteca do portao |
| RNNoise 0.2 | a mesma rede, modelo novo (2024) | 48 kHz | WASM pronto no pacote do Jitsi (`@jitsi/rnnoise-wasm` 0.2.1, versao sincrona para AudioWorklet) | nao testado ainda: precisa baixar |
| GTCRN | rede minuscula | **16 kHz** | WASM num AudioWorklet | o antigo motor reserva |
| DeepFilterNet3 | rede grande (2023) | 48 kHz | WASM num AudioWorklet | o antigo motor principal, agora medido com limite |
| `voiceIsolation` do Chromium | efeito do sistema | — | no Windows, **sem implementacao** encontrada na captura WASAPI do Chromium [I] | pedido pelo app, provavelmente sem efeito |
| Krisp, NVIDIA Broadcast | comerciais | — | SDK pago ou placa NVIDIA | fora: custo e dependencia |

## 4. Como foi medido (rodada 1)

**Bancada** ([ferramentas/banco-de-ruido](../../ferramentas/banco-de-ruido/README.md), fora do app): um Electron escondido
passa cada arquivo por cada motor. Os motores em AudioWorklet rodam num
`OfflineAudioContext` a 48 kHz, o mais rapido que o processador consegue, e o
tempo gasto dividido pela duracao do audio da a **fracao do tempo real** num
nucleo. O supressor do navegador nao roda fora do tempo real: entra pelo
**microfone falso do Chromium** (`--use-file-for-fake-audio-capture`), que toca o
arquivo como se fosse a captura, com o mesmo processamento do app.

**Material, sem baixar nada:** fala sintetica em portugues (a voz Maria do
proprio Windows, 50 s de frases de chamada de jogo, fala ativa a -26 dBFS) e
ruidos sinteticos: teclado mecanico (rajadas de teclas com o estalo, o corpo e a
volta), clique de mouse, ventilador (ruido rosa com zumbido) e conversa ao fundo
(outra voz, abafada). Cada ruido em duas relacoes sinal/ruido (15 e 5 dB, os dois
medidos so nos trechos ativos) e tambem sozinho.

**Metricas:**

| Metrica | O que diz | Bom |
|---|---|---|
| Reducao | quanto o motor abaixa o ruido SOZINHO | maior |
| STOI na mistura | inteligibilidade objetiva (0 a 1), comparada com a fala limpa | maior |
| STOI da fala limpa | o quanto o motor estraga voz SEM ruido | perto de 1 |
| Latencia | atraso do motor, por correlacao com a fala limpa | menor |
| Fracao do tempo real | processador num nucleo | menor |

**Dois tropecos da bancada que valem registro:** (1) a renderizacao offline e
muito mais rapida que o tempo real, e os motores terminam de subir o WASM de
forma assincrona — sem esperar, o arquivo inteiro saia mudo (RNNoise) ou sem
tratamento (DFN3); a bancada suspende a renderizacao ate eles ficarem prontos.
(2) Depois de ~40 instancias do DFN3 no mesmo processo, as seguintes falham e
**repassam o som caladas** — o mesmo defeito que o autoteste antigo existia para
pegar. A bancada agora marca toda saida igual a entrada.

## 5. Resultados da rodada 1

Material sintetico: vale para comparar os motores entre si, nao para decidir.
Para ouvir: [pagina de escuta da rodada 1](https://claude.ai/artifact/8ZCXwuzsCW6tFjkLQfG32n)
(privada, com o dono), com 8 s da mesma fala em cada motor. Para refazer as
medicoes: [ferramentas/banco-de-ruido](../../ferramentas/banco-de-ruido/README.md).

**Quanto cada motor abaixa o ruido sozinho** (dB, maior e melhor; SNR de 5 dB):

| Motor | Teclado | Mouse | Ventilador | Teclado + ventilador | Conversa |
|---|---|---|---|---|---|
| Navegador (a da 2.0.2) | 4,6 | 6,3 | 19,5 | 17,1 | 1,3 |
| Speex | 0,1 | 0,4 | 4,6 | 4,0 | 0,2 |
| RNNoise 0.1 | 1,1 | 0,3 | 44,0 | 15,4 | 0,3 |
| GTCRN (16 kHz) | 22,8 | 39,3 | 15,3 | 17,7 | 0,0 |
| DFN3 sem limite (o da 2.0.1) | 38,0 | 3,6 | 13,4 | 15,6 | 0,4 |
| DFN3 limite 20 dB | 19,9 | 3,5 | 11,6 | 13,2 | 0,4 |
| DFN3 limite 12 dB | 12,0 | 3,2 | 8,7 | 9,5 | 0,4 |

**O que sobra da voz** (STOI, 1 = intacta) e **quanto custa**:

| Motor | Fala limpa depois do motor | Fala com teclado alto (sem motor: 0,884) | Fala com ventilador alto (sem motor: 0,789) | Latencia | Processador |
|---|---|---|---|---|---|
| Navegador (a da 2.0.2) | 0,985 | 0,871 | 0,781 | na captura | dentro do Chromium |
| Speex | 0,999 | 0,884 | 0,824 | 3 ms | 0,5% |
| RNNoise 0.1 | 0,999 | 0,906 | 0,863 | 21 ms | 1,3% |
| GTCRN (16 kHz) | 0,996 | 0,964 | 0,866 | 32 ms | 4,5% |
| DFN3 sem limite | 0,884 | 0,806 | 0,888 | 41 ms | 7,5% |
| DFN3 limite 20 dB | 0,914 | 0,832 | 0,881 | 41 ms | 7,6% |
| DFN3 limite 12 dB | 0,948 | 0,858 | 0,864 | 41 ms | 7,8% |

Processador: fracao do tempo real num nucleo desta maquina (o autoteste antigo
dizia ~38% para o DFN3 porque contava a carga do modelo). A captura "sem
processamento" pelo microfone falso ficou de fora: sem o supressor, ele roda a
44,1 kHz e toca o arquivo de 48 kHz na velocidade errada.

**Leitura:**

- **A reclamacao original se confirma na 2.0.2:** o supressor do navegador tira
  bem o ventilador (19,5 dB) e deixa o teclado quase inteiro (4,6 dB).
- **O DFN3 sem limite e o que mais tira teclado e o que mais estraga a voz**
  (STOI 0,884 na fala limpa) — o mesmo "som de lata" que motivou a retirada. O
  limite funciona como prometido (20 dB de limite = ~20 dB tirados), mas nao
  resolve: com 12 dB a voz ainda perde (0,948) e o teclado ja passa. E o DFN3
  quase nao pega clique de mouse (3 a 8 dB).
- **O GTCRN tira teclado e mouse com forca e preserva a voz**, mas trabalha a 16
  kHz: tudo acima de 8 kHz some. A fala sintetica tem pouco acima disso, entao
  estas metricas nao mostram a perda; com voz real ela aparece (criterio 3).
- **O RNNoise 0.1 preserva a voz e e o melhor no ruido constante**, com quase
  nenhum processador, mas nao pega teclado.
- **Nenhum candidato passa em tudo.** A pergunta que decide e se o dano do DFN3
  e da voz sintetica (modelos treinados com voz humana se confundem com ela) ou
  dele mesmo — e se o RNNoise 0.2, bem mais novo que o 0.1 testado aqui, fecha o
  buraco do teclado. As duas respostas precisam de material real (secao 7).
- **Hipoteses para a rodada 2:** (a) DFN3 com limite moderado; (b) RNNoise 0.2;
  (c) combinacoes, como um motor para ruido constante mais um tratamento proprio
  para transientes (teclado e mouse), ou o ganho do GTCRN aplicado a banda
  cheia. Nenhuma vira codigo antes da rodada 2 e da aprovacao.

## 6. Criterio de aceitacao (proposto, antes de qualquer codigo)

A limpeza nova so entra se, na rodada 2 (fala e ruido reais), passar em tudo:

| # | Criterio | Como se mede |
|---|---|---|
| 1 | Teclado mecanico e clique de mouse abaixam **pelo menos 20 dB** | reducao no ruido sozinho, com o teclado de verdade |
| 2 | Ruido constante abaixa **pelo menos 12 dB** | idem, ventilador e ar-condicionado |
| 3 | A voz nao sai "de lata": **STOI da fala limpa >= 0,97** e nenhuma perda audivel acima de 8 kHz | STOI e energia de 8 a 16 kHz da fala limpa, antes e depois |
| 4 | Na escuta as cegas, o dono prefere a nova a limpeza do navegador | pagina de escuta com as faixas embaralhadas |
| 5 | **Processador <= 10% de um nucleo** nesta maquina (e o que acontece numa maquina fraca, dito antes) | fracao do tempo real na bancada e no app |
| 6 | **Latencia somada <= 40 ms** | correlacao na bancada |
| 7 | **Nunca falha calada**: sem o motor, cai para o navegador e a tela diz | teste com o motor quebrado de proposito |

## 7. O que falta e o que preciso do dono

**Rodada 2, com material real.** A rodada 1 usou voz sintetica, que engana modelos
treinados com voz humana, e teclado gerado por programa. Para decidir, preciso de
pelo menos uma das duas fontes:

1. **Gravacao do dono** (a melhor: o microfone e o teclado de verdade do grupo):
   uns 5 minutos no Gravador de Som do Windows — ler um texto, digitar, clicar e
   ficar em silencio. Fica so na maquina de testes, fora do repositorio.
2. **Material publico** (precisa de permissao para baixar, ~650 MB no total):
   - ESC-50, so as classes teclado, mouse e aspirador: ~50 MB de clipes de 5 s
     (github.com/karoldvl/ESC-50; licenca CC BY-NC, uso interno de teste);
   - uma voz de estudio a 48 kHz do EARS (Meta, CC BY-NC): ~565 MB;
   - o modelo DNSMOS P.835 da Microsoft (nota de qualidade por rede neural,
     usada nos desafios de supressao de ruido): 1,1 MB, mais `onnxruntime` e
     `numpy` para Python (~26 MB);
   - o RNNoise 0.2 (modelo novo, de 2024) no pacote `@jitsi/rnnoise-wasm`: ~2 MB.

Com isso a rodada 2 mede os mesmos candidatos (mais o RNNoise 0.2), gera a pagina
de escuta com voz real, e este documento vira o **plano**, com a recomendacao e o
custo de cada escolha, para o dono aprovar antes de o codigo comecar.

## Apendice: roteiro da gravacao do dono

Com o microfone e o teclado de sempre, no lugar de sempre, pelo **Gravador de
Som** do Windows. Quatro gravacoes, e depois dizer em que pasta ficaram:

1. **fala** (~60 s): ler o texto abaixo em voz normal, sem digitar.
2. **teclado** (30 s): digitar qualquer coisa, sem falar.
3. **mouse** (20 s): clicar como clica jogando, sem falar.
4. **silencio** (20 s): ficar quieto, com o computador ligado como sempre.

> Pessoal, tem um cara no telhado do lado esquerdo, perto da caixa d'agua.
> Espera, deixa eu recarregar antes de entrar. Alguem tem kit medico sobrando?
> Estou com pouca vida. Vou pela ponte, me cobre daqui a pouco. Boa, pegamos o
> objetivo! Agora segura a posicao que eles vao voltar. Cuidado com a granada,
> ela caiu bem do seu lado. Se a minha voz estiver picotando ou metalica, me
> avisa. Amanha a gente joga de novo, umas nove da noite, e dessa vez eu levo o
> sniper. Quem ficou com a chave do cofre? Eu achei que estava com o Marcos, mas
> ele saiu da partida faz tempo. Vamos com calma, sem pressa, um de cada vez.

As gravacoes ficam so na maquina de testes, fora do repositorio.

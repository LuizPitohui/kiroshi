# Supressao de ruido do Kiroshi

Como o Kiroshi tira teclado, ventilador e barulho de fundo do microfone antes
de a voz sair para a chamada, por que e feito assim, e o que fazer quando nao
funciona.

Para quem so usa o app, a parte que importa esta no [MANUAL](MANUAL.md#limpeza-de-ruido).
Este documento e para quem mexe no codigo, gera o instalador ou investiga uma
reclamacao de "estao ouvindo meu teclado".

---

## Resumo

- O microfone passa por uma **rede neural (DeepFilterNet3)** que separa voz de
  todo o resto, rodando localmente, no computador de quem fala.
- Em computador fraco demais, entra um **modelo mais leve (GTCRN)**. Se nenhum
  modelo rodar, volta para a **supressao do proprio navegador**. Falhar nunca
  significa microfone cru.
- No modo **por atividade de voz**, um **portao** fecha o microfone no silencio.
- Os arquivos do modelo vao **dentro do instalador**. Nada e baixado de fora
  durante o uso.
- A tela **Ajustes > Voz e video > Testar** mostra qual motor esta rodando de
  verdade, e o "Ouvir minha voz" toca exatamente o que os outros ouvem.

---

## Por que isto foi reescrito

Antes desta versao o Kiroshi dizia ter "limpeza reforcada com RNNoise", e as
pessoas continuavam ouvindo o teclado umas das outras. A investigacao achou
**quatro defeitos**, e o primeiro sozinho ja explicava tudo.

### 1. O modelo nunca rodou, em nenhuma maquina

O `LocalAudioTrack.setProcessor()` do LiveKit recusa trabalhar se a faixa nao
tiver um `AudioContext`:

```
Audio context needs to be set on LocalAudioTrack in order to enable processors
```

Quem entrega esse contexto a faixa e a **sala**, dentro de `publishTrack`. O
controlador aplicava o processador **antes** de publicar — de proposito, para
nao haver corte audivel no meio da chamada. Resultado: `setProcessor` lancava
sempre, o erro ia para um `console.warn`, e como a supressao do navegador ja
tinha sido **desligada** para "dar lugar ao modelo", o microfone saia **cru**.

Ou seja: com a "limpeza reforcada" ligada, o Kiroshi limpava *menos* do que
com ela desligada.

**Conserto:** `prepararFaixaParaProcessador()` em `src/voice/ruido.ts` entrega a
faixa um `AudioContext` suspenso, que so existe para passar nessa checagem.
Nossos processadores usam o proprio contexto, a 48 kHz. Ao publicar, a sala
troca o contexto pelo dela, como sempre fez.

### 2. Falha silenciosa, e a tela mentindo

A tela de ajustes mostrava "Limpeza reforcada (RNNoise): sim" olhando para o
**interruptor**, nao para o que estava rodando. Ninguem tinha como descobrir o
defeito 1.

**Conserto:** o estado de voz agora tem `limpeza.motor`, preenchido com o que a
cascata **conseguiu montar**. A tela mostra esse valor, e quando o motor
preferido fica de fora, mostra por que.

### 3. O modo "por voz" transmitia o tempo todo

O ajuste `voiceThreshold` era salvo mas nao era lido em lugar nenhum. Nao havia
portao: entre uma frase e outra, qualquer ruido que escapasse do modelo ia
junto.

**Conserto:** portao de ruido depois do modelo, com histerese e espera. O ajuste
virou `limiarDeVozDb`, em dB, com controle deslizante na tela.

### 4. Mudar ajustes no meio da chamada nao fazia nada

So a troca de microfone reabria a captura. Quem desligava e religava a limpeza
durante uma conversa para comparar ouvia exatamente a mesma coisa, e concluia
que ela nao existia.

**Conserto:** ajustes de captura reabrem o microfone; intensidade e sensibilidade
mudam ao vivo. Ver [Ajustes](#ajustes).

### E um quinto, achado durante a implementacao

O Vite embute como `data:` todo arquivo abaixo de 4 KB importado com `?url`. O
worklet do portao tem 1 KB, e a politica de seguranca nao aceita script
`data:`. No build de producao o portao falhava, o processador inteiro falhava
junto, e a cascata descartava o modelo. Em desenvolvimento nao aparece, porque
la os arquivos sao servidos por URL.

**Conserto:** `assetsInlineLimit` em `electron.vite.config.ts` nunca embute
worklets.

**A licao que fica:** cada um desses defeitos era invisivel de fora. Por isso a
implementacao nova mede o **resultado** (o autoteste abaixo) em vez de confiar
em "nao deu erro", e a tela mostra o que roda, nao o que foi pedido.

---

## Como funciona

### A cadeia

```
microfone
   │  getUserMedia (supressao do navegador DESLIGADA se houver modelo)
   ▼
MediaStreamSource ──▶ MODELO ──▶ [PORTAO] ──▶ MediaStreamDestination
                     48 kHz      so no modo       │
                     mono        por voz          ▼
                                            faixa processada
                                                  │  setProcessor (LiveKit)
                                                  ▼
                                            Opus ──▶ SFU ──▶ os outros
```

A limpeza acontece **antes do Opus**. Depois da compressao as amostras ja foram
descartadas e nao ha mais o que limpar.

Tudo roda a **48 kHz**. Os dois modelos foram treinados nessa taxa; em outra, o
resultado nao e "um pouco pior", e voz desafinada. Por isso cada processador
monta o proprio `AudioContext` em vez de usar o do LiveKit, cuja taxa depende
da placa de som.

### Os motores

| Motor | Quando | O que remove | Custo |
|---|---|---|---|
| **DeepFilterNet3** | Padrao, se passar no autoteste | Ruido constante, teclado, clique, voz ao fundo | Alto |
| **GTCRN** | Reserva: DFN3 reprovado ou sem os arquivos | Ruido constante e boa parte do transiente | Baixo |
| **Navegador** | Limpeza por IA desligada, ou nenhum modelo rodou | Ruido constante (ventilador, chiado). Teclado passa | Nenhum |
| **Nenhum** | Tudo desligado (perfil "Estudio") | Nada | Nenhum |

O **DeepFilterNet3** e uma rede de realce de voz de banda cheia (Schroter et
al., ICASSP 2022), compilada para WebAssembly e rodando num `AudioWorklet`. A
integracao usa o pacote `deepfilternet3-noise-filter`, fixado em **1.3.0**.

O **GTCRN** vem de `@sapphi-red/web-noise-suppressor`, a mesma biblioteca que o
projeto ja usava para o RNNoise. E bem mais leve que o DFN3 e, segundo os
autores, melhor que o RNNoise; por isso substituiu o RNNoise como reserva.

**Nunca dois supressores.** Com um modelo ativo, `noiseSuppression` e
`voiceIsolation` do navegador sao pedidos desligados. Os modelos foram
treinados com audio cru; alimentar um deles com a saida de outro supressor da
voz robotica. Cancelamento de eco e ganho automatico continuam como a pessoa
escolheu: eco nao e ruido (e o som da propria caixa voltando, que o modelo nao
distingue de voz), e ganho so nivela volume.

### A cascata

`src/voice/cadeia.ts`, em duas etapas, porque a captura fica no meio delas:

1. **`planejarLimpeza`** descobre quais modelos rodam nesta maquina. Precisa vir
   antes de abrir o microfone: se ha modelo, o supressor do navegador tem que
   ser pedido desligado na captura.
2. **`aplicarLimpeza`** tenta cada modelo, em ordem, na faixa aberta. O primeiro
   que pegar encerra a cascata.

Se **nenhum** modelo pegar, a cascata devolve `precisaReabrir: true`, e quem
chamou reabre o microfone com o supressor do navegador **ligado**
(`restartTrack` com `restricoesDeResgate`) e aplica a cascata de novo, sem
modelos, so para montar o portao. Esse caminho e coberto por um teste que
simula o LiveKit recusando todo processador, exatamente como acontecia em
producao.

A mesma cascata e usada pela chamada (`controller.ts`) e pelo **teste de
microfone** dos ajustes. Antes, o teste abria o microfone direto, e o que se
ouvia no "Ouvir minha voz" nunca tinha passado por modelo nenhum.

### O autoteste do DeepFilterNet3

O pacote tem um comportamento perigoso: se o modelo falhar dentro do worklet,
ele registra um erro no console do thread de audio e **passa a copiar a entrada
para a saida**, sem avisar ninguem. Um motor quebrado e um motor funcionando
sao indistinguiveis por fora.

Por isso, antes de oferecer o DFN3, `verificarDeepFilter()` em
`src/voice/ruido-dfn3.ts` roda o modelo de verdade:

1. Monta um `OfflineAudioContext` (renderiza o mais rapido possivel, sem tocar
   nada e sem microfone).
2. Passa **2 segundos de ruido branco** deterministico pelo modelo, com
   intensidade 60.
3. Mede, na **segunda metade** do audio (a primeira inclui a latencia do
   modelo, em que a saida e silencio por construcao):

| Medida | Aprova se | Pega o caso de |
|---|---|---|
| Reducao do ruido | Entre 10 e 70 dB | Modelo que so repassa o som (~0 dB) |
| | | Saida morta (silencio, microfone mudo) |
| Tempo gasto | Ate 60% do tempo real | Processador que picotaria a voz numa chamada de verdade |

De graca, o teste tambem pega tudo que impediria o motor de rodar: arquivos
ausentes, protocolo nao registrado, politica de seguranca bloqueando o worklet,
WASM incompativel com o pacote.

O resultado e medido **uma vez por execucao** do app, com o app ocioso logo
depois de abrir (`aquecerLimpeza()`), para a primeira entrada em chamada nao
esperar por ele. Para refazer, basta reabrir o app.

As constantes (`REDUCAO_MINIMA_DB`, `REDUCAO_MAXIMA_DB`,
`FRACAO_MAXIMA_DO_TEMPO_REAL`) estao em `src/voice/limpeza.ts`, com a
justificativa de cada valor. **O limite de tempo e uma heuristica**: ele foi
escolhido para deixar folga para jogo e transmissao de tela dividindo o
processador, nao medido numa frota de maquinas. Se muita gente com maquina boa
cair para o GTCRN, ele e o primeiro lugar para olhar.

### O portao

Existe so no modo **por atividade de voz**. No apertar-para-falar quem decide
quando o microfone abre e a tecla, e um portao so cortaria o comeco das frases
de quem fala baixo.

| Parametro | Valor | Por que |
|---|---|---|
| Limiar padrao | -45 dB | Depois do modelo, o ruido que sobra fica abaixo de -60 dB e voz normal entre -30 e -10 dB |
| Faixa do ajuste | -70 a -20 dB | |
| Histerese | fecha 6 dB abaixo de onde abre | Sem isso, voz perto do limite abre e fecha dezenas de vezes por segundo |
| Espera para fechar | 300 ms | Fim de palavra e mais baixo que o comeco; sem espera o portao come o final ("obrigad-") |

Sem modelo (limpeza desligada ou nenhum modelo rodou), o portao continua
existindo sobre um `GainNode` que so repassa (`ApenasPortao`). Sem isso,
desligar a limpeza por IA desligaria tambem, calado, a deteccao de voz.

---

## Ajustes

Guardados em `localStorage`, chave `kiroshi.voice`.

| Ajuste | Padrao | Muda | Observacao |
|---|---|---|---|
| `limpezaDeRuido` | `true` | Reabre o microfone | "Limpeza de ruido por IA". Mesmo nome da versao com RNNoise, para quem desligou continuar desligado |
| `intensidadeDaLimpeza` | `100` | **Ao vivo** | So o DFN3 usa. Ver abaixo |
| `limiarDeVozDb` | `-45` | **Ao vivo** | Substitui o `voiceThreshold`, que nunca era lido |
| `inputMode` | `voice-activity` | **Ao vivo** | Liga e desliga o portao |
| `noiseSuppression` | `true` | Reabre o microfone | Ignorado enquanto um modelo roda |
| `voiceIsolation` | `true` | Reabre o microfone | Ignorado enquanto um modelo roda |
| `echoCancellation` | `true` | Reabre o microfone | |
| `autoGainControl` | `true` | Reabre o microfone | |

**Reabrir o microfone** e inevitavel para os ajustes do navegador: eles sao
pedidos na captura. Causa um corte curto na voz para quem esta ouvindo. Os
ajustes **ao vivo** nao cortam nada.

**Intensidade** e o limite de atenuacao do DeepFilterNet3, em dB. `100` quer
dizer "sem limite": o modelo remove tudo que julgar ruido. Valores menores
misturam de volta uma parte do som original — a voz fica mais natural e o
fundo volta junto. O padrao e o maximo porque o problema que motivou tudo isto
foi teclado passando.

**Migracao:** o antigo `voiceThreshold` (0 a 1) fica esquecido no
`localStorage` de quem ja usava o app. Nao e lido nem convertido: nunca teve
efeito, entao ninguem tinha um valor que dependesse dele. O nome novo existe
para ele nao ser reinterpretado numa escala que nao e a dele.

### Perfis

Os tres perfis de entrada do Discord correspondem a combinacoes destes ajustes.
O Kiroshi ainda nao tem o seletor de perfil; quem quiser o equivalente monta
assim:

| Perfil | `limpezaDeRuido` | Navegador (supressao, isolamento, eco, ganho) | Resultado |
|---|---|---|---|
| Isolamento de voz | ligado | tanto faz (substituido) + eco e ganho ligados | DFN3 (ou GTCRN) |
| Estudio | desligado | tudo desligado | Som cru, motor "Nenhum" |
| Personalizado | a gosto | a gosto | O que a pessoa escolher |

---

## Os arquivos do modelo

### Onde moram

```
packages/desktop/resources/modelos/
├── manifesto.json                         ← vai para o git
└── dfn3/v3/                               ← NAO vai para o git
    ├── models/DeepFilterNet3_onnx.tar.gz  (~7,6 MB)
    └── pkg/df_bg.wasm                  (~15,7 MB)
```

O caminho `dfn3/v3/...` nao e escolha nossa: o pacote acrescenta
`v3/pkg/df_bg.wasm` e `v3/models/DeepFilterNet3_onnx.tar.gz` a URL base que
recebe.

No instalador, o `electron-builder.yml` copia a pasta para `resources/modelos`,
ao lado do `app.asar` e **fora** dele, para o modelo ser lido direto do disco.

Sao 24 MB em disco, mas **10 MB a mais no instalador** — o NSIS comprime.
Medido: 82,9 MB antes, 93,2 MB depois. Num servidor atras de tunel isso
importa: publicar uma versao nova sem podar a anterior enche a pasta de
download rapido.

### Por que um protocolo proprio

A interface le os arquivos por `kiroshi-modelos://dfn3/...`, um esquema
registrado em `electron/main.ts`. As alternativas nao serviam:

- **A CDN do pacote.** Por padrao ele baixa o modelo de um servidor de
  terceiros. O Kiroshi e auto-hospedado: a voz de ninguem vai depender de uma
  maquina que nao e nossa, nem avisar a ela toda vez que alguem entra numa
  chamada.
- **`file://`.** O Chromium recusa `fetch` nesse esquema, e e com `fetch` que o
  pacote le os arquivos.

O esquema e registrado com `supportFetchAPI`, `secure`, `standard` e
`corsEnabled` (a interface roda em `file://`, origem nula, e sem CORS liberado
o `fetch` dela seria bloqueado). O tratador so serve arquivos **dentro** da
pasta dos modelos: um `..` na URL devolve 403.

### `npm run modelos`

`packages/desktop/scripts/baixar-modelos.mjs`. Baixa o que falta e verifica
tudo.

```bash
npm run modelos                  # baixa o que falta e verifica
npm run modelos -- --verificar   # so verifica; falha se faltar algo
npm run modelos -- --tolerante   # como o padrao, mas sem rede nao falha
```

Ja esta ligado aos outros comandos:

| Comando | Roda | Se falhar |
|---|---|---|
| `npm run dev` | `--tolerante` | Avisa e segue; o app usa o GTCRN |
| `npm run dist:win`, `dist:dir` | `--verificar` | **Interrompe o build.** Instalador sem modelo nao sai |

**Tres verificacoes**, cada uma pegando um defeito diferente:

| Verificacao | Pega |
|---|---|
| **Hash SHA-256** contra o manifesto | Download corrompido, pagina de erro salva como binario, arquivo trocado na origem |
| **Estrutura do WASM**: exporta `df_create`, `df_process_frame`, `df_set_atten_lim`, `df_get_frame_length`, e todas as funcoes que ele importa existem no codigo de cola do pacote instalado | WASM de outra versao do pacote. O wasm-bindgen gera nomes com hash (`__wbg_..._344f42d3...`); com nomes diferentes o worklet falha calado e repassa o som cru |
| **Conteudo do modelo**: o `.tar.gz` abre e tem `enc.onnx`, `erb_dec.onnx`, `df_dec.onnx`, `config.ini` | Arquivo que nao e o modelo |

Os nomes esperados do WASM sao **lidos do pacote instalado**, nao escritos no
script. Assim a verificacao acompanha o pacote.

### De onde vem cada arquivo

| Arquivo | Origem | Hash |
|---|---|---|
| Modelo | Repositorio do autor (`Rikorose/DeepFilterNet`), **fixado por commit** | Registrado no manifesto |
| WASM | CDN do pacote, caminho `v3/` | **Registrado na primeira execucao** |

O WASM precisa vir de la porque tem que casar byte a byte com o codigo de cola
embutido no pacote 1.3.0, e o pacote nao publica o WASM no npm. Ele e baixado
**uma vez, na maquina de quem gera o instalador**, e nunca durante o uso.

**Primeira execucao:** o hash do WASM comeca `null` no manifesto. O script
baixa, passa pela verificacao estrutural, calcula o hash e **escreve no
manifesto**. Faca commit do `manifesto.json` nessa hora. Dali em diante,
qualquer diferenca e erro. Quem quiser eliminar a confianca na primeira
execucao pode compilar o WASM do codigo-fonte (instrucoes no README do pacote)
e comparar.

---

## Seguranca

| Ponto | Decisao |
|---|---|
| Dados de audio | Processados localmente. Nenhum audio sai do computador antes do Opus, e nenhum servico externo participa |
| Rede durante o uso | Nenhuma. O modelo vem do instalador, pelo protocolo local |
| `blob:` em `script-src` | O pacote carrega o worklet por URL blob e nao oferece outro jeito. Uma URL blob so pode ser criada por codigo que ja esta rodando na pagina, que ja poderia fazer o que quisesse. Nao libera nenhuma origem de fora |
| `kiroshi-modelos:` em `connect-src` | So a leitura dos arquivos do modelo |
| `wasm-unsafe-eval` | Ja existia para o RNNoise. Libera compilar WebAssembly, e so isso: `eval()` continua bloqueado |
| Tratador do protocolo | So le dentro de `resources/modelos`. Caminho fora da pasta devolve 403 |
| Integridade dos arquivos | Hash e estrutura verificados antes de entrarem no instalador |

---

## Mapa do codigo

Tudo em `packages/desktop/`.

| Arquivo | Responsabilidade |
|---|---|
| `src/voice/limpeza.ts` | **Decisoes**, em funcoes puras: ordem dos motores, restricoes do navegador, portao, o que reabre o microfone, avaliacao do autoteste. Testavel sem audio |
| `src/voice/limpeza.test.ts` | Testes das decisoes e **simulacao da cascata** com o LiveKit recusando processador |
| `src/voice/cadeia.ts` | **Cascata**: planejar, aplicar, resgatar. Usada pela chamada e pelo teste de microfone |
| `src/voice/ruido.ts` | Base comum dos processadores (contexto, portao, saida), **GTCRN**, `ApenasPortao`, e o conserto do `AudioContext` do LiveKit |
| `src/voice/ruido-dfn3.ts` | **DeepFilterNet3** e o autoteste |
| `src/voice/controller.ts` | `publishMicrophone` usa a cascata; `updateSettings` reabre ou ajusta ao vivo; estado `limpeza` |
| `src/screens/SettingsScreen.tsx` | Teste de microfone pela cascata, controles de intensidade e sensibilidade, `LimpezaAtiva` |
| `src/index.html` | Politica de seguranca |
| `electron/main.ts` | Protocolo `kiroshi-modelos://` |
| `electron.vite.config.ts` | Worklets nunca embutidos como `data:` |
| `electron-builder.yml` | `extraResources` com os modelos |
| `scripts/baixar-modelos.mjs` | Baixa e verifica |
| `resources/modelos/manifesto.json` | Origem e hash de cada arquivo |

---

## Diagnostico

### Na tela

**Ajustes > Voz e video > Testar microfone.** Abaixo da barra aparece:

```
Limpando agora: DeepFilterNet3
nao precisa · Isolamento de voz   nao precisa · Supressao de ruido
sim · Cancelamento de eco   sim · Ganho automatico   sim · Portao de voz
```

Se o motor nao for o DeepFilterNet3, um "Por que nao esta usando o
DeepFilterNet3?" abre a lista de motivos, em texto que da para copiar.

Ligue **Ouvir minha voz** (com fone) e digite: o que se ouve e o que os outros
ouvem, depois do modelo e do portao.

### No console

Com o DevTools aberto (em desenvolvimento, `http://localhost:9222`), tudo da
limpeza comeca com `[limpeza]`:

```
[limpeza] DeepFilterNet3 aprovado: 38.2 dB de reducao, 21% do tempo real
[limpeza] DeepFilterNet3 reprovado: <motivo>
[limpeza] motor em uso: gtcrn [...falhas]
[limpeza] nenhum modelo pegou; voltando para o navegador [...falhas]
```

### Sintomas

| Sintoma | Causa provavel | O que fazer |
|---|---|---|
| Motor "GTCRN", motivo *nao consegui carregar os arquivos do modelo* | Instalador gerado sem `npm run modelos`, ou pasta `resources/modelos` ausente | Rodar `npm run modelos` e gerar de novo. O `dist:win` ja impede isso; aparece em builds feitos por fora dele |
| Motivo *esta so repassando o som* | WASM incompativel com o pacote | `npm run modelos -- --verificar` aponta; ver [Atualizando](#atualizando-o-deepfilternet3) |
| Motivo *processador lento demais* | Maquina fraca, ou ocupada no momento em que o app abriu | Normal em maquina fraca. Se for maquina boa, reabrir o app com menos coisa rodando refaz o teste |
| Motivo *Refused to...* / *Content Security Policy* | Alguem mexeu na politica em `index.html` | Conferir `blob:` em `script-src` e `kiroshi-modelos:` em `connect-src` |
| Motor "Navegador" com a limpeza por IA ligada | Nenhum modelo rodou; as falhas dizem por que | Ler a lista de motivos |
| Corta o comeco ou o fim das frases | Portao alto demais | Arrastar a sensibilidade para a esquerda |
| Ruido abre o microfone | Portao baixo demais | Arrastar para a direita |
| Voz soa artificial, "debaixo d'agua" | Intensidade alta demais para aquele microfone ou ambiente | Baixar a intensidade para 60–80 |
| Voz picotando so com o DFN3 | Processador no limite durante a chamada (jogo, transmissao) | Baixar a qualidade da transmissao; o autoteste pode ter aprovado com a maquina ociosa |
| Eco da propria voz | Caixa de som, e cancelamento de eco desligado | Religar o cancelamento de eco. O modelo nao remove eco |

---

## Testes

### Automatizados

```bash
npm run test -w @kiroshi/desktop
```

`limpeza.test.ts` cobre as decisoes (ordem dos motores, restricoes, portao,
limites, o que reabre o microfone, a avaliacao do autoteste) e **simula a
cascata** com o LiveKit recusando todo processador, garantindo que o
resultado e sempre o supressor do navegador religado, nunca microfone cru.

As bibliotecas de audio sao substituidas por cascas vazias com `vi.mock`: elas
definem classes com `extends AudioWorkletNode` ao serem importadas, e o Node
nao tem `AudioWorkletNode`. O que roda audio de verdade (o autoteste, os
worklets) so e testavel num Chromium, e fica para o roteiro abaixo.

### Roteiro manual

**Sempre no app instalado**, nao so no `npm run dev`: um dos cinco defeitos
desta historia (o worklet embutido como `data:`) so aparecia no build de
producao.

1. `npm run dist:win` e instalar.
2. **Ajustes > Voz e video > Testar microfone.** Conferir *Limpando agora:
   DeepFilterNet3*.
3. Ligar **Ouvir minha voz** com fone. Digitar forte, sem falar: nao deve
   passar nada, e a barra deve ficar parada.
4. Falar e digitar ao mesmo tempo: a voz passa, o teclado nao (ou quase nada).
5. Arrastar a intensidade para 0: o teclado volta. Para 100: some. Sem cortes
   no retorno ao arrastar.
6. Arrastar a sensibilidade: o ponto em que o portao abre muda, sem cortes.
7. Entrar numa chamada com outra pessoa e repetir 3 e 4 do lado de la.
8. Durante a chamada, desligar a limpeza por IA: o teclado deve voltar para o
   outro lado (e a limpeza do navegador assume). Religar: some de novo.
9. Apertar para falar: a linha *Portao de voz* passa a *NAO*.

**Reserva:** para ver a cascata caindo, renomear
`resources/modelos/dfn3` na pasta de instalacao e reabrir o app. O motor deve
virar *GTCRN (reserva)*, com o motivo na lista.

---

## Atualizando o DeepFilterNet3

O pacote esta fixado em `1.3.0` **de proposito**. O WASM e o codigo de cola
embutido no pacote sao gerados juntos; uma versao nova quase sempre muda os
nomes com hash e exige o WASM correspondente.

1. Ler o changelog do pacote. Conferir em especial se o caminho dos arquivos
   mudou (hoje `v3/`; o pacote ja mudou de `v2/` para `v3/` antes). Se mudou,
   atualizar `caminho` e `origem` no manifesto.
2. `npm install deepfilternet3-noise-filter@<versao> --save-exact -w @kiroshi/desktop`
3. No `manifesto.json`: atualizar `pacote.versao` e colocar `"sha256": null` no
   WASM.
4. Apagar `resources/modelos/dfn3/<pasta antiga>`.
5. `npm run modelos`. Ele baixa o WASM novo, confere contra o codigo de cola da
   versao instalada e registra o hash.
6. Conferir se a API usada em `ruido-dfn3.ts` (`DeepFilterNet3Core`,
   `initialize`, `createAudioWorkletNode`, `setSuppressionLevel`, `destroy`,
   `assetConfig.cdnUrl`) continua igual, e se o pacote ainda carrega o worklet
   por URL `blob:` (se passou a usar outra coisa, a politica de seguranca pode
   precisar mudar).
7. `npm run typecheck && npm run test`, e o roteiro manual inteiro.
8. Commit do `package.json`, do `package-lock.json` e do `manifesto.json`
   **juntos**.

O **modelo** (`.tar.gz`) raramente muda. Se mudar, o hash novo tem que ser
conferido contra o repositorio do autor antes de ir para o manifesto.

---

## Limites conhecidos

**Latencia.** O DFN3 processa em quadros de 10 ms e olha um pouco a frente,
somando algumas dezenas de milissegundos ao caminho da voz. Nao foi medido
neste projeto; numa chamada de voz nao se percebe, mas existe.

**Processador.** O DFN3 roda no thread de audio de quem fala. O autoteste mede
com a maquina ociosa; com jogo e transmissao de tela ao mesmo tempo, uma
maquina aprovada no limite pode picotar. Nao ha, hoje, troca automatica para o
GTCRN no meio da chamada.

**Eco nao e ruido.** O modelo nao remove o som da propria caixa voltando pelo
microfone. Isso continua sendo trabalho do cancelamento de eco do navegador.

**GTCRN sem intensidade.** O controle so vale para o DFN3.

**Autoteste uma vez por execucao.** Resolver o problema (rodar `npm run
modelos`, fechar programas pesados) so vale depois de reabrir o app.

**Interface no navegador comum.** `vite.web.config.ts` abre a interface num
navegador para inspecionar layout. La o protocolo `kiroshi-modelos://` nao
existe, o autoteste reprova e a limpeza cai para o GTCRN. Esperado: a versao de
navegador nao e o produto.

**URL blob nao revogada.** O pacote cria uma URL blob para o worklet a cada
contexto e nao a revoga. Sao alguns KB por entrada em chamada, liberados ao
fechar o app.

**Confianca na primeira execucao.** O hash do WASM e registrado no primeiro
download, nao conferido contra uma fonte independente. Ver
[De onde vem cada arquivo](#de-onde-vem-cada-arquivo).

---

## Licencas e creditos

| Componente | Licenca | Autor |
|---|---|---|
| DeepFilterNet (modelo e libDF) | MIT ou Apache-2.0 | Hendrik Schroter |
| `deepfilternet3-noise-filter` | MIT ou Apache-2.0 | phuvinh010701 |
| `@sapphi-red/web-noise-suppressor` (integracao do GTCRN, portao) | MIT | sapphi-red |
| GTCRN (modelo original) | ver o repositorio `Xiaobin-Rong/gtcrn` | Xiaobin Rong et al. |

Artigo do modelo: Schroter, H., Rosenkranz, T., Escalante-B., A.N., & Maier, A.
(2022). *DeepFilterNet: A Low Complexity Speech Enhancement Framework for
Full-Band Audio based on Deep Filtering.* ICASSP 2022, 7407–7411.

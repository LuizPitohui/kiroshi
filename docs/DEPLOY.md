# Deploy do Kiroshi

Como o Kiroshi vai para o ar no servidor `arasaka`, e o que fazer quando algo
sai do lugar.

---

## O caminho da rede, e por que ele e assim

O servidor esta atras de CGNAT: o IPv4 publico e compartilhado com outros
assinantes e o roteador nao encaminha portas. Testado, nao suposto — a porta
7777 do Terraria, que esta aberta na maquina, nao responde de fora.

Mas a maquina tem **IPv6 publico alcancavel**. Isso foi confirmado subindo um
listener e pedindo a um servico externo (em outra rede, outro continente) que
se conectasse a ele. A conexao chegou.

Disso sai a divisao:

```
  Cliente                      Internet                     arasaka
  -------                      --------                     -------

  API + gateway     -->  Cloudflare Tunnel (HTTPS/WSS)  -->  127.0.0.1:4000
  (login, mensagens)          sai do servidor para fora

  Voz e video       -->  IPv6 direto (UDP)              -->  [2804:...]:7881
  (audio, camera, tela)       conexao direta, sem intermediario
```

Duas razoes para a midia nao passar pelo tunel:

1. **Nao daria.** O Cloudflare Tunnel transporta HTTP e WebSocket. WebRTC usa
   UDP, que ele nao carrega.
2. **Nao deveria.** Mesmo se desse, colocar um intermediario no meio de uma
   conversa em tempo real so adiciona atraso. O caminho direto e melhor.

### Quem nao tem IPv6

A maioria das operadoras de fibra no Brasil entrega IPv6 por padrao. Quem
estiver em uma rede sem IPv6 (4G antigo, rede corporativa) nao vai conseguir
fechar a chamada pelo caminho direto.

A saida e um relay TURN, configurado em `TURN_SERVERS` no `.env`. Fica
desligado por padrao, porque adiciona latencia para todo mundo e so faz falta
para quem precisa. Veja "Ligando o relay" mais abaixo.

---

## Primeiro deploy

### 1. Banco

O Postgres do servidor ja existe e e compartilhado. O Kiroshi usa dois bancos
proprios dentro dele, com um usuario dedicado:

```sql
CREATE ROLE kiroshi_app LOGIN PASSWORD '<senha forte>';
CREATE DATABASE kiroshi_db  OWNER kiroshi_app;  -- producao
CREATE DATABASE kiroshi_dev OWNER kiroshi_app;  -- desenvolvimento
```

Dois bancos separados de proposito: sem isso, um teste local apagaria as
conversas de verdade.

O `kiroshi_app` nao tem permissao para criar bancos. E intencional: o app nunca
precisa disso, e limitar o que ele pode fazer limita o estrago se a senha
vazar. Como consequencia, o `prisma migrate dev` nao funciona (ele quer criar
um banco sombra); a migracao e gerada com `prisma migrate diff`.

### 2. Configuracao

```bash
cp deploy/.env.production.example deploy/.env.production
```

Preencha. Para cada segredo:

```bash
openssl rand -base64 48
```

### 3. Subir

```bash
./deploy/scripts/deploy.sh arasaka
```

O script descobre o IPv6 da maquina, envia o codigo, monta a configuracao do
SFU com os valores reais, constroi a imagem e sobe. Rodar de novo e seguro: os
segredos sao preservados e o banco so recebe migracoes.

### 4. Rotas no Cloudflare

Esta parte e no painel, porque o tunel e gerenciado por token — nao ha arquivo
de configuracao no servidor para editar.

Em **Cloudflare Zero Trust > Networks > Tunnels**, abra o tunel do arasaka,
aba **Public Hostnames**, e adicione dois:

| Subdomain | Domain      | Service                 |
|-----------|-------------|-------------------------|
| `order`   | arasaka.fun | `HTTP://localhost:4000` |
| `voz`     | arasaka.fun | `HTTP://localhost:7880` |

Em cada um, abra **Additional application settings > HTTP Settings** e deixe
**Disable Chunked Encoding** desligado. O WebSocket do gateway e a
sinalizacao do SFU precisam de conexao contínua.

> **Nao coloque Cloudflare Access na frente destes dois hostnames.** O Access
> exige login pelo navegador, e o app desktop nao tem como passar por essa
> tela. O `terminal.arasaka.fun` usa Access e continua assim; estes dois nao
> devem usar.

Confira:

```bash
curl https://order.arasaka.fun/api/info
curl https://voz.arasaka.fun/
```

O primeiro devolve um JSON com o nome do servidor; o segundo, `OK`.

---

## Criando as contas

O cadastro e fechado (`ALLOW_OPEN_REGISTRATION=false`): so entra quem tem
convite. Para um grupo de amigos isso evita que o servidor vire alvo de
cadastro automatizado.

A primeira conta precisa ser criada com o cadastro aberto por um instante:

```bash
ssh arasaka
cd ~/kiroshi/deploy
sed -i 's/ALLOW_OPEN_REGISTRATION=false/ALLOW_OPEN_REGISTRATION=true/' .env
docker compose up -d --force-recreate api
```

Crie sua conta pelo app, crie o servidor, e feche de novo:

```bash
sed -i 's/ALLOW_OPEN_REGISTRATION=true/ALLOW_OPEN_REGISTRATION=false/' .env
docker compose up -d --force-recreate api
```

Dali em diante ninguem mais precisa mexer no `.env`: as outras contas entram
por convite, como explicado logo abaixo.

---

## Convidando alguem

Nao ha painel web de administracao, de proposito: seria mais superficie
exposta para dez pessoas que se conhecem. O que precisa existir fica em um
comando, alcancavel so por quem ja tem o servidor na mao.

```bash
ssh arasaka
cd ~/kiroshi/deploy
docker compose exec api node packages/server/dist/admin.js convite
```

Sai um codigo de oito caracteres. A pessoa baixa o app em
`https://order.arasaka.fun/baixar`, instala,
clica em **Criar uma** na tela de entrada e usa esse codigo — ele cria a conta
e ja coloca no servidor, de uma vez.

O padrao vale para uma pessoa e sete dias. Para um mutirao:

```bash
# dez pessoas, trinta dias
docker compose exec api node packages/server/dist/admin.js convite --usos 10 --dias 30
```

Os outros comandos:

| Comando | O que faz |
|---|---|
| `contas` | quem tem conta, desde quando, quem usa 2FA |
| `servidores` | os servidores, donos e tamanho |
| `convites` | os codigos ativos e quanto ja foram usados |
| `revogar <codigo>` | mata um convite antes da hora |
| `remover <usuario>` | apaga uma conta; pede `--confirmar` |

> `remover` apaga tambem tudo que a pessoa escreveu, por cascata no banco — as
> conversas de quem ficou perdem pedacos. Para so tirar alguem do servidor,
> remova pelo app, que preserva o historico.


---

## Distribuindo o instalador

O executavel tem 82 MB, acima do limite de praticamente todo chat. Em vez de
servico de transferencia com link que expira, o proprio servidor publica:

```
https://order.arasaka.fun/baixar          o arquivo
https://order.arasaka.fun/baixar/versao   qual versao esta la, sem baixar
```

O endereco e fixo. Publicar uma versao nova e so rodar o deploy com o
instalador pronto em `packages/desktop/release/` — ele envia, remove a antiga,
e o mesmo link passa a entregar a nova. Quem ja tem o link nao precisa de um
novo.

O envio so acontece quando o arquivo mudou (compara o tamanho), entao um deploy
de codigo nao carrega 82 MB a toa.

Para publicar sem esperar um deploy inteiro:

```bash
scp packages/desktop/release/Kiroshi-Setup-*.exe \
    arasaka:~/kiroshi/deploy/downloads/
```

A rota le a pasta a cada pedido, entao vale na hora, sem reiniciar nada.

## Operacao

```bash
ssh arasaka
cd ~/kiroshi/deploy

docker compose ps                    # o que esta rodando
docker compose logs -f api           # acompanhar a API
docker compose logs -f livekit       # acompanhar a voz
docker compose restart api           # reiniciar so a API
docker compose down && docker compose up -d
```

### Backup

O que importa esta em dois lugares: o banco e os anexos.

```bash
# Banco
docker exec postgres-global pg_dump -U kiroshi_app kiroshi_db | gzip > kiroshi-$(date +%F).sql.gz

# Anexos
docker run --rm -v kiroshi_kiroshi-uploads:/data -v $PWD:/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

### Restaurar

```bash
gunzip -c kiroshi-2026-01-15.sql.gz | docker exec -i postgres-global psql -U kiroshi_app kiroshi_db
```

---

## Ligando o relay (quando alguem nao conecta na voz)

Sinal de que e isso: a pessoa entra no canal, aparece na lista, e ninguem ouve
ninguem. O chat funciona normalmente, porque ele passa pelo tunel e nao pelo
caminho da midia.

**Confirme antes de mexer.** No app da pessoa: **Ajustes > Voz e video >
Diagnostico > Verificar conexao**. Funciona mesmo fora de chamada e a primeira
linha responde direto se ha IPv6. Sem IPv6, e isso mesmo.

Nos registros do servidor o sintoma aparece como varias sessoes RTC seguidas
para o mesmo participante, todas encerradas pelo cliente:

```bash
docker compose logs livekit | grep <id-do-usuario> | grep -c "starting RTC session"
```

Meia duzia de tentativas em poucos minutos e ICE que nao fecha, nao alguem
entrando e saindo.

### Por que as solucoes obvias nao servem

**coturn no proprio servidor** precisaria de porta IPv4 aberta, e o IPv4 daqui
e CGNAT. Em IPv6 ele funcionaria, mas quem precisa de relay e justamente quem
nao tem IPv6 — um relay so alcancavel por IPv6 nao ajuda ninguem.

**playit.gg**, que ja roda nesta maquina, faz encaminhamento de porta e nao
fala o protocolo TURN. Um endereco dele em `TURN_SERVERS` nao funciona: o
cliente espera um servidor TURN de verdade do outro lado, com autenticacao e
alocacao de relay, nao um socket UDP repassado.

### O que serve: Cloudflare Realtime

TURN gerenciado, sem porta aberta e sem servico novo para manter. **Nao e
gratuito no nosso caso**: a Cloudflare so isenta quem usa o SFU dela tambem, e
aqui o SFU e o LiveKit proprio. Custa US$ 0,05 por GB que sai do relay para o
cliente.

Na pratica isso e pouco, porque so quem precisa usa o relay — o ICE sempre
prefere o caminho direto. Ordem de grandeza: tres horas de conversa so em voz
dao alguns centavos; tres horas assistindo uma tela em 1080p, uns vinte
centavos.

A chave **nao serve como credencial**. Ela e um segredo longo que fica no
servidor e permite emitir credenciais curtas, uma por sessao — o codigo ja faz
isso em `packages/server/src/services/turn.ts`. Mandar a chave ao cliente seria
o oposto: um segredo fixo na mao de todo mundo, sem como revogar.

1. No painel da Cloudflare: **Realtime > TURN Server > Create**.
2. Copie o **Turn Token ID** e o **API Token**.
3. No servidor:

```bash
ssh arasaka       # ou: ssh pitohui@192.168.100.21 pela rede local
cd ~/kiroshi/deploy
nano .env
```

Acrescente as duas linhas:

```
CLOUDFLARE_TURN_KEY_ID=<turn-token-id>
CLOUDFLARE_TURN_API_TOKEN=<api-token>
```

```bash
docker compose up -d --force-recreate api
```

Confira que chegou ao cliente:

```bash
docker compose exec api node -e "
const { montarIceServers } = require('/app/packages/server/dist/services/turn.js');
montarIceServers().then(r => console.log(JSON.stringify(r, null, 2)));
"
```

Deve sair uma lista com `turn:turn.cloudflare.com` e um par usuario/senha
aleatorio. Lista vazia significa que a chave nao foi aceita — veja
`docker compose logs --tail 20 api`.

Falha com a Cloudflare **nao derruba a chamada**: quem tem IPv6 conecta direto
de qualquer jeito, entao o erro vira aviso no log e a voz segue sem relay.


### Por que o relay sozinho nao resolveu aqui

Medido, nao suposto. Com `FORCE_TURN_RELAY=true` e credenciais validas da
Cloudflare, a chamada nao fecha. Os pares de candidatos que o SFU registrou:

```
local:  192.168.100.21:7881   udp  type(host)     <- IPv4 PRIVADO
remote: 104.30.1xx.xxx:...    udp  type(relay)    <- relay da Cloudflare
state:  failed                                     (todos)
```

O SFU esta atras de CGNAT e nao tem IPv4 publico alcancavel, entao anuncia o
endereco da rede local. O cliente pede ao TURN permissao para `192.168.100.21`,
mas os pacotes do servidor chegam la com o IP publico do CGNAT — origem sem
permissao, descartada.

Tentamos fazer o LiveKit anunciar o IPv4 publico com `use_external_ip: true`.
Ele **descobre** o endereco por STUN e depois **descarta**:

```
found external IP via STUN   externalIP: 189.12.33.106
could not validate external IP   error: context canceled
```

A validacao dele consiste em receber um pacote de volta naquele endereco, o que
exige entrada — exatamente o que o CGNAT bloqueia. E `--node-ip` aceita um
endereco so, entao nao da para anunciar IPv6 e IPv4 publico ao mesmo tempo.

Conclusao: **relay no lado do cliente nao basta enquanto o servidor nao tiver
IPv4 publico**. As duas pontas precisam de um endereco que a outra alcance.

O que resolve, em ordem de esforco:

1. **A pessoa habilitar IPv6 na propria internet.** A maioria dos provedores
   grandes ja entrega; as vezes esta so desligado no roteador. Resolve o caso
   individual sem mexer em nada aqui.
2. **Pedir IPv4 publico ao provedor do servidor** (sair do CGNAT). Costuma ser
   pedido por telefone ou chat, sem custo. Resolve para todo mundo de uma vez,
   e ainda dispensa o relay.
3. **Um retransmissor com IPv4 publico proprio** (VPS pequena rodando coturn,
   ou tunel UDP). Mais trabalho e custo mensal.

A configuracao de TURN fica no lugar: nao custa nada enquanto ninguem usa o
relay, e passa a servir no dia em que o item 2 acontecer.

### O caminho pela rede virtual (Tailscale)

Quando alguem nao tem IPv6 e nao da para esperar pelo provedor, a saida e
colocar essa pessoa na mesma rede virtual do servidor. O SFU ja anuncia os
dois enderecos ao mesmo tempo, entao **so quem precisa instala** — quem tem
IPv6 continua indo direto e nem encosta na VPN.

O servidor ja roda o Tailscale em container (`docker ps | grep tailscale`),
com estado em `/home/pitohui/tailscale/state` e `restart: unless-stopped`.

**Do lado de quem precisa:**

1. Instalar o Tailscale ([tailscale.com/download](https://tailscale.com/download)).
2. Entrar com a conta que voce convidar, pelo painel do Tailscale.
3. Pronto. Nada muda dentro do Kiroshi.

**Do lado do servidor**, ja esta feito: `interfaces.includes` em
`deploy/livekit.yaml` lista a interface fisica e a da VPN, e `node_ip` nao e
usado — ele aceitaria um endereco so, e aqui ha dois caminhos validos.

Confira quais enderecos o SFU esta anunciando:

```bash
docker compose restart livekit && sleep 5
docker compose logs --tail 5 livekit | grep -i "node\|external"
```

#### O que esperar de latencia

Medido com `tailscale netcheck` neste servidor:

```
MappingVariesByDestIP: true      <- NAT simetrico
Nearest DERP: Sao Paulo (82ms)
```

NAT simetrico e o tipo que impede conexao direta entre pares. Na pratica o
Tailscale vai usar o relay dele (DERP) para falar com este servidor, e a voz
de quem estiver pela VPN vai ter latencia bem maior que os 1ms de quem esta
direto — na casa de 150 a 250 ms para alguem nos Estados Unidos.

Para conversa isso e utilizavel. Para transmissao de tela, funciona com mais
atraso. **Se a pessoa conseguir habilitar IPv6 na internet dela, o caminho
direto e muito melhor** e dispensa a VPN inteira; a rede virtual e a rede de
seguranca de quem nao tem essa opcao.

### Outro provedor

`TURN_SERVERS` continua funcionando e tem prioridade sobre a Cloudflare, para
trocar de provedor sem mexer em codigo. Serve para qualquer TURN que aceite
usuario e senha fixos:

```
TURN_SERVERS=[{"urls":["turn:host:3478?transport=udp"],"username":"u","credential":"s"}]
```

---

## Quando algo quebra

**A API nao sobe, log fala de migracao.**
O Prisma marca a migracao como falha e se recusa a seguir. Veja o erro:

```bash
docker exec postgres-global psql -U pitohui -d kiroshi_db \
  -tAc "SELECT logs FROM _prisma_migrations WHERE finished_at IS NULL"
```

Se o banco ainda estiver vazio, o caminho mais rapido e recomecar:

```bash
docker compose down
docker exec postgres-global psql -U pitohui -d kiroshi_db \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO kiroshi_app;'
docker compose up -d
```

> Cuidado ao gerar o arquivo de migracao no Windows: o PowerShell escreve BOM
> no inicio do arquivo com `Out-File -Encoding utf8`, e o Postgres recusa com
> `syntax error at or near "﻿"`. Gere pelo Git Bash, ou tire o BOM:
> `sed -i '1s/^\xEF\xBB\xBF//' migration.sql`

**O SSH cai no meio do deploy.**
O build da imagem passa minutos sem escrever nada e o tunel derruba a conexao
ociosa. O script ja manda keepalive; se ainda assim cair, o build continua no
servidor. Retome com:

```bash
ssh arasaka 'cd ~/kiroshi/deploy && docker compose up -d'
```

**O app diz "nao consegui falar com este servidor".**
Na ordem: o tunel esta conectado (`systemctl status cloudflared`), a API
responde localmente (`curl http://127.0.0.1:4000/health`), o hostname esta
no painel do Cloudflare, e o hostname nao esta atras do Access.

**A voz conecta e cai sozinha.**
Quase sempre e o token expirando em chamada longa. Ele vale 6 horas e o app
renova; se estiver caindo antes, confira o relogio do servidor (`timedatectl`)
— relogio adiantado invalida token recem emitido.

**Ninguem ouve ninguem, mas todos aparecem no canal.**
E o caminho da midia. Veja "Ligando o relay" acima.

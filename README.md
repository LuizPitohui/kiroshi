# Kiroshi

Voz, video, compartilhamento de tela e conversa. Auto-hospedado.

Feito para um grupo fechado que precisava sair do Discord e queria os dados no
proprio servidor. Cada pessoa instala um executavel e usa.

![Kiroshi](packages/desktop/build/icon256.png)

---

## O que tem

**Conversa** — markdown (negrito, italico, riscado, codigo, citacao, spoiler),
anexos com preview, cartoes de link, reacoes, respostas, mencoes de pessoa,
cargo e everyone, edicao, mensagens fixadas, busca, "fulano esta digitando",
modo lento.

**Voz e video** — canais de voz, camera, compartilhamento de tela em ate 1080p
60 fps com audio do sistema, supressao de ruido, apertar para falar ou
deteccao de voz, indicador de quem esta falando, volume por pessoa, silenciar
e mover membros.

**Servidores** — categorias e canais, cargos com hierarquia, permissoes
granulares por canal, convites com validade e limite de uso, banimentos,
registro de auditoria, emojis, figurinhas e soundboard proprios.

**Contas** — email e senha, 2FA por app autenticador com codigos de
recuperacao, perfil com avatar, bio e pronomes, status personalizado,
presenca, amigos, bloqueio, mensagens diretas individuais e em grupo.

**App** — instalador para Windows, bandeja do sistema, notificacoes nativas,
tema escuro e claro, iniciar com o computador, reconexao automatica.

---

## Como e por dentro

```
packages/
  shared/    tipos, protocolo do gateway, permissoes, validacao
  server/    Fastify (REST) + ws (gateway) + Prisma/Postgres + LiveKit
  desktop/   Electron + React + Vite
deploy/      Dockerfile, compose, configuracao do SFU, script de deploy
docs/        arquitetura e deploy
```

**Servidor:** Node com TypeScript. REST no Fastify, tempo real em WebSocket com
protocolo proprio (heartbeat, sequencia, retomada de sessao), Postgres via
Prisma, voz pelo LiveKit.

**Cliente:** Electron com isolamento de contexto. React com Zustand, estado
normalizado, envio otimista de mensagem.

**Compartilhado:** um pacote com os tipos, o protocolo e a resolucao de
permissoes, usado pelas duas pontas. O servidor autoriza com a mesma funcao que
o cliente usa para decidir o que mostrar.

As decisoes e o motivo de cada uma estao em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

---

## Rodando local

Precisa de Node 20+ e um Postgres.

```bash
npm install

# Configuracao do servidor
cp packages/server/.env.example packages/server/.env
#   preencha DATABASE_URL e JWT_SECRET (openssl rand -base64 48)

npm run db:push -w @kiroshi/server
KIROSHI_SEED=1 npm run db:seed -w @kiroshi/server   # dados de exemplo

npm run dev:server     # API em :4000
npm run dev:desktop    # app Electron
```

O seed cria o servidor "Arasaka" com cinco contas (`pitohui`, `kaya`, `rafa`,
`bruno`, `lele`), senha `ordem123456`.

Sem `LIVEKIT_URL` no `.env`, a voz fica desligada e o resto funciona normal.

### Interface no navegador

Para mexer em layout sem empacotar o Electron:

```bash
npx vite --config packages/desktop/vite.web.config.ts
```

Os recursos que dependem do sistema (captura de tela, bandeja, atalho global)
ficam desativados por um substituto em `src/lib/bridge.ts`.

---

## Testes

```bash
npm test                                   # unidade: permissoes, snowflake, markdown, tokens
node packages/server/test/e2e.mjs          # ponta a ponta, com o servidor local no ar
node packages/server/test/producao.mjs     # endpoints publicos, pelo tunel
node packages/server/test/fumaca-producao.mjs https://servidor <convite>
node packages/desktop/test/verificar-instalador.mjs <usuario> <senha>

# com o app aberto com --remote-debugging-port=9222 e ja logado:
node packages/desktop/test/palco.mjs        # quadros, destaque, tela cheia
node packages/desktop/test/movimento.mjs    # a preferencia de movimento
node packages/desktop/test/conversa.mjs     # mandar mensagem, emoji, anexo
node packages/desktop/test/fixar.mjs <servidor> <usuario> <senha>
node packages/desktop/test/queda-de-voz.mjs <host-ssh>   # derruba o SFU de proposito
```

O de ponta a ponta sobe duas sessoes de gateway e verifica o fluxo real: login,
2FA, entrega em tempo real entre usuarios, permissoes, convites, rate limit, e
as regressoes dos bugs ja corrigidos.

O de fumaca faz o mesmo contra producao com contas descartaveis, que ele mesmo
apaga no fim — inclusive saindo do servidor onde entrou.

O do instalador sobe o executavel empacotado de verdade, limpa a sessao para
simular uma instalacao nova, entra em producao, entra em um canal de voz e abre
a camera. E o unico que prova o que vai ser distribuido: o modo de
desenvolvimento nao tem asar, nem isolamento de contexto, nem a ponte do
preload.

O do palco dirige a interface de video clicando onde a pessoa clica, e verifica
tambem o que nao aparece numa captura de tela: que o elemento de video sobrevive
a troca entre destaque e grade sem ser recriado — se ele fosse, a imagem
piscaria a cada clique.

O da conversa dirige o compositor digitando e clicando como uma pessoa faz:
manda tres mensagens seguidas, abre o emoji, busca, anexa, remove o anexo e
fixa. Nasceu de um relato de uso — a suite so falava com a API, e por isso um
compositor que travava depois do primeiro envio passava por todos os testes.

O da queda de voz para o servidor de midia de proposito e cobra que o app
avise que esta reconectando, explique quando desistir, e nao invente
explicacao quando a saida foi voluntaria. Deixa o SFU fora do ar por cerca de
um minuto — nao rode com gente em chamada.

---

## Instalador

```bash
npm run dist:win -w @kiroshi/desktop
```

Sai em `packages/desktop/release/Kiroshi-Setup-<versao>.exe`. Instala por usuario,
sem pedir administrador.

O deploy publica o arquivo e o servidor o entrega em
`https://order.arasaka.fun/baixar` — endereco fixo, sempre a versao mais nova.
Mandar 82 MB por chat nao funciona, e link de servico de transferencia expira.

O endereco padrao do servidor vem de `packages/desktop/.env.production` e pode
ser trocado na tela de login.

---

## Deploy

```bash
cp deploy/.env.production.example deploy/.env.production
# preencha
./deploy/scripts/deploy.sh <host-ssh>
```

Sobe a API e o SFU em containers, aplica as migracoes e confere que respondeu.

O passo a passo completo, incluindo as rotas do Cloudflare Tunnel e o que fazer
quando algo quebra, esta em [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Administracao

O cadastro e fechado: so entra quem tem convite. Nao ha painel web, de
proposito — o que precisa existir fica em um comando, no servidor:

```bash
docker compose exec api node packages/server/dist/admin.js convite
```

Tambem lista contas e servidores, mostra e revoga convites, e remove contas.
Detalhes em [docs/DEPLOY.md](docs/DEPLOY.md#convidando-alguem).

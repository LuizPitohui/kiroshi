# Producao e operacao

> Versao publica. Enderecos, a lista dos outros servicos do host, os dados
> brutos por participante e as pendencias de seguranca ficam em
> `privado/producao.md` e `privado/seguranca.md` (fora do git — o repositorio e
> publico). Levantamento de 2026-09-24, so com comandos de leitura.

---

## Topologia

```
  Cliente (Windows, Electron)                      arasaka (casa, atras de CGNAT)
  ---------------------------                      ------------------------------
  REST + gateway   -> Cloudflare Tunnel (HTTP/2) -> 127.0.0.1:4000  kiroshi-api
  Sinalizacao voz  -> Cloudflare Tunnel        ->  :7880            kiroshi-livekit (rede do host)
  Midia            -> IPv6 direto UDP 7881     ->  interface fisica
                   -> Tailscale                ->  interface da VPN
                   -> relay TURN da Cloudflare ->  (o servidor sai pelo NAT de casa + CGNAT)
```

- `order.arasaka.fun`: API, gateway, anexos, paginas, `/baixar` (instalador e
  `latest.yml`), callback do Google.
- `voz.arasaka.fun`: sinalizacao do LiveKit. A API fala com o LiveKit por dentro
  do servidor desde 2026-09-26: `LIVEKIT_API_URL=http://host.docker.internal:7880`
  no `.env` e `extra_hosts: host.docker.internal:host-gateway` no servico `api`
  do compose (o LiveKit roda na rede do host). Antes ia pelo `LIVEKIT_URL`
  publico, dando a volta pela Cloudflare — e parava quando o tunel parava.
- Postgres: container compartilhado com outros projetos do dono; o Kiroshi usa
  `kiroshi_db` (producao) e `kiroshi_dev` (desenvolvimento), acessados pela ponte
  do Docker.
- O host roda varios outros servicos e projetos do dono. **O container `atm11`
  nao se toca nem se discute** (decisao do dono).
- O host reinicia uma vez por dia por agendamento do dono (horario nas notas
  privadas): chamadas em andamento caem nesse horario, e no boot a API tenta o
  Postgres antes de ele subir e se recupera sozinha.

## Stack no host

`~/kiroshi/deploy/`: `docker-compose.yml`, `.env` (0600), `livekit.yaml`,
`livekit.runtime.yaml` (gerado no deploy com as interfaces reais), `downloads/`
(o que `/baixar` serve).

| Servico (compose) | Container | Imagem | Notas |
|---|---|---|---|
| `api` | `kiroshi-api` | construida do repo | `127.0.0.1:4000`; healthcheck `/health`; le o `.env` |
| `livekit` | `kiroshi-livekit` | `livekit/livekit-server:v1.13` | `network_mode: host` |

Publicado em 2026-09-24: **1.15.0** (`Kiroshi-Setup-1.15.0.exe`, 97.694.691
bytes, `releaseDate 2026-09-23T07:21:46Z`). Cadastro fechado
(`ALLOW_OPEN_REGISTRATION=false`); relay forcado desligado; Google ligado.

## Regras de ouro

1. **Deploy completo reinicia o LiveKit e derruba todas as chamadas**, inclusive
   transmissoes. Antes, conferir quem esta em chamada; se houver gente, perguntar
   ao dono.
2. **Mudanca so de cliente nao precisa de deploy:** trocar `.exe`, `.blockmap` e
   `latest.yml` em `~/kiroshi/deploy/downloads/` por scp. Zero interrupcao.
3. **Mudanca so de `.env`:** `cd ~/kiroshi/deploy && docker compose up -d api`
   recria so a API (o servico chama `api`; `kiroshi-api` e o container).
4. **Conferir a publicacao em cinco lugares:** sha512 local, sha512 no servidor,
   `latest.yml` no servidor, `latest.yml` servido em
   `https://order.arasaka.fun/baixar/latest.yml`, e `curl -I` no `.exe` publico.
5. **Da maquina de desenvolvimento, o caminho e a LAN** (`ssh` pelo endereco
   local, ver notas privadas) — 87 MB sobem em menos de 2 s. O alias pelo tunel
   (`arasaka`) e reserva e o token de acesso expira.
6. Nenhum teste que derruba ou age em producao roda sem combinar (lista em
   [02-arquitetura.md](02-arquitetura.md#testes)).
7. Comandos de leitura para diagnostico nao precisam de permissao; qualquer coisa
   que altere o host, sim.

## Deploy so da API (`deploy/scripts/deploy-api.sh [host]`) — o padrao

Para mudanca em `packages/server` ou `packages/shared`. Nao toca no LiveKit:
ninguem cai da chamada. Recusa se ha mudanca nao commitada no servidor, pergunta
ao SFU se ha gente em chamada (`FORCAR=1` passa por cima), envia so o commit
(git archive, sem o `docker-compose.yml` do servidor), guarda a imagem atual como
`kiroshi-api:anterior`, recria so o servico `api` e espera o `/health`. Se falhar,
imprime o comando de volta. Primeira vez em 2026-09-24 (pacote de seguranca,
`6f493df`): a API trocou em segundos, o LiveKit seguiu no ar e os clientes
1.15 se reidentificaram sozinhos.

## Deploy completo (`deploy/scripts/deploy.sh <host>`) — so quando o SFU muda

1. Testa o SSH; resolve `~/kiroshi` no servidor.
2. Descobre IPv6, interface da rota padrao e interface de VPN.
3. Se nao ha `.env` no servidor, envia `deploy/.env.production` (so copia — nao
   gera segredo, apesar do que o script diz).
4. Le a chave e o segredo do LiveKit do servidor.
5. Envia o codigo (`rsync --delete` ou `tar` via SSH no Git Bash).
6. Publica o instalador mais recente de `release*/` (apaga os antigos, inclusive
   blockmaps; envia o `.exe` se o **tamanho** mudou).
7. Gera `livekit.runtime.yaml` e barra marcadores esquecidos.
8. `docker compose build --pull api` e `up -d`.
9. **Sempre `restart livekit`.**
10. Confere `/health` ate 10 vezes.

Migracoes rodam no start do container (`prisma migrate deploy`), **sem backup
antes**. Nao existe backup automatico do banco.

## Estabilidade observada (72 h ate 2026-09-24)

Detalhe e analise em [04-midia.md](04-midia.md#caminhos-de-rede-em-producao-medido).

- LiveKit: 234 trocas de par ICE (a maioria de quem usa relay), 57 retomadas de
  sessao (32 por queda da sinalizacao, 10 por falha da conexao de quem publica),
  1 `publish time out`, nenhum par TCP.
- `cloudflared` (protocolo QUIC na epoca; HTTP/2 desde 2026-09-25, ver o backlog
  F13): 43 conexoes encerradas, 77 tentativas de reconexao, 25 falhas de
  discagem QUIC.
- Host: CPU ociosa >= 97% nas medias de 10 min; pico de ~5 Mbit/s de saida.
- API: 600 linhas de log; erros so no boot diario (Postgres ainda subindo).

## Diagnostico (comandos de leitura)

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker stats --no-stream kiroshi-api kiroshi-livekit
# LiveKit agrupado por nivel/modulo/mensagem
docker logs --since 72h kiroshi-livekit 2>&1 | awk -F"\t" 'NF>=5 {print $2" | "$3" | "$5}' | sort | uniq -c | sort -rn
# motivos de retomada de sessao
docker logs --since 72h kiroshi-livekit 2>&1 | grep "resuming RTC session" | grep -oE '"ReconnectReason": "[A-Z_]+"' | sort | uniq -c
# tunel
journalctl -u cloudflared --since "72 hours ago" --no-pager -o short-iso --utc
# rede e CPU historicas (sysstat, medias de 10 min)
LC_ALL=C sar -n DEV -f /var/log/sysstat/saDD
# quem esta em chamada (so contagens; saida 0 = vazio, 1 = tem gente) — rodar ANTES de qualquer deploy
ssh <host> 'docker exec -i -w /app kiroshi-api node --input-type=module -' < deploy/scripts/quem-em-chamada.mjs
```

## Pendencias de operacao

- Sem metricas: LiveKit sem `prometheus_port`, nenhuma telemetria de video no
  cliente. Primeiro passo de qualquer trabalho em estabilidade.
- Sem backup automatico do banco; migracoes sem backup antes.
- `deploy.sh` sempre reinicia o LiveKit — por isso existe o `deploy-api.sh`.
- `/baixar/:arquivo` sem `Range`: cada atualizacao baixa 93 MiB por maquina
  (ver [07-desktop-e-entrega.md](07-desktop-e-entrega.md)).
- Seguranca do host: ver notas privadas.

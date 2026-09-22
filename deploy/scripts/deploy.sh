#!/usr/bin/env bash
#
# Deploy do Kiroshi no servidor.
#
#   ./deploy/scripts/deploy.sh [host-ssh]
#
# O que faz, em ordem:
#   1. descobre o IPv6 publico da maquina, que e o caminho da midia;
#   2. gera os segredos na primeira vez e reaproveita nas seguintes;
#   3. envia o codigo;
#   4. monta a configuracao do SFU com os valores reais;
#   5. constroi a imagem e sobe tudo;
#   6. confere que respondeu.
#
# Rodar de novo e seguro: os segredos sao preservados e o banco nao e tocado
# alem das migracoes.

set -euo pipefail

HOST="${1:-arasaka}"

# O build da imagem passa minutos sem produzir saida; sem keepalive o tunel
# do Cloudflare Access derruba a conexao no meio.
SSH_OPTS=(-o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8)

info() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m [aviso]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m [erro]\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
info "Conferindo acesso a $HOST"
ssh "${SSH_OPTS[@]}" -o ConnectTimeout=20 "$HOST" "echo ok" >/dev/null \
  || fail "nao consegui conectar em $HOST. Confira o ~/.ssh/config e se o servidor esta ligado."

# O home e resolvido no servidor, nao aqui: expandir $HOME localmente apontaria
# para a maquina errada. Os outros stacks do arasaka moram no home, e assim o
# deploy nao precisa de sudo.
REMOTE_HOME=$(ssh "${SSH_OPTS[@]}" "$HOST" 'echo $HOME')
REMOTE_DIR="$REMOTE_HOME/kiroshi"
REMOTE_ENV="$REMOTE_DIR/deploy/.env"
echo "    destino: $HOST:$REMOTE_DIR"

# ---------------------------------------------------------------------------
info "Descobrindo o IPv6 publico do servidor"

# Endereco global, ignorando link-local (fe80) e temporarios de privacidade,
# que mudam sozinhos e nao servem para anunciar um servico.
NODE_IP=$(ssh "${SSH_OPTS[@]}" "$HOST" "ip -6 addr show scope global 2>/dev/null \
  | grep -v temporary \
  | grep -oP 'inet6 \K[0-9a-f:]+' \
  | grep -v '^fd' | grep -v '^fc' \
  | head -1")

if [ -z "$NODE_IP" ]; then
  warn "sem IPv6 publico. A midia vai precisar de outro caminho (TURN ou tunel UDP)."
  NODE_IP=$(ssh "${SSH_OPTS[@]}" "$HOST" "hostname -I | awk '{print \$1}'")
  warn "usando $NODE_IP; so funciona para quem estiver na mesma rede."
else
  echo "    IPv6: $NODE_IP"
fi

# A interface fisica, tirada da rota padrao.
#
# O LiveKit roda com a rede do host e enxerga toda ponte de docker da maquina.
# Sem restringir, ele anuncia dezenas de candidatos ICE em enderecos 172.x que
# nenhum cliente alcanca, e a negociacao de video estoura o prazo antes de
# chegar no endereco que funciona.
IFACE=$(ssh "${SSH_OPTS[@]}" "$HOST" "ip route get 1.1.1.1 2>/dev/null | grep -oP 'dev \K\S+' | head -1")
[ -n "$IFACE" ] || fail "nao consegui descobrir a interface de rede do servidor."
echo "    interface de midia: $IFACE"

# A interface da rede virtual, quando existir.
#
# E o unico caminho para quem nao tem IPv6, porque o IPv4 desta maquina esta
# atras de CGNAT e nao aceita conexao de fora. Quem tem IPv6 nem encosta nela.
#
# Ausencia nao e erro: em um servidor com IPv4 publico a rede virtual nao faz
# falta. Nesse caso a linha da interface e removida do arquivo, em vez de
# ficar apontando para algo que nao existe — o LiveKit recusa subir com uma
# interface desconhecida na lista.
VPN_IFACE=$(ssh "${SSH_OPTS[@]}" "$HOST" \
  "ip -br link show 2>/dev/null | grep -oE '^(tailscale[0-9]+|zt[a-z0-9]+|wg[0-9]+)' | head -1")
if [ -n "$VPN_IFACE" ]; then
  echo "    interface da rede virtual: $VPN_IFACE"
else
  echo "    interface da rede virtual: nenhuma (so o caminho direto)"
fi

# ---------------------------------------------------------------------------
info "Preparando o diretorio remoto"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $REMOTE_DIR"

# ---------------------------------------------------------------------------
info "Segredos"

# Se ja existe .env no servidor, mantem: regerar o JWT_SECRET desconectaria
# todo mundo, e regerar a chave do LiveKit derrubaria as chamadas.
if ssh "${SSH_OPTS[@]}" "$HOST" "test -f $REMOTE_ENV"; then
  echo "    .env existente preservado"
  EXISTING=1
else
  EXISTING=0
  echo "    gerando segredos novos"
fi

if [ "$EXISTING" = "0" ]; then
  if [ ! -f "deploy/.env.production" ]; then
    fail "crie deploy/.env.production a partir de deploy/.env.production.example antes do primeiro deploy."
  fi
  ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $REMOTE_DIR/deploy"
  scp -q "deploy/.env.production" "$HOST:$REMOTE_ENV"
  ssh "${SSH_OPTS[@]}" "$HOST" "chmod 600 $REMOTE_ENV"
fi

LIVEKIT_API_KEY=$(ssh "${SSH_OPTS[@]}" "$HOST" "grep '^LIVEKIT_API_KEY=' $REMOTE_ENV | cut -d= -f2- | tr -d '\"'")
LIVEKIT_API_SECRET=$(ssh "${SSH_OPTS[@]}" "$HOST" "grep '^LIVEKIT_API_SECRET=' $REMOTE_ENV | cut -d= -f2- | tr -d '\"'")

[ -n "$LIVEKIT_API_KEY" ] || fail "LIVEKIT_API_KEY vazio no .env do servidor."
[ -n "$LIVEKIT_API_SECRET" ] || fail "LIVEKIT_API_SECRET vazio no .env do servidor."

# ---------------------------------------------------------------------------
info "Enviando o codigo"

EXCLUDES=(
  --exclude 'node_modules'
  --exclude 'dist'
  --exclude 'out'
  # Com estrela, e nao 'release' exato.
  #
  # O Windows trava os arquivos do aplicativo enquanto ele esta aberto, entao
  # empacotar durante um teste exige mandar a saida para `release-<versao>`. O
  # padrao exato nao casava com essas pastas, e cada uma tem 368 MB de Electron
  # desempacotado: o envio do codigo passou a arrastar quase dois gigabytes por
  # um tunel SSH e travava sem dizer o que estava fazendo.
  --exclude 'release*'
  --exclude '.git'
  --exclude '*.log'
  --exclude '.env'
  --exclude '.env.production'
  --exclude 'uploads'
  --exclude '*.tsbuildinfo'
)

if command -v rsync >/dev/null; then
  rsync -az --delete "${EXCLUDES[@]}" ./ "$HOST:$REMOTE_DIR/"
else
  # Git Bash no Windows nao traz rsync. tar sobre ssh faz o mesmo trabalho e
  # existe em qualquer lugar; a diferenca e que nao remove o que sumiu, entao
  # limpamos os diretorios de codigo antes.
  echo "    rsync indisponivel, usando tar"
  ssh "${SSH_OPTS[@]}" "$HOST" "rm -rf $REMOTE_DIR/packages $REMOTE_DIR/deploy/Dockerfile.server"
  tar czf - "${EXCLUDES[@]}" . | ssh "${SSH_OPTS[@]}" "$HOST" "tar xzf - -C $REMOTE_DIR"
fi

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# O instalador vai junto, para o servidor poder distribui-lo.
#
# Sao TRES arquivos, e os tres importam:
#
#   .exe        o instalador em si, para quem instala pela primeira vez;
#   latest.yml  o que o aplicativo instalado le para saber que ha versao nova;
#   .blockmap   o que permite baixar so as partes que mudaram entre versoes.
#
# Publicar so o .exe deixa a atualizacao automatica quieta para sempre, sem
# erro visivel em lugar nenhum: o aplicativo procura `latest.yml`, nao acha, e
# conclui que ja esta atualizado.
#
# Nada disso entra no envio normal do codigo: fica em `release*/`, excluido de
# proposito, e 82 MB por deploy seria desperdicio quando so o codigo mudou.
#
# A pasta de saida muda de nome quando o Windows trava os arquivos do app
# aberto e o empacotamento precisa escrever em outro lugar, entao procuramos em
# todas e ficamos com a mais recente.
INSTALADOR=$(ls -t packages/desktop/release*/Kiroshi-Setup-*.exe 2>/dev/null | head -1)
if [ -n "$INSTALADOR" ]; then
  NOME=$(basename "$INSTALADOR")
  PASTA_BUILD=$(dirname "$INSTALADOR")
  info "Publicando o instalador ($NOME)"
  ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $REMOTE_DIR/deploy/downloads"

  TAMANHO_LOCAL=$(wc -c < "$INSTALADOR" | tr -d ' ')
  TAMANHO_REMOTO=$(ssh "${SSH_OPTS[@]}" "$HOST" \
    "wc -c < $REMOTE_DIR/deploy/downloads/$NOME 2>/dev/null || echo 0" | tr -d ' ')

  if [ "$TAMANHO_LOCAL" = "$TAMANHO_REMOTO" ]; then
    echo "    ja publicado, pulando o envio"
  else
    # Versoes antigas saem: o servidor publica sempre a mais nova, e guardar as
    # velhas so ocupa espaco e confunde quem for olhar a pasta.
    ssh "${SSH_OPTS[@]}" "$HOST" \
      "rm -f $REMOTE_DIR/deploy/downloads/Kiroshi-Setup-*.exe $REMOTE_DIR/deploy/downloads/Kiroshi-Setup-*.blockmap"
    scp -q "$INSTALADOR" "$HOST:$REMOTE_DIR/deploy/downloads/$NOME"
    echo "    enviado ($(( TAMANHO_LOCAL / 1024 / 1024 )) MB)"
  fi

  # O manifesto e o mapa de blocos vao sempre, mesmo quando o .exe foi pulado:
  # sao pequenos, e um `latest.yml` desatualizado e pior que nenhum.
  for EXTRA in "$PASTA_BUILD/latest.yml" "$INSTALADOR.blockmap"; do
    if [ -f "$EXTRA" ]; then
      scp -q "$EXTRA" "$HOST:$REMOTE_DIR/deploy/downloads/$(basename "$EXTRA")"
    else
      warn "$(basename "$EXTRA") nao existe; a atualizacao automatica nao vai funcionar."
    fi
  done
else
  warn "nenhum instalador em packages/desktop/release*; o link de download ficara sem arquivo."
fi

# ---------------------------------------------------------------------------
info "Montando a configuracao do SFU"

# O livekit.yaml versionado tem marcadores; o arquivo que roda recebe os
# valores reais e fica so no servidor, com permissao restrita.
#
# Sem rede virtual, a linha inteira da interface sai do arquivo: deixar o
# marcador sem substituir faria o LiveKit tentar abrir uma interface chamada
# "${LIVEKIT_VPN_INTERFACE}" e recusar subir.
if [ -n "$VPN_IFACE" ]; then
  TROCA_VPN="s|\${LIVEKIT_VPN_INTERFACE}|$VPN_IFACE|"
else
  TROCA_VPN="/\${LIVEKIT_VPN_INTERFACE}/d"
fi

ssh "${SSH_OPTS[@]}" "$HOST" "cd $REMOTE_DIR/deploy \
  && sed -e 's|\${LIVEKIT_INTERFACE}|$IFACE|' \
         -e '$TROCA_VPN' \
         -e 's|\${LIVEKIT_API_KEY}|$LIVEKIT_API_KEY|' \
         -e 's|\${LIVEKIT_API_SECRET}|$LIVEKIT_API_SECRET|' \
         livekit.yaml > livekit.runtime.yaml \
  && chmod 600 livekit.runtime.yaml \
  && sed -i 's|./livekit.yaml:|./livekit.runtime.yaml:|' docker-compose.yml"

# Um marcador esquecido vira erro agora, e nao um container reiniciando em
# loop meia hora depois.
ssh "${SSH_OPTS[@]}" "$HOST" "! grep -q '\${LIVEKIT' $REMOTE_DIR/deploy/livekit.runtime.yaml" \
  || fail "sobrou marcador nao substituido em livekit.runtime.yaml."

# ---------------------------------------------------------------------------
info "Construindo e subindo"
ssh "${SSH_OPTS[@]}" "$HOST" "cd $REMOTE_DIR/deploy && docker compose build --pull api && docker compose up -d"

# O SFU precisa de reinicio explicito.
#
# `docker compose up -d` so recria container cuja definicao mudou, e a do SFU
# nunca muda: o caminho do arquivo montado e sempre o mesmo, so o conteudo
# dele e reescrito. Sem isto, mexer na configuracao do SFU e deployar nao
# aplicava nada — e o log seguia mostrando a configuracao antiga, o que e
# especialmente traicoeiro porque tudo parece ter dado certo.
info "Aplicando a configuracao do SFU"
ssh "${SSH_OPTS[@]}" "$HOST" "cd $REMOTE_DIR/deploy && docker compose restart livekit" >/dev/null
sleep 6

# ---------------------------------------------------------------------------
info "Verificando"
sleep 8

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  STATUS=$(ssh "${SSH_OPTS[@]}" "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:4000/health" || echo "000")
  if [ "$STATUS" = "200" ]; then
    break
  fi
  echo "    tentativa $attempt: HTTP $STATUS, aguardando..."
  sleep 5
done

if [ "$STATUS" != "200" ]; then
  warn "a API nao respondeu. Ultimos registros:"
  ssh "${SSH_OPTS[@]}" "$HOST" "cd $REMOTE_DIR/deploy && docker compose logs --tail 40 api"
  fail "deploy nao concluido."
fi

HEALTH=$(ssh "${SSH_OPTS[@]}" "$HOST" "curl -s --max-time 5 http://127.0.0.1:4000/health")
echo "    API: $HEALTH"

LIVEKIT_STATUS=$(ssh "${SSH_OPTS[@]}" "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:7880/" || echo "000")
echo "    SFU: HTTP $LIVEKIT_STATUS na porta 7880"

info "Pronto"
echo ""
echo "  Midia direta:  [$NODE_IP]:7881/udp (e 7882/tcp como reserva)"
if [ -n "$VPN_IFACE" ]; then
  VPN_IP=$(ssh "${SSH_OPTS[@]}" "$HOST" "ip -4 -br addr show $VPN_IFACE 2>/dev/null | awk '{print \$3}' | cut -d/ -f1")
  echo "  Midia pela VPN: ${VPN_IP:-$VPN_IFACE}:7881/udp — para quem nao tem IPv6"
fi
echo "  API local:     http://127.0.0.1:4000"
echo ""
echo "  Falta ligar o hostname publico no Cloudflare Tunnel apontando para"
echo "  http://127.0.0.1:4000. Veja docs/DEPLOY.md."
echo ""

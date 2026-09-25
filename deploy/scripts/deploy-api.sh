#!/usr/bin/env bash
#
# Publica SO a API, sem reiniciar o LiveKit.
#
#   ./deploy/scripts/deploy-api.sh [host-ssh]        (padrao: pitohui@192.168.100.21)
#   FORCAR=1 ./deploy/scripts/deploy-api.sh          (publica mesmo com gente em chamada)
#
# O deploy.sh completo reconstroi tudo e SEMPRE reinicia o SFU, o que derruba
# quem esta em chamada — inclusive transmissao ao vivo. Quando so o servidor
# mudou (packages/server, packages/shared), isso e desnecessario: basta trocar
# o container da API.
#
# O que este script faz, e por que:
#
#   1. Recusa se ha mudanca nao commitada no servidor ou no shared: o que vai
#      para producao e o commit, nunca a pasta de trabalho.
#   2. Pergunta ao SFU se ha gente em chamada (quem-em-chamada.mjs). Reiniciar a
#      API nao derruba a midia, mas apaga os estados de voz do banco no boot:
#      quem esta na chamada some da lista do canal ate reentrar.
#   3. Envia so o que o Dockerfile usa, tirado do commit (git archive). NAO
#      envia deploy/docker-compose.yml: o do servidor aponta para o
#      livekit.runtime.yaml gerado no deploy completo, e sobrescreve-lo deixaria
#      o SFU sem configuracao no proximo `up`.
#   4. Guarda a imagem atual como kiroshi-api:anterior antes de construir, para
#      voltar atras com um comando (impresso no fim se algo falhar).
#   5. Recria so o servico `api` (--no-deps) e espera o /health.
#
# Migracoes rodam no inicio do container, como no deploy completo.

set -euo pipefail

HOST="${1:-pitohui@192.168.100.21}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain -- packages/server packages/shared)" ]; then
  echo "ha mudanca nao commitada em packages/server ou packages/shared; commite antes." >&2
  exit 1
fi
REV=$(git rev-parse --short HEAD)

echo "== quem esta em chamada"
if ! "${SSH[@]}" 'docker exec -i -w /app kiroshi-api node --input-type=module -' < deploy/scripts/quem-em-chamada.mjs; then
  if [ "${FORCAR:-}" != "1" ]; then
    echo "tem gente em chamada (ou nao deu para perguntar). FORCAR=1 para publicar mesmo assim." >&2
    exit 1
  fi
  echo "   FORCAR=1: seguindo mesmo assim"
fi

echo "== enviando $REV"
git archive --format=tar HEAD \
  package.json package-lock.json tsconfig.base.json .npmrc \
  packages/shared packages/server packages/desktop/package.json \
  deploy/Dockerfile.server \
  | gzip \
  | "${SSH[@]}" 'cd ~/kiroshi && rm -rf packages/server packages/shared && tar xzf -'

echo "== construindo a imagem"
"${SSH[@]}" 'cd ~/kiroshi/deploy && docker tag kiroshi-api:latest kiroshi-api:anterior && docker compose build api'

echo "== trocando so a API"
"${SSH[@]}" 'cd ~/kiroshi/deploy && docker compose up -d --no-deps api'

echo "== conferindo"
for _ in $(seq 1 20); do
  STATUS=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:4000/health" || echo 000)
  if [ "$STATUS" = "200" ]; then
    echo "API no ar com $REV."
    exit 0
  fi
  sleep 3
done

echo "A API nao respondeu. Para voltar a versao anterior:" >&2
echo "  ssh $HOST 'cd ~/kiroshi/deploy && docker tag kiroshi-api:anterior kiroshi-api:latest && docker compose up -d --no-deps api'" >&2
exit 1

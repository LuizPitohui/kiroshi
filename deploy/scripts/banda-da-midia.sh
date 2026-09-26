#!/usr/bin/env bash
#
# Quanto cada pessoa manda e recebe AGORA pela porta de midia do LiveKit (UDP
# 7881), medido no proprio servidor. Enderecos nunca aparecem: cada remetente
# vira R1, R2... com o tipo de rede (rede local, Cloudflare = relay TURN,
# Tailscale, internet).
#
#   ssh <host> 'bash -s' < deploy/scripts/banda-da-midia.sh          (10 s)
#   ssh <host> 'SEGUNDOS=30 bash -s' < deploy/scripts/banda-da-midia.sh
#
# Precisa de sudo (tcpdump). So le cabecalhos; nada e gravado.
#
# Por que existe: o contador da placa de rede soma todos os servicos da
# maquina, e o SFU usa rede do host (o `docker stats` dele mostra zero). Foi
# assim que se achou, em 2026-09-26, uma transmissao sem espectador subindo
# 11,7 Mbit/s (04-midia.md, "Dynacast e a renegociacao").

# Sem pipefail: o `timeout` que encerra o tcpdump sai com 124, e isso e o normal.
set -eu
SEGUNDOS="${SEGUNDOS:-10}"
INTERFACE="${INTERFACE:-enp1s0}"

sudo -n timeout "$SEGUNDOS" tcpdump -i "$INTERFACE" -nn -q -l 'udp port 7881' 2>/dev/null |
  awk -v s="$SEGUNDOS" '
    {
      src = $3; dst = $5; sub(/:$/, "", dst); len = $NF
      if (dst ~ /\.7881$/) { dir = "manda"; r = src } else { dir = "recebe"; r = dst }
      sub(/\.[0-9]+$/, "", r)
      if (!(r in nome)) {
        n++
        tipo = (r ~ /:/) ? "IPv6" : "IPv4"
        if (r ~ /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^fe80:|^fd/) tipo = tipo ", rede local"
        else if (r ~ /^2606:4700:|^2a06:98c1:|^162\.159\.|^141\.101\.|^104\.(1[6-9]|2[0-9]|3[01])\.|^172\.(6[4-9]|7[01])\./) tipo = tipo ", Cloudflare (relay)"
        else if (r ~ /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./) tipo = tipo ", Tailscale"
        else tipo = tipo ", internet"
        nome[r] = "R" n " (" tipo ")"
      }
      b[dir, r] += len; t[dir] += len
    }
    END {
      printf "porta 7881 em %s s: entra %.1f Mbit/s, sai %.1f Mbit/s\n", s, t["manda"] * 8 / s / 1e6, t["recebe"] * 8 / s / 1e6
      for (r in nome) printf "  %s: manda %.2f Mbit/s, recebe %.2f Mbit/s\n", nome[r], b["manda", r] * 8 / s / 1e6, b["recebe", r] * 8 / s / 1e6
    }'

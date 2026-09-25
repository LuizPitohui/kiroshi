import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { enderecoLocal } from './enderecos.js';

/**
 * O IP de quem fez o pedido, para o limite por IP e o registro de sessao.
 *
 * Em producao toda conexao chega pelo cloudflared, entao o endereco do socket
 * e sempre o da maquina (ou o gateway da rede do Docker), igual para todo
 * mundo. O IP de verdade vem num cabecalho. Antes o servidor lia o
 * `X-Forwarded-For` confiando em qualquer um, e esse cabecalho o proprio
 * cliente escreve: bastava mandar um valor diferente a cada tentativa para
 * escapar do limite de login.
 *
 * Agora: o `CF-Connecting-IP`, que a Cloudflare preenche e o cliente nao
 * controla, vale so quando a conexao vem de um endereco local — que e de onde
 * o cloudflared chega, e de onde ninguem de fora chega, porque a porta da API
 * so e publicada no loopback. Fora isso, vale o IP que o Fastify ja calculou.
 */
export function ipDoCliente(
  headers: IncomingHttpHeaders,
  enderecoDoSocket: string | undefined,
  alternativa?: string,
): string {
  const vizinho = enderecoDoSocket ?? '';
  if (vizinho && enderecoLocal(vizinho)) {
    const bruto = headers['cf-connecting-ip'];
    const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim();
    // So um IP de verdade: lixo no cabecalho nao vira chave de limite.
    if (valor && isIP(valor)) return valor;
  }
  return alternativa ?? vizinho;
}

/** Atalho para pedido do Fastify. */
export function ipDaRequisicao(request: {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
  ip: string;
}): string {
  return ipDoCliente(request.headers, request.socket.remoteAddress, request.ip);
}

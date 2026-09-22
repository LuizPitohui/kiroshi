/**
 * Que caminhos de rede existem ate o servidor de midia.
 *
 * Sao dois, e cada um serve um publico:
 *
 *   IPv6          direto e mais rapido. Serve quem tem IPv6 na operadora.
 *   rede virtual  o unico caminho de quem so tem IPv4, porque o IPv4 do
 *                 servidor esta atras de CGNAT e nao aceita conexao de fora.
 *
 * Fica separado do controlador de proposito: sao regras puras, sem navegador
 * nem estado, e assim da para testa-las sem carregar o aplicativo inteiro.
 */

/**
 * Se o endereco e da faixa que a rede virtual usa (100.64.0.0/10).
 *
 * E a faixa reservada para CGNAT, e o Tailscale entrega endereco dela para
 * cada maquina que entra. Em teoria uma operadora tambem poderia entregar um
 * endereco dessa faixa direto ao aparelho, mas na pratica o CGNAT fica no lado
 * da operadora e o aparelho da casa recebe 192.168.x — entao achar 100.64+
 * numa interface local quer dizer VPN ligada.
 *
 * A checagem e pelo numero, nao pelo texto: 100.63.x e 100.128.x comecam com
 * "100." e estao FORA da faixa.
 */
export function naFaixaDaVpn(endereco: string): boolean {
  const partes = endereco.split('.');
  if (partes.length !== 4) return false;
  if (partes.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;

  const [primeiro, segundo] = partes.map(Number) as [number, number, number, number];
  return primeiro === 100 && segundo >= 64 && segundo <= 127;
}

/** Um endereco IPv6 tem ":"; nenhum IPv4 tem. */
export function ehIPv6(endereco: string): boolean {
  return endereco.includes(':');
}

export interface CaminhosDisponiveis {
  temIPv6: boolean;
  naVpn: boolean;
}

/**
 * Le a lista de enderecos das interfaces locais e diz o que existe.
 *
 * Recebe a lista pronta em vez de coleta-la: quem coleta precisa do navegador,
 * isto aqui e so a leitura.
 */
export function lerCaminhos(enderecos: readonly string[]): CaminhosDisponiveis {
  return { temIPv6: enderecos.some(ehIPv6), naVpn: enderecos.some(naFaixaDaVpn) };
}

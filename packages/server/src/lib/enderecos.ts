import { isIP } from 'node:net';

/**
 * Classificacao de enderecos IP, sem rede e sem DNS.
 *
 * Dois usos, com perguntas diferentes:
 *
 *   `enderecoPublico` — posso buscar uma pagina neste endereco para montar
 *   um cartao de link? Tudo que nao for internet publica e recusado:
 *   loopback, rede privada, link-local, CGNAT, multicast, reservado.
 *
 *   `enderecoLocal` — esta conexao veio de dentro desta maquina ou da rede
 *   do Docker? So dai o cabecalho do cloudflared merece confianca.
 *
 * O que levou a este modulo: a checagem antiga comparava texto, e um IPv6 que
 * carrega um IPv4 dentro passava. `http://[::ffff:127.0.0.1]/` chega ao
 * servidor como `::ffff:7f00:1` — o `URL` normaliza para hexa —, e a regex que
 * procurava o IPv4 em forma de pontos nao casava. Aqui o IPv6 e lido em grupos
 * de 16 bits e o IPv4 embutido (mapeado, compativel, NAT64, 6to4) e
 * classificado como o IPv4 que ele e.
 */

type Octetos = [number, number, number, number];

function octetosIPv4(ip: string): Octetos | null {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').map(Number) as Octetos;
}

/**
 * Os oito grupos de 16 bits de um IPv6, com o IPv4 do fim ja convertido.
 * Devolve null para o que nao for IPv6.
 */
export function gruposIPv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;

  let texto = ip.toLowerCase();
  // A zona (fe80::1%eth0) diz por qual interface sair, nao muda o endereco.
  const zona = texto.indexOf('%');
  if (zona >= 0) texto = texto.slice(0, zona);

  // IPv4 escrito no fim (::ffff:127.0.0.1) vira os dois ultimos grupos.
  const ultimo = texto.lastIndexOf(':');
  const cauda = texto.slice(ultimo + 1);
  if (cauda.includes('.')) {
    const o = octetosIPv4(cauda);
    if (!o) return null;
    texto = `${texto.slice(0, ultimo + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }

  const metades = texto.split('::');
  if (metades.length > 2) return null;
  const ler = (parte: string): number[] => (parte ? parte.split(':').map((g) => parseInt(g, 16)) : []);
  const inicio = ler(metades[0] ?? '');
  const fim = metades.length === 2 ? ler(metades[1] ?? '') : [];
  const faltam = metades.length === 2 ? 8 - inicio.length - fim.length : 0;
  if (faltam < 0) return null;

  const grupos = [...inicio, ...new Array<number>(faltam).fill(0), ...fim];
  if (grupos.length !== 8 || grupos.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return grupos;
}

function ipv4DeGrupos(alto: number, baixo: number): string {
  return `${alto >> 8}.${alto & 0xff}.${baixo >> 8}.${baixo & 0xff}`;
}

/**
 * O IPv4 que um IPv6 carrega dentro, nos formatos em que isso acontece:
 *
 *   ::ffff:a.b.c.d      mapeado (e o que o sistema usa em socket de pilha dupla)
 *   ::ffff:0:a.b.c.d    traduzido (SIIT)
 *   ::a.b.c.d           compativel, obsoleto
 *   64:ff9b::a.b.c.d    NAT64 conhecido, e 64:ff9b:1::/48, o NAT64 local
 *   2002:aabb:ccdd::    6to4, com o IPv4 nos grupos 1 e 2
 */
export function ipv4Embutido(grupos: number[]): string | null {
  const g = (i: number) => grupos[i] ?? 0;
  const zerados = (de: number, ate: number) => grupos.slice(de, ate).every((x) => x === 0);

  if (zerados(0, 5) && g(5) === 0xffff) return ipv4DeGrupos(g(6), g(7));
  if (zerados(0, 4) && g(4) === 0xffff && g(5) === 0) return ipv4DeGrupos(g(6), g(7));
  // `::` e `::1` sao enderecos do proprio IPv6, nao IPv4 compativel.
  if (zerados(0, 6) && !(g(6) === 0 && g(7) <= 1)) return ipv4DeGrupos(g(6), g(7));
  if (g(0) === 0x64 && g(1) === 0xff9b && (zerados(2, 6) || g(2) === 1)) return ipv4DeGrupos(g(6), g(7));
  if (g(0) === 0x2002) return ipv4DeGrupos(g(1), g(2));
  return null;
}

/** IPv4 que nao e internet publica. */
function ipv4Interno([a, b, c]: Octetos): boolean {
  if (a === 0) return true; // "esta rede"
  if (a === 10) return true; // privada
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (e o Tailscale)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local e metadados de nuvem
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF e documentacao
  if (a === 192 && b === 88 && c === 99) return true; // retransmissao 6to4
  if (a === 192 && b === 168) return true; // privada
  if (a === 198 && (b === 18 || b === 19)) return true; // testes de desempenho
  if (a === 198 && b === 51 && c === 100) return true; // documentacao
  if (a === 203 && b === 0 && c === 113) return true; // documentacao
  if (a >= 224) return true; // multicast, reservado e broadcast
  return false;
}

/** IPv6 que nao e internet publica, olhando o IPv4 embutido quando houver. */
function ipv6Interno(grupos: number[]): boolean {
  const embutido = ipv4Embutido(grupos);
  if (embutido) return ipv4Interno(octetosIPv4(embutido)!);

  const g0 = grupos[0] ?? 0;
  const g1 = grupos[1] ?? 0;
  if (grupos.every((x) => x === 0)) return true; // ::
  if (grupos.slice(0, 7).every((x) => x === 0) && grupos[7] === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7, local unico
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10, site-local obsoleto
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x0100 && grupos.slice(1, 4).every((x) => x === 0)) return true; // 100::/64, descarte
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentacao
  // Teredo carrega o IPv4 embaralhado, sem como conferir para onde vai.
  if (g0 === 0x2001 && g1 === 0x0000) return true;
  return false;
}

/**
 * Pode sair uma busca para este endereco? So internet publica.
 * Texto que nao e IP e recusado.
 */
export function enderecoPublico(ip: string): boolean {
  const v4 = octetosIPv4(ip);
  if (v4) return !ipv4Interno(v4);
  const v6 = gruposIPv6(ip);
  if (v6) return !ipv6Interno(v6);
  return false;
}

/**
 * A conexao veio da propria maquina ou de uma rede privada ao lado dela?
 *
 * E o caso do cloudflared: ele fala com a API pelo loopback do host, e o
 * Docker entrega a conexao ao container a partir do gateway da rede dele,
 * que e um endereco privado (172.x). A porta so e publicada no loopback, entao
 * ninguem de fora chega com um endereco desses.
 */
export function enderecoLocal(ip: string): boolean {
  const v6 = gruposIPv6(ip);
  // Um IPv4 que chega por socket de pilha dupla aparece como ::ffff:a.b.c.d.
  // So essa forma: as outras que embutem IPv4 nao sao endereco de vizinho.
  const mapeado =
    v6 && v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff
      ? ipv4DeGrupos(v6[6] ?? 0, v6[7] ?? 0)
      : null;

  const v4 = octetosIPv4(mapeado ?? ip);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  if (!v6) return false;
  const g0 = v6[0] ?? 0;
  if (v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // local unico
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  return false;
}

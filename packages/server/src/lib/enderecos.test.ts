/**
 * Classificacao de IP para o cartao de link e para a confianca no proxy.
 *
 * O que estes testes protegem: o servidor busca paginas que os usuarios
 * escrevem. Um endereco interno que escape daqui vira o servidor sondando a
 * propria rede a pedido de quem mandou a mensagem.
 */

import { describe, it, expect } from 'vitest';
import { enderecoLocal, enderecoPublico, gruposIPv6, ipv4Embutido } from './enderecos.js';

describe('IPv4', () => {
  it('internet publica passa', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1']) {
      expect(enderecoPublico(ip), ip).toBe(true);
    }
  });

  it('loopback, privada, link-local, CGNAT, multicast e reservada sao recusadas', () => {
    for (const ip of [
      '127.0.0.1', '127.5.5.5', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255',
      '192.168.100.21', '169.254.169.254', '100.64.0.1', '100.127.255.255', '192.0.0.1',
      '192.0.2.10', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '255.255.255.255',
    ]) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
  });
});

describe('IPv6', () => {
  it('internet publica passa', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2804:14c::1']) {
      expect(enderecoPublico(ip), ip).toBe(true);
    }
  });

  it('loopback, local unico, link-local, multicast e documentacao sao recusados', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', 'fec0::1', '2001:db8::1', '100::']) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
  });
});

describe('IPv4 embutido em IPv6', () => {
  it('mapeado para loopback e recusado, nas duas grafias', () => {
    // A segunda e como o `URL` normaliza a primeira: foi por ela que o filtro
    // antigo deixava passar.
    expect(enderecoPublico('::ffff:127.0.0.1')).toBe(false);
    expect(enderecoPublico('::ffff:7f00:1')).toBe(false);
  });

  it('mapeado para a rede de casa e recusado', () => {
    expect(enderecoPublico('::ffff:192.168.100.21')).toBe(false);
    expect(enderecoPublico('::ffff:c0a8:6415')).toBe(false);
  });

  it('mapeado para internet publica passa', () => {
    expect(enderecoPublico('::ffff:8.8.8.8')).toBe(true);
    expect(enderecoPublico('::ffff:808:808')).toBe(true);
  });

  it('traduzido e compativel seguem o IPv4 de dentro', () => {
    expect(enderecoPublico('::ffff:0:7f00:1')).toBe(false);
    expect(enderecoPublico('::127.0.0.1')).toBe(false);
    expect(enderecoPublico('::7f00:1')).toBe(false);
    expect(enderecoPublico('::8.8.8.8')).toBe(true);
  });

  it('NAT64 segue o IPv4 de dentro', () => {
    expect(enderecoPublico('64:ff9b::7f00:1')).toBe(false);
    expect(enderecoPublico('64:ff9b::127.0.0.1')).toBe(false);
    expect(enderecoPublico('64:ff9b:1::a00:1')).toBe(false);
    expect(enderecoPublico('64:ff9b::808:808')).toBe(true);
  });

  it('6to4 segue o IPv4 dos grupos 1 e 2', () => {
    expect(enderecoPublico('2002:7f00:1::')).toBe(false);
    expect(enderecoPublico('2002:c0a8:6415::1')).toBe(false);
    expect(enderecoPublico('2002:808:808::1')).toBe(true);
  });

  it('Teredo e recusado: o IPv4 vem embaralhado, sem como conferir', () => {
    expect(enderecoPublico('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(false);
  });

  it('extrai o IPv4 certo', () => {
    expect(ipv4Embutido(gruposIPv6('::ffff:7f00:1')!)).toBe('127.0.0.1');
    expect(ipv4Embutido(gruposIPv6('64:ff9b::c0a8:1')!)).toBe('192.168.0.1');
    expect(ipv4Embutido(gruposIPv6('2002:a00:1::')!)).toBe('10.0.0.1');
    expect(ipv4Embutido(gruposIPv6('2606:4700::1111')!)).toBeNull();
  });
});

describe('o que nao e IP', () => {
  it('e recusado, sem lancar', () => {
    for (const texto of ['localhost', '', 'exemplo.com', '999.1.1.1', ':::', '1:2:3']) {
      expect(enderecoPublico(texto), texto).toBe(false);
      expect(enderecoLocal(texto), texto).toBe(false);
    }
  });

  it('gruposIPv6 expande as formas curtas', () => {
    expect(gruposIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(gruposIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(gruposIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(gruposIPv6('1.2.3.4')).toBeNull();
  });
});

describe('enderecoLocal: de onde o cloudflared chega', () => {
  it('loopback e a rede do Docker contam como locais', () => {
    for (const ip of ['127.0.0.1', '::1', '172.18.0.1', '::ffff:172.18.0.1', '10.1.2.3', '192.168.0.5', 'fd00::1', 'fe80::1']) {
      expect(enderecoLocal(ip), ip).toBe(true);
    }
  });

  it('internet e CGNAT nao contam', () => {
    for (const ip of ['8.8.8.8', '::ffff:8.8.8.8', '100.64.0.1', '2606:4700::1111']) {
      expect(enderecoLocal(ip), ip).toBe(false);
    }
  });

  it('so a forma mapeada vale como IPv4 local, nao um 6to4 forjado', () => {
    expect(enderecoLocal('2002:a00:1::ffff:0:0')).toBe(false);
  });
});

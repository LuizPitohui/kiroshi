/**
 * A faixa da rede virtual.
 *
 * Esta funcao decide qual mensagem a pessoa le quando a chamada cai: "instale
 * a VPN" ou "a VPN esta ligada e mesmo assim falhou". Errar aqui manda alguem
 * instalar o que ja tem, ou pior, faz o aplicativo dizer que nao ha mais nada
 * a fazer quando bastava ligar a VPN.
 *
 * O erro facil e comparar texto: "100." casa com 100.63 e 100.200, que estao
 * fora da faixa 100.64.0.0/10.
 */

import { describe, it, expect } from 'vitest';
import { naFaixaDaVpn, lerCaminhos } from './caminhos.js';

describe('enderecos da rede virtual', () => {
  it('reconhece o endereco do servidor', () => {
    expect(naFaixaDaVpn('100.85.246.51')).toBe(true);
  });

  it('reconhece os enderecos das duas maquinas que ja entraram', () => {
    expect(naFaixaDaVpn('100.112.255.45')).toBe(true);
    expect(naFaixaDaVpn('100.66.187.120')).toBe(true);
  });

  it('aceita as duas pontas da faixa', () => {
    expect(naFaixaDaVpn('100.64.0.0')).toBe(true);
    expect(naFaixaDaVpn('100.127.255.255')).toBe(true);
  });
});

describe('enderecos que comecam com 100 mas estao fora', () => {
  it('recusa 100.63, um a menos que o inicio', () => {
    expect(naFaixaDaVpn('100.63.255.255')).toBe(false);
  });

  it('recusa 100.128, um a mais que o fim', () => {
    expect(naFaixaDaVpn('100.128.0.0')).toBe(false);
  });

  it('recusa 100.0.0.1, que comparacao por texto deixaria passar', () => {
    expect(naFaixaDaVpn('100.0.0.1')).toBe(false);
  });
});

describe('enderecos comuns de casa', () => {
  it.each(['192.168.0.10', '192.168.100.21', '10.0.0.5', '172.17.0.1', '127.0.0.1'])(
    'recusa %s',
    (endereco) => {
      expect(naFaixaDaVpn(endereco)).toBe(false);
    },
  );
});

describe('entradas que nao sao IPv4', () => {
  it('recusa IPv6, que tem a propria checagem', () => {
    expect(naFaixaDaVpn('2804:d4b:812f:ce00:661c:67ff:fedf:719')).toBe(false);
    expect(naFaixaDaVpn('fd7a:115c:a1e0::df01:f6c9')).toBe(false);
  });

  it('recusa o nome .local que o navegador usa para esconder o endereco', () => {
    // Sem permissao de midia o Chrome troca o endereco por um mDNS; tratar
    // isso como "tem VPN" daria a mensagem errada.
    expect(naFaixaDaVpn('8f2c1d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f.local')).toBe(false);
  });

  it('recusa texto solto e partes faltando', () => {
    expect(naFaixaDaVpn('')).toBe(false);
    expect(naFaixaDaVpn('100.64.1')).toBe(false);
    expect(naFaixaDaVpn('100.64.1.2.3')).toBe(false);
    expect(naFaixaDaVpn('100.64.1.abc')).toBe(false);
  });

  it('recusa numero fora de um octeto', () => {
    expect(naFaixaDaVpn('100.64.1.256')).toBe(false);
    expect(naFaixaDaVpn('300.64.1.1')).toBe(false);
  });
});

describe('leitura dos dois caminhos juntos', () => {
  it('quem tem so IPv4 de casa nao tem caminho nenhum', () => {
    expect(lerCaminhos(['192.168.1.20', '10.0.0.4'])).toEqual({ temIPv6: false, naVpn: false });
  });

  it('quem esta na rede virtual sem IPv6 tem o plano B', () => {
    // O caso do amigo dos Estados Unidos: operadora so com IPv4, VPN ligada.
    expect(lerCaminhos(['192.168.1.20', '100.66.187.120'])).toEqual({
      temIPv6: false,
      naVpn: true,
    });
  });

  it('quem tem IPv6 tem o caminho direto mesmo sem VPN', () => {
    expect(lerCaminhos(['192.168.100.5', '2804:d4b:812f:ce00::10'])).toEqual({
      temIPv6: true,
      naVpn: false,
    });
  });

  it('os dois ao mesmo tempo, que e o caso de quem hospeda', () => {
    expect(lerCaminhos(['192.168.100.21', '2804:d4b:812f:ce00::719', '100.85.246.51'])).toEqual({
      temIPv6: true,
      naVpn: true,
    });
  });

  it('lista vazia nao inventa caminho', () => {
    // Acontece quando a coleta falha; melhor dizer "nao achei" do que mentir.
    expect(lerCaminhos([])).toEqual({ temIPv6: false, naVpn: false });
  });
});

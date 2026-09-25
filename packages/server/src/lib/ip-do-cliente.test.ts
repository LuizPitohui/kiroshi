/**
 * De onde vem o IP que conta para o limite de login e de cadastro.
 *
 * O que estes testes protegem: o limite por IP so vale se o IP nao puder ser
 * escolhido por quem esta sendo limitado.
 */

import { describe, it, expect } from 'vitest';
import { ipDaRequisicao, ipDoCliente } from './ip-do-cliente.js';

describe('pedido que chega pelo cloudflared', () => {
  it('usa o CF-Connecting-IP quando a conexao vem do loopback', () => {
    expect(ipDoCliente({ 'cf-connecting-ip': '203.0.113.7' }, '127.0.0.1')).toBe('203.0.113.7');
    expect(ipDoCliente({ 'cf-connecting-ip': '2804:14c::1' }, '::1')).toBe('2804:14c::1');
  });

  it('usa o CF-Connecting-IP quando vem do gateway da rede do Docker', () => {
    expect(ipDoCliente({ 'cf-connecting-ip': '203.0.113.7' }, '172.18.0.1')).toBe('203.0.113.7');
    expect(ipDoCliente({ 'cf-connecting-ip': '203.0.113.7' }, '::ffff:172.18.0.1')).toBe('203.0.113.7');
  });

  it('ignora cabecalho que nao e IP e cai no endereco conhecido', () => {
    expect(ipDoCliente({ 'cf-connecting-ip': 'nao-e-ip' }, '127.0.0.1', '127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('pedido que nao vem de endereco local', () => {
  it('nao confia no CF-Connecting-IP: quem manda pode escolher o valor', () => {
    expect(ipDoCliente({ 'cf-connecting-ip': '1.2.3.4' }, '8.8.8.8', '8.8.8.8')).toBe('8.8.8.8');
  });

  it('sem cabecalho, vale o IP que o Fastify calculou', () => {
    expect(ipDoCliente({}, '127.0.0.1', '10.0.0.5')).toBe('10.0.0.5');
  });
});

describe('ipDaRequisicao', () => {
  it('le cabecalho, socket e ip do pedido do Fastify', () => {
    const pedido = {
      headers: { 'cf-connecting-ip': '198.51.100.20' },
      socket: { remoteAddress: '172.19.0.1' },
      ip: '172.19.0.1',
    };
    expect(ipDaRequisicao(pedido)).toBe('198.51.100.20');
  });
});

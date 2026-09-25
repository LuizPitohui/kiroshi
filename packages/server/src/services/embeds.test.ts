/**
 * Destinos que o cartao de link pode buscar.
 *
 * O que estes testes protegem: a busca de pagina que o usuario escreveu nao
 * pode alcancar a rede interna do servidor, em nenhuma grafia de endereco.
 * Sem rede: so enderecos literais e `localhost`, que o sistema resolve sozinho.
 */

import { describe, it, expect } from 'vitest';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { __testing } = await import('./embeds.js');
const { resolverDestino, lookupFixo } = __testing;

describe('resolverDestino', () => {
  it('recusa loopback escondido em IPv6 mapeado, nas duas grafias', async () => {
    expect(await resolverDestino('http://[::ffff:127.0.0.1]/')).toBeNull();
    expect(await resolverDestino('http://[::ffff:7f00:1]/')).toBeNull();
  });

  it('recusa endereco interno literal, em qualquer grafia que o URL aceite', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://10.0.0.1/',
      'http://192.168.100.21:5432/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::1]/',
      'http://[fd00::1]/',
      // O URL normaliza estas duas para 127.0.0.1.
      'http://2130706433/',
      'http://0x7f.1/',
    ]) {
      expect(await resolverDestino(url), url).toBeNull();
    }
  });

  it('recusa nome que resolve para dentro da maquina', async () => {
    expect(await resolverDestino('http://localhost:4000/')).toBeNull();
  });

  it('recusa o que nao e http nem https', async () => {
    for (const url of ['ftp://exemplo.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'nao e url']) {
      expect(await resolverDestino(url), url).toBeNull();
    }
  });

  it('aceita IP publico e guarda o endereco que a conexao vai usar', async () => {
    const destino = await resolverDestino('http://8.8.8.8/pagina');
    expect(destino?.enderecos).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
});

describe('lookupFixo', () => {
  const enderecos = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1::1', family: 6 },
  ];

  it('com all, devolve todos os enderecos conferidos, sem DNS', () => {
    let recebido: unknown;
    lookupFixo(enderecos)('qualquer.nome', { all: true }, (_erro, enderecosRecebidos) => {
      recebido = enderecosRecebidos;
    });
    expect(recebido).toEqual(enderecos);
  });

  it('sem all, devolve o primeiro', () => {
    let recebido: unknown[] = [];
    lookupFixo(enderecos)('qualquer.nome', {}, (_erro, endereco, familia) => {
      recebido = [endereco, familia];
    });
    expect(recebido).toEqual(['93.184.216.34', 4]);
  });
});

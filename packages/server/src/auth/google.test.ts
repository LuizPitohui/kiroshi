/**
 * O endereco de retorno do login com Google.
 *
 * Esta e a peca de seguranca do fluxo. O servidor recebe um endereco do
 * aplicativo e, no fim da conversa com o Google, manda o navegador para la
 * levando um token que abre a conta. Se a validacao deixar passar um endereco
 * de fora, o servidor vira um redirecionador aberto e entrega a conta de quem
 * clicar para quem pediu.
 *
 * Por isso os testes aqui sao quase todos do que NAO pode.
 */
import { describe, it, expect } from 'vitest';
import { retornoPermitido } from './google.js';

describe('retornoPermitido: o que passa', () => {
  it('loopback em IPv4 com porta', () => {
    expect(retornoPermitido('http://127.0.0.1:53114/pronto')).toBe(true);
  });

  it('loopback em IPv6 com porta', () => {
    expect(retornoPermitido('http://[::1]:53114/pronto')).toBe(true);
  });

  it('qualquer porta, porque o aplicativo sorteia uma', () => {
    for (const porta of [1024, 8080, 49152, 65535]) {
      expect(retornoPermitido(`http://127.0.0.1:${porta}/pronto`)).toBe(true);
    }
  });

  it('e qualquer caminho dentro dela', () => {
    expect(retornoPermitido('http://127.0.0.1:53114/')).toBe(true);
    expect(retornoPermitido('http://127.0.0.1:53114/qualquer/coisa')).toBe(true);
  });
});

describe('retornoPermitido: o que nao passa', () => {
  it('site de fora, que e o ataque inteiro', () => {
    expect(retornoPermitido('https://atacante.example/pega')).toBe(false);
    expect(retornoPermitido('http://atacante.example/pega')).toBe(false);
  });

  /*
    Endereco de fora disfarcado de loopback. Cada um destes ja foi um bypass
    real de validacao de redirect em algum produto.
  */
  it('nem disfarcado de loopback', () => {
    const disfarces = [
      'http://127.0.0.1.atacante.example:80/pronto',
      'http://atacante.example/127.0.0.1:53114',
      'http://127.0.0.1@atacante.example:80/pronto',
      'http://atacante.example#127.0.0.1:53114',
      'http://127.0.0.1:53114@atacante.example/pronto',
    ];
    for (const d of disfarces) {
      expect(retornoPermitido(d), d).toBe(false);
    }
  });

  /*
    `localhost` e um NOME, e nome se resolve. Quem controlar a resolucao de
    nomes da maquina — um arquivo hosts mexido, um DNS hostil — aponta
    `localhost` para onde quiser. O numero nao se resolve.
  */
  it('localhost fica de fora, porque e nome e nome se resolve', () => {
    expect(retornoPermitido('http://localhost:53114/pronto')).toBe(false);
  });

  it('sem porta nao vale: o aplicativo sempre tem uma', () => {
    expect(retornoPermitido('http://127.0.0.1/pronto')).toBe(false);
  });

  it('outros esquemas nao valem', () => {
    for (const url of [
      'https://127.0.0.1:53114/pronto',
      'file:///127.0.0.1',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'kiroshi://127.0.0.1:53114/pronto',
    ]) {
      expect(retornoPermitido(url), url).toBe(false);
    }
  });

  it('usuario e senha no endereco nao valem', () => {
    expect(retornoPermitido('http://alguem@127.0.0.1:53114/pronto')).toBe(false);
    expect(retornoPermitido('http://alguem:segredo@127.0.0.1:53114/pronto')).toBe(false);
  });

  /*
    Consulta e ancora ficam de fora porque a entrega e acrescentada por nos
    como `?entrega=...`. Um endereco que ja trouxesse consulta podeira
    embaralhar a nossa, ou esconder um segundo parametro que o aplicativo
    leria antes do certo.
  */
  it('consulta e ancora nao valem', () => {
    expect(retornoPermitido('http://127.0.0.1:53114/pronto?x=1')).toBe(false);
    expect(retornoPermitido('http://127.0.0.1:53114/pronto#x')).toBe(false);
  });

  it('lixo nao derruba a validacao, so reprova', () => {
    for (const lixo of ['', ' ', 'nao e url', '://', 'http://']) {
      expect(retornoPermitido(lixo), JSON.stringify(lixo)).toBe(false);
    }
  });

  /*
    Outros enderecos privados NAO valem. A conversa e entre o aplicativo e o
    servidor na MESMA maquina; qualquer outro endereco e outra maquina, mesmo
    dentro de casa.
  */
  it('rede local nao e loopback', () => {
    for (const url of [
      'http://192.168.100.21:53114/pronto',
      'http://10.0.0.5:53114/pronto',
      'http://0.0.0.0:53114/pronto',
      'http://169.254.169.254/pronto',
    ]) {
      expect(retornoPermitido(url), url).toBe(false);
    }
  });
});

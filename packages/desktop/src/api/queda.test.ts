/**
 * O que derruba uma sessao quando o gateway cai — e o que NAO derruba.
 *
 * Este arquivo existe por causa de um defeito que chegou aos usuarios: o
 * aplicativo deslogava toda vez que a internet caia por mais de quinze
 * minutos. A sequencia:
 *
 *   a internet cai;
 *   o access token expira sozinho (vive 15 minutos);
 *   a internet volta;
 *   o gateway reconecta com o token velho;
 *   o servidor recusa com 4004;
 *   o aplicativo apagava a sessao — jogando fora um refresh token de
 *   SESSENTA DIAS que estava valido.
 *
 * O teste central e o primeiro: 4004 nao pode levar direto ao logout.
 */
import { describe, it, expect } from 'vitest';
import { GatewayCloseCode } from '@kiroshi/shared';
import { acaoParaQueda, acaoDepoisDeRenovar } from './queda.js';

describe('token recusado nao e sessao morta', () => {
  /*
    O teste que teria evitado o problema. Se ele passar a esperar 'sair',
    alguem reintroduziu o defeito.
  */
  it('4004 manda renovar, nunca sair direto', () => {
    expect(acaoParaQueda(GatewayCloseCode.AUTHENTICATION_FAILED)).toBe('renovar-e-reconectar');
  });

  it('4003 tambem, pelo mesmo motivo', () => {
    expect(acaoParaQueda(GatewayCloseCode.NOT_AUTHENTICATED)).toBe('renovar-e-reconectar');
  });

  it('so depois de a renovacao FALHAR e que se sai', () => {
    expect(acaoDepoisDeRenovar(false)).toBe('sair');
  });

  it('e se ela der certo, volta a conectar', () => {
    expect(acaoDepoisDeRenovar(true)).toBe('reconectar');
  });
});

describe('quedas comuns reconectam sem mexer na sessao', () => {
  it('queda de rede, erro desconhecido, timeout: tudo reconecta', () => {
    for (const codigo of [
      1000,
      1001,
      1006, // fechamento anormal: o codigo tipico de queda de internet
      GatewayCloseCode.UNKNOWN_ERROR,
      GatewayCloseCode.SESSION_TIMED_OUT,
      GatewayCloseCode.INVALID_SEQUENCE,
      GatewayCloseCode.RATE_LIMITED,
      4000,
    ]) {
      expect(acaoParaQueda(codigo), String(codigo)).toBe('reconectar');
    }
  });

  /*
    A queda de internet chega como 1006 na maioria das vezes, e as vezes como
    o 4000 que o proprio aplicativo usa quando o batimento para de responder.
    Nenhum dos dois pode chegar perto do logout.
  */
  it('nenhuma queda comum leva a sair', () => {
    for (let codigo = 1000; codigo <= 1015; codigo++) {
      expect(acaoParaQueda(codigo), String(codigo)).not.toBe('sair');
    }
  });
});

describe('sessao assumida por outro aparelho', () => {
  /*
    Para de tentar, mas NAO desloga: a pessoa continua com a conta, so nao
    esta ativa neste aparelho. Reconectar aqui viraria um cabo de guerra entre
    os dois, cada um derrubando o outro.
  */
  it('4010 para de tentar, sem deslogar', () => {
    expect(acaoParaQueda(GatewayCloseCode.SESSION_REPLACED)).toBe('parar');
  });
});

describe('a unica porta para o logout', () => {
  /*
    Nenhum codigo de fechamento, sozinho, resulta em 'sair'. Sair so acontece
    depois de uma renovacao recusada — que e o servidor dizendo que a sessao
    acabou mesmo.
  */
  it('nenhum codigo sozinho desloga', () => {
    for (let codigo = 1000; codigo <= 4100; codigo++) {
      expect(acaoParaQueda(codigo), String(codigo)).not.toBe('sair');
    }
  });
});

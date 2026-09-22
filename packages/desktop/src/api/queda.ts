import { GatewayCloseCode } from '@kiroshi/shared';

/**
 * O que fazer quando o gateway cai.
 *
 * Existe separado porque a versao anterior era um `if` dentro do gateway que
 * tratava `AUTHENTICATION_FAILED` como "a sessao morreu" e apagava os tokens.
 * Isso deslogava todo mundo sempre que a internet caia por mais de quinze
 * minutos — o tempo de vida do access token.
 *
 * A sequencia era esta: a internet cai, o access token expira sozinho, a
 * internet volta, o gateway reconecta com o token VELHO, o servidor recusa
 * com 4004, e o aplicativo jogava fora um refresh token de sessenta dias que
 * estava perfeitamente valido no bolso.
 *
 * A distincao que faltava: "este token nao vale" e diferente de "esta pessoa
 * nao entra mais". O primeiro se resolve renovando; so o segundo e motivo para
 * mandar alguem de volta ao login.
 */

export type AcaoNaQueda =
  /** Reconectar com espera progressiva, sem mexer na sessao. */
  | 'reconectar'
  /** Renovar o access token e tentar de novo; so desistir se a renovacao falhar. */
  | 'renovar-e-reconectar'
  /** Parar de tentar, mas manter a sessao: outro aparelho assumiu. */
  | 'parar'
  /** A sessao acabou de verdade: mandar para o login. */
  | 'sair';

export function acaoParaQueda(codigo: number): AcaoNaQueda {
  switch (codigo) {
    /*
      Token recusado. NAO e o mesmo que sessao morta: quase sempre e so o
      access token que venceu enquanto o aparelho estava sem rede. Renova e
      tenta de novo; se a renovacao tambem for recusada, ai sim e sair.
    */
    case GatewayCloseCode.AUTHENTICATION_FAILED:
    case GatewayCloseCode.NOT_AUTHENTICATED:
      return 'renovar-e-reconectar';

    /*
      Outro aparelho assumiu a sessao. Reconectar aqui viraria um cabo de
      guerra entre os dois, cada um derrubando o outro. Para de tentar, mas a
      sessao continua valida — a pessoa nao foi deslogada, so nao esta mais
      ativa NESTE aparelho.
    */
    case GatewayCloseCode.SESSION_REPLACED:
      return 'parar';

    default:
      return 'reconectar';
  }
}

/**
 * Depois de tentar renovar, o que fazer.
 *
 * Separado de proposito: e a unica porta que leva ao logout, e deixa-la
 * explicita torna dificil alguem acrescentar outra sem perceber.
 */
export function acaoDepoisDeRenovar(renovou: boolean): AcaoNaQueda {
  return renovou ? 'reconectar' : 'sair';
}

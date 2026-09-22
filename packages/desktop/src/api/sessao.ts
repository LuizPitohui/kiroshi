/**
 * Quando uma resposta do servidor significa que a sessao acabou.
 *
 * Existe separado porque a versao anterior era um `if (!response.ok)` dentro
 * da renovacao do token: QUALQUER resposta fora do 2xx apagava a sessao e
 * mandava a pessoa para a tela de login. Inclusive 502 e 503, que e o que o
 * tunel devolve nos segundos em que o servidor esta reiniciando — ou seja, um
 * deploy deslogava quem estivesse renovando naquele instante.
 *
 * A distincao que importa: "o servidor disse que voce nao e mais voce" e
 * diferente de "o servidor nao respondeu". A primeira e definitiva; a segunda
 * passa sozinha, e jogar a sessao fora por causa dela e perder um login que
 * ainda era valido.
 */

/** O servidor recusou a identidade: nao adianta tentar de novo com o mesmo token. */
export function sessaoMorreu(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * O servidor nao esta em condicoes de responder agora: o token continua bom.
 *
 * Reiniciando, sobrecarregado, atras de um tunel que ainda nao reconectou, ou
 * segurando por excesso de pedidos.
 */
export function servidorIndisponivel(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * A decisao de IGNORAR um pedido de entrada em canal de voz.
 *
 * O `connect` do controlador e chamado de DOIS lugares:
 *
 *   1. o clique da pessoa, por `joinChannel`;
 *   2. o eco `VOICE_SERVER_UPDATE` que o gateway manda logo em seguida.
 *
 * O segundo existe de proposito — e por ele que um moderador consegue mover
 * alguem de sala — e chega poucos milissegundos depois do primeiro. Sem
 * guarda, os dois entram na sala, o servidor ve duas conexoes com a mesma
 * identidade e derruba a primeira. Medido em producao: tres entradas seguidas
 * no mesmo canal, fechando com DUPLICATE_IDENTITY depois de 1,3s e 5,9s.
 *
 * A GUARDA NAO PODE OLHAR PARA `connecting`, E ISSO CUSTOU UMA VERSAO.
 *
 * A primeira tentativa de conserto perguntava "ja estou conectado OU
 * conectando a este canal?". Parecia obvio e quebrou a entrada inteira:
 * `joinChannel` emite `connecting: true` com o canal ANTES de chamar
 * `connect`, entao `connect` via o estado que o proprio `joinChannel` tinha
 * acabado de escrever, concluia que ja havia alguem entrando e desistia. A
 * tela ficava em "Entrando na chamada..." para sempre.
 *
 * O problema de fundo: `connecting` nao distingue "ja existe uma entrada em
 * voo" de "esta E a entrada em voo". Duas situacoes opostas, o mesmo valor.
 *
 * Por isso a marca e EXPLICITA. Quem comeca uma entrada escreve o canal em
 * `emVoo` e limpa no fim, aconteca o que acontecer. So quem NAO comecou aquela
 * entrada e barrado por ela.
 */

export interface SituacaoDeEntrada {
  /**
   * O canal cuja entrada esta em voo agora, escrito por quem a comecou.
   *
   * `null` quando nao ha nenhuma. Nao confundir com `connecting` do estado
   * publico: aquele tambem fica verdadeiro durante uma reconexao do LiveKit,
   * que nao e uma entrada nova.
   */
  emVoo: string | null;
  connected: boolean;
  channelId: string | null;
  /**
   * Ha uma sala de midia aberta agora.
   *
   * Separado de `connected` de proposito: durante uma reconexao do LiveKit a
   * sala existe e `connected` oscila. Quem esta sendo movido de canal por um
   * moderador precisa continuar atendendo o token nesse intervalo.
   */
  naSala: boolean;
}

/**
 * Este pedido de entrada deve ser ignorado?
 *
 * Duas razoes, e so estas duas:
 *
 *   ja ha uma entrada em voo para o MESMO canal — o pedido nao acrescenta
 *   nada, e e a corrida que derrubava a chamada;
 *
 *   ja estou conectado nesse canal — entrar de novo derrubaria uma chamada
 *   que esta funcionando.
 *
 * A comparacao e sempre por canal, nunca por "estou ocupado". Quem clica em
 * Geral e muda de ideia para Play durante a conexao PRECISA que o segundo
 * pedido passe; uma guarda por ocupacao viraria travamento.
 */
export function devoIgnorarEntrada(situacao: SituacaoDeEntrada, canalPedido: string): boolean {
  if (situacao.emVoo === canalPedido) return true;
  if (situacao.connected && situacao.channelId === canalPedido) return true;
  return false;
}

/**
 * ESTE cliente deve atender a um token vindo do gateway?
 *
 * O servidor emite `VOICE_SERVER_UPDATE` com `emitToUser`, que entrega a TODAS
 * as sessoes conectadas daquela conta. Quem entra numa chamada pelo
 * computador faz todos os outros aparelhos logados receberem o token — e, sem
 * esta guarda, entrarem na sala junto.
 *
 * O estrago tem dois tamanhos, e o segundo e o que assusta:
 *
 *   os aparelhos se derrubam em circulo. Cada entrada nova e uma identidade
 *   duplicada, o servidor fecha a anterior, e a anterior tenta voltar;
 *
 *   e um aparelho parado em outro comodo COMECA A TRANSMITIR O MICROFONE sem
 *   ninguem ter tocado nele — entrar na sala abre a faixa de audio local.
 *
 * Foi visto acontecendo: uma segunda instancia aberta aqui na mesa, logada na
 * mesma conta, apareceu dentro da chamada sem receber um clique sequer.
 *
 * A regra: so atende quem tem motivo para estar esperando um token.
 *
 *   COM ENTRADA EM VOO — o token e a resposta ao proprio pedido;
 *   JA NA SALA — e um moderador movendo a pessoa de canal, e o servidor so
 *   move quem ja esta na voz.
 *
 * Parado e sem ter pedido nada, o token nao e para este cliente.
 */
export function devoAtenderTokenDoGateway(situacao: SituacaoDeEntrada): boolean {
  return situacao.emVoo !== null || situacao.naSala;
}

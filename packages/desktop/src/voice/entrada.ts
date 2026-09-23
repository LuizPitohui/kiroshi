/**
 * A decisao de IGNORAR um pedido de entrada em canal de voz.
 *
 * Existe por um defeito que derrubava chamadas e depois culpava a internet de
 * quem usava.
 *
 * O `connect` do controlador e chamado de DOIS lugares:
 *
 *   1. o clique da pessoa, por `joinChannel`;
 *   2. o eco `VOICE_SERVER_UPDATE` que o gateway manda logo em seguida.
 *
 * O segundo existe de proposito — e por ele que um moderador consegue mover
 * alguem de sala — e chega poucos milissegundos depois do primeiro.
 *
 * A guarda antiga perguntava so "ja estou CONECTADO a este canal?". Entre o
 * clique e a conexao de fato existe uma janela de um a seis segundos em que o
 * estado e `connecting: true, connected: false`, e e exatamente nela que o eco
 * chega. A guarda deixava passar, o `connect` rodava de novo, saia da sala
 * meio aberta e entrava outra vez.
 *
 * Do lado do servidor isso aparece como duas conexoes com a mesma identidade,
 * e o LiveKit derruba a primeira. Medido no log de producao: tres entradas
 * seguidas no mesmo canal, fechando com `DUPLICATE_IDENTITY` depois de 1,3s e
 * 5,9s, e so a terceira sobrevivendo.
 *
 * Para quem usava, o efeito era pior do que o defeito: a chamada caia e o
 * aplicativo dizia "provavelmente foi instabilidade ou algo bloqueando UDP na
 * sua rede". Mandava a pessoa procurar defeito no proprio roteador por causa
 * de uma corrida no cliente.
 */

export interface EstadoDeEntrada {
  connected: boolean;
  connecting: boolean;
  channelId: string | null;
}

/**
 * Ja estou nesse canal, ou a caminho dele?
 *
 * "A caminho" conta, e e esse o conserto. Um segundo pedido para o MESMO canal
 * enquanto o primeiro esta em voo nao tem nada a acrescentar: ou o primeiro
 * termina e a pessoa esta na sala, ou ele falha e o erro aparece.
 *
 * Trocar de canal continua funcionando, e este e o limite que importa: a
 * comparacao e por canal, nao por "estou ocupado". Quem clica em Geral e logo
 * em Play durante a conexao PRECISA que o segundo pedido passe — senao o
 * conserto viraria um travamento.
 */
export function jaEstouIndoPara(estado: EstadoDeEntrada, canal: string): boolean {
  if (estado.channelId !== canal) return false;
  return estado.connected || estado.connecting;
}

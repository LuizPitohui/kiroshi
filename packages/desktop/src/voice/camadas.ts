/**
 * A pausa das camadas de video que a renegociacao desfaz.
 *
 * Com o `dynacast` ligado, o servidor de voz diz a quem transmite quais camadas
 * alguem esta assistindo, e o LiveKit desliga as outras (`encoding.active =
 * false`): transmissao que ninguem assiste nao sobe nada. Mas a conexao de
 * quem transmite e a mesma que recebe, e cada renegociacao dela (comecar ou
 * parar de assistir alguem, gente entrando ou saindo) faz o Chromium religar
 * as camadas pausadas. O servidor nao manda pausar de novo — para ele nada
 * mudou — e o video inteiro sobe para ninguem ate a proxima mudanca de
 * espectadores daquela transmissao.
 *
 * Medido em producao em 2026-09-26: uma transmissao 1080p60 sem ninguem
 * assistindo subia 11,7 Mbit/s havia uns 20 minutos. Reproduzido com dois
 * Betas: pausada em 0 kbps, bastou quem transmitia parar de assistir o outro
 * para as tres camadas voltarem (3,7 Mbit/s) e ficarem.
 *
 * O LiveKit guarda a ultima ordem do servidor na faixa (`subscribedCodecs`);
 * o controlador compara com o que esta saindo e reaplica a ordem quando
 * discordam. O proprio LiveKit faz o mesmo so num caso (codec novo publicado).
 */

export interface QualidadePedida {
  quality: number;
  enabled: boolean;
}

export interface CodecPedido {
  codec: string;
  qualities: QualidadePedida[];
}

/** A qualidade de cada camada pelo `rid`, como o LiveKit conta (`videoQualityForRid`). */
export function qualidadeDoRid(rid: string | undefined): number {
  switch (rid || 'q') {
    case 'q':
      return 0;
    case 'h':
      return 1;
    case 'f':
      return 2;
    default:
      return 2;
  }
}

/**
 * Se alguma camada que esta saindo discorda da ultima ordem do servidor.
 *
 * Falso sem ordem para comparar: nenhum aviso ainda, ou o aviso e de outro
 * codec (o de reserva, que este app nao usa).
 */
export function camadasDesalinhadas(
  codec: string | undefined,
  pedidos: ReadonlyArray<CodecPedido> | undefined,
  camadas: ReadonlyArray<{ rid?: string; active?: boolean }>,
): boolean {
  if (!codec || !pedidos) return false;
  const pedido = pedidos.find((p) => p.codec === codec);
  if (!pedido) return false;
  return camadas.some((camada) => {
    const ordem = pedido.qualities.find((q) => q.quality === qualidadeDoRid(camada.rid));
    // `active` ausente vale ligado, como no navegador.
    return ordem !== undefined && (camada.active ?? true) !== ordem.enabled;
  });
}

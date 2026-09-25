/**
 * Que camada pedir ao servidor para cada video que chega, e quando pausar.
 *
 * Era a hipotese 1 das travadas (docs/conhecimento/04-midia.md): com a
 * adaptacao automatica do LiveKit a camada saia do tamanho do quadro na tela.
 * Ao lado do chat o quadro tinha ~280 px, e quem assistia recebia 360p a 15
 * fps — o "travando muito" que o grupo descrevia. Pedir a camada alta com a
 * adaptacao ligada nao adianta: no `livekit-client` o tamanho do quadro e
 * TETO, e vence sempre que e menor.
 *
 * A interface nova desliga a adaptacao e decide aqui, com duas regras:
 *
 * - **Transmissao assistida nunca vem abaixo de 720p.** O quadro pequeno e
 *   escolha de disposicao, nao de qualidade; quem aceitou assistir quer ver.
 *   Em destaque ou em tela cheia (quadro alto), 1080p.
 * - **O que ninguem esta vendo e pausado no servidor** (janela minimizada,
 *   palco fechado, quadro fora da tela). Pausar, e nao so esconder: o video
 *   deixa de sair do servidor, que sobe tudo pela internet de casa.
 *
 * A escala do Windows (125%, 150%) conta: um quadro de 400 px CSS a 150% ocupa
 * 600 pixels de verdade. A adaptacao do LiveKit ignorava isso.
 */

export type Qualidade = 'alta' | 'media' | 'baixa';

/** Escolha da pessoa para uma transmissao: automatica, ou fixa. */
export type Preferencia = 'auto' | Qualidade;

export interface QuadroParaRecepcao {
  fonte: 'camera' | 'tela';
  /** Altura do quadro na tela, em pixels CSS. */
  alturaCss: number;
  /** `devicePixelRatio`: a escala do Windows. */
  densidade: number;
  /** Alguem consegue ver este quadro agora. */
  visivel: boolean;
  preferencia: Preferencia;
}

export interface Recepcao {
  /** Falso pausa o video no servidor. */
  ativa: boolean;
  qualidade: Qualidade;
}

/** A partir desta altura real (px), a transmissao vale a camada de 1080p. */
const TELA_ALTA = 600;
/** Camera: tres camadas (180p, 360p e a cheia). */
const CAMERA_ALTA = 480;
const CAMERA_MEDIA = 200;

export function recepcaoPara(q: QuadroParaRecepcao): Recepcao {
  const altura = Math.max(0, q.alturaCss) * Math.max(1, q.densidade || 1);

  let qualidade: Qualidade;
  if (q.preferencia !== 'auto') qualidade = q.preferencia;
  else if (q.fonte === 'tela') qualidade = altura >= TELA_ALTA ? 'alta' : 'media';
  else qualidade = altura >= CAMERA_ALTA ? 'alta' : altura >= CAMERA_MEDIA ? 'media' : 'baixa';

  return { ativa: q.visivel && altura > 0, qualidade };
}

/** Rotulo curto da escolha, para o menu do quadro. */
export const NOMES_DA_PREFERENCIA: Record<Preferencia, string> = {
  auto: 'Automática',
  alta: 'Alta (1080p)',
  media: 'Média (720p)',
  baixa: 'Baixa (360p)',
};

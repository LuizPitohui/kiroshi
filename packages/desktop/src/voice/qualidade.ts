/**
 * Quanta banda cada modo de transmissao recebe.
 *
 * Fica separado do controlador de proposito: e uma regra pura, sem navegador
 * nem estado, e assim da para testa-la sem carregar o aplicativo inteiro.
 */

/**
 * Banda maxima para uma transmissao de tela, em bits por segundo.
 *
 * Os 3 Mbps fixos que existiam antes davam conta de 720p, e era por isso que
 * 1080p aparecia lavado e 60 fps nao acontecia na pratica: faltava banda para
 * o que a pessoa tinha pedido no seletor. O numero agora acompanha a escolha.
 *
 * As contas, para VP8, que e o codec em uso:
 *
 *   720p30    1,5 Mbps   texto nitido em tela pequena
 *   720p60    3 Mbps
 *   1080p30   4 Mbps     leitura confortavel em tela cheia
 *   1080p60   8 Mbps     o dobro de quadros pede perto do dobro de banda
 *
 * Nao e um teto que sempre se gasta: o controle de congestionamento do WebRTC
 * usa menos quando a rede nao aguenta, e o simulcast garante que quem assiste
 * em miniatura receba uma camada pequena. O numero so precisa deixar espaco
 * para a melhor camada ser boa de verdade.
 *
 * O teto de 8 Mbps e deliberado: acima disso o upload de uma fibra domestica
 * comum comeca a sofrer, e quem transmite e justamente quem paga esse custo.
 */
export function bitrateDeTela(altura: number, fps: number): number {
  if (altura <= 720) return fps >= 60 ? 3_000_000 : 1_500_000;
  return fps >= 60 ? 8_000_000 : 4_000_000;
}

/**
 * As restricoes que a captura de tela pede ao navegador.
 *
 * A altura e o que define "1080p": o navegador reduz uma tela 1440p ou 4K
 * para caber, e mantem uma 1080p como esta. A largura acompanha a proporcao
 * do monitor sozinha.
 *
 * NAO existe teto de largura, e a ausencia dele e a correcao.
 *
 * Havia um, escrito como `(altura * 21) / 9` com a intencao declarada de "nao
 * cortar monitor ultrawide". Ele fazia o oposto: 21/9 da 2,333, e nenhum
 * monitor vendido como 21:9 tem essa proporcao — um 2560x1080 e 2,370 e um
 * 3440x1440 e 2,389. Os dois precisam de mais largura do que o teto permitia,
 * entao o pedido ficava impossivel de satisfazer e a captura falhava. Em
 * 32:9 (5120x1440) a diferenca era de 3840 contra 2520: nem perto.
 *
 * Quem tem tela ultrawide era exatamente quem o teto dizia proteger, e era o
 * unico que ele quebrava.
 */
export interface RestricoesDeTela {
  frameRate: { ideal: number; max: number };
  height: { ideal: number; max: number };
}

export function restricoesDeTela(altura: number, fps: number): RestricoesDeTela {
  return {
    frameRate: { ideal: fps, max: fps },
    height: { ideal: altura, max: altura },
  };
}

/**
 * As camadas que a transmissao de tela publica.
 *
 * Duas coisas foram descobertas medindo uma chamada de verdade pelo SFU, e as
 * duas estavam erradas.
 *
 * **O bitrate e a taxa de quadros nunca chegavam.** O `publishTrack` recebia
 * `videoEncoding`, e o LiveKit descarta esse campo quando a fonte e tela:
 * `computeVideoEncodings` faz `if (isScreenShare) videoEncoding =
 * options.screenShareEncoding`. Sem `screenShareEncoding`, ele caia no padrao
 * `h1080fps15` — 1920x1080, 2,5 Mbps e QUINZE quadros por segundo. Quem
 * escolhia "1080p, 60 fps — jogos" recebia 15 fps desde sempre, e o SFU
 * confirmou: camada de topo em 2500 kbps.
 *
 * **A queda era um degrau so.** O padrao publicava duas camadas, 540p e
 * 1080p. Qualquer aperto de banda derrubava direto de 1080p para 540p, o que
 * na tela e a diferenca entre ler o texto e nao ler — "perde qualidade do
 * nada". Com uma camada no meio, a degradacao passa por 720p antes.
 */
export interface CamadaDeTela {
  largura: number;
  altura: number;
  bitrate: number;
  fps: number;
}

/**
 * O que a pessoa vai transmitir, escolhido no seletor de tela.
 *
 *   movimento  jogo, video: o que importa e a fluidez
 *   detalhe    texto, codigo, planilha: o que importa e ler
 *
 * Sem essa escolha a captura de tela ia sem `contentHint`, e o Chromium trata
 * captura sem dica como documento: segura a resolucao e derruba quadros
 * quando aperta. Num jogo isso e exatamente a "travada com a imagem nitida"
 * (04-midia.md, hipotese 4).
 */
export type ConteudoDaTela = 'movimento' | 'detalhe';

/** A dica do WebRTC para cada conteudo (`MediaStreamTrack.contentHint`). */
export function dicaDoConteudo(conteudo: ConteudoDaTela): 'motion' | 'detail' {
  return conteudo === 'movimento' ? 'motion' : 'detail';
}

/**
 * Do que o codificador abre mao quando a banda aperta.
 *
 * Antes saia da taxa de quadros (60 fps = fluidez); agora sai do conteudo,
 * que e a pergunta certa: um jogo a 30 fps tambem quer fluidez, e uma
 * planilha a 60 fps continua querendo o texto nitido.
 */
export function degradacaoDoConteudo(conteudo: ConteudoDaTela): 'maintain-framerate' | 'maintain-resolution' {
  return conteudo === 'movimento' ? 'maintain-framerate' : 'maintain-resolution';
}

export function camadasDeTela(altura: number, fps: number, conteudo: ConteudoDaTela = 'movimento'): CamadaDeTela[] {
  /*
    Texto em 1080p nao tem camada de 360p: texto a 360p nao se le, entao ela
    so gastaria codificacao. A queda vai para 720p a poucos quadros, que ainda
    deixa ler (a receita do Discord para texto: 720p a 5 fps de reserva).
  */
  if (conteudo === 'detalhe' && altura > 720) {
    return [{ largura: 1280, altura: 720, bitrate: 600_000, fps: 5 }];
  }

  /*
    A camada baixa existe para caber em rede ruim, nao para ser bonita. Em jogo
    ela vai a 30 fps: 15 fps com o personagem andando e o que se chama de
    travada, e quem cai para esta camada e justamente quem ja esta sofrendo.
    Em texto de 720p, 15 fps bastam.
  */
  const baixa: CamadaDeTela = { largura: 640, altura: 360, bitrate: 500_000, fps: conteudo === 'movimento' ? Math.min(30, fps) : 15 };

  if (altura <= 720) return [baixa];

  /*
    O degrau do meio. Meia taxa de quadros da escolha, porque numa queda de
    banda o que sustenta a legibilidade e a resolucao — e quem escolheu 60 fps
    ja tem a camada cheia quando a rede aguenta.
  */
  const media: CamadaDeTela = {
    largura: 1280,
    altura: 720,
    bitrate: fps >= 60 ? 2_500_000 : 1_800_000,
    fps: fps >= 60 ? 30 : fps,
  };

  return [baixa, media];
}

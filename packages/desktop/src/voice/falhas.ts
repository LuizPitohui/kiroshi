/**
 * Traduz uma falha de captura em uma frase que leva a pessoa a alguma acao.
 *
 * Funcao pura, e fora do controlador de proposito: o controlador importa o
 * LiveKit inteiro, e testar uma tabela de mensagens nao deveria exigir isso.
 *
 * Por que ela existe separada da captura.
 *
 * Os nomes que o navegador da — `NotReadableError`, `OverconstrainedError` —
 * nao dizem nada para quem esta tentando mostrar a tela para os amigos. Pior:
 * o mesmo nome significa coisas diferentes conforme o que se pediu. Camera
 * ocupada e tela que o Windows recusou capturar chegam aqui com o MESMO
 * `NotReadableError`, e a saida tem que ser diferente.
 *
 * A versao anterior tinha o parametro `o` e ignorava ele em tres dos cinco
 * ramos, devolvendo texto de camera para falha de tela. O resultado apareceu
 * numa captura de tela real: alguem tentou transmitir a tela e leu "a camera
 * esta ocupada por outro programa, feche Teams, Zoom, OBS" — conselho que nao
 * tinha como ajudar, sobre um dispositivo que nem entrava na operacao. A
 * pessoa fecha tres programas, tenta de novo, falha igual, e conclui que o
 * aplicativo esta quebrado.
 *
 * O nome tecnico vai junto, entre parenteses. Ele nao ajuda quem le, e e a
 * unica coisa que torna uma captura de tela diagnosticavel por quem mantem —
 * sem ele, a mensagem acima nao permitia nem saber qual erro tinha ocorrido.
 */

/**
 * O que se estava tentando capturar.
 *
 * `som-da-tela` existe separado de `tela` porque sao falhas diferentes com o
 * mesmo nome de erro, e confundi-las ja aconteceu duas vezes neste arquivo.
 * Quando a captura de tela COM som falha, o que falhou pode ter sido so o
 * audio — e mandar a pessoa mexer no modo de tela cheia do jogo por causa de
 * um problema de placa de som e o mesmo erro de antes, com outro nome.
 */
export type FonteDeMidia = 'camera' | 'tela' | 'som-da-tela';

/** O nome que o navegador deu ao erro, quando deu algum. */
export function codigoDaFalha(erro: unknown): string | null {
  const nome = (erro as { name?: string })?.name;
  return typeof nome === 'string' && nome && nome !== 'Error' ? nome : null;
}

export function explicarFalhaDeMidia(erro: unknown, fonte: FonteDeMidia): string {
  const texto = mensagem(erro, fonte);
  const codigo = codigoDaFalha(erro);
  return codigo ? `${texto} (${codigo})` : texto;
}

function mensagem(erro: unknown, fonte: FonteDeMidia): string {
  if (fonte === 'som-da-tela') return mensagemDoSom(erro);

  const daCamera = fonte === 'camera';
  const coisa = daCamera ? 'a camera' : 'a tela';

  switch (codigoDaFalha(erro) ?? '') {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return daCamera
        ? 'O Windows bloqueou a camera para este aplicativo. Abra Configuracoes > Privacidade e seguranca > Camera e libere para aplicativos da area de trabalho.'
        : 'A captura de tela foi negada. Se voce nao cancelou, abra Configuracoes > Privacidade e seguranca > Gravacao de tela e libere para aplicativos da area de trabalho.';

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return daCamera
        ? 'Nao encontrei nenhuma camera conectada.'
        : 'A tela que voce escolheu nao existe mais. Se era uma janela, ela foi fechada; se era um monitor, foi desconectado. Escolha de novo.';

    case 'NotReadableError':
    case 'TrackStartError':
      return daCamera
        ? /*
             Duas causas, e a segunda so entrou aqui depois de acontecer.

             A primeira e a obvia: outro programa segurando a camera.

             A segunda nao tem mecanismo obvio, mas tem evidencia: numa maquina
             do grupo, DESATIVAR os aprimoramentos de audio do Windows fez a
             camera voltar a abrir. Provavelmente e uma suite de som do
             fabricante (Nahimic, Realtek, Sonic Studio) que mexe em mais coisa
             do que audio. Nao sei explicar o porque; sei que resolveu, e a
             pessoa seguinte merece saber disso antes de passar a tarde
             trocando de webcam.
          */
          'A camera esta ocupada por outro programa. Feche quem estiver usando (Teams, Zoom, OBS, o app do celular como webcam) e tente de novo. Se nao resolver, tente desativar os aprimoramentos de audio do Windows: Win+R, mmsys.cpl, aba Reproducao, dispositivo padrao, Propriedades, e marque "Desativar todos os aprimoramentos" — ja consertou a camera de alguem aqui.'
        : /*
             O caso comum de longe: jogo em tela cheia exclusiva. Nesse modo o
             jogo toma conta da placa de video e o Windows nao entrega a
             imagem para mais ninguem. Trocar para "tela cheia em janela"
             resolve, e e o primeiro conselho por isso.
           */
          'O Windows nao deixou capturar esta tela. Quase sempre e jogo em tela cheia exclusiva: mude o jogo para "tela cheia em janela" (borderless) e tente de novo. Se nao for isso, escolha a outra tela ou a janela do jogo em vez do monitor inteiro.';

    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return daCamera
        ? 'Esta camera nao aceita o formato pedido. Se for camera virtual, confira se o programa que a fornece esta transmitindo.'
        : 'Esta tela nao aceita a qualidade pedida. Escolha uma opcao menor na lista de qualidade e tente de novo.';

    case 'AbortError':
      return `Nao consegui iniciar ${coisa}. Tente de novo.`;

    default: {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return `Nao consegui ligar ${coisa}: ${detalhe}`;
    }
  }
}

/**
 * O som ficou de fora antes de tentar: este Windows nao separa o som do
 * Kiroshi do resto, e o som do sistema inteiro levaria a chamada junto. Quem
 * assiste ouviria a propria voz de volta, que e o retorno relatado pelo dono
 * em 2026-09-25. O corte de versao mora no `main.ts` (`windowsSeparaOSomDoApp`).
 */
export const SOM_DA_TELA_PEDE_WINDOWS_NOVO =
  'este Windows não consegue deixar o som do Kiroshi fora da captura, e quem assiste ouviria a própria voz de volta. O som da tela precisa do Windows 10 versão 2004 ou mais novo.';

/**
 * Por que o som do sistema nao entrou na transmissao.
 *
 * A imagem, nesse ponto, JA esta no ar — o aplicativo tenta de novo sem o som
 * quando o pedido com som falha. Entao estas frases nao sao sobre um fracasso:
 * sao sobre o que ficou de fora e o que fazer para recuperar.
 *
 * Nada aqui fala de tela cheia exclusiva nem de escolher outro monitor. Esses
 * conselhos servem para a imagem, e repeti-los aqui mandaria a pessoa mexer no
 * jogo para resolver um problema de placa de som.
 */
function mensagemDoSom(erro: unknown): string {
  switch (codigoDaFalha(erro) ?? '') {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'o Windows nao autorizou capturar o audio do sistema.';

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'nao ha dispositivo de saida de audio ativo para capturar. Confira se as caixas ou o fone estao conectados e sao o dispositivo padrao.';

    /*
      O caso comum: algum programa segurou a saida de audio em modo exclusivo,
      ou o driver travou. Reiniciar o Kiroshi nao resolve — quem esta segurando
      e o outro programa.

      A mensagem carrega o CAMINHO, e nao so a causa. Quando ela so dizia "modo
      exclusivo", quem batia nisso precisava perguntar para alguem onde fica
      esse ajuste — e a mensagem virava o comeco de uma conversa em vez do fim
      de um problema.

      O comentario fica ACIMA do `return`, e nao depois dele: um comentario de
      varias linhas entre `return` e o valor faz o JavaScript inserir ponto e
      virgula sozinho e devolver `undefined`. O teste pegou isso na hora, mas
      vale o registro para nao voltar.
    */
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        'o Windows recusou entregar o audio do sistema. Quase sempre e outro ' +
        'programa segurando a saida em modo exclusivo — alguns jogos, programas ' +
        'de audio e o painel da placa de som fazem isso. Para desligar: tecle ' +
        'Win+R, digite mmsys.cpl, aba Reproducao, escolha o dispositivo padrao, ' +
        'Propriedades, aba Avancado, e desmarque as duas caixas de modo ' +
        'exclusivo. Se nao resolver, trocar o dispositivo de saida padrao e ' +
        'voltar costuma destravar o driver.'
      );

    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'o dispositivo de saida nao aceita o formato de captura pedido.';

    default: {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return `o Windows recusou capturar o audio do sistema: ${detalhe}`;
    }
  }
}

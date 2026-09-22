import { compareIds } from '@kiroshi/shared';

/**
 * Onde entra o divisor de "nao lidas" na conversa.
 *
 * Funcao pura porque a regra tem casos de borda que so aparecem em situacoes
 * dificeis de reproduzir na mao — canal nunca aberto, historico pela metade,
 * as unicas mensagens novas sendo as suas. Testar isso mexendo no aplicativo
 * exigiria duas contas e paciencia; aqui e uma chamada de funcao.
 *
 * Tres decisoes moram aqui.
 *
 * **As suas mensagens nao contam.** Voce nao tem mensagem nao lida de si
 * mesmo. Sem esta regra, responder em um canal e voltar depois mostrava o
 * divisor logo acima do que voce mesmo escreveu, o que nao informa nada.
 *
 * **Sem marcador de leitura e com historico pela metade, nao ha divisor.**
 * Quando nunca se abriu o canal, o servidor nao sabe onde voce parou, e a
 * janela carregada comeca num ponto arbitrario do meio da conversa. Um
 * divisor ali diria "voce parou aqui" apontando para um lugar onde voce nunca
 * esteve. Com o historico inteiro na tela o primeiro item E o comeco, e ai o
 * divisor esta certo.
 *
 * **O corte e congelado por quem chama.** Esta funcao recebe a ultima lida
 * como parametro em vez de ler do estado justamente para isso: o aplicativo
 * marca o canal como lido segundos depois de abrir, e se o divisor
 * acompanhasse esse valor ele sumiria na cara de quem acabou de chegar, antes
 * de ter servido para alguma coisa.
 */

export interface MensagemParaCorte {
  id: string;
  authorId: string;
}

export interface EntradaDoCorte {
  /** As mensagens carregadas, da mais antiga para a mais nova. */
  mensagens: readonly MensagemParaCorte[];
  /** O marcador de leitura, congelado na entrada do canal. */
  ultimaLida: string | null;
  /** Meu proprio id, para nao contar o que eu mesmo escrevi. */
  euSou: string | null;
  /** O historico inteiro esta carregado (nao ha nada mais antigo por vir). */
  historicoCompleto: boolean;
}

/**
 * O indice da primeira mensagem nao lida, ou `null` quando nao ha divisor.
 *
 * O divisor vai ACIMA dessa mensagem.
 */
export function corteDeNaoLidas({
  mensagens,
  ultimaLida,
  euSou,
  historicoCompleto,
}: EntradaDoCorte): number | null {
  if (mensagens.length === 0) return null;

  const deOutraPessoa = (m: MensagemParaCorte): boolean => m.authorId !== euSou;

  if (ultimaLida === null) {
    if (!historicoCompleto) return null;
    const primeira = mensagens.findIndex(deOutraPessoa);
    return primeira === -1 ? null : primeira;
  }

  const indice = mensagens.findIndex(
    (m) => compareIds(m.id, ultimaLida) > 0 && deOutraPessoa(m),
  );

  // Nada depois do marcador, ou so coisa minha: nao ha o que separar.
  if (indice === -1) return null;

  // O divisor no primeiro item so faz sentido se ali for mesmo o comeco. Com
  // historico pela metade, a mensagem do topo e so a mais antiga que coube na
  // janela — e o divisor acima dela sugeriria que tudo que se ve e novo.
  if (indice === 0 && !historicoCompleto) return null;

  return indice;
}

/**
 * Quantas mensagens nao lidas existem, para o rotulo do divisor e do botao.
 *
 * Conta a partir do corte, e nao do marcador, para as duas coisas sempre
 * dizerem o mesmo numero.
 */
export function quantasNaoLidas(
  mensagens: readonly MensagemParaCorte[],
  corte: number | null,
  euSou: string | null,
): number {
  if (corte === null) return 0;
  let total = 0;
  for (let i = corte; i < mensagens.length; i++) {
    if (mensagens[i]!.authorId !== euSou) total++;
  }
  return total;
}

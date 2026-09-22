/**
 * O DIA de uma mensagem, para quando a HORA ja esta escrita em outro lugar.
 *
 * Nasceu com a lista de mensagens virando log de transmissao. Ali a calha da
 * esquerda carrega o horario de toda mensagem, em monoespacada, sempre
 * visivel. Repetir "hoje as 05:12" na linha do autor colocaria o mesmo dado
 * duas vezes na mesma tela — e foi exatamente esse conflito que, no desenho
 * antigo, empurrou a hora para so aparecer ao passar o mouse.
 *
 * Entao aqui sobra o que a calha NAO diz: que dia foi.
 *
 * E devolve VAZIO para hoje, de proposito. A esmagadora maioria das mensagens
 * que alguem le foi escrita hoje, e escrever "hoje" em todas elas gasta uma
 * palavra por linha para informar o caso comum. O que precisa de marca e a
 * excecao — a conversa de ontem, a de semana passada.
 */
export function diaDaMensagem(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);

  // Data invalida nao vira "Invalid Date" na tela: vira nada.
  if (Number.isNaN(data.getTime())) return '';

  /*
    A comparacao e por DIA DE CALENDARIO, nao por horas decorridas.
    Uma mensagem das 23h50 e a resposta dela a 00h10 estao a vinte minutos de
    distancia e em dias diferentes; quem le quer saber disso. Subtrair
    milissegundos daria "hoje" para as duas.
  */
  if (data.toDateString() === agora.toDateString()) return '';

  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return 'ontem';

  /*
    Dentro da semana, o nome do dia diz mais que o numero: "sexta" situa
    melhor que "19/09" para quem esta rolando a conversa para tras. Passou de
    seis dias, o nome deixa de ser util — "sexta" pode ser a de tres semanas
    atras — e a data volta.
  */
  const seisDiasAtras = new Date(agora);
  seisDiasAtras.setDate(agora.getDate() - 6);
  seisDiasAtras.setHours(0, 0, 0, 0);
  if (data >= seisDiasAtras) {
    return data.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
  }

  return data.toLocaleDateString('pt-BR');
}

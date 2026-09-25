/**
 * A conversa como sequencia de linhas: separadores de dia, o divisor de
 * novas e as mensagens, cada uma sabendo se continua a anterior.
 *
 * Pura e com o "agora" injetado: as regras de agrupar tem bordas que so
 * aparecem em situacoes chatas de reproduzir (virada da meia-noite, resposta
 * no meio de uma sequencia, divisor em cima de um dia novo), e teste que le o
 * relogio da maquina reprova sozinho na virada do mes.
 */

export interface MensagemParaLinha {
  id: string;
  authorId: string;
  createdAt: string;
  type: string;
  /** Resposta a outra mensagem: nunca continua a anterior. */
  reference: unknown;
}

export type Linha =
  /** Separador de dia. `novas` junta o divisor quando os dois caem no mesmo lugar. */
  | { tipo: 'dia'; chave: string; rotulo: string; novas: number | null }
  | { tipo: 'novas'; chave: string; quantas: number }
  | { tipo: 'mensagem'; chave: string; indice: number; continua: boolean };

/** Quanto tempo a mesma pessoa pode ficar calada e ainda continuar o bloco. */
export const JANELA_DO_BLOCO_MS = 7 * 60 * 1000;

const COMUNS = new Set(['DEFAULT', 'REPLY']);

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * O rotulo do separador de dia.
 *
 * Por dia de CALENDARIO, nao por horas: a mensagem das 23h50 e a resposta da
 * 00h10 estao a vinte minutos e em dias diferentes. Dentro da semana, o nome
 * do dia situa melhor que o numero; fora dela, a data inteira.
 */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  if (mesmoDia(data, agora)) return 'Hoje';
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(data, ontem)) return 'Ontem';

  const seisDiasAtras = new Date(agora);
  seisDiasAtras.setDate(agora.getDate() - 6);
  seisDiasAtras.setHours(0, 0, 0, 0);
  const diaEMes = data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  if (data >= seisDiasAtras && data <= agora) {
    const semana = data.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
    return `${semana}, ${diaEMes}`;
  }
  if (data.getFullYear() === agora.getFullYear()) return diaEMes;
  return data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "22:31", para a calha e o cabecalho. */
export function horaCurta(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** A data inteira, para a dica em cima do horario. */
export function dataCompleta(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Monta as linhas.
 *
 * Uma mensagem CONTINUA a anterior (sem nome nem avatar) quando e da mesma
 * pessoa, dentro da janela de 7 minutos, no mesmo dia, as duas sao mensagens
 * comuns e ela nao e resposta. E nunca a primeira depois do divisor de novas:
 * sem cabecalho, o divisor passaria a cortar ao meio o que parece uma fala so.
 */
export function montarLinhas(
  mensagens: readonly MensagemParaLinha[],
  corte: number | null,
  naoLidas: number,
  agora: Date = new Date(),
): Linha[] {
  const linhas: Linha[] = [];
  let anterior: MensagemParaLinha | null = null;
  let diaAnterior: Date | null = null;

  mensagens.forEach((m, indice) => {
    const data = new Date(m.createdAt);
    const valida = !Number.isNaN(data.getTime());
    const diaNovo = valida && (diaAnterior === null || !mesmoDia(data, diaAnterior));
    const divisor = indice === corte && naoLidas > 0;

    if (diaNovo) {
      linhas.push({ tipo: 'dia', chave: `dia-${m.id}`, rotulo: rotuloDoDia(m.createdAt, agora), novas: divisor ? naoLidas : null });
    } else if (divisor) {
      linhas.push({ tipo: 'novas', chave: `novas-${m.id}`, quantas: naoLidas });
    }

    const continua =
      anterior !== null &&
      !diaNovo &&
      !divisor &&
      anterior.authorId === m.authorId &&
      COMUNS.has(anterior.type) &&
      COMUNS.has(m.type) &&
      !m.reference &&
      valida &&
      data.getTime() - new Date(anterior.createdAt).getTime() < JANELA_DO_BLOCO_MS;

    linhas.push({ tipo: 'mensagem', chave: m.id, indice, continua });
    anterior = m;
    if (valida) diaAnterior = data;
  });

  return linhas;
}

/** "kaya está digitando…", para os nomes de quem digita agora. */
export function quemDigita(nomes: readonly string[]): string {
  if (nomes.length === 0) return '';
  if (nomes.length === 1) return `${nomes[0]} está digitando…`;
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]} estão digitando…`;
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]} estão digitando…`;
  return 'Várias pessoas estão digitando…';
}

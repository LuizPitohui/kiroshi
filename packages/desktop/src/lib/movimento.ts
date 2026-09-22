/**
 * Preferencia de movimento do aplicativo.
 *
 * O padrao e obedecer ao sistema operacional: quem desligou os efeitos de
 * animacao no Windows fez isso por um motivo, e muitas vezes o motivo e
 * enjoo, tontura ou enxaqueca. Ignorar essa escolha seria decidir pela pessoa
 * uma coisa que ela ja decidiu.
 *
 * Mas "seguir o sistema" tambem prende quem quer o contrario. Nao e raro ter
 * as animacoes do Windows desligadas por causa do desempenho da maquina, e
 * ainda assim querer que um aplicativo se mova. Entao existe a escolha, com
 * tres estados em vez de um interruptor: seguir, forcar movimento, forcar
 * ausencia. O do meio nao existiria se o sistema fosse a unica fonte.
 *
 * A marca vai no <html> e o CSS decide o resto; nada aqui sabe quais
 * transicoes existem.
 */

const CHAVE = 'kiroshi.movimento';

export type Movimento = 'sistema' | 'completo' | 'reduzido';

function valido(v: string | null): v is Movimento {
  return v === 'sistema' || v === 'completo' || v === 'reduzido';
}

function ler(): Movimento {
  try {
    const guardado = localStorage.getItem(CHAVE);
    return valido(guardado) ? guardado : 'sistema';
  } catch {
    // Armazenamento bloqueado: segue o sistema, que e o padrao seguro.
    return 'sistema';
  }
}

function pintar(valor: Movimento): void {
  // "sistema" nao escreve nada: sem o atributo, a consulta de midia do CSS
  // manda sozinha, que e exatamente o comportamento desejado.
  if (valor === 'sistema') delete document.documentElement.dataset.mov;
  else document.documentElement.dataset.mov = valor;
}

function escrever(valor: string): Movimento {
  const escolha: Movimento = valido(valor) ? valor : 'sistema';
  try {
    localStorage.setItem(CHAVE, escolha);
  } catch {
    // Sem guardar, vale so para esta sessao.
  }
  pintar(escolha);
  // Devolve o que foi mesmo aplicado: quem chama guarda isso no estado, e
  // assim a tela nunca mostra uma escolha que o modulo normalizou por baixo.
  return escolha;
}

/** Roda antes do primeiro render, para nao haver um quadro com o valor errado. */
function instalar(): void {
  pintar(ler());
}

export const aplicarMovimento = { ler, escrever, instalar };

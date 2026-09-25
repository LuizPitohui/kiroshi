/*
  As preferencias de notificacao deste aparelho: se avisa no Windows, se pisca
  a janela e se mostra o contador na barra de tarefas. Por aparelho, e nao na
  conta — o notebook do trabalho pode querer silencio que o computador de casa
  nao quer. O que e por servidor e por canal fica na conta (servidor).
*/

export interface PreferenciasDeNotificacao {
  /** Notificacao do Windows para mensagens. */
  windows: boolean;
  /** Piscar a janela na barra de tarefas quando chega algo. */
  piscar: boolean;
  /** O selo de mencoes nao lidas no icone da barra de tarefas. */
  contador: boolean;
}

const CHAVE = 'kiroshi.notificacoes';
const PADRAO: PreferenciasDeNotificacao = { windows: true, piscar: true, contador: true };

const ouvintes = new Set<() => void>();
let atuais: PreferenciasDeNotificacao | null = null;

export function lerPreferenciasDeNotificacao(): PreferenciasDeNotificacao {
  if (atuais) return atuais;
  try {
    const salvas = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Partial<PreferenciasDeNotificacao>;
    atuais = {
      windows: salvas.windows !== false,
      piscar: salvas.piscar !== false,
      contador: salvas.contador !== false,
    };
  } catch {
    atuais = PADRAO;
  }
  return atuais;
}

export function gravarPreferenciasDeNotificacao(patch: Partial<PreferenciasDeNotificacao>): PreferenciasDeNotificacao {
  atuais = { ...lerPreferenciasDeNotificacao(), ...patch };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atuais));
  } catch {
    // sem armazenamento: vale ate fechar
  }
  for (const ouvinte of ouvintes) ouvinte();
  return atuais;
}

export function assinarPreferenciasDeNotificacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

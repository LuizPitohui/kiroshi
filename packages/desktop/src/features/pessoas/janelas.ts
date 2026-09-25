import { create } from 'zustand';

/*
  As janelas de moderacao de uma pessoa (apelido, expulsar, banir, passar a
  posse) moram num lugar so, montado uma vez na casca.

  O menu que as abre fecha ao escolher o item — e com ele iria junto uma
  janela que morasse dentro dele. Assim o clique direito no painel de
  membros, o menu "..." da pagina de Membros e o cartao de perfil abrem a
  mesma janela, com o mesmo texto e a mesma conferencia.
*/

export type JanelaDaPessoa = 'apelido' | 'expulsar' | 'banir' | 'posse';

interface Estado {
  aberta: { tipo: JanelaDaPessoa; guildId: string; userId: string } | null;
  abrir: (tipo: JanelaDaPessoa, guildId: string, userId: string) => void;
  fechar: () => void;
}

export const useJanelasDaPessoa = create<Estado>((set) => ({
  aberta: null,
  abrir: (tipo, guildId, userId) => set({ aberta: { tipo, guildId, userId } }),
  fechar: () => set({ aberta: null }),
}));

export const abrirJanela = (tipo: JanelaDaPessoa, guildId: string, userId: string) =>
  useJanelasDaPessoa.getState().abrir(tipo, guildId, userId);

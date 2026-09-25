import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/index.js';
import { Botao } from '../../design/primitivos/index.js';
import { ContextoDaChamada, type FonteDaChamada } from './fonte.js';
import type { ParticipanteParaQuadro } from './quadros.js';
import type { FonteDeVideo } from './videos.js';
import { Palco } from './Palco.js';

/*
  O palco na vitrine, sem servidor de midia: participantes de mentira e video
  sintetico (um canvas animado). Prova disposicoes, destaque, convite, fita e —
  o principal — que o <video> muda de lugar sem ser recriado.
*/

interface PessoaDemo {
  userId: string;
  nome: string;
  local: boolean;
  camera: boolean;
  tela: boolean;
  falando: boolean;
  mudo: boolean;
  surdo: boolean;
  assistindo: string[];
}

const GENTE: PessoaDemo[] = [
  { userId: 'demo-eu', nome: 'pitohui', local: true, camera: false, tela: false, falando: false, mudo: false, surdo: false, assistindo: [] },
  { userId: 'demo-kaya', nome: 'kaya', local: false, camera: false, tela: true, falando: false, mudo: true, surdo: false, assistindo: [] },
  { userId: 'demo-rafa', nome: 'rafa', local: false, camera: true, tela: false, falando: true, mudo: false, surdo: false, assistindo: ['demo-kaya'] },
  { userId: 'demo-bruno', nome: 'bruno', local: false, camera: false, tela: false, falando: false, mudo: false, surdo: true, assistindo: ['demo-kaya'] },
];

interface EstadoDemo {
  pessoas: PessoaDemo[];
  assistindoEu: string[];
  versao: number;
  mudar: (userId: string, parte: Partial<PessoaDemo>) => void;
  assistir: (userId: string, sim: boolean) => void;
  entrar: () => void;
  sair: () => void;
}

const useDemo = create<EstadoDemo>((set) => ({
  pessoas: GENTE,
  assistindoEu: [],
  versao: 0,
  mudar: (userId, parte) => set((s) => ({ pessoas: s.pessoas.map((p) => (p.userId === userId ? { ...p, ...parte } : p)), versao: s.versao + 1 })),
  assistir: (userId, sim) => set((s) => ({ assistindoEu: sim ? [...new Set([...s.assistindoEu, userId])] : s.assistindoEu.filter((x) => x !== userId) })),
  entrar: () =>
    set((s) => {
      const n = s.pessoas.length;
      const userId = `demo-extra-${n}`;
      return { pessoas: [...s.pessoas, { userId, nome: `convidado ${n - 3}`, local: false, camera: n % 2 === 0, tela: false, falando: false, mudo: false, surdo: false, assistindo: [] }], versao: s.versao + 1 };
    }),
  sair: () => set((s) => ({ pessoas: s.pessoas.length > 1 ? s.pessoas.slice(0, -1) : s.pessoas, versao: s.versao + 1 })),
}));

// ---------------------------------------------------------------------------
// Video sintetico
// ---------------------------------------------------------------------------

const sinteticos = new Map<string, FonteDeVideo>();

function videoSintetico(chave: string, rotulo: string, cor: string): FonteDeVideo {
  const existente = sinteticos.get(chave);
  if (existente) return existente;
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const inicio = performance.now();
  // setInterval, e nao requestAnimationFrame: segue desenhando com a janela escondida.
  setInterval(() => {
    const t = (performance.now() - inicio) / 1000;
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? cor : '#16161a';
      ctx.fillRect(((i * 120 + t * 160) % 1400) - 120, 200 + Math.sin(t + i) * 80, 90, 320);
    }
    ctx.fillStyle = '#f4f4f5';
    ctx.font = '600 56px Rajdhani, sans-serif';
    ctx.fillText(rotulo.toUpperCase(), 48, 96);
    ctx.font = '32px "JetBrains Mono", monospace';
    ctx.fillText(`${t.toFixed(1)} s`, 48, 660);
  }, 33);
  const fluxo = canvas.captureStream(30);
  const fonte: FonteDeVideo = {
    attach: (el) => {
      el.srcObject = fluxo;
      return el;
    },
    detach: (el) => {
      if (el.srcObject === fluxo) el.srcObject = null;
      return el;
    },
  };
  sinteticos.set(chave, fonte);
  return fonte;
}

const fonteDemo: FonteDaChamada = {
  usarParticipantes() {
    const pessoas = useDemo((s) => s.pessoas);
    const assistindoEu = useDemo((s) => s.assistindoEu);
    const participantes = useMemo<ParticipanteParaQuadro[]>(
      () => pessoas.map((p) => ({ userId: p.userId, isLocal: p.local, hasVideo: p.camera, hasScreenShare: p.tela, assistindo: p.assistindo })),
      [pessoas],
    );
    return { participantes, assistindoEu };
  },
  usarPessoa(userId) {
    return useDemo(
      useShallow((s) => {
        const p = s.pessoas.find((x) => x.userId === userId);
        return { falando: p?.falando ?? false, mudo: p?.mudo ?? false, surdo: p?.surdo ?? false, pelaModeracao: false, sinal: 'good' as const };
      }),
    );
  },
  usarVersaoDeMidia() {
    return useDemo((s) => s.versao);
  },
  videoDe(userId, fonte) {
    const p = useDemo.getState().pessoas.find((x) => x.userId === userId);
    if (!p) return null;
    return videoSintetico(`${userId}|${fonte}`, fonte === 'tela' ? `tela de ${p.nome}` : p.nome, fonte === 'tela' ? '#dc2626' : '#22d3ee');
  },
  assistir: (userId) => useDemo.getState().assistir(userId, true),
  pararDeAssistir: (userId) => useDemo.getState().assistir(userId, false),
  mede: false,
};

/** Os nomes da demonstracao no store, para o quadro achar (so na vitrine). */
function useNomesDaDemonstracao() {
  const pessoas = useDemo((s) => s.pessoas);
  useEffect(() => {
    useStore.setState((s) => {
      const users = new Map(s.users);
      for (const p of pessoas) {
        if (!users.has(p.userId)) {
          users.set(p.userId, { id: p.userId, username: p.nome, displayName: p.nome, avatarUrl: null, bannerUrl: null, bio: null, pronouns: null, accentColor: null, bot: false, createdAt: new Date(0).toISOString() });
        }
      }
      return { users };
    });
  }, [pessoas]);
}

export function PalcoDeDemonstracao() {
  useNomesDaDemonstracao();
  const pessoas = useDemo((s) => s.pessoas);
  const mudar = useDemo((s) => s.mudar);
  const kaya = pessoas.find((p) => p.userId === 'demo-kaya');
  const rafa = pessoas.find((p) => p.userId === 'demo-rafa');
  const eu = pessoas.find((p) => p.local);

  const controles = (
    <div data-vitrine="palco-controles" className="flex h-[64px] shrink-0 flex-wrap items-center justify-center gap-2">
      <Botao tamanho="sm" onClick={() => kaya && mudar('demo-kaya', { tela: !kaya.tela })}>
        {kaya?.tela ? 'Kaya para de transmitir' : 'Kaya transmite'}
      </Botao>
      <Botao tamanho="sm" onClick={() => rafa && mudar('demo-rafa', { camera: !rafa.camera })}>
        Câmera do Rafa
      </Botao>
      <Botao tamanho="sm" onClick={() => eu && mudar(eu.userId, { tela: !eu.tela })}>
        {eu?.tela ? 'Parar minha tela' : 'Minha tela'}
      </Botao>
      <Botao tamanho="sm" onClick={() => kaya && mudar('demo-kaya', { falando: !kaya.falando })}>
        Kaya fala
      </Botao>
      <Botao tamanho="sm" onClick={() => useDemo.getState().entrar()}>
        + Alguém entra
      </Botao>
      <Botao tamanho="sm" onClick={() => useDemo.getState().sair()}>
        − Alguém sai
      </Botao>
    </div>
  );

  return (
    <ContextoDaChamada.Provider value={fonteDemo}>
      <div data-vitrine="palco-demo" className="flex h-[620px] flex-col border border-borda">
        <Palco guildId={null} canalId={null} controles={controles} className="min-h-0 flex-1" />
      </div>
    </ContextoDaChamada.Provider>
  );
}

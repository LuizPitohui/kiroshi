import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { voice } from '../../voice/controller.js';
import { recepcaoPara, type Preferencia } from '../../voice/recepcao.js';
import { resumirEnvio, resumirRecebimento, type EntradaDeStats } from '../../voice/metricas.js';
import { registrarAmostra, resumoEnviado, resumoRecebido, somarJanela, type AmostraDeTravada, type ResumoEnviado, type ResumoRecebido } from './medicao.js';

// ---------------------------------------------------------------------------
// Janela oculta: um ouvinte so, para todos os quadros
// ---------------------------------------------------------------------------

let oculta = false;
const ouvintes = new Set<() => void>();
let desligar: (() => void) | null = null;

function assinarOculta(avisar: () => void): () => void {
  if (ouvintes.size === 0) {
    desligar =
      window.kiroshi?.window.onOcultaChange?.((valor) => {
        oculta = valor;
        for (const o of ouvintes) o();
      }) ?? null;
  }
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
    if (ouvintes.size === 0) {
      desligar?.();
      desligar = null;
    }
  };
}

/** A janela esta minimizada ou escondida na bandeja. */
export function useJanelaOculta(): boolean {
  return useSyncExternalStore(assinarOculta, () => oculta, () => false);
}

// ---------------------------------------------------------------------------
// Recepcao: o quadro diz ao motor que camada quer e se alguem o ve
// ---------------------------------------------------------------------------

export interface AlvoDeRecepcao {
  userId: string;
  fonte: 'camera' | 'tela';
  preferencia: Preferencia;
}

/**
 * Mede o quadro (altura e se esta na tela) e pede a recepcao certa. `null`
 * para quem nao recebe nada (o proprio video, convite ainda nao aceito).
 */
export function useRecepcao(caixa: RefObject<HTMLElement | null>, alvo: AlvoDeRecepcao | null): void {
  const escondida = useJanelaOculta();
  const [altura, setAltura] = useState(0);
  const [naTela, setNaTela] = useState(true);
  const ativo = alvo !== null;

  useEffect(() => {
    const el = caixa.current;
    if (!el || !ativo) return;
    const tamanho = new ResizeObserver(([e]) => setAltura(Math.round(e?.contentRect.height ?? 0)));
    const visao = new IntersectionObserver(([e]) => setNaTela(Boolean(e?.isIntersecting)));
    tamanho.observe(el);
    visao.observe(el);
    return () => {
      tamanho.disconnect();
      visao.disconnect();
    };
  }, [caixa, ativo]);

  const userId = alvo?.userId;
  const fonte = alvo?.fonte;
  const preferencia = alvo?.preferencia ?? 'auto';

  useEffect(() => {
    if (!userId || !fonte) return;
    voice.ajustarRecepcao(
      userId,
      fonte,
      recepcaoPara({ fonte, alturaCss: altura, densidade: window.devicePixelRatio, visivel: !escondida && naTela, preferencia }),
    );
  }, [userId, fonte, preferencia, altura, naTela, escondida]);

  // Ao sair de cena (ou trocar de alvo), devolve: o motor espera um instante
  // antes de pausar, para a troca de lugar nao virar travada.
  useEffect(() => {
    if (!userId || !fonte) return;
    return () => voice.ajustarRecepcao(userId, fonte, null);
  }, [userId, fonte]);
}

// ---------------------------------------------------------------------------
// Qualidade medida
// ---------------------------------------------------------------------------

const INTERVALO_DE_MEDIDA_MS = 2000;

/** O que chega de verdade de um video: imagem, banda e travadas nos ultimos 30 s. */
export function useQualidadeRecebida(userId: string | null, fonte: 'camera' | 'tela', ativo: boolean): ResumoRecebido | null {
  const [resumo, setResumo] = useState<ResumoRecebido | null>(null);
  useEffect(() => {
    if (!userId || !ativo) {
      setResumo(null);
      return;
    }
    let vivo = true;
    let anterior: EntradaDeStats[] | null = null;
    let amostras: AmostraDeTravada[] = [];
    const medir = async () => {
      const atual = await voice.estatisticasDeVideo(userId, fonte);
      if (!vivo || !atual) return;
      const video = resumirRecebimento(atual, anterior);
      anterior = atual;
      if (video?.travadas != null) {
        amostras = registrarAmostra(amostras, { em: Date.now(), travadas: video.travadas, segundos: video.segundosTravado ?? 0 });
      }
      setResumo(resumoRecebido(video, somarJanela(amostras)));
    };
    void medir();
    const relogio = setInterval(() => void medir(), INTERVALO_DE_MEDIDA_MS);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [userId, fonte, ativo]);
  return resumo;
}

/** O que a minha transmissao esta mandando: topo, banda somada e limitacao. */
export function useQualidadeEnviada(ativo: boolean): ResumoEnviado | null {
  const [resumo, setResumo] = useState<ResumoEnviado | null>(null);
  useEffect(() => {
    if (!ativo) {
      setResumo(null);
      return;
    }
    let vivo = true;
    let anterior: EntradaDeStats[] | null = null;
    const medir = async () => {
      const atual = await voice.estatisticasDoEnvio();
      if (!vivo || !atual) return;
      setResumo(resumoEnviado(resumirEnvio(atual, anterior)));
      anterior = atual;
    };
    void medir();
    const relogio = setInterval(() => void medir(), INTERVALO_DE_MEDIDA_MS);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [ativo]);
  return resumo;
}

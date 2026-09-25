import { useEffect, useRef } from 'react';
import { AVISO_DE_SOLIDAO, voice, type VoiceState } from '../../voice/controller.js';
import { useAnunciarChamada } from '../../hooks/useAnunciarChamada.js';
import { avisar } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { alternarFone, alternarMicrofone, avisarServidor } from '../casca/acoesDeVoz.js';
import { useEstadoDoPalco } from './estadoDoPalco.js';
import * as videos from './videos.js';

/** Quais videos existem na chamada agora: camera ligada, ou tela minha ou assistida. */
function videosVivos(v: VoiceState): string {
  const chaves: string[] = [];
  for (const p of v.participants) {
    if (p.hasVideo) chaves.push(`${p.userId}|camera`);
    if (p.hasScreenShare && (p.isLocal || v.assistindo.includes(p.userId))) chaves.push(`${p.userId}|tela`);
  }
  return chaves.sort().join(',');
}

/**
 * A faxina da chamada, montada uma vez na casca (sem desenhar nada):
 *
 * - quem entra e quem sai: som (sempre ligado na interface nova, decisao do
 *   dono) e anuncio para leitor de tela, pelo mesmo gancho da 1.x;
 * - solta os videos de quem desligou a camera, parou de transmitir ou saiu —
 *   o registro guarda os elementos entre telas, entao alguem precisa soltar;
 * - chamada encerrada, escolhas do palco zeradas;
 * - erro da voz (camera ocupada, microfone negado, queda) vira aviso, em vez
 *   de ficar parado num campo que so a 1.x lia;
 * - com a chamada aberta, os atalhos do Discord: Ctrl+Shift+M (microfone) e
 *   Ctrl+Shift+D (som). Com a janela em foco; os globais, com jogo na frente,
 *   chegam com os ajustes de atalhos.
 */
export function ZeladorDaChamada() {
  useAnunciarChamada({ somSempreLigado: true });
  const vivos = useVoz(videosVivos);
  const naChamada = useVoz((v) => v.connected || v.connecting);
  const erro = useVoz((v) => v.error);
  // Saindo nao conta: sair desliga camera e tela, e avisar isso punha a pessoa de volta no canal.
  const midia = useVoz((v) => (v.connected && !v.saindo ? `${v.cameraOn}|${v.screenSharing}` : null));
  const midiaAnterior = useRef<string | null>(null);

  /*
    Camera e tela mudam por varios caminhos (o botao, o seletor, a transmissao
    que o Windows encerra sozinho): quem conta ao servidor e daqui, de um lugar
    so. A primeira leitura depois de conectar nao conta — a entrada ja levou o
    estado inteiro.
  */
  useEffect(() => {
    if (midia && midiaAnterior.current !== null && midiaAnterior.current !== midia) avisarServidor();
    midiaAnterior.current = midia;
  }, [midia]);

  useEffect(() => {
    videos.podar(new Set(vivos ? vivos.split(',') : []));
  }, [vivos]);

  useEffect(() => {
    if (!naChamada) useEstadoDoPalco.getState().limpar();
  }, [naChamada]);

  useEffect(() => {
    if (!erro) return;
    // Desligado por ficar sozinho: fica na tela ate a pessoa voltar e ver.
    if (erro === AVISO_DE_SOLIDAO) avisar.lembrete('Chamada encerrada', erro);
    else avisar.erro('Chamada', erro);
    voice.clearError();
  }, [erro]);

  useEffect(() => {
    if (!naChamada) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'm') {
        e.preventDefault();
        void alternarMicrofone();
      } else if (tecla === 'd') {
        e.preventDefault();
        void alternarFone();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [naChamada]);

  return null;
}

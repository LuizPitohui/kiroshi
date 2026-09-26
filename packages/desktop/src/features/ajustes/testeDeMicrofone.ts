import { useEffect, useRef, useState } from 'react';
import { voice, type VoiceSettings } from '../../voice/controller.js';
import { aplicarEmFaixaAvulsa, aplicarLimpeza } from '../../voice/cadeia.js';
import { limiarDoPortao, nomeDoMotor, restricoesDoNavegador } from '../../voice/limpeza.js';
import type { ProcessadorDeLimpeza } from '../../voice/ruido.js';

/** O motivo da falha do microfone em palavras de quem usa, pelo nome do erro do navegador. */
function explicarFalhaDoMicrofone(falha: unknown): string {
  const nome = falha instanceof DOMException || falha instanceof Error ? falha.name : '';
  if (nome === 'NotAllowedError') return 'O Windows negou o microfone ao Kiroshi. Libere em Configurações do Windows > Privacidade > Microfone.';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Nenhum microfone encontrado. Confira se ele está conectado.';
  if (nome === 'NotReadableError') return 'O microfone está ocupado por outro programa.';
  return 'Não consegui abrir o microfone.';
}

/** Nivel em dBFS (valor eficaz): 0 e o maximo, silencio fica perto de -90. */
export function nivelEmDb(amostras: Float32Array): number {
  let soma = 0;
  for (const v of amostras) soma += v * v;
  const eficaz = Math.sqrt(soma / Math.max(1, amostras.length));
  return eficaz > 0 ? Math.max(-90, 20 * Math.log10(eficaz)) : -90;
}

export interface TesteDeMicrofone {
  /** O nivel agora, antes do portao; null com o teste parado. */
  nivelDb: number | null;
  erro: string | null;
  /** Quem limpa o som ("Navegador" ou "Nenhum"). */
  motor: string | null;
}

/**
 * O teste de microfone: a MESMA entrada da chamada (limpeza do navegador e
 * portao), com duas saidas.
 *
 *   O nivel, ANTES do portao: e com ele que se escolhe o limiar. O medidor da
 *   1.x media depois do portao — tudo abaixo do limiar ja vinha zerado — e era
 *   linear, sem a marca do limiar: impossivel calibrar no olho.
 *
 *   O retorno (ouvir a si mesmo), DEPOIS da limpeza e do portao: e o que os
 *   outros ouvem, a unica coisa que interessa testar. Com o volume acima de
 *   100%, a 1.x estourava aqui e fechava o teste calada.
 *
 * Nada passa pela sala: e tudo local.
 */
export function useTesteDeMicrofone(
  ativo: boolean,
  ouvir: boolean,
  ajustes: Pick<
    VoiceSettings,
    | 'inputDeviceId'
    | 'outputDeviceId'
    | 'outputVolume'
    | 'noiseSuppression'
    | 'echoCancellation'
    | 'autoGainControl'
    | 'voiceIsolation'
    | 'inputMode'
    | 'limiarDeVozDb'
  >,
): TesteDeMicrofone {
  const [nivelDb, setNivelDb] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [motor, setMotor] = useState<string | null>(null);
  const processador = useRef<ProcessadorDeLimpeza | null>(null);

  useEffect(() => {
    if (!ativo) return;
    setErro(null);
    let cancelado = false;
    let fluxo: MediaStream | null = null;
    let contexto: AudioContext | null = null;
    let retorno: HTMLAudioElement | null = null;
    let relogio: ReturnType<typeof setInterval> | null = null;
    let proc: ProcessadorDeLimpeza | null = null;

    const parar = (f: MediaStream | null) => f?.getTracks().forEach((t) => t.stop());

    void (async () => {
      const completos = voice.getSettings();
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: completos.inputDeviceId ?? undefined, ...restricoesDoNavegador(completos) },
      });
      if (cancelado) return parar(mic);
      fluxo = mic;
      const montada = await aplicarLimpeza(completos, aplicarEmFaixaAvulsa(mic.getAudioTracks()[0] as MediaStreamTrack));
      proc = montada.processador;
      if (cancelado) {
        void proc?.destroy();
        return parar(mic);
      }
      processador.current = proc;
      setMotor(nomeDoMotor(montada.motor));

      // Antes do portao, se houver cadeia; sem cadeia nenhuma, o som cru.
      let analisador = proc?.medidorAntesDoPortao?.() ?? null;
      if (!analisador) {
        contexto = new AudioContext();
        analisador = contexto.createAnalyser();
        analisador.fftSize = 1024;
        contexto.createMediaStreamSource(mic).connect(analisador);
      }
      const amostras = new Float32Array(analisador.fftSize);
      const leitor = analisador;
      relogio = setInterval(() => {
        leitor.getFloatTimeDomainData(amostras);
        setNivelDb(nivelEmDb(amostras));
      }, 60);

      if (ouvir) {
        retorno = new Audio();
        retorno.srcObject = proc?.processedTrack ? new MediaStream([proc.processedTrack]) : mic;
        // O elemento so aceita ate 1: acima de 100% o volume geral vale na chamada, nao aqui.
        retorno.volume = Math.min(1, Math.max(0, completos.outputVolume));
        const comSaida = retorno as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (completos.outputDeviceId && comSaida.setSinkId) await comSaida.setSinkId(completos.outputDeviceId).catch(() => undefined);
        await retorno.play().catch(() => undefined);
      }
    })().catch((falha: unknown) => {
      if (!cancelado) setErro(explicarFalhaDoMicrofone(falha));
    });

    return () => {
      cancelado = true;
      if (relogio) clearInterval(relogio);
      processador.current = null;
      void proc?.destroy();
      if (retorno) {
        retorno.pause();
        retorno.srcObject = null;
      }
      parar(fluxo);
      void contexto?.close();
      setNivelDb(null);
    };
    // O limiar muda ao vivo (abaixo); o resto reabre o microfone, como na chamada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ativo,
    ouvir,
    ajustes.inputDeviceId,
    ajustes.outputDeviceId,
    ajustes.outputVolume,
    ajustes.noiseSuppression,
    ajustes.echoCancellation,
    ajustes.autoGainControl,
    ajustes.voiceIsolation,
  ]);

  useEffect(() => {
    void processador.current?.definirPortao(limiarDoPortao(ajustes));
  }, [ajustes.limiarDeVozDb, ajustes.inputMode]);

  return { nivelDb, erro, motor };
}

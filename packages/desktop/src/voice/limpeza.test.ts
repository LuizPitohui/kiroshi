/**
 * As decisoes da limpeza de ruido.
 *
 * O bug que motivou este arquivo nao estava em nenhum modelo: estava numa
 * DECISAO. O controlador desligava a supressao do navegador porque ia usar o
 * modelo, o modelo falhava ao ser plugado, e ninguem voltava atras. O
 * microfone saia cru em todas as maquinas, com a tela dizendo que a limpeza
 * estava ligada.
 *
 * Por isso, alem das funcoes puras, ha uma SIMULACAO da cascata no fim —
 * com o LiveKit recusando todo processador, exatamente como fazia — que
 * prova que falhar nunca termina em microfone cru.
 */
import { describe, it, expect, vi } from 'vitest';

/*
  As bibliotecas de audio definem classes com `extends AudioWorkletNode` no
  momento em que sao importadas, e o Node nao tem AudioWorkletNode. A cascata
  so precisa CRIAR os processadores (os construtores nao tocam em audio) e ver
  o `aplicar` falhar ou passar — entao as bibliotecas viram cascas vazias.
*/
vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  GtcrnWorkletNode: class {},
  NoiseGateWorkletNode: class {},
}));
vi.mock('deepfilternet3-noise-filter', () => ({ DeepFilterNet3Core: class {} }));
import {
  FRACAO_MAXIMA_DO_TEMPO_REAL,
  INTENSIDADE_PADRAO,
  LIMIAR_MAXIMO_DB,
  LIMIAR_MINIMO_DB,
  LIMIAR_PADRAO_DB,
  avaliarAutoteste,
  exigeReabrirMicrofone,
  intensidadeValida,
  limiarDoPortao,
  limiarValido,
  modelosATentar,
  motorSemModelo,
  restricoesDoNavegador,
  rms,
  type AjustesDeLimpeza,
  type Disponibilidade,
} from './limpeza.js';
import { aplicarLimpeza, type PlanoDeLimpeza } from './cadeia.js';

const PADRAO: AjustesDeLimpeza = {
  limpezaDeRuido: true,
  intensidadeDaLimpeza: INTENSIDADE_PADRAO,
  noiseSuppression: true,
  voiceIsolation: true,
  echoCancellation: true,
  autoGainControl: true,
  inputMode: 'voice-activity',
  limiarDeVozDb: LIMIAR_PADRAO_DB,
};

const TUDO_RODA: Disponibilidade = {
  deepfilternet3: { ok: true },
  gtcrn: true,
  portao: true,
};

describe('quais modelos tentar', () => {
  it('DeepFilterNet3 primeiro, GTCRN de reserva', () => {
    expect(modelosATentar(PADRAO, TUDO_RODA)).toEqual(['deepfilternet3', 'gtcrn']);
  });

  it('DFN3 reprovado no autoteste: so o GTCRN', () => {
    const disp = { ...TUDO_RODA, deepfilternet3: { ok: false as const, motivo: 'lento' } };
    expect(modelosATentar(PADRAO, disp)).toEqual(['gtcrn']);
  });

  it('limpeza desligada: nenhum modelo, mesmo com tudo disponivel', () => {
    expect(modelosATentar({ limpezaDeRuido: false }, TUDO_RODA)).toEqual([]);
  });

  it('aparelho sem AudioWorklet: nenhum modelo', () => {
    const disp: Disponibilidade = {
      deepfilternet3: { ok: false, motivo: 'sem worklet' },
      gtcrn: false,
      portao: false,
    };
    expect(modelosATentar(PADRAO, disp)).toEqual([]);
  });
});

describe('o que pedir ao navegador', () => {
  /*
    Nunca dois supressores empilhados: com modelo, os do navegador saem.
  */
  it('com modelo, supressao e isolamento do navegador desligados', () => {
    const r = restricoesDoNavegador(PADRAO, true);
    expect(r.noiseSuppression).toBe(false);
    expect(r.voiceIsolation).toBe(false);
  });

  /*
    Eco e ganho nao sao ruido: ficam como a pessoa escolheu.
  */
  it('com modelo, eco e ganho continuam como a pessoa escolheu', () => {
    const r = restricoesDoNavegador({ ...PADRAO, echoCancellation: false }, true);
    expect(r.echoCancellation).toBe(false);
    expect(r.autoGainControl).toBe(true);
  });

  it('sem modelo, os ajustes da pessoa valem', () => {
    expect(restricoesDoNavegador(PADRAO, false)).toEqual({
      noiseSuppression: true,
      voiceIsolation: true,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it('perfil estudio: nada ligado e o motor e "nenhum"', () => {
    const estudio = { ...PADRAO, noiseSuppression: false, voiceIsolation: false };
    expect(motorSemModelo(estudio)).toBe('nenhum');
    expect(motorSemModelo(PADRAO)).toBe('navegador');
  });
});

describe('portao', () => {
  it('existe no modo por voz, com o limiar escolhido', () => {
    expect(limiarDoPortao({ inputMode: 'voice-activity', limiarDeVozDb: -50 })).toBe(-50);
  });

  it('nao existe no apertar para falar', () => {
    expect(limiarDoPortao({ inputMode: 'push-to-talk', limiarDeVozDb: -50 })).toBeNull();
  });

  it('limiar fora da faixa e trazido para dentro', () => {
    expect(limiarValido(-500)).toBe(LIMIAR_MINIMO_DB);
    expect(limiarValido(0)).toBe(LIMIAR_MAXIMO_DB);
    expect(limiarValido(Number.NaN)).toBe(LIMIAR_PADRAO_DB);
  });
});

describe('intensidade', () => {
  it('fica entre 0 e 100, inteira', () => {
    expect(intensidadeValida(150)).toBe(100);
    expect(intensidadeValida(-3)).toBe(0);
    expect(intensidadeValida(42.6)).toBe(43);
    expect(intensidadeValida(Number.NaN)).toBe(INTENSIDADE_PADRAO);
  });
});

describe('o que exige reabrir o microfone', () => {
  it('ajustes de captura reabrem', () => {
    expect(exigeReabrirMicrofone({ limpezaDeRuido: false }, { limpezaDeRuido: true })).toBe(true);
    expect(exigeReabrirMicrofone({ voiceIsolation: false }, { voiceIsolation: true })).toBe(true);
    expect(exigeReabrirMicrofone({ inputDeviceId: 'b' }, { inputDeviceId: 'a' })).toBe(true);
  });

  /*
    Estes mudam ao vivo. Reabrir a cada passo do controle deslizante picotaria
    a voz de quem esta falando.
  */
  it('intensidade, limiar e modo de entrada NAO reabrem', () => {
    expect(exigeReabrirMicrofone({ intensidadeDaLimpeza: 50 }, { intensidadeDaLimpeza: 100 })).toBe(false);
    expect(exigeReabrirMicrofone({ limiarDeVozDb: -30 }, { limiarDeVozDb: -45 })).toBe(false);
    expect(exigeReabrirMicrofone({ inputMode: 'push-to-talk' }, { inputMode: 'voice-activity' })).toBe(false);
  });

  it('mandar o mesmo valor nao reabre', () => {
    expect(exigeReabrirMicrofone({ limpezaDeRuido: true }, { limpezaDeRuido: true })).toBe(false);
  });
});

describe('autoteste', () => {
  const base = { rmsEntrada: 0.1, msGastos: 300, segundosDeAudio: 2 };

  it('aprova modelo que reduz o ruido e cabe no processador', () => {
    const r = avaliarAutoteste({ ...base, rmsSaida: 0.001 }); // 40 dB
    expect(r.ok).toBe(true);
  });

  /*
    O caso que motivou o teste: o pacote, com o modelo quebrado, repassa a
    entrada sem avisar. Por fora parece funcionando.
  */
  it('reprova modelo que so repassa o som', () => {
    const r = avaliarAutoteste({ ...base, rmsSaida: 0.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/repassando/);
  });

  it('reprova saida em silencio absoluto: seria microfone mudo', () => {
    const r = avaliarAutoteste({ ...base, rmsSaida: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/mudo/);
  });

  it('reprova saida morta, abaixo do que o limite de atenuacao permite', () => {
    const r = avaliarAutoteste({ ...base, rmsSaida: 1e-6 }); // 100 dB
    expect(r.ok).toBe(false);
  });

  it('reprova processador lento demais', () => {
    const ms = 2000 * (FRACAO_MAXIMA_DO_TEMPO_REAL + 0.1);
    const r = avaliarAutoteste({ ...base, rmsSaida: 0.001, msGastos: ms });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/lento/);
  });

  it('rms de um trecho', () => {
    const sinal = new Float32Array([0, 0, 1, -1]);
    expect(rms(sinal, 2)).toBe(1);
    expect(rms(sinal, 0, 2)).toBe(0);
    expect(rms(sinal, 4)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Simulacao da cascata
// ---------------------------------------------------------------------------

describe('cascata, com o LiveKit recusando processador', () => {
  const plano = (modelos: PlanoDeLimpeza['modelos']): PlanoDeLimpeza => ({
    modelos,
    restricoes: restricoesDoNavegador(PADRAO, modelos.length > 0),
    avisos: [],
  });

  /*
    EXATAMENTE o bug que estava em producao: `setProcessor` lancava
    "Audio context needs to be set" para todo processador.
  */
  const recusaTudo = async (): Promise<void> => {
    throw new Error('Audio context needs to be set on LocalAudioTrack in order to enable processors');
  };

  it('falhar em todos os modelos NUNCA termina em microfone cru', async () => {
    const r = await aplicarLimpeza(plano(['deepfilternet3', 'gtcrn']), PADRAO, recusaTudo);

    expect(r.processador).toBeNull();
    // Quem chamou e avisado de que precisa reabrir...
    expect(r.precisaReabrir).toBe(true);
    // ...e com o supressor do navegador LIGADO.
    expect(r.restricoesDeResgate.noiseSuppression).toBe(true);
    expect(r.restricoesDeResgate.voiceIsolation).toBe(true);
    expect(r.motor).toBe('navegador');
  });

  it('cada falha fica registrada, em ordem, para a tela de diagnostico', async () => {
    const r = await aplicarLimpeza(plano(['deepfilternet3', 'gtcrn']), PADRAO, recusaTudo);
    expect(r.falhas).toHaveLength(2);
    expect(r.falhas[0]).toMatch(/^deepfilternet3: Audio context/);
    expect(r.falhas[1]).toMatch(/^gtcrn: /);
  });

  it('DFN3 falha, GTCRN pega: fica o GTCRN, sem reabrir', async () => {
    const r = await aplicarLimpeza(plano(['deepfilternet3', 'gtcrn']), PADRAO, async (p) => {
      if (p.motor === 'deepfilternet3') throw new Error('wasm');
    });
    expect(r.motor).toBe('gtcrn');
    expect(r.precisaReabrir).toBe(false);
    expect(r.falhas).toEqual(['deepfilternet3: wasm']);
  });

  it('o primeiro que pega encerra a cascata', async () => {
    const tentados: string[] = [];
    const r = await aplicarLimpeza(plano(['deepfilternet3', 'gtcrn']), PADRAO, async (p) => {
      tentados.push(p.motor);
    });
    expect(r.motor).toBe('deepfilternet3');
    expect(tentados).toEqual(['deepfilternet3']);
    expect(r.falhas).toEqual([]);
  });

  it('sem modelo no plano, nao ha nada para reabrir', async () => {
    const r = await aplicarLimpeza(plano([]), PADRAO, recusaTudo);
    expect(r.precisaReabrir).toBe(false);
    expect(r.motor).toBe('navegador');
  });
});

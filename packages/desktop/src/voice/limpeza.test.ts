/**
 * As decisoes da entrada de audio.
 *
 * O bug que motivou este arquivo nao estava em nenhum modelo: estava numa
 * DECISAO. O controlador desligava a supressao do navegador porque ia usar o
 * modelo, o modelo falhava ao ser plugado, e ninguem voltava atras. O
 * microfone saia cru em todas as maquinas, com a tela dizendo que a limpeza
 * estava ligada.
 *
 * A limpeza por modelo saiu (2.0.2, backlog F3), mas a regra fica: a
 * SIMULACAO no fim, com o LiveKit recusando todo processador exatamente como
 * fazia, prova que falhar nunca termina em microfone cru.
 */
import { describe, it, expect, vi } from 'vitest';

/*
  A biblioteca do portao define classes com `extends AudioWorkletNode` no
  momento em que e importada, e o Node nao tem AudioWorkletNode. A cadeia so
  precisa CRIAR o processador (o construtor nao toca em audio) e ver o
  `aplicar` falhar ou passar — entao a biblioteca vira casca vazia.
*/
vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  NoiseGateWorkletNode: class {},
}));
import {
  AJUSTES_QUE_REABREM_O_MICROFONE,
  LIMIAR_MAXIMO_DB,
  LIMIAR_MINIMO_DB,
  LIMIAR_PADRAO_DB,
  exigeReabrirMicrofone,
  limiarDoPortao,
  limiarValido,
  migrarAjustesDaLimpezaPorModelo,
  motorDaLimpeza,
  restricoesDoNavegador,
  type AjustesDeLimpeza,
} from './limpeza.js';
import { aplicarLimpeza } from './cadeia.js';

const PADRAO: AjustesDeLimpeza = {
  noiseSuppression: true,
  voiceIsolation: true,
  echoCancellation: true,
  autoGainControl: true,
  inputMode: 'voice-activity',
  limiarDeVozDb: LIMIAR_PADRAO_DB,
};

describe('o que pedir ao navegador', () => {
  it('exatamente o que a pessoa escolheu', () => {
    expect(restricoesDoNavegador(PADRAO)).toEqual({
      noiseSuppression: true,
      voiceIsolation: true,
      echoCancellation: true,
      autoGainControl: true,
    });
    const r = restricoesDoNavegador({ ...PADRAO, echoCancellation: false, noiseSuppression: false });
    expect(r.echoCancellation).toBe(false);
    expect(r.noiseSuppression).toBe(false);
    expect(r.autoGainControl).toBe(true);
  });

  it('perfil estudio: nada ligado e o motor e "nenhum"', () => {
    const estudio = { ...PADRAO, noiseSuppression: false, voiceIsolation: false };
    expect(motorDaLimpeza(estudio)).toBe('nenhum');
    expect(motorDaLimpeza(PADRAO)).toBe('navegador');
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

describe('o que exige reabrir o microfone', () => {
  it('ajustes de captura reabrem', () => {
    expect(exigeReabrirMicrofone({ noiseSuppression: false }, { noiseSuppression: true })).toBe(true);
    expect(exigeReabrirMicrofone({ voiceIsolation: false }, { voiceIsolation: true })).toBe(true);
    expect(exigeReabrirMicrofone({ inputDeviceId: 'b' }, { inputDeviceId: 'a' })).toBe(true);
  });

  /*
    Estes mudam ao vivo. Reabrir a cada passo do controle deslizante picotaria
    a voz de quem esta falando.
  */
  it('limiar e modo de entrada NAO reabrem', () => {
    expect(exigeReabrirMicrofone({ limiarDeVozDb: -30 }, { limiarDeVozDb: -45 })).toBe(false);
    expect(exigeReabrirMicrofone({ inputMode: 'push-to-talk' }, { inputMode: 'voice-activity' })).toBe(false);
  });

  it('mandar o mesmo valor nao reabre', () => {
    expect(exigeReabrirMicrofone({ noiseSuppression: true }, { noiseSuppression: true })).toBe(false);
  });

  it('a chave da limpeza por modelo nao existe mais na lista', () => {
    expect(AJUSTES_QUE_REABREM_O_MICROFONE).not.toContain('limpezaDeRuido');
  });
});

describe('ajustes gravados com a limpeza por modelo', () => {
  /*
    Com a IA ligada, o supressor do navegador nao fazia efeito, e desligado
    ninguem notava. Sem a IA, deixa-lo desligado seria tirar toda limpeza de
    quem tinha pedido a mais forte.
  */
  it('quem tinha a IA ligada volta a ter o supressor do navegador', () => {
    const lido = migrarAjustesDaLimpezaPorModelo({ noiseSuppression: false, limpezaDeRuido: true, intensidadeDaLimpeza: 100 });
    expect(lido.noiseSuppression).toBe(true);
  });

  it('quem tinha desligado a IA fica como escolheu', () => {
    expect(migrarAjustesDaLimpezaPorModelo({ noiseSuppression: false, limpezaDeRuido: false }).noiseSuppression).toBe(false);
    expect(migrarAjustesDaLimpezaPorModelo({ noiseSuppression: true, limpezaDeRuido: false }).noiseSuppression).toBe(true);
  });

  it('as chaves antigas somem, para a regra nao valer de novo', () => {
    const lido = migrarAjustesDaLimpezaPorModelo({ noiseSuppression: true, limpezaDeRuido: true, intensidadeDaLimpeza: 60 });
    expect('limpezaDeRuido' in lido).toBe(false);
    expect('intensidadeDaLimpeza' in lido).toBe(false);
  });

  it('ajustes ja novos passam iguais', () => {
    expect(migrarAjustesDaLimpezaPorModelo({ noiseSuppression: false })).toEqual({ noiseSuppression: false });
  });
});

// ---------------------------------------------------------------------------
// Simulacao da cadeia
// ---------------------------------------------------------------------------

describe('cadeia, com o LiveKit recusando processador', () => {
  /*
    EXATAMENTE o bug que ja esteve em producao: `setProcessor` lancava
    "Audio context needs to be set" para todo processador.
  */
  const recusaTudo = async (): Promise<void> => {
    throw new Error('Audio context needs to be set on LocalAudioTrack in order to enable processors');
  };

  /*
    O Node nao tem AudioWorkletNode; a cadeia confere antes de montar. Aqui
    ele existe so para ela tentar.
  */
  const comWorklet = async (fn: () => Promise<void>): Promise<void> => {
    const g = globalThis as { AudioWorkletNode?: unknown };
    const antes = g.AudioWorkletNode;
    g.AudioWorkletNode = class {};
    try {
      await fn();
    } finally {
      g.AudioWorkletNode = antes;
    }
  };

  it('a falha deixa so sem portao: a limpeza do navegador ja foi pedida na captura', async () => {
    await comWorklet(async () => {
      const r = await aplicarLimpeza(PADRAO, recusaTudo);
      expect(r.processador).toBeNull();
      expect(r.portao).toBe(false);
      expect(r.motor).toBe('navegador');
      expect(r.falhas).toEqual([expect.stringMatching(/^portao: Audio context/)]);
    });
  });

  it('pegando, o portao entra no modo por voz', async () => {
    await comWorklet(async () => {
      const r = await aplicarLimpeza(PADRAO, async () => undefined);
      expect(r.processador).not.toBeNull();
      expect(r.portao).toBe(true);
      expect(r.falhas).toEqual([]);
    });
  });

  it('no apertar para falar a cadeia entra sem portao, pronta para trocar de modo ao vivo', async () => {
    await comWorklet(async () => {
      const r = await aplicarLimpeza({ ...PADRAO, inputMode: 'push-to-talk' }, async () => undefined);
      expect(r.processador).not.toBeNull();
      expect(r.portao).toBe(false);
    });
  });

  it('sem AudioWorklet: sem cadeia, e o motivo so aparece se havia portao a montar', async () => {
    const r = await aplicarLimpeza(PADRAO, async () => undefined);
    expect(r.processador).toBeNull();
    expect(r.falhas).toHaveLength(1);
    const ptt = await aplicarLimpeza({ ...PADRAO, inputMode: 'push-to-talk' }, async () => undefined);
    expect(ptt.falhas).toEqual([]);
  });
});

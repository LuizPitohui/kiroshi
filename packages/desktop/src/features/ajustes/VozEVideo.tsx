import { useEffect, useRef, useState } from 'react';
import { voice, type InputMode, type VoiceSettings } from '../../voice/controller.js';
import { LIMIAR_MAXIMO_DB, LIMIAR_MINIMO_DB } from '../../voice/limpeza.js';
import { rotuloDoAtalho, useAtalhos } from '../../app/atalhos.js';
import { navegar } from '../../app/rotas.js';
import { Aviso, Botao, Deslizante, Escolha, Interruptor, LinhaDeInterruptor, Selecao, Tecla, cx } from '../../design/primitivos/index.js';
import { Bloco, Linha } from './partes.js';
import { useTesteDeMicrofone } from './testeDeMicrofone.js';

const PADRAO = 'padrao';

interface Dispositivos {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

function opcoes(lista: MediaDeviceInfo[], nomeDoPadrao: string) {
  return [
    { valor: PADRAO, rotulo: nomeDoPadrao },
    ...lista
      .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ valor: d.deviceId, rotulo: d.label || `Dispositivo ${i + 1}` })),
  ];
}

/** Posicao (0 a 100) de um nivel na faixa do limiar. */
function posicao(db: number): number {
  const limitado = Math.min(LIMIAR_MAXIMO_DB, Math.max(LIMIAR_MINIMO_DB, db));
  return ((limitado - LIMIAR_MINIMO_DB) / (LIMIAR_MAXIMO_DB - LIMIAR_MINIMO_DB)) * 100;
}

/**
 * O medidor da sensibilidade: o nivel ao vivo e a marca do limiar na mesma
 * escala em dB. Verde, a voz passa; cinza, o portao segura.
 */
function Medidor({ nivelDb, limiarDb }: { nivelDb: number | null; limiarDb: number }) {
  const passa = nivelDb !== null && nivelDb >= limiarDb;
  return (
    <div className="space-y-1.5">
      <div aria-hidden className="relative h-3 border border-borda bg-terminal">
        <div
          className={cx('absolute inset-y-0 left-0 animado:transition-[width] animado:duration-75', passa ? 'bg-fala' : 'bg-texto-3')}
          style={{ width: `${nivelDb === null ? 0 : posicao(nivelDb)}%` }}
        />
        <div className="absolute -inset-y-1 w-0.5 bg-acento" style={{ left: `calc(${posicao(limiarDb)}% - 1px)` }} />
      </div>
      <p className="flex justify-between font-mono text-11 text-texto-3">
        <span>{nivelDb === null ? 'Teste parado' : `${Math.round(nivelDb)} dB · ${passa ? 'a voz passa' : 'o portão segura'}`}</span>
        <span>limiar {limiarDb} dB</span>
      </p>
    </div>
  );
}

/** A previa da camera, so quando a pessoa pede: camera nunca abre sozinha. */
function PreviaDaCamera({ deviceId }: { deviceId: string | null }) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!aberta) return;
    let fluxo: MediaStream | null = null;
    let cancelado = false;
    setErro(null);
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((f) => {
        if (cancelado) return f.getTracks().forEach((t) => t.stop());
        fluxo = f;
        if (video.current) video.current.srcObject = f;
      })
      .catch(() => {
        if (!cancelado) setErro('A câmera não abriu. Ela pode estar em uso por outro programa, ou ser uma câmera virtual sem nada transmitindo.');
      });
    return () => {
      cancelado = true;
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, [aberta, deviceId]);

  return (
    <div className="space-y-3">
      <Botao tamanho="sm" onClick={() => setAberta((v) => !v)}>
        {aberta ? 'Fechar a prévia' : 'Ver a câmera'}
      </Botao>
      {aberta ? (
        <div className="aspect-video w-full max-w-[420px] border border-borda bg-preto">
          {/* Espelhada, como um espelho: e assim que a pessoa espera se ver. Os outros veem normal. */}
          <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-contain" />
        </div>
      ) : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}

/**
 * Voz e video (10-front-end-novo.md 4.6): dispositivos, volume, modo de
 * entrada, sensibilidade com medidor em dB, teste de microfone e camera.
 *
 * A limpeza de ruido vai ser refeita do zero (F3); ate la aparece so o que
 * funciona hoje, sem prometer o que nao entrega.
 */
export function PaginaVozEVideo() {
  const [ajustes, setAjustes] = useState<VoiceSettings>(() => ({ ...voice.getSettings() }));
  const [dispositivos, setDispositivos] = useState<Dispositivos | null>(null);
  const [testando, setTestando] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const teclaDeFalar = useAtalhos((s) => s.atalhos.falar);
  const teste = useTesteDeMicrofone(testando, ouvindo, ajustes);

  useEffect(() => {
    void voice.listDevices().then(setDispositivos);
    void useAtalhos.getState().carregar();
    // Plugar ou tirar um fone troca a lista.
    const aoMudar = () => void voice.listDevices().then(setDispositivos);
    navigator.mediaDevices.addEventListener('devicechange', aoMudar);
    return () => navigator.mediaDevices.removeEventListener('devicechange', aoMudar);
  }, []);

  async function mudar(patch: Partial<VoiceSettings>) {
    setAjustes((a) => ({ ...a, ...patch }));
    await voice.updateSettings(patch);
    setAjustes({ ...voice.getSettings() });
  }

  const d = dispositivos ?? { inputs: [], outputs: [], cameras: [] };

  return (
    <div className="space-y-8">
      <Bloco titulo="Dispositivos">
        <Selecao rotulo="Microfone" valor={ajustes.inputDeviceId ?? PADRAO} opcoes={opcoes(d.inputs, 'O padrão do Windows')} aoMudar={(v) => void mudar({ inputDeviceId: v === PADRAO ? null : v })} />
        <Selecao rotulo="Saída de som" valor={ajustes.outputDeviceId ?? PADRAO} opcoes={opcoes(d.outputs, 'O padrão do Windows')} aoMudar={(v) => void mudar({ outputDeviceId: v === PADRAO ? null : v })} />
        <Deslizante
          rotulo="Volume da chamada"
          valor={Math.round(ajustes.outputVolume * 100)}
          min={0}
          max={200}
          passo={5}
          marca={100}
          formatar={(v) => `${v}%`}
          aoMudar={(v) => void mudar({ outputVolume: v / 100 })}
        />
      </Bloco>

      <Bloco titulo="Modo de entrada">
        <Escolha<InputMode>
          rotulo="Como o microfone abre"
          valor={ajustes.inputMode}
          aoMudar={(inputMode) => void mudar({ inputMode })}
          opcoes={[
            { valor: 'voice-activity', rotulo: 'Detecção de voz', descricao: 'Abre sozinho quando você fala mais alto que o limiar.' },
            { valor: 'push-to-talk', rotulo: 'Apertar para falar', descricao: 'Só abre enquanto você segura a tecla — com o jogo na frente, inclusive.' },
          ]}
        />
        {ajustes.inputMode === 'push-to-talk' ? (
          <Linha titulo="Tecla de falar" descricao={teclaDeFalar ? undefined : 'Nenhuma tecla escolhida: sem ela, o microfone fica fechado.'}>
            <Tecla>{rotuloDoAtalho(teclaDeFalar)}</Tecla>
            <Botao tamanho="sm" onClick={() => navegar({ tela: 'ajustes', pagina: 'atalhos' })}>
              Trocar em Atalhos
            </Botao>
          </Linha>
        ) : null}
      </Bloco>

      <Bloco
        titulo="Microfone"
        descricao={
          ajustes.inputMode === 'voice-activity'
            ? 'Teste e fale normalmente: a voz tem que passar da marca, e o barulho de fundo ficar antes dela.'
            : 'Teste para ouvir como você chega aos outros.'
        }
      >
        {ajustes.inputMode === 'voice-activity' ? (
          <>
            <Medidor nivelDb={teste.nivelDb} limiarDb={ajustes.limiarDeVozDb} />
            <Deslizante
              rotulo="Limiar de voz"
              valor={ajustes.limiarDeVozDb}
              min={LIMIAR_MINIMO_DB}
              max={LIMIAR_MAXIMO_DB}
              passo={1}
              formatar={(v) => `${v} dB`}
              aoMudar={(v) => void mudar({ limiarDeVozDb: v })}
            />
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Botao variante={testando ? 'secundario' : 'primario'} onClick={() => setTestando((v) => !v)}>
            {testando ? 'Parar o teste' : 'Testar microfone'}
          </Botao>
          <label className="flex items-center gap-2 text-14 text-texto-2">
            <Interruptor ligado={ouvindo} aoMudar={setOuvindo} rotulo="Ouvir minha voz" />
            Ouvir minha voz
          </label>
          {testando && teste.motor ? <span className="font-mono text-11 text-texto-3">limpeza: {teste.motor}</span> : null}
        </div>
        {teste.erro ? <Aviso tipo="erro">{teste.erro}</Aviso> : null}
      </Bloco>

      <Bloco titulo="Limpeza do som" descricao="A limpeza de ruído vai ser refeita do zero logo depois desta interface. Por enquanto, estas são as que funcionam.">
        <LinhaDeInterruptor
          titulo="Limpeza de ruído por IA"
          descricao="Tira teclado, ventilador e barulho de fundo da sua voz."
          ligado={ajustes.limpezaDeRuido}
          aoMudar={(limpezaDeRuido) => void mudar({ limpezaDeRuido })}
        />
        {!ajustes.limpezaDeRuido ? (
          <LinhaDeInterruptor
            titulo="Supressão de ruído do navegador"
            descricao="A mais simples, sem IA. Com a IA ligada ela fica desligada, para não empilhar duas."
            ligado={ajustes.noiseSuppression}
            aoMudar={(noiseSuppression) => void mudar({ noiseSuppression })}
          />
        ) : null}
        <LinhaDeInterruptor
          titulo="Cancelamento de eco"
          descricao="Evita que o som das caixas volte pelo microfone. Com fone, pode desligar."
          ligado={ajustes.echoCancellation}
          aoMudar={(echoCancellation) => void mudar({ echoCancellation })}
        />
        <LinhaDeInterruptor
          titulo="Ganho automático"
          descricao="Ajusta o volume da sua voz sozinho, para quem fala baixo ou longe do microfone."
          ligado={ajustes.autoGainControl}
          aoMudar={(autoGainControl) => void mudar({ autoGainControl })}
        />
      </Bloco>

      <Bloco titulo="Câmera">
        <Selecao rotulo="Câmera" valor={ajustes.cameraDeviceId ?? PADRAO} opcoes={opcoes(d.cameras, 'A padrão do Windows')} aoMudar={(v) => void mudar({ cameraDeviceId: v === PADRAO ? null : v })} />
        <PreviaDaCamera deviceId={ajustes.cameraDeviceId} />
      </Bloco>
    </div>
  );
}

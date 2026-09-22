import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog.js';
import { InlineAlert } from '../ui/InlineAlert.js';
import type { ScreenSource } from '../../../electron/preload.js';
import { voice } from '../../voice/controller.js';
import { explicarFalhaDeMidia } from '../../voice/falhas.js';
import { Monitor, Window } from '../Icons.js';

interface Props {
  onClose: () => void;
}

/**
 * Seletor de tela ou janela.
 *
 * A qualidade e escolhida aqui e nao nos ajustes porque depende do que se vai
 * transmitir: um jogo pede 60 fps, uma planilha pede resolucao. Deixar a
 * decisao junto da escolha da janela evita ter que voltar nos ajustes depois.
 */
export function ScreenPickerModal({ onClose }: Props) {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(true);
  const [quality, setQuality] = useState<'720p30' | '1080p30' | '1080p60'>('1080p30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /* Transmitindo, mas sem o som pedido. Nao e erro: a imagem esta no ar. */
  const [avisoSemSom, setAvisoSemSom] = useState<string | null>(null);
  /* Trava sincrona contra duplo-clique; ver o comentario em `start`. */
  const comecando = useRef(false);

  useEffect(() => {
    let cancelled = false;

    window.kiroshi.screen
      .sources()
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        setLoading(false);
        // Pre-seleciona a primeira tela: e o caso mais comum.
        const firstScreen = list.find((s) => s.kind === 'screen');
        if (firstScreen) setSelected(firstScreen.id);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Nao consegui listar as telas disponiveis.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // O Esc vem do `Dialog`, junto com a armadilha de foco e o retorno dele
  // para quem abriu. Este arquivo era o unico dos sete modais que tratava a
  // tecla, e tratava so ela.

  const filtered = sources.filter((s) => s.kind === tab);

  async function start(): Promise<void> {
    if (!selected) return;

    /*
      Trava sincrona, alem do estado.

      `setStarting(true)` so desabilita o botao no proximo render. Dois cliques
      no mesmo instante — ou um duplo-clique, que e o que se faz quando algo
      demora — passavam os dois pela guarda e chamavam a transmissao duas
      vezes. O `ref` fecha a porta na hora.
    */
    if (comecando.current) return;
    comecando.current = true;

    setStarting(true);
    setError(null);

    const settings = {
      '720p30': { maxHeight: 720, fps: 30 },
      '1080p30': { maxHeight: 1080, fps: 30 },
      '1080p60': { maxHeight: 1080, fps: 60 },
    }[quality];

    try {
      const { motivoSemSom } = await voice.startScreenShare(selected, { withAudio, ...settings });

      /*
        Transmitiu, mas sem o som que foi pedido: nao fecha calado.

        Fechar aqui deixaria a pessoa transmitindo em silencio achando que o
        som esta indo, e ela so descobriria pelos amigos perguntando. O aviso
        fica na tela ate ela fechar, com a transmissao ja no ar.
      */
      if (motivoSemSom) {
        setAvisoSemSom(motivoSemSom);
        setStarting(false);
        comecando.current = false;
        return;
      }

      onClose();
    } catch (err) {
      setError(explicarFalhaDeMidia(err, 'tela'));
      setStarting(false);
      comecando.current = false;
    }
  }

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Compartilhar tela"
      descricao="Escolha o que as outras pessoas vao ver."
      largura={720}
      acoes={
        /*
          Com a transmissao JA no ar, nao ha mais o que transmitir aqui.

          Este foi um defeito meu, e um dos piores tipos: quando a captura do
          som falhava, o dialogo passava a mostrar "Transmitindo, mas sem o som
          do sistema" e CONTINUAVA com o botao Transmitir ativo. Quem lia
          aquilo como "nao deu certo" clicava de novo — e publicava a tela uma
          segunda vez, dobrando o proprio upload.

          Medido no SFU: uma pessoa com duas faixas de tela 1920x1080 ao mesmo
          tempo, reproduzindo a cada sessao nova. Era sempre a mesma pessoa,
          porque era a unica cujo audio falhava.
        */
        avisoSemSom ? (
          <button className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={!selected || starting}
            >
              {starting ? 'Iniciando...' : 'Transmitir'}
            </button>
          </>
        )
      }
    >
      <>
        <div className="tabs">
          <button
            className={`tab ${tab === 'screen' ? 'active' : ''}`}
            onClick={() => setTab('screen')}
          >
            <Monitor size={14} /> Telas
          </button>
          <button
            className={`tab ${tab === 'window' ? 'active' : ''}`}
            onClick={() => setTab('window')}
          >
            <Window size={14} /> Janelas
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 32 }}>
            <p>Nenhuma {tab === 'screen' ? 'tela' : 'janela'} disponivel.</p>
          </div>
        ) : (
          <div className="source-grid">
            {filtered.map((source) => (
              <button
                key={source.id}
                className={`source ${selected === source.id ? 'selected' : ''}`}
                onClick={() => setSelected(source.id)}
              >
                <img src={source.thumbnail} alt="" />
                <div className="source-name">
                  {source.appIcon && <img src={source.appIcon} alt="" />}
                  <span>{source.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="divider" />

        <div className="row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
          <div className="row-text">
            <div className="row-title">Qualidade</div>
            <div className="row-desc">
              60 fps deixa o movimento fluido; 1080p deixa o texto legivel.
            </div>
          </div>
          <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="720p30">720p, 30 fps — leve</option>
            <option value="1080p30">1080p, 30 fps — equilibrado</option>
            <option value="1080p60">1080p, 60 fps — jogos</option>
          </select>
        </div>

        <div className="row" style={{ borderBottom: 'none' }}>
          <div className="row-text">
            <div className="row-title">Incluir o som</div>
            <div className="row-desc">Transmite o audio do sistema junto com a imagem.</div>
          </div>
          <button
            className={`switch ${withAudio ? 'on' : ''}`}
            onClick={() => setWithAudio((v) => !v)}
            aria-label="Incluir o som"
            aria-pressed={withAudio}
          />
        </div>

        {error && <InlineAlert tipo="erro">{error}</InlineAlert>}

        {/*
          Aviso, e nao erro: a tela ESTA sendo transmitida neste momento. O
          que falhou foi o extra que a pessoa pediu, e ela precisa saber
          porque ninguem descobre sozinho que esta transmitindo em silencio.
        */}
        {avisoSemSom && (
          <InlineAlert
            tipo="aviso"
            titulo="Transmitindo, mas sem o som do sistema"
          >
            A imagem ja esta no ar. So o audio do sistema ficou de fora: {avisoSemSom}
          </InlineAlert>
        )}
      </>
    </Dialog>
  );
}

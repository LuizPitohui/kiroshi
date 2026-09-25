import { useEffect, useState } from 'react';
import { atalhoDaTecla, atalhoDoMouse, rotuloDoAtalho, useAtalhos, type AcaoDeAtalho } from '../../app/atalhos.js';
import { navegar } from '../../app/rotas.js';
import { Aviso, Botao, Tecla } from '../../design/primitivos/index.js';
import { voice } from '../../voice/controller.js';
import { Bloco, Linha } from './partes.js';

const ACOES: { acao: AcaoDeAtalho; titulo: string; descricao: string }[] = [
  { acao: 'falar', titulo: 'Falar (segurar)', descricao: 'Segure para falar, solte para calar. Vale no modo Apertar para falar.' },
  { acao: 'mutar', titulo: 'Silenciar o microfone', descricao: 'Liga e desliga o microfone.' },
  { acao: 'ensurdecer', titulo: 'Silenciar o som', descricao: 'Para de ouvir a chamada, e fecha o microfone junto.' },
];

/**
 * A linha de um atalho: o atual, trocar (a proxima tecla ou botao lateral do
 * mouse vira o atalho) e tirar.
 */
function LinhaDeAtalho({ acao, titulo, descricao }: (typeof ACOES)[number]) {
  const atalho = useAtalhos((s) => s.atalhos[acao]);
  const definir = useAtalhos((s) => s.definir);
  const [capturando, setCapturando] = useState(false);

  useEffect(() => {
    if (!capturando) return;
    const teclar = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturando(false);
        return;
      }
      const novo = atalhoDaTecla(e, acao);
      if (!novo) return; // um modificador sozinho: a pessoa ainda esta montando a combinacao
      setCapturando(false);
      void definir(acao, novo);
    };
    const clicar = (e: MouseEvent) => {
      const novo = atalhoDoMouse(e.button);
      if (!novo) return;
      e.preventDefault();
      setCapturando(false);
      void definir(acao, novo);
    };
    window.addEventListener('keydown', teclar, { capture: true });
    window.addEventListener('mousedown', clicar, { capture: true });
    return () => {
      window.removeEventListener('keydown', teclar, { capture: true });
      window.removeEventListener('mousedown', clicar, { capture: true });
    };
  }, [capturando, acao, definir]);

  return (
    <Linha titulo={titulo} descricao={descricao}>
      {capturando ? (
        <span role="status" className="font-mono text-12 uppercase tracking-rotulo text-acento">
          Aperte a tecla… (Esc cancela)
        </span>
      ) : (
        <Tecla>{rotuloDoAtalho(atalho)}</Tecla>
      )}
      <Botao tamanho="sm" onClick={() => setCapturando((v) => !v)}>
        {capturando ? 'Cancelar' : 'Trocar'}
      </Botao>
      {atalho && !capturando ? (
        <Botao tamanho="sm" variante="fantasma" onClick={() => void definir(acao, null)}>
          Tirar
        </Botao>
      ) : null}
    </Linha>
  );
}

/**
 * Os atalhos da chamada, globais: valem com o jogo na frente, sem tomar a
 * tecla dele (electron/atalhos.ts).
 */
export function PaginaAtalhos() {
  const carregado = useAtalhos((s) => s.carregado);
  const globais = useAtalhos((s) => s.globais);
  const [modo, setModo] = useState(() => voice.getSettings().inputMode);

  useEffect(() => {
    void useAtalhos.getState().carregar();
    return voice.subscribe(() => setModo(voice.getSettings().inputMode));
  }, []);

  return (
    <div className="space-y-8">
      {carregado && !globais ? (
        <Aviso tipo="aviso" titulo="Só com o Kiroshi em foco">
          A escuta global de teclado não está disponível nesta instalação: os atalhos abaixo só funcionam com a janela do Kiroshi na frente.
        </Aviso>
      ) : null}
      <Bloco titulo="Na chamada" descricao="Funcionam em qualquer janela — no jogo, inclusive — e a tecla continua chegando a ele. Um botão lateral do mouse também serve.">
        {ACOES.map((a) => (
          <LinhaDeAtalho key={a.acao} {...a} />
        ))}
      </Bloco>
      {modo !== 'push-to-talk' ? (
        <p className="text-13 text-texto-3">
          O modo de entrada agora é por detecção de voz: a tecla de falar só vale no modo Apertar para falar.{' '}
          <button type="button" className="text-texto underline" onClick={() => navegar({ tela: 'ajustes', pagina: 'voz-e-video' })}>
            Trocar em Voz e vídeo
          </button>
        </p>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AppWindow, Monitor } from 'lucide-react';
import type { ScreenSource } from '../../../electron/preload.js';
import { voice } from '../../voice/controller.js';
import { explicarFalhaDeMidia } from '../../voice/falhas.js';
import type { ConteudoDaTela } from '../../voice/qualidade.js';
import {
  QUALIDADES,
  gravarEscolhaDaTransmissao,
  lerEscolhaDaTransmissao,
  type QualidadeDaTransmissao,
} from './escolhaDaTransmissao.js';
import { Aviso, Botao, Carregando, Dialogo, Escolha, LinhaDeInterruptor, cx } from '../../design/primitivos/index.js';

type Qualidade = QualidadeDaTransmissao;
const lerEscolha = lerEscolhaDaTransmissao;

/**
 * O que transmitir: tela ou janela, e COMO — jogo (fluidez) ou texto
 * (nitidez), qualidade e som. A escolha fica guardada para a proxima vez.
 *
 * O conteudo vira a dica do codificador (`contentHint`) e o que ele sacrifica
 * quando a banda aperta: sem ela, jogo era tratado como documento e travava
 * com a imagem nitida (04-midia.md, hipotese 4).
 */
export function SeletorDeTela({ aberto, aoMudar }: { aberto: boolean; aoMudar: (a: boolean) => void }) {
  const [fontes, setFontes] = useState<ScreenSource[] | null>(null);
  const [aba, setAba] = useState<'screen' | 'window'>('screen');
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const inicial = lerEscolha();
  const [conteudo, setConteudo] = useState<ConteudoDaTela>(inicial.conteudo);
  const [qualidade, setQualidade] = useState<Qualidade>(inicial.qualidade);
  const [som, setSom] = useState(inicial.som);
  const [erro, setErro] = useState<string | null>(null);
  const [semSom, setSemSom] = useState<string | null>(null);
  const [comecando, setComecando] = useState(false);
  // Trava sincrona: o estado so desabilita o botao no proximo desenho, e um
  // duplo clique publicava a tela duas vezes (dobrando o upload — medido no SFU).
  const trava = useRef(false);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setFontes(null);
    setErro(null);
    setSemSom(null);
    window.kiroshi.screen
      .sources()
      .then((lista) => {
        if (cancelado) return;
        setFontes(lista);
        setEscolhida((atual) => atual ?? lista.find((f) => f.kind === 'screen')?.id ?? null);
      })
      .catch(() => !cancelado && setErro('Não consegui listar as telas e janelas.'));
    return () => {
      cancelado = true;
    };
  }, [aberto]);

  async function comecar() {
    if (!escolhida || trava.current) return;
    trava.current = true;
    setComecando(true);
    setErro(null);
    gravarEscolhaDaTransmissao({ conteudo, qualidade, som });
    try {
      const { motivoSemSom } = await voice.startScreenShare(escolhida, { withAudio: som, conteudo, ...QUALIDADES[qualidade] });
      // No ar, mas sem o som pedido: o dialogo fica com o aviso (e sem botao
      // de transmitir de novo, que publicaria a tela duas vezes).
      if (motivoSemSom) setSemSom(motivoSemSom);
      else aoMudar(false);
    } catch (e) {
      setErro(explicarFalhaDeMidia(e, 'tela'));
    } finally {
      trava.current = false;
      setComecando(false);
    }
  }

  const lista = (fontes ?? []).filter((f) => f.kind === aba);

  return (
    <Dialogo
      aberto={aberto}
      aoMudar={aoMudar}
      titulo="Transmitir"
      rotulo="Tela"
      descricao="Escolha o que os outros vão ver, e como."
      largura="lg"
      acoes={
        semSom ? (
          <Botao variante="primario" onClick={() => aoMudar(false)}>
            Fechar
          </Botao>
        ) : (
          <>
            <Botao variante="fantasma" onClick={() => aoMudar(false)}>
              Cancelar
            </Botao>
            <Botao variante="primario" carregando={comecando} disabled={!escolhida} onClick={() => void comecar()}>
              ▸ Transmitir
            </Botao>
          </>
        )
      }
    >
      {semSom ? (
        <Aviso tipo="aviso" titulo="Transmitindo, mas sem o som">
          A imagem já está no ar; só o som ficou de fora: {semSom}
        </Aviso>
      ) : (
        <div className="space-y-5">
          <div role="tablist" aria-label="Fontes" className="flex gap-1 border-b border-borda">
            {(['screen', 'window'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={aba === k}
                onClick={() => setAba(k)}
                className={cx(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 font-mono text-11 uppercase tracking-rotulo',
                  aba === k ? 'border-acento text-texto' : 'border-transparente text-texto-3 hover:text-texto',
                )}
              >
                {k === 'screen' ? <Monitor aria-hidden className="size-4" strokeWidth={1.5} /> : <AppWindow aria-hidden className="size-4" strokeWidth={1.5} />}
                {k === 'screen' ? 'Telas' : 'Janelas'}
              </button>
            ))}
          </div>

          {erro ? (
            <Aviso tipo="erro" titulo="Não deu para transmitir">
              {erro}
            </Aviso>
          ) : null}

          {fontes === null && !erro ? (
            <div className="py-8">
              <Carregando texto="Procurando telas…" />
            </div>
          ) : lista.length === 0 ? (
            <p className="py-6 text-center text-13 text-texto-3">Nenhuma {aba === 'screen' ? 'tela' : 'janela'} disponível.</p>
          ) : (
            <div role="radiogroup" aria-label={aba === 'screen' ? 'Telas' : 'Janelas'} className="k-rolagem grid max-h-[300px] grid-cols-3 gap-3 overflow-y-auto pr-1">
              {lista.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={escolhida === f.id}
                  onClick={() => setEscolhida(f.id)}
                  onDoubleClick={() => void comecar()}
                  className={cx(
                    'relative border bg-terminal p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-acento',
                    escolhida === f.id ? 'border-acento shadow-[0_0_0_1px_var(--k-acento)]' : 'border-borda hover:border-borda-2',
                  )}
                >
                  <img src={f.thumbnail} alt="" className="aspect-video w-full bg-preto object-contain" />
                  <span className="mt-1.5 flex items-center gap-1.5 text-12 text-texto-2">
                    {f.appIcon ? <img src={f.appIcon} alt="" className="size-4" /> : null}
                    <span className="truncate">{f.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <Escolha<ConteudoDaTela>
            rotulo="O que vai passar"
            valor={conteudo}
            aoMudar={setConteudo}
            opcoes={[
              { valor: 'movimento', rotulo: 'Jogo ou vídeo', descricao: 'Fluidez primeiro: segura os quadros por segundo.' },
              { valor: 'detalhe', rotulo: 'Texto ou código', descricao: 'Nitidez primeiro: segura a resolução.' },
            ]}
          />
          <Escolha<Qualidade>
            rotulo="Qualidade"
            valor={qualidade}
            aoMudar={setQualidade}
            opcoes={[
              { valor: '720p30', rotulo: '720p · 30', descricao: 'Leve, para upload fraco.' },
              { valor: '1080p30', rotulo: '1080p · 30', descricao: 'O padrão.' },
              { valor: '1080p60', rotulo: '1080p · 60', descricao: 'Jogo rápido; pede mais upload.' },
            ]}
          />
          <LinhaDeInterruptor
            titulo="Incluir o som do computador"
            descricao="Vai o som do Windows, menos o do próprio Kiroshi: quem assiste não ouve a própria voz de volta."
            ligado={som}
            aoMudar={setSom}
          />
        </div>
      )}
    </Dialogo>
  );
}

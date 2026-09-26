import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Message } from '@kiroshi/shared';
import { LIMITS } from '@kiroshi/shared';
import { FileText, Paperclip, Smile, X } from 'lucide-react';
import { gateway } from '../../api/gateway.js';
import { selectors, useStore } from '../../store/index.js';
import { deveEnviar } from '../../lib/leitura.js';
import { Balao, BalaoConteudo, BalaoGatilho, BotaoIcone, cx } from '../../design/primitivos/index.js';
import { SeletorDeEmoji } from './SeletorDeEmoji.js';
import { ListaDeSugestoes, ariaDoCampo, useAutocompletar } from './Autocompletar.js';
import { dicionarioDoCanal, fontesDoCanal } from './fontes.js';
import { escolhaDaSugestao, paraEnvio } from './mencoes.js';
import { enviarMensagem, type AnexosPendentes } from './envio.js';
import { motivo } from './acoes.js';
import { tamanhoLegivel } from './Anexos.js';

const ALTURA_MAXIMA = 320;
/** A partir de quanto o contador aparece. */
const AVISO_DE_TAMANHO = LIMITS.messageContent.max - 500;
/** Um sinal de "digitando" a cada 4 s, no maximo: o servidor mostra por 9 s. */
const INTERVALO_DE_DIGITANDO = 4000;

const chaveDoRascunho = (canalId: string) => `kiroshi.draft.${canalId}`;

function lerRascunho(canalId: string): string {
  try {
    return sessionStorage.getItem(chaveDoRascunho(canalId)) ?? '';
  } catch {
    return '';
  }
}

interface Props {
  canalId: string;
  /** "#geral" ou "@kaya", para o texto de espera. */
  destino: string;
  ehDM: boolean;
  campo: RefObject<HTMLTextAreaElement | null>;
  respondendo: Message | null;
  aoCancelarResposta: () => void;
  aoEnviar: () => void;
  /** Seta para cima no campo vazio edita a ultima mensagem sua. */
  aoEditarUltima: () => boolean;
  /** Shift+Tab: entra na lista de mensagens pela ultima (como no Discord). */
  aoIrParaMensagens: () => boolean;
  anexos: AnexosPendentes;
  podeEnviar: boolean;
  podeAnexar: boolean;
  /** No painel estreito da chamada: sem a dica "ENTER ENVIA", que so ocupa lugar. */
  lateral?: boolean;
}

/**
 * Onde se escreve.
 *
 * Enter envia e Shift+Enter quebra a linha, SEM opcao (pedido do dono: a
 * escolha "Ctrl+Enter envia" da 1.x sai da interface nova). Numpad Enter vale
 * igual; durante a composicao de acentos (IME) o Enter e da composicao.
 */
export function Compositor({ canalId, destino, ehDM, campo, respondendo, aoCancelarResposta, aoEnviar, aoEditarUltima, aoIrParaMensagens, anexos, podeEnviar, podeAnexar, lateral = false }: Props) {
  const [texto, setTexto] = useState(() => lerRascunho(canalId));
  const [erro, setErro] = useState<string | null>(null);
  const [emojis, setEmojis] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const ultimoDigitando = useRef(0);
  const cursorDepois = useRef<number | null>(null);
  const nomeDaResposta = useStore((s) => (respondendo ? selectors.displayNameOf(s, respondendo.authorId, respondendo.guildId) : ''));

  // O que foi escolhido na lista: numa colisao de nomes (usuario `adm`, cargo
  // "ADM"), e a escolha que decide quem e mencionado (`paraEnvio`).
  const escolhidas = useRef(new Map<string, string>());
  const auto = useAutocompletar({
    campo,
    valor: texto,
    aoTrocar: (novo, cursor) => {
      cursorDepois.current = cursor;
      setTexto(novo);
    },
    obterFontes: () => fontesDoCanal(canalId),
    aoAceitar: (s) => {
      const escolha = escolhaDaSugestao(s);
      if (escolha) escolhidas.current.set(...escolha);
    },
  });

  // Outro canal, outras escolhas.
  useEffect(() => {
    escolhidas.current = new Map();
  }, [canalId]);

  // Rascunho por canal: trocar de canal e voltar nao perde o que se escreveu.
  useEffect(() => {
    try {
      if (texto) sessionStorage.setItem(chaveDoRascunho(canalId), texto);
      else sessionStorage.removeItem(chaveDoRascunho(canalId));
    } catch {
      // sem armazenamento: o rascunho vive so enquanto o canal esta aberto
    }
  }, [texto, canalId]);

  // A altura acompanha o texto ate um limite; o cursor vai para onde a
  // sugestao aceita mandou.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
    if (cursorDepois.current !== null) {
      el.setSelectionRange(cursorDepois.current, cursorDepois.current);
      cursorDepois.current = null;
    }
  }, [texto, campo]);

  // Abrir o canal ou escolher responder ja deixa o cursor pronto.
  useEffect(() => {
    campo.current?.focus();
  }, [canalId, respondendo, campo]);

  function avisarDigitando() {
    const agora = Date.now();
    if (agora - ultimoDigitando.current < INTERVALO_DE_DIGITANDO) return;
    ultimoDigitando.current = agora;
    gateway.sendTyping(canalId);
  }

  function inserir(trecho: string) {
    const el = campo.current;
    const inicio = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const antes = texto.slice(0, inicio);
    const espaco = antes && !/\s$/.test(antes) ? ' ' : '';
    const novo = `${antes}${espaco}${trecho}${texto.slice(fim)}`;
    cursorDepois.current = inicio + espaco.length + trecho.length;
    setTexto(novo);
    el?.focus();
  }

  async function enviar() {
    const limpo = texto.trim();
    const lista = anexos.anexos;
    if (lista.some((a) => !a.idEnviado && !a.erro)) {
      setErro('Espere os arquivos terminarem de enviar.');
      return;
    }
    const prontos = lista.filter((a) => a.idEnviado).map((a) => a.idEnviado!);
    if (!limpo && prontos.length === 0) return;
    if (limpo.length > LIMITS.messageContent.max) {
      setErro(`A mensagem passa de ${LIMITS.messageContent.max} caracteres.`);
      return;
    }

    const conteudo = paraEnvio(limpo, dicionarioDoCanal(canalId), escolhidas.current);
    const resposta = respondendo;
    const levados = anexos.tirarTodos();
    setTexto('');
    setErro(null);
    anexos.setAviso(null);
    aoEnviar();

    try {
      await enviarMensagem({ canalId, conteudo, anexos: prontos, respostaA: resposta });
      anexos.soltar(levados);
      escolhidas.current = new Map();
    } catch (e) {
      // Falhou: tudo volta para a caixa — o texto, os anexos e a resposta —,
      // senao a pessoa perderia o que escreveu. (A 1.x devolvia so o texto.)
      setTexto((atual) => atual || limpo);
      anexos.devolver(levados);
      setErro(motivo(e, 'Não consegui enviar. O texto continua aqui; tente de novo.'));
    }
  }

  const tamanho = texto.length;
  const semPermissao = !podeEnviar;

  return (
    <div className="shrink-0 px-4 pb-4">
      {respondendo ? (
        <div className="flex h-8 items-center gap-2 border border-b-0 border-borda-2 bg-terminal px-3 text-13 text-texto-3">
          <span className="min-w-0 flex-1 truncate">
            Respondendo a <strong className="font-semibold text-texto-2">{nomeDaResposta}</strong>
          </span>
          <button type="button" onClick={aoCancelarResposta} aria-label="Cancelar resposta" className="grid size-6 place-items-center hover:text-texto">
            <X aria-hidden className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}

      {anexos.anexos.length > 0 ? (
        <ul aria-label="Anexos" className="k-rolagem flex gap-2 overflow-x-auto border border-b-0 border-borda-2 bg-terminal p-2">
          {anexos.anexos.map((a) => (
            <li key={a.idLocal} className="relative w-[120px] shrink-0 border border-borda bg-deck">
              {a.previa ? (
                <img src={a.previa} alt="" className="h-[84px] w-full object-cover" />
              ) : (
                <div className="grid h-[84px] place-items-center">
                  <FileText aria-hidden className="size-7 text-texto-3" strokeWidth={1.5} />
                </div>
              )}
              <p className="truncate px-1.5 pt-1 text-11 text-texto-2" title={a.nome}>
                {a.nome}
              </p>
              <p className={cx('px-1.5 pb-1 font-mono text-10', a.erro ? 'text-perigo' : 'text-texto-3')}>
                {a.erro ? '[!] falhou' : a.idEnviado ? tamanhoLegivel(a.tamanho) : `${Math.round(a.progresso * 100)}%`}
              </p>
              {!a.idEnviado && !a.erro ? (
                <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-acento" style={{ width: `${Math.round(a.progresso * 100)}%` }} />
              ) : null}
              <button
                type="button"
                onClick={() => anexos.remover(a.idLocal)}
                aria-label={`Remover ${a.nome}`}
                title={a.erro ?? undefined}
                className="absolute right-1 top-1 grid size-6 place-items-center border border-borda-2 bg-deck/90 text-texto-2 hover:border-perigo hover:text-perigo"
              >
                <X aria-hidden className="size-3.5" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {erro || anexos.aviso ? (
        <p role="alert" className="border border-b-0 border-borda-2 bg-terminal px-3 py-1.5 text-13 text-perigo">
          [!] {erro ?? anexos.aviso}
        </p>
      ) : null}

      <div
        className={cx(
          'relative flex items-end gap-2 border bg-terminal px-2 py-[5px]',
          'border-borda-2 focus-within:border-acento focus-within:shadow-[0_0_0_1px_var(--k-acento-tenue),0_0_20px_var(--k-acento-tenue)]',
          semPermissao && 'opacity-60',
        )}
      >
        <ListaDeSugestoes auto={auto} campo={campo} />
        {podeAnexar && !semPermissao ? (
          <>
            <BotaoIcone rotulo="Anexar arquivo" icone={<Paperclip className="size-[18px]" strokeWidth={1.5} />} onClick={() => arquivo.current?.click()} />
            <input
              ref={arquivo}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) anexos.adicionar(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
        <textarea
          ref={campo}
          value={texto}
          rows={1}
          readOnly={semPermissao}
          maxLength={LIMITS.messageContent.max}
          aria-label={`Mensagem para ${destino}`}
          placeholder={semPermissao ? 'Você não tem permissão para enviar mensagens aqui.' : ehDM ? `Mensagem para ${destino}` : `Conversar em ${destino}`}
          {...ariaDoCampo(auto)}
          onChange={(e) => {
            setTexto(e.target.value);
            if (erro) setErro(null);
            if (e.target.value) avisarDigitando();
            auto.atualizar();
          }}
          onSelect={auto.atualizar}
          onPaste={(e) => {
            const arquivos = [...e.clipboardData.files];
            if (arquivos.length > 0 && podeAnexar) {
              e.preventDefault();
              anexos.adicionar(arquivos);
            }
          }}
          onKeyDown={(e) => {
            if (auto.aoTeclar(e)) return;
            if (e.nativeEvent.isComposing) return;
            if (deveEnviar(e, 'enter')) {
              e.preventDefault();
              void enviar().catch((falha: unknown) => setErro(motivo(falha, 'Algo deu errado ao enviar. O texto continua aqui.')));
              return;
            }
            if (e.key === 'ArrowUp' && !texto && !e.shiftKey && !e.altKey && !e.ctrlKey) {
              if (aoEditarUltima()) e.preventDefault();
              return;
            }
            if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) {
              if (aoIrParaMensagens()) e.preventDefault();
              return;
            }
            if (e.key === 'Escape' && respondendo) {
              e.preventDefault();
              aoCancelarResposta();
            }
          }}
          className="k-rolagem min-h-[34px] min-w-0 flex-1 resize-none bg-transparente px-1 py-[7px] text-15 leading-[1.35] text-texto outline-none placeholder:text-mudo"
        />
        {tamanho >= AVISO_DE_TAMANHO ? (
          <span
            aria-live="polite"
            className={cx('self-center font-mono text-10', tamanho >= LIMITS.messageContent.max ? 'text-perigo' : 'text-texto-3')}
          >
            {LIMITS.messageContent.max - tamanho}
          </span>
        ) : lateral ? null : (
          <span aria-hidden className="hidden self-center font-mono text-[9.5px] tracking-[0.16em] text-mudo xl:inline">
            ENTER ENVIA
          </span>
        )}
        {!semPermissao ? (
          <Balao open={emojis} onOpenChange={setEmojis}>
            <BalaoGatilho asChild>
              <BotaoIcone rotulo="Emoji" icone={<Smile className="size-[18px]" strokeWidth={1.5} />} />
            </BalaoGatilho>
            <BalaoConteudo
              rotulo="Escolher emoji"
              lado="top"
              alinhar="end"
              aoFecharFoco={(e) => {
                // O emoji entrou no texto: o cursor fica no campo, nao no botao.
                e.preventDefault();
                campo.current?.focus();
              }}
            >
              <SeletorDeEmoji
                guildId={useStore.getState().channels.get(canalId)?.guildId ?? null}
                aoEscolher={(e) => {
                  setEmojis(false);
                  inserir(e.tipo === 'unicode' ? e.emoji : `:${e.nome}:`);
                }}
              />
            </BalaoConteudo>
          </Balao>
        ) : null}
      </div>
    </div>
  );
}

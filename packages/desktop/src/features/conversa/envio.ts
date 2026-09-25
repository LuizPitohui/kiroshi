import { useEffect, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { LIMITS, generateId } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { motivo } from './acoes.js';

/**
 * Os ids das mensagens otimistas ainda sem confirmacao.
 *
 * Fora do store de proposito: a copia otimista e a de verdade carregam o
 * mesmo `nonce`, entao nenhum campo da mensagem diz qual e qual. Quando a de
 * verdade chega, a otimista sai da lista com outro id — e o componente dela
 * deixa de existir, entao ler este conjunto na hora de desenhar basta.
 */
export const idsOtimistas = new Set<string>();

interface Envio {
  canalId: string;
  conteudo: string;
  anexos: string[];
  respostaA: Message | null;
}

/**
 * Envia com copia otimista: a mensagem aparece na hora e some quando a de
 * verdade chega pelo gateway (mesmo `nonce`).
 *
 * O id da copia e um snowflake de verdade: com prefixo ("temp-") a ordenacao
 * por id numerico estourava e o envio morria em silencio (1.x, corrigido la).
 *
 * A resposta do POST tambem entra no store. Com o gateway caido ou atrasado a
 * mensagem enviada ficava para sempre esmaecida, esperando um evento que nao
 * vinha; agora a propria resposta confirma. Se o evento chegar tambem, o
 * store troca pelo mesmo id e nada duplica.
 */
export async function enviarMensagem({ canalId, conteudo, anexos, respostaA }: Envio): Promise<void> {
  const s = useStore.getState();
  const eu = s.user;
  const nonce = generateId();
  const id = generateId();

  if (eu) {
    idsOtimistas.add(id);
    s.addMessage({
      id,
      channelId: canalId,
      guildId: s.channels.get(canalId)?.guildId ?? null,
      authorId: eu.id,
      author: eu,
      content: conteudo,
      type: respostaA ? 'REPLY' : 'DEFAULT',
      attachments: [],
      embeds: [],
      reactions: [],
      mentionedUserIds: [],
      mentionedRoleIds: [],
      mentionsEveryone: false,
      reference: respostaA ? { messageId: respostaA.id, channelId: canalId, guildId: respostaA.guildId } : null,
      referencedMessage: respostaA,
      pinned: false,
      editedAt: null,
      createdAt: new Date().toISOString(),
      nonce,
    });
  }

  try {
    const real = await api.post<Message>(`/channels/${canalId}/messages`, {
      content: conteudo,
      ...(anexos.length ? { attachmentIds: anexos } : {}),
      ...(respostaA ? { replyToId: respostaA.id } : {}),
      nonce,
    });
    // A copia sai pelo id, e nao so pelo nonce: se a resposta viesse sem ele,
    // a otimista ficaria duplicada ao lado da de verdade.
    const agora = useStore.getState();
    agora.deleteMessage(canalId, id);
    if (real?.id) agora.addMessage(real);
  } catch (erro) {
    useStore.getState().deleteMessage(canalId, id);
    throw erro;
  } finally {
    idsOtimistas.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Anexos a caminho
// ---------------------------------------------------------------------------

export interface AnexoPendente {
  idLocal: string;
  nome: string;
  tamanho: number;
  previa: string | null;
  progresso: number;
  idEnviado: string | null;
  erro: string | null;
}

/**
 * Os arquivos escolhidos para a proxima mensagem.
 *
 * O envio de cada um comeca na hora: quando a pessoa aperta Enter, o arquivo
 * ja esta no servidor e a mensagem sai sem espera. As previas sao URLs de
 * objeto, soltas ao remover e ao desmontar (a 1.x so soltava ao remover, e
 * trocar de canal com anexos na caixa deixava as imagens presas na memoria).
 */
export function useAnexosPendentes() {
  const [anexos, setAnexos] = useState<AnexoPendente[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const vivos = useRef(anexos);
  vivos.current = anexos;

  useEffect(
    () => () => {
      for (const a of vivos.current) if (a.previa) URL.revokeObjectURL(a.previa);
    },
    [],
  );

  const mudar = (idLocal: string, parte: Partial<AnexoPendente>) =>
    setAnexos((lista) => lista.map((a) => (a.idLocal === idLocal ? { ...a, ...parte } : a)));

  function adicionar(arquivos: FileList | File[]) {
    const lista = [...arquivos];
    const espaco = LIMITS.attachmentsPerMessage - vivos.current.length;
    setAviso(lista.length > espaco ? `No máximo ${LIMITS.attachmentsPerMessage} arquivos por mensagem.` : null);
    for (const arquivo of lista.slice(0, Math.max(0, espaco))) {
      if (arquivo.size > LIMITS.attachmentBytes) {
        setAviso(`${arquivo.name} passa de ${LIMITS.attachmentBytes / 1024 / 1024} MB.`);
        continue;
      }
      const pendente: AnexoPendente = {
        idLocal: generateId(),
        nome: arquivo.name,
        tamanho: arquivo.size,
        previa: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : null,
        progresso: 0,
        idEnviado: null,
        erro: null,
      };
      setAnexos((atual) => [...atual, pendente]);
      void api
        .upload(arquivo, (fracao) => mudar(pendente.idLocal, { progresso: fracao }))
        .then((guardado) => mudar(pendente.idLocal, { idEnviado: guardado.id, progresso: 1 }))
        .catch((erro: unknown) => mudar(pendente.idLocal, { erro: motivo(erro, 'Falha ao enviar o arquivo.') }));
    }
  }

  function remover(idLocal: string) {
    setAnexos((lista) => {
      const alvo = lista.find((a) => a.idLocal === idLocal);
      if (alvo?.previa) URL.revokeObjectURL(alvo.previa);
      return lista.filter((a) => a.idLocal !== idLocal);
    });
  }

  /** Esvazia a caixa sem soltar as previas (a mensagem pode voltar se o envio falhar). */
  function tirarTodos(): AnexoPendente[] {
    const lista = vivos.current;
    setAnexos([]);
    return lista;
  }

  function devolver(lista: AnexoPendente[]) {
    setAnexos(lista);
  }

  function soltar(lista: AnexoPendente[]) {
    for (const a of lista) if (a.previa) URL.revokeObjectURL(a.previa);
  }

  return { anexos, aviso, setAviso, adicionar, remover, tirarTodos, devolver, soltar };
}

export type AnexosPendentes = ReturnType<typeof useAnexosPendentes>;

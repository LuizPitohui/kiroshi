import { useEffect, useRef, useState } from 'react';
import type { Message } from '@kiroshi/shared';
import { Pin } from 'lucide-react';
import { api } from '../../api/client.js';
import { selectors, useStore } from '../../store/index.js';
import { Avatar, Balao, BalaoConteudo, BalaoGatilho, BotaoIcone, Botao, Carregando, EstadoVazio, Aviso } from '../../design/primitivos/index.js';
import { Conteudo } from './Conteudo.js';
import { alternarFixada, motivo } from './acoes.js';
import { rotuloDoDia, horaCurta } from './linhas.js';
import { pedirSalto } from './salto.js';

function Fixada({ mensagem, guildId, podeFixar, aoIr, aoDesafixar }: { mensagem: Message; guildId: string | null; podeFixar: boolean; aoIr: () => void; aoDesafixar: () => void }) {
  const nome = useStore((s) => selectors.displayNameOf(s, mensagem.authorId, guildId));
  const cor = useStore((s) => selectors.colorOf(s, mensagem.authorId, guildId));
  return (
    <li className="group relative border border-borda bg-terminal p-3">
      <div className="flex items-center gap-2">
        <Avatar nome={nome} id={mensagem.authorId} url={mensagem.author.avatarUrl} tamanho={24} />
        <span className="truncate text-14 font-semibold" style={cor ? { color: cor } : undefined}>
          {nome}
        </span>
        <span className="font-mono text-10 text-mudo">
          {rotuloDoDia(mensagem.createdAt)} {horaCurta(mensagem.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-6">
        <Conteudo conteudo={mensagem.content || (mensagem.attachments.length ? '[anexo]' : '')} guildId={guildId} />
      </div>
      <div className="mt-2 flex gap-2">
        <Botao tamanho="sm" variante="secundario" onClick={aoIr}>
          Ir até ela
        </Botao>
        {podeFixar ? (
          <Botao tamanho="sm" variante="fantasma" onClick={aoDesafixar}>
            Desafixar
          </Botao>
        ) : null}
      </div>
    </li>
  );
}

/**
 * As fixadas do canal, num balao ancorado no cabecalho (como no Discord).
 * Buscadas a cada abertura: o servidor so avisa que a lista mudou, nao como.
 */
export function Fixadas({ canalId, guildId, podeFixar }: { canalId: string; guildId: string | null; podeFixar: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<Message[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Depois de "ir ate ela" o foco fica na mensagem, e nao volta para o botao.
  const saltou = useRef(false);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setLista(null);
    setErro(null);
    api
      .get<Message[]>(`/channels/${canalId}/pins`)
      .then((itens) => !cancelado && setLista(itens))
      .catch((e: unknown) => !cancelado && setErro(motivo(e, 'Não consegui buscar as fixadas.')));
    return () => {
      cancelado = true;
    };
  }, [aberto, canalId]);

  return (
    <Balao open={aberto} onOpenChange={setAberto}>
      <BalaoGatilho asChild>
        <BotaoIcone rotulo="Mensagens fixadas" ligado={aberto} icone={<Pin className="size-[18px]" strokeWidth={1.5} />} />
      </BalaoGatilho>
      <BalaoConteudo
        rotulo="Mensagens fixadas"
        lado="bottom"
        alinhar="end"
        className="flex max-h-[min(560px,70vh)] w-[440px] flex-col"
        aoFecharFoco={(e) => {
          if (saltou.current) e.preventDefault();
          saltou.current = false;
        }}
      >
        <p className="k-rotulo border-b border-borda px-4 py-3">Fixadas</p>
        <div className="k-rolagem min-h-0 flex-1 overflow-y-auto p-3">
          {erro ? (
            <Aviso tipo="erro" titulo="Sem as fixadas">
              {erro}
            </Aviso>
          ) : lista === null ? (
            <Carregando texto="Buscando…" />
          ) : lista.length === 0 ? (
            <EstadoVazio titulo="Nada fixado ainda">Fixe uma mensagem (tecla P, ou no menu dela) para achá-la depois sem rolar a conversa.</EstadoVazio>
          ) : (
            <ul className="space-y-2">
              {lista.map((m) => (
                <Fixada
                  key={m.id}
                  mensagem={m}
                  guildId={guildId}
                  podeFixar={podeFixar}
                  aoIr={() => {
                    saltou.current = true;
                    setAberto(false);
                    pedirSalto(canalId, m.id);
                  }}
                  aoDesafixar={() => {
                    void alternarFixada(m).then((ok) => ok && setLista((atual) => atual?.filter((x) => x.id !== m.id) ?? null));
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </BalaoConteudo>
    </Balao>
  );
}

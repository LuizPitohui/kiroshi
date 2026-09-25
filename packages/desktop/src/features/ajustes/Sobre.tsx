import { useEffect, useState } from 'react';
import type { AtualizacaoEstado } from '../../../electron/preload.js';
import { api } from '../../api/client.js';
import { Botao } from '../../design/primitivos/index.js';
import { Bloco, Linha } from './partes.js';

function descrever(estado: AtualizacaoEstado | null): string {
  if (!estado) return 'Lendo…';
  switch (estado.fase) {
    case 'ocioso':
      return 'Você está na versão mais nova que o servidor oferece.';
    case 'procurando':
      return 'Procurando versão nova…';
    case 'baixando':
      return `Baixando a versão ${estado.versao ?? 'nova'}: ${Math.round(estado.progresso)}%`;
    case 'pronta':
      return `A versão ${estado.versao ?? 'nova'} está pronta. Ela entra ao reiniciar — ou sozinha, na próxima vez que o Kiroshi fechar.`;
    case 'erro':
      return `Não consegui procurar agora${estado.erro ? `: ${estado.erro}` : '.'}`;
  }
}

/** Versao, servidor e a atualizacao (que baixa sozinha; aqui so se acompanha e reinicia). */
export function PaginaSobre() {
  const [versao, setVersao] = useState<string | null>(null);
  const [estado, setEstado] = useState<AtualizacaoEstado | null>(null);

  useEffect(() => {
    void window.kiroshi?.app.version().then(setVersao);
    void window.kiroshi?.atualizacao.estado().then(setEstado);
    return window.kiroshi?.atualizacao.aoMudar(setEstado);
  }, []);

  return (
    <div className="space-y-8">
      <Bloco titulo="Esta instalação">
        <Linha titulo="Versão">
          <span className="font-mono text-13 text-texto-2">{versao ?? '…'}</span>
        </Linha>
        <Linha titulo="Servidor">
          <span className="font-mono text-13 text-texto-2">{api.getBaseUrl()}</span>
        </Linha>
      </Bloco>
      <Bloco titulo="Atualizações" descricao="O Kiroshi procura sozinho a cada dez minutos e baixa em segundo plano. Você nunca precisa baixar nada.">
        <p role="status" className="text-14 text-texto-2">
          {descrever(estado)}
        </p>
        <div className="flex gap-2">
          {estado?.fase === 'pronta' ? (
            <Botao variante="primario" onClick={() => window.kiroshi?.atualizacao.instalarEReiniciar()}>
              Reiniciar e atualizar
            </Botao>
          ) : (
            <Botao
              carregando={estado?.fase === 'procurando'}
              disabled={estado?.fase === 'baixando'}
              onClick={() => void window.kiroshi?.atualizacao.procurar().then(setEstado)}
            >
              Procurar agora
            </Botao>
          )}
        </div>
      </Bloco>
    </div>
  );
}

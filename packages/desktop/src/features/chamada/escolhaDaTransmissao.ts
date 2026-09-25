import type { ConteudoDaTela } from '../../voice/qualidade.js';

/*
  A escolha de como transmitir — o que vai passar, a qualidade e o som —,
  guardada para a proxima vez. O seletor de tela usa e grava; Configuracoes >
  Transmissao muda o padrao sem precisar abrir uma transmissao.
*/

export type QualidadeDaTransmissao = '720p30' | '1080p30' | '1080p60';

export const QUALIDADES: Record<QualidadeDaTransmissao, { maxHeight: number; fps: number }> = {
  '720p30': { maxHeight: 720, fps: 30 },
  '1080p30': { maxHeight: 1080, fps: 30 },
  '1080p60': { maxHeight: 1080, fps: 60 },
};

export interface EscolhaDaTransmissao {
  conteudo: ConteudoDaTela;
  qualidade: QualidadeDaTransmissao;
  som: boolean;
}

const CHAVE = 'kiroshi.transmissao';

export function lerEscolhaDaTransmissao(): EscolhaDaTransmissao {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, unknown>;
    return {
      conteudo: v.conteudo === 'detalhe' ? 'detalhe' : 'movimento',
      qualidade: v.qualidade === '720p30' || v.qualidade === '1080p60' ? v.qualidade : '1080p30',
      som: v.som !== false,
    };
  } catch {
    return { conteudo: 'movimento', qualidade: '1080p30', som: true };
  }
}

export function gravarEscolhaDaTransmissao(escolha: EscolhaDaTransmissao): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(escolha));
  } catch {
    // sem armazenamento: so nao lembra
  }
}

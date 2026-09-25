import { useState } from 'react';
import { Escolha, LinhaDeInterruptor } from '../../design/primitivos/index.js';
import {
  gravarEscolhaDaTransmissao,
  lerEscolhaDaTransmissao,
  type EscolhaDaTransmissao,
  type QualidadeDaTransmissao,
} from '../chamada/escolhaDaTransmissao.js';
import type { ConteudoDaTela } from '../../voice/qualidade.js';
import { Bloco } from './partes.js';

/**
 * O padrao de como transmitir: o seletor de tela abre com isto marcado, e o
 * que se escolhe la tambem vira o padrao.
 */
export function PaginaTransmissao() {
  const [escolha, setEscolha] = useState<EscolhaDaTransmissao>(lerEscolhaDaTransmissao);

  function mudar(patch: Partial<EscolhaDaTransmissao>) {
    const nova = { ...escolha, ...patch };
    setEscolha(nova);
    gravarEscolhaDaTransmissao(nova);
  }

  return (
    <div className="space-y-8">
      <Bloco titulo="Padrão ao transmitir" descricao="O seletor de tela já abre assim. Dá para trocar a cada transmissão.">
        <Escolha<ConteudoDaTela>
          rotulo="O que vai passar"
          valor={escolha.conteudo}
          aoMudar={(conteudo) => mudar({ conteudo })}
          opcoes={[
            { valor: 'movimento', rotulo: 'Movimento', descricao: 'Jogo e vídeo: segura a fluidez quando a internet aperta.' },
            { valor: 'detalhe', rotulo: 'Detalhe', descricao: 'Texto e código: segura a nitidez, a poucos quadros.' },
          ]}
        />
        <Escolha<QualidadeDaTransmissao>
          rotulo="Qualidade"
          valor={escolha.qualidade}
          aoMudar={(qualidade) => mudar({ qualidade })}
          opcoes={[
            { valor: '720p30', rotulo: '720p · 30 fps', descricao: 'Mais leve: internet fraca ou computador ocupado com o jogo.' },
            { valor: '1080p30', rotulo: '1080p · 30 fps', descricao: 'O padrão.' },
            { valor: '1080p60', rotulo: '1080p · 60 fps', descricao: 'Mais fluido; pesa no envio e no computador.' },
          ]}
        />
        <LinhaDeInterruptor
          titulo="Incluir o som"
          descricao="O som do que está na tela vai junto. No Windows, sai o som do computador inteiro."
          ligado={escolha.som}
          aoMudar={(som) => mudar({ som })}
        />
      </Bloco>
    </div>
  );
}

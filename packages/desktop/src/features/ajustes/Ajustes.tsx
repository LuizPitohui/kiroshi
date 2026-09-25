import { useState } from 'react';
import { X } from 'lucide-react';
import { aplicarTema, type Tema } from '../../app/tema.js';
import { aplicarMovimento, type Movimento } from '../../lib/movimento.js';
import { aplicarDensidade, type Densidade } from '../../lib/leitura.js';
import { ROTA_INICIAL, navegar } from '../../app/rotas.js';
import { BotaoIcone, Escolha, cx } from '../../design/primitivos/index.js';

/**
 * Previa da conversa com as classes de verdade (`compacto:`), para a troca de
 * densidade aparecer aqui mesmo, sem sair dos ajustes.
 */
function PreviaDaConversa() {
  const linha = (hora: string, nome: string | null, texto: string, cor: string) => (
    <div className={cx('grid grid-cols-[72px_minmax(0,1fr)] pr-4 compacto:grid-cols-[62px_minmax(0,1fr)]', nome ? 'pt-1 compacto:pt-px' : 'py-px')}>
      <div className="flex justify-end pr-2.5">
        {nome ? (
          <span aria-hidden className="mr-auto ml-4 mt-0.5 grid size-10 place-items-center rounded-full font-display text-16 font-bold text-preto compacto:hidden" style={{ background: cor }}>
            {nome[0]}
          </span>
        ) : null}
        <span className={cx('pt-[3px] font-mono text-10 text-mudo compacto:block', nome ? 'hidden' : 'opacity-0 compacto:opacity-100')}>{hora}</span>
      </div>
      <div className="min-w-0">
        {nome ? (
          <span className="mr-2 inline-flex items-baseline gap-2">
            <span className="text-[14.5px] font-semibold" style={{ color: cor }}>
              {nome}
            </span>
            <span className="font-mono text-[10.5px] text-mudo compacto:hidden">{hora}</span>
          </span>
        ) : null}
        <span className="block text-15 text-texto compacto:inline">{texto}</span>
      </div>
    </div>
  );
  return (
    <div aria-hidden className="border border-borda bg-void py-2">
      {linha('22:02', 'kaya', 'eu! só terminar essa missão', '#f472b6')}
      {linha('22:03', null, 'vou abrir a transmissão no Geral', '#f472b6')}
      {linha('22:10', 'rafa', 'boa, entrando na call', '#a3e635')}
    </div>
  );
}

function Aparencia() {
  const [tema, setTema] = useState<Tema>(aplicarTema.ler);
  const [densidade, setDensidade] = useState<Densidade>(aplicarDensidade.ler);
  const [movimento, setMovimento] = useState<Movimento>(aplicarMovimento.ler);

  return (
    <div className="space-y-8">
      <Escolha<Tema>
        rotulo="Tema"
        valor={tema}
        aoMudar={(v) => setTema(aplicarTema.escrever(v))}
        opcoes={[
          { valor: 'escuro', rotulo: 'Escuro', descricao: 'O padrão: preto e vermelho.' },
          { valor: 'claro', rotulo: 'Corporativo', descricao: 'Claro, para o dia.' },
          { valor: 'sistema', rotulo: 'Seguir o Windows', descricao: 'Troca junto com o sistema.' },
        ]}
      />
      <div className="space-y-3">
        <Escolha<Densidade>
          rotulo="Densidade da conversa"
          valor={densidade}
          aoMudar={(v) => setDensidade(aplicarDensidade.escrever(v))}
          opcoes={[
            { valor: 'confortavel', rotulo: 'Confortável', descricao: 'Foto, nome em cima, respiro entre blocos.' },
            { valor: 'compacto', rotulo: 'Compacta', descricao: 'Hora, nome e texto numa linha só.' },
          ]}
        />
        <PreviaDaConversa />
      </div>
      <Escolha<Movimento>
        rotulo="Movimento"
        valor={movimento}
        aoMudar={(v) => setMovimento(aplicarMovimento.escrever(v))}
        opcoes={[
          { valor: 'sistema', rotulo: 'Seguir o Windows', descricao: 'Anima se as animações do Windows estiverem ligadas.' },
          { valor: 'completo', rotulo: 'Completo', descricao: 'Anima sempre.' },
          { valor: 'reduzido', rotulo: 'Reduzido', descricao: 'Só o essencial, sem transições.' },
        ]}
      />
    </div>
  );
}

/**
 * Configuracoes. Nesta versao so a Aparencia: as outras paginas chegam na
 * fatia 5, e o que nao funciona nao aparece (nada decorativo).
 */
export function Ajustes() {
  const fechar = () => (history.length > 1 ? history.back() : navegar(ROTA_INICIAL));
  return (
    <div
      className="flex h-full min-h-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) fechar();
      }}
    >
      <nav aria-label="Páginas de configuração" className="w-56 shrink-0 border-r border-borda bg-deck px-3 py-6">
        <p className="k-rotulo px-2 pb-2">Configurações</p>
        <ul>
          <li>
            <span aria-current="page" className="relative flex h-8 items-center bg-elevado px-2 text-14 text-texto">
              <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-acento" />
              Aparência
            </span>
          </li>
        </ul>
        <p className="mt-4 px-2 text-12 text-texto-3">Perfil, conta, voz, notificações e atalhos chegam na próxima versão do Beta.</p>
      </nav>
      <section aria-labelledby="titulo-ajustes" className="k-rolagem min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 py-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="k-rotulo mb-1">Configurações</p>
              <h1 id="titulo-ajustes" className="font-display text-28 font-bold uppercase tracking-display">
                Aparência
              </h1>
            </div>
            <BotaoIcone rotulo="Fechar" atalho="Esc" onClick={fechar} icone={<X className="size-5" strokeWidth={1.5} />} tamanho="lg" />
          </div>
          <Aparencia />
        </div>
      </section>
    </div>
  );
}

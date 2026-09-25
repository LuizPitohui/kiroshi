/**
 * Vitrine da interface nova: todos os primitivos, vivos, sem servidor nem
 * conta. Abre com `?nova&vitrine`. E onde se prova o visual e o teclado antes
 * de usar um componente numa tela — e o alvo dos testes de interface.
 *
 * Cada secao tem `data-vitrine` estavel: os testes dirigem por ele, nunca por
 * classe (a reescrita quebrou todos os testes 1.x justamente por isso).
 */
import { useState, type ReactNode } from 'react';
import { Mic, MicOff, Headphones, MonitorUp, Video, Settings, Search, Hash, Trash2, UserX, Volume2, Copy } from 'lucide-react';
import {
  Abas,
  Aviso,
  Avatar,
  Avisos,
  Botao,
  BotaoIcone,
  Campo,
  CampoSenha,
  AreaDeTexto,
  Carregando,
  Confirmacao,
  Contador,
  ConteudoDaAba,
  Deslizante,
  Dialogo,
  Esqueleto,
  EstadoVazio,
  LinhaDeInterruptor,
  Menu,
  MenuConteudo,
  MenuDeContexto,
  MenuDeContextoConteudo,
  MenuDeContextoGatilho,
  MenuDeContextoItem,
  MenuDeContextoSeparador,
  MenuGatilho,
  MenuItem,
  MenuRotulo,
  MenuSeparador,
  ProvedorDeDicas,
  Selecao,
  SeloCargo,
  SeloVivo,
  Tecla,
  avisar,
} from '../../design/primitivos/index.js';
import { aplicarTema, type Tema } from '../../app/tema.js';
import { aplicarMovimento, type Movimento } from '../../lib/movimento.js';
import { PalcoDeDemonstracao } from '../chamada/PalcoDeDemonstracao.js';

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section data-vitrine={id} className="border border-borda bg-deck p-5">
      <h2 className="k-rotulo mb-4">{titulo}</h2>
      {children}
    </section>
  );
}

const i = (Icone: typeof Mic) => <Icone className="size-4" strokeWidth={1.5} />;

export default function Vitrine(): React.JSX.Element {
  const [tema, setTema] = useState<Tema>(aplicarTema.ler());
  const [mov, setMov] = useState<Movimento>(aplicarMovimento.ler());
  const [nome, setNome] = useState('');
  const [sobre, setSobre] = useState('Uma linha sobre mim');
  const [senha, setSenha] = useState('segredo123');
  const [ligado, setLigado] = useState(true);
  const [mudo, setMudo] = useState(false);
  const [volume, setVolume] = useState(100);
  const [limiar, setLimiar] = useState(-45);
  const [dispositivo, setDispositivo] = useState('padrao');
  const [aba, setAba] = useState('online');
  const [dialogo, setDialogo] = useState(false);
  const [confirmacao, setConfirmacao] = useState(false);

  return (
    <ProvedorDeDicas>
      <div className="k-rolagem h-full overflow-y-auto bg-void">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
          <header className="flex items-end justify-between gap-6">
            <div>
              <p className="k-rotulo">Kiroshi // sistema de design</p>
              <h1 className="font-display text-36 font-bold uppercase tracking-display">Vitrine</h1>
            </div>
            <div className="flex gap-4">
              <Selecao
                rotulo="Tema"
                valor={tema}
                aoMudar={(v) => setTema(aplicarTema.escrever(v as Tema))}
                opcoes={[
                  { valor: 'escuro', rotulo: 'Escuro' },
                  { valor: 'claro', rotulo: 'Claro (Corporativo)' },
                  { valor: 'sistema', rotulo: 'Seguir o sistema' },
                ]}
                className="w-52"
              />
              <Selecao
                rotulo="Movimento"
                valor={mov}
                aoMudar={(v) => setMov(aplicarMovimento.escrever(v))}
                opcoes={[
                  { valor: 'sistema', rotulo: 'Seguir o sistema' },
                  { valor: 'completo', rotulo: 'Completo' },
                  { valor: 'reduzido', rotulo: 'Reduzido' },
                ]}
                className="w-52"
              />
            </div>
          </header>

          <Secao id="botoes" titulo="Botões">
            <div className="flex flex-wrap items-center gap-3">
              <Botao variante="primario">▸ Entrar na chamada</Botao>
              <Botao variante="secundario" icone={i(Copy)}>
                Copiar link
              </Botao>
              <Botao variante="fantasma">Cancelar</Botao>
              <Botao variante="perigo" icone={i(Trash2)}>
                Apagar canal
              </Botao>
              <Botao variante="primario" carregando>
                Salvando
              </Botao>
              <Botao variante="secundario" disabled>
                Desativado
              </Botao>
              <Botao variante="primario" tamanho="sm">
                Pequeno
              </Botao>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <BotaoIcone rotulo={mudo ? 'Ligar microfone' : 'Silenciar microfone'} icone={mudo ? i(MicOff) : i(Mic)} ligado={mudo} alerta={mudo} onClick={() => setMudo((v) => !v)} atalho="Ctrl Shift M" />
              <BotaoIcone rotulo="Ensurdecer" icone={i(Headphones)} ligado={false} />
              <BotaoIcone rotulo="Câmera" icone={i(Video)} ligado={false} />
              <BotaoIcone rotulo="Compartilhar tela" icone={i(MonitorUp)} ligado />
              <BotaoIcone rotulo="Ajustes" icone={i(Settings)} />
              <span className="ml-3 flex items-center gap-1 text-12 text-texto-3">
                Busca: <Tecla>Ctrl</Tecla>
                <Tecla>K</Tecla>
              </span>
            </div>
          </Secao>

          <Secao id="campos" titulo="Campos">
            <div className="grid grid-cols-2 gap-5">
              <Campo rotulo="Nome de exibição" value={nome} onChange={(e) => setNome(e.target.value)} dica="Como os outros vão te ver." placeholder="pitohui" />
              <Campo rotulo="Nome de usuário" defaultValue="Nome Inválido" erro="Use só letras minúsculas, números, ponto ou _." />
              <CampoSenha rotulo="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
              <Campo rotulo="Buscar" prefixo={i(Search)} placeholder="// buscar ou ir para…" />
              <AreaDeTexto rotulo="Sobre mim" value={sobre} onChange={(e) => setSobre(e.target.value)} maxLength={190} contador className="col-span-2" />
            </div>
          </Secao>

          <Secao id="controles" titulo="Controles">
            <div className="grid grid-cols-2 gap-x-8">
              <div className="divide-y divide-borda">
                <LinhaDeInterruptor titulo="Iniciar com o Windows" descricao="Abre escondido na bandeja quando você entra no computador." ligado={ligado} aoMudar={setLigado} />
                <LinhaDeInterruptor titulo="Cancelamento de eco" descricao="Evita que o som das caixas volte pelo microfone." ligado={!ligado} aoMudar={(v) => setLigado(!v)} />
                <LinhaDeInterruptor titulo="Indisponível" descricao="Desativado mostra por quê, em vez de sumir." ligado={false} aoMudar={() => undefined} desativado />
              </div>
              <div className="flex flex-col gap-6">
                <Deslizante rotulo="Volume geral" valor={volume} aoMudar={setVolume} max={200} formatar={(v) => `${v}%`} />
                <Deslizante rotulo="Sensibilidade" valor={limiar} aoMudar={setLimiar} min={-70} max={-20} formatar={(v) => `${v} dB`} marca={-52} />
                <Selecao
                  rotulo="Microfone"
                  valor={dispositivo}
                  aoMudar={setDispositivo}
                  opcoes={[
                    { valor: 'padrao', rotulo: 'Padrão do Windows', detalhe: 'Microfone (Realtek Audio)' },
                    { valor: 'headset', rotulo: 'Headset HyperX' },
                    { valor: 'webcam', rotulo: 'Microfone da webcam' },
                  ]}
                />
              </div>
            </div>
          </Secao>

          <Secao id="identidade" titulo="Pessoas e selos">
            <div className="flex flex-wrap items-center gap-5">
              <Avatar nome="pitohui" id="359457076772151296" tamanho={40} status="ONLINE" falando />
              <Avatar nome="kaya" id="2" tamanho={40} status="IDLE" />
              <Avatar nome="rafa" id="3" tamanho={40} status="DND" />
              <Avatar nome="bruno" id="4" tamanho={40} status="OFFLINE" />
              <Avatar nome="lele" id="5" tamanho={72} status="ONLINE" />
              <SeloVivo />
              <SeloVivo grande />
              <Contador valor={3} rotulo="menções" />
              <Contador valor={128} rotulo="menções" />
              <SeloCargo nome="ADM" cor={0xfb7185} />
              <SeloCargo nome="Membro" />
            </div>
          </Secao>

          <Secao id="camadas" titulo="Menus, diálogos e avisos">
            <div className="flex flex-wrap items-center gap-3">
              <Menu>
                <MenuGatilho asChild>
                  <Botao>Menu do servidor ▾</Botao>
                </MenuGatilho>
                <MenuConteudo>
                  <MenuRotulo>Arasaka</MenuRotulo>
                  <MenuItem icone={i(Hash)}>Criar canal</MenuItem>
                  <MenuItem icone={i(Settings)} atalho="Ctrl ,">
                    Ajustes do servidor
                  </MenuItem>
                  <MenuSeparador />
                  <MenuItem icone={i(Trash2)} perigo>
                    Sair do servidor
                  </MenuItem>
                </MenuConteudo>
              </Menu>
              <MenuDeContexto>
                <MenuDeContextoGatilho asChild>
                  <span tabIndex={0} className="border border-dashed border-borda-2 px-3 py-2 text-13 text-texto-3">
                    Botão direito aqui (ou Shift+F10)
                  </span>
                </MenuDeContextoGatilho>
                <MenuDeContextoConteudo>
                  <MenuDeContextoItem icone={i(Volume2)}>Volume de kaya</MenuDeContextoItem>
                  <MenuDeContextoItem icone={i(MicOff)}>Silenciar no servidor</MenuDeContextoItem>
                  <MenuDeContextoSeparador />
                  <MenuDeContextoItem icone={i(UserX)} perigo>
                    Expulsar kaya
                  </MenuDeContextoItem>
                </MenuDeContextoConteudo>
              </MenuDeContexto>
              <Botao onClick={() => setDialogo(true)}>Abrir diálogo</Botao>
              <Botao variante="perigo" onClick={() => setConfirmacao(true)}>
                Banir kaya
              </Botao>
              <Botao variante="fantasma" onClick={() => avisar.erro('Não consegui enviar', 'A mensagem continua no campo; tente de novo.')}>
                Aviso de erro
              </Botao>
              <Botao variante="fantasma" onClick={() => avisar.ok('Link copiado')}>
                Aviso de sucesso
              </Botao>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Aviso tipo="info">Sua conexão usa o caminho direto por IPv6.</Aviso>
              <Aviso tipo="aviso" titulo="Sinal instável">A voz pode falhar nos próximos segundos.</Aviso>
              <Aviso tipo="erro" titulo="A chamada caiu" acao={<Botao tamanho="sm" variante="primario">Tentar de novo</Botao>}>
                Suas mensagens de texto continuam disponíveis.
              </Aviso>
              <Aviso tipo="ok">Perfil salvo.</Aviso>
            </div>
            <Dialogo
              aberto={dialogo}
              aoMudar={setDialogo}
              rotulo="servidor"
              titulo="Convidar pessoas"
              descricao="O link vale 7 dias e pode ser usado 1 vez."
              acoes={
                <>
                  <Botao variante="fantasma" onClick={() => setDialogo(false)}>
                    Fechar
                  </Botao>
                  <Botao variante="primario" icone={i(Copy)}>
                    Copiar link
                  </Botao>
                </>
              }
            >
              <Campo rotulo="Link do convite" readOnly value="order.arasaka.fun/convite/Ab3dEf9h" />
            </Dialogo>
            <Confirmacao
              aberto={confirmacao}
              aoMudar={setConfirmacao}
              titulo="Banir kaya?"
              descricao="Ela sai do servidor e não consegue voltar por convite até ser desbanida."
              confirmar="Banir"
              perigo
              aoConfirmar={async () => {
                await new Promise((r) => setTimeout(r, 700));
                throw new Error('Você não pode banir alguém com cargo igual ou acima do seu.');
              }}
            />
          </Secao>

          <Secao id="abas" titulo="Abas">
            <Abas
              rotulo="Amigos"
              valor={aba}
              aoMudar={setAba}
              abas={[
                { valor: 'online', rotulo: 'Online' },
                { valor: 'todos', rotulo: 'Todos' },
                { valor: 'pendentes', rotulo: 'Pendentes', contagem: 2 },
                { valor: 'bloqueados', rotulo: 'Bloqueados' },
              ]}
            >
              <ConteudoDaAba value="online" className="pt-4 text-13 text-texto-2">
                3 amigos online.
              </ConteudoDaAba>
              <ConteudoDaAba value="todos" className="pt-4 text-13 text-texto-2">
                7 amigos.
              </ConteudoDaAba>
              <ConteudoDaAba value="pendentes" className="pt-4 text-13 text-texto-2">
                2 pedidos esperando resposta.
              </ConteudoDaAba>
              <ConteudoDaAba value="bloqueados" className="pt-4 text-13 text-texto-2">
                Ninguém bloqueado.
              </ConteudoDaAba>
            </Abas>
          </Secao>

          <Secao id="palco" titulo="Palco da chamada (vídeo sintético)">
            <PalcoDeDemonstracao />
          </Secao>

          <Secao id="estados" titulo="Estados">
            <div className="grid grid-cols-2 gap-5">
              <div className="grid h-40 place-items-center border border-borda">
                <Carregando texto="Sincronizando canais…" />
              </div>
              <div className="flex h-40 flex-col justify-center gap-2 border border-borda p-4">
                <Esqueleto className="h-3 w-3/4" />
                <Esqueleto className="h-3 w-1/2" />
                <Esqueleto className="h-3 w-2/3" />
              </div>
              <div className="col-span-2 h-64 border border-borda">
                <EstadoVazio rotulo="Início" titulo="Sua rede começa aqui" acao={<><Botao variante="primario">Adicionar amigo</Botao><Botao>Entrar num servidor</Botao></>}>
                  Adicione alguém pelo nome de usuário, crie um servidor ou entre por convite.
                </EstadoVazio>
              </div>
            </div>
          </Secao>
        </div>
      </div>
      <Avisos />
    </ProvedorDeDicas>
  );
}

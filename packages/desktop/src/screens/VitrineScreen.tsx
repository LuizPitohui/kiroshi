import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/ui/Dialog.js';
import { Drawer } from '../components/ui/Drawer.js';
import { ContextMenu } from '../components/ui/ContextMenu.js';
import { TextField } from '../components/ui/TextField.js';
import { Switch } from '../components/ui/Switch.js';
import { SettingsSection } from '../components/ui/SettingsSection.js';
import { InlineAlert } from '../components/ui/InlineAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { ConnectionStatus } from '../components/ui/ConnectionStatus.js';
import { ParticipantTile } from '../components/ui/ParticipantTile.js';
import { ContextPanel } from '../components/ui/ContextPanel.js';
import { CallControls } from '../components/CallControls.js';
import { ProfileCard } from '../components/ui/ProfileCard.js';
import { UnsavedBar } from '../components/ui/UnsavedBar.js';
import { Avatar } from '../components/Avatar.js';
import { BarraDeEstado } from '../components/BarraDeEstado.js';
import { anunciar } from '../lib/anunciar.js';
import { useToast } from '../components/ui/Toast.js';
import { Trash, Edit, Link, Chevron, Users, Mic, Monitor, Plus } from '../components/Icons.js';

/**
 * Vitrine: todos os componentes compartilhados em uma tela.
 *
 * Serve a dois propositos, e o segundo e o que justifica ela existir.
 *
 * O primeiro e obvio: ver as pecas juntas. Duas variacoes do mesmo botao em
 * telas diferentes passam despercebidas; lado a lado, nao.
 *
 * O segundo e o teste. `test/vitrine.mjs` dirige esta tela e cobra o que nao
 * se ve — se o foco entra no dialogo e volta para quem o abriu, se o campo
 * liga rotulo e erro por id, se a chave e um checkbox de verdade, se cada
 * tipo de aviso tem um icone proprio. Sem um lugar onde todas as pecas
 * existem ao mesmo tempo, esse teste precisaria navegar o aplicativo inteiro
 * e dependeria de ter servidor, conta e dados.
 *
 * Por isso os `data-vitrine`: sao enderecos estaveis para o teste, que nao
 * dependem de classe de estilo nem de ordem na tela.
 *
 * Nao e uma tela de produto. Chega por `?vitrine` na URL.
 */
export function VitrineScreen() {
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('segredo');
  const [bio, setBio] = useState('Uma linha sobre mim que ja passa de setenta por cento');
  const [ligado, setLigado] = useState(true);
  const [painelAberto, setPainelAberto] = useState(false);
  const [salvouNaVitrine, setSalvouNaVitrine] = useState(false);
  const [volumeDeVozNaVitrine, setVolumeDeVozNaVitrine] = useState(100);
  const [volumeDaTelaNaVitrine, setVolumeDaTelaNaVitrine] = useState(60);

  const ancoraDoMenu = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  return (
    <div className="vitrine">
      <h1 className="vitrine-titulo">Componentes</h1>

      <SettingsSection titulo="Camadas" descricao="Dialogo, gaveta e menu de acoes.">
        <div className="vitrine-linha">
          <button
            className="btn btn-primary"
            data-vitrine="abrir-dialogo"
            onClick={() => setDialogoAberto(true)}
          >
            Abrir dialogo
          </button>
          <button className="btn" onClick={() => setGavetaAberta(true)}>
            Abrir gaveta
          </button>
          <button className="btn" onClick={() => toast.mostrar('Convite copiado')}>
            Mostrar toast
          </button>
        </div>

        {/*
          A ancora fica colada na base do bloco para o teste poder cobrar que o
          balao VIRE PARA CIMA quando nao cabe embaixo.
        */}
        <div className="vitrine-ancora-baixo">
          <button
            ref={ancoraDoMenu}
            className="btn"
            data-vitrine="abrir-menu-embaixo"
            onClick={() => setMenuAberto((v) => !v)}
          >
            Menu de acoes
          </button>
        </div>
      </SettingsSection>

      <SettingsSection titulo="Formularios" descricao="Campo, senha, contador e chave.">
        <div data-vitrine="campo-ok">
          <TextField
            rotulo="Nome de exibicao"
            valor={nome}
            aoMudar={setNome}
            dica="Como os outros vao te ver."
          />
        </div>

        <div data-vitrine="campo-erro">
          <TextField
            rotulo="Nome de usuario"
            valor="nome invalido"
            aoMudar={() => undefined}
            erro="Use so letras minusculas, numeros, ponto ou _"
          />
        </div>

        <div data-vitrine="campo-senha">
          <TextField rotulo="Senha" type="password" valor={senha} aoMudar={setSenha} />
        </div>

        <div data-vitrine="campo-contador">
          <TextField rotulo="Sobre mim" valor={bio} aoMudar={setBio} multilinha maxLength={70} />
        </div>

        <div data-vitrine="chave">
          <Switch
            ligado={ligado}
            aoMudar={setLigado}
            rotulo="Cancelamento de eco"
            descricao="Evita que o som das caixas volte pelo microfone."
          />
        </div>

        <Switch
          ligado={false}
          aoMudar={() => undefined}
          rotulo="Reducao de ruido"
          descricao="Indisponivel neste dispositivo de entrada."
          desabilitado
          motivo="O microfone selecionado nao suporta."
        />
      </SettingsSection>

      <SettingsSection
        titulo="Feedback"
        descricao="Cada tipo tem um icone proprio, nao so uma cor."
      >
        <div className="vitrine-pilha">
          <InlineAlert tipo="info">Sua conexao usa o caminho direto por IPv6.</InlineAlert>
          <InlineAlert tipo="sucesso">Perfil salvo.</InlineAlert>
          <InlineAlert tipo="aviso" titulo="Conexao instavel">
            A voz pode falhar nos proximos segundos.
          </InlineAlert>
          <InlineAlert tipo="erro" titulo="Nao consegui enviar" aoDispensar={() => undefined}>
            A mensagem continua aqui; tente de novo.
          </InlineAlert>

          <ConnectionStatus
            estado="caiu"
            detalhe="ultimo par de candidatos: 100.66.187.120 -> 100.85.246.51"
            aoTentarNovamente={() => undefined}
            aoVerDiagnostico={() => undefined}
            aoSair={() => undefined}
          />
        </div>
      </SettingsSection>

      <SettingsSection titulo="Vazio e carregando">
        <EmptyState
          compacto
          titulo="Sua rede comeca aqui"
          descricao="Adicione alguem pelo nome de usuario ou entre em um servidor por convite."
          acoes={
            <>
              <button className="btn btn-primary">Adicionar amigo</button>
              <button className="btn">Entrar em um servidor</button>
            </>
          }
        />
        <div className="vitrine-esqueleto">
          <Skeleton forma="circulo" largura={36} altura={36} />
          <div style={{ flex: 1 }}>
            <Skeleton forma="texto" linhas={3} />
          </div>
        </div>
      </SettingsSection>

      {/*
        As pecas das nao lidas.

        Elas sao so marcacao e estilo — a regra de ONDE o divisor cai e
        testada como funcao pura em `lib/naoLidas.test.ts`. O que aquele teste
        nao alcanca e se o divisor tem rotulo legivel e se os dois estados do
        botao sao distinguiveis, que e o que se ve aqui.
      */}
      <SettingsSection
        titulo="Nao lidas"
        descricao="O divisor da conversa e o atalho de volta ao fim."
      >
        <div className="vitrine-conversa" data-vitrine="divisor">
          <div className="divisor-nao-lidas" role="separator">
            <span className="divisor-rotulo">3 mensagens nao lidas</span>
          </div>
        </div>

        <div className="vitrine-linha" data-vitrine="voltar">
          {/*
            Os dois estados lado a lado. Sao acoes diferentes: um leva ao
            presente, o outro ao ponto em que a pessoa parou de ler — e por
            isso mudam de texto, e nao so de cor.
          */}
          <button className="voltar-ao-fim vitrine-estatico">
            <span>Ir para o fim</span>
            <Chevron size={14} />
          </button>
          <button className="voltar-ao-fim com-novidade vitrine-estatico">
            <span>3 mensagens nao lidas</span>
            <Chevron size={14} />
          </button>
        </div>
      </SettingsSection>

      {/*
        As pecas da chamada.

        Elas entraram aqui depois das outras, e a razao vale registrar: o
        `ParticipantTile` e o `ContextPanel` ficaram prontos, documentados e
        fora da vitrine, o que quer dizer que nada os exercitava. Pareciam
        cobertos porque estavam na mesma pasta dos que estao.

        Tambem e o unico jeito honesto de verificar o palco sem uma chamada de
        verdade: a composicao por numero de participantes e testada como
        funcao pura em `voice/palco.test.ts`, e o que aquele teste nao alcanca
        e o CSS que cada modo recebe. Aqui os quatro modos existem ao mesmo
        tempo, com quadros de mentira, e da para medir a largura de cada um.
      */}
      <SettingsSection
        titulo="Chamada"
        descricao="Cartao de participante, modos do palco, controles e painel lateral."
      >
        <div className="vitrine-linha" data-vitrine="tiles">
          <div style={{ width: 200, height: 112 }}>
            <RostoFalso nome="pitohuikun" falando />
          </div>
          <div style={{ width: 200, height: 112 }}>
            <RostoFalso nome="vartaque" semMicrofone />
          </div>
          <div style={{ width: 200, height: 112 }}>
            <RostoFalso nome="Tela de vartaque" aoVivo aviso />
          </div>
        </div>

        {/*
          Os quatro modos, cada um com a contagem que o dispara. O teste mede
          a largura dos quadros dentro de cada um: se `palco-dupla` deixar os
          dois do tamanho de uma grade de nove, a diferenca aparece aqui.
        */}
        {(
          [
            ['solo', 1],
            ['dupla', 2],
            ['grade', 5],
            ['faixa', 4],
          ] as const
        ).map(([modo, quantos]) => (
          <div key={modo} className="vitrine-palco" data-vitrine={`palco-${modo}`}>
            <div
              className={`stage-floor palco-${modo}`}
              style={
                {
                  '--cols': modo === 'grade' ? 3 : quantos,
                  '--rows': modo === 'grade' ? 2 : 1,
                } as React.CSSProperties
              }
            >
              {Array.from({ length: quantos }, (_, i) => (
                <RostoFalso
                  key={i}
                  nome={`pessoa ${i + 1}`}
                  semImagem={modo === 'faixa'}
                  falando={i === 0}
                />
              ))}
            </div>
            <span className="vitrine-nota">{modo}</span>
          </div>
        ))}

        {/*
          Um video DE VERDADE dentro de um quadro de verdade.

          E a unica secao da vitrine com midia real, e existe porque o resto
          nao alcanca este defeito: os outros quadros usam `div`, e `div` nao
          tem proporcao propria. O video tem — e era dai que vinha o corte.
          O elemento media 1552x873 dentro de um quadro de 1554x551, e os
          322px que sobravam iam para o `overflow: hidden`. Topo e base da
          transmissao, cortados, em toda chamada.

          O teste cobra o unico fato que importa: o video nao pode ser maior
          que o quadro que o contem.
        */}
        <div data-vitrine="encaixe-do-video">
          <div className="stage-floor palco-destaque" style={{ height: 220, width: 620 }}>
            <div className="tile spot">
              <VideoDeProva />
            </div>
          </div>
          <span className="vitrine-nota">video 16/9 em quadro largo</span>
        </div>

        {/*
          O convite para assistir uma transmissao.

          Nao ha previa da tela de proposito: qualquer imagem aqui exigiria
          baixar a transmissao, que e exatamente o que este estado evita.
        */}
        <div className="vitrine-linha" data-vitrine="convite">
          <div style={{ width: 240, height: 135 }}>
            <ParticipantTile nome="Tela de vartaque" aoVivo>
              <div className="convite-transmissao">
                <Users size={26} className="convite-icone" />
                <span className="convite-titulo">vartaque esta transmitindo</span>
                <button className="btn btn-primary">Assistir</button>
              </div>
            </ParticipantTile>
          </div>
          <div style={{ width: 148, height: 84 }}>
            <ParticipantTile nome="Tela de pitohuikun" aoVivo miniatura>
              <div className="convite-transmissao">
                <Users size={26} className="convite-icone" />
                <span className="convite-titulo">pitohuikun esta transmitindo</span>
                <button className="btn btn-primary">Assistir</button>
              </div>
            </ParticipantTile>
          </div>
        </div>

        {/*
          O cartao da pessoa, como ele monta.

          Aqui sao as PECAS soltas, sem balao: o balao precisa de uma ancora
          viva e de estado de chamada, e o que se quer cobrar e o cartao em si
          — os dois volumes separados, com rotulo e alcance de teclado, e a
          acao de amizade.
        */}
        <div data-vitrine="cartao-pessoa">
          <div className="cartao-pessoa" style={{ width: 300 }}>
            <ProfileCard
              displayName="vartaque"
              username="vartaque"
              pronouns="ele/dele"
              status="ONLINE"
            />
            <div className="cartao-volumes">
              <label className="cartao-volume">
                <span className="cartao-volume-icone" aria-hidden="true">
                  <Mic size={14} />
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={volumeDeVozNaVitrine}
                  onChange={(e) => setVolumeDeVozNaVitrine(Number(e.target.value))}
                  aria-label="Voz de vartaque"
                  aria-valuetext={`${volumeDeVozNaVitrine} por cento`}
                />
                <span className="cartao-volume-valor mono">{volumeDeVozNaVitrine}%</span>
              </label>
              <label className="cartao-volume">
                <span className="cartao-volume-icone" aria-hidden="true">
                  <Monitor size={14} />
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={volumeDaTelaNaVitrine}
                  onChange={(e) => setVolumeDaTelaNaVitrine(Number(e.target.value))}
                  aria-label="Som da transmissao de vartaque"
                  aria-valuetext={`${volumeDaTelaNaVitrine} por cento`}
                />
                <span className="cartao-volume-valor mono">{volumeDaTelaNaVitrine}%</span>
              </label>
            </div>
            <div className="cartao-pessoa-acoes">
              <button className="btn btn-primary">
                <Plus size={14} />
                Adicionar amigo
              </button>
            </div>
          </div>
        </div>

        <div className="vitrine-linha" data-vitrine="controles-de-chamada">
          <CallControls />
        </div>

        <div className="vitrine-linha">
          <button
            className="btn"
            data-vitrine="abrir-painel"
            onClick={() => setPainelAberto((v) => !v)}
          >
            {painelAberto ? 'Fechar painel' : 'Abrir painel'}
          </button>
        </div>
      </SettingsSection>

      {/*
        O painel fica fora da grade da vitrine, encostado na direita, porque e
        assim que ele vive no produto: uma coluna na borda, com alca propria.
        Dentro de um cartao a alca nao teria contra o que arrastar.
      */}
      {painelAberto && (
        <div className="vitrine-painel-area">
          <ContextPanel
            titulo="Conversa da chamada"
            chave="vitrine"
            aoFechar={() => setPainelAberto(false)}
          >
            <EmptyState
              compacto
              titulo="Sem mensagens"
              descricao="Escreva algo para quem esta na chamada."
            />
          </ContextPanel>
        </div>
      )}

      {/*
        Os anuncios.

        Nao ha nada para ver — e esse e o ponto. O teste cobra que as duas
        regioes existam ANTES de qualquer anuncio (uma regiao criada junto com
        o texto nao e lida), que cada urgencia caia na regiao certa, e que o
        mesmo texto duas vezes produza conteudo diferente. Esse ultimo e o que
        ninguem descobre olhando: o leitor de tela so fala quando o conteudo
        muda, entao "Fulano entrou na chamada" duas vezes seria falado uma so.
      */}
      <SettingsSection
        titulo="Anuncios"
        descricao="O que o aplicativo diz a quem usa leitor de tela. Invisivel de proposito."
      >
        <div className="vitrine-linha">
          <button
            className="btn"
            data-vitrine="anunciar-normal"
            onClick={() => anunciar('vartaque entrou na chamada')}
          >
            Anunciar (normal)
          </button>
          <button
            className="btn"
            data-vitrine="anunciar-urgente"
            onClick={() => anunciar('A chamada caiu', 'urgente')}
          >
            Anunciar (urgente)
          </button>
        </div>
      </SettingsSection>

      {/*
        As pecas do perfil.

        O cartao aparece com bio e sem bio porque a diferenca nao e so uma
        linha a mais: sem bio ele nao desenha a divisoria, e o caso vazio e o
        que quebra primeiro quando alguem mexe no espacamento.

        A barra aparece nos dois estados — pendente e com erro — porque a
        segunda nao e a primeira em outra cor: ela troca o texto pela mensagem
        do servidor, e um texto longo ali precisa caber sem empurrar os botoes
        para fora.
      */}
      <SettingsSection
        titulo="Perfil"
        descricao="O cartao como os outros veem, e a barra de alteracoes nao salvas."
      >
        <div className="vitrine-linha" data-vitrine="cartoes">
          <ProfileCard
            displayName="pitohuikun"
            username="pitohuikun"
            pronouns="ele/dele"
            bio={'Jogo de madrugada.\nMe chama no @ se precisar.'}
            status="ONLINE"
          />
          <ProfileCard displayName="vartaque" username="vartaque" status="IDLE" />
        </div>

        <div data-vitrine="barra-pendente">
          <UnsavedBar
            avisarAoSair={false}
            visivel
            aoSalvar={() => setSalvouNaVitrine(true)}
            aoDescartar={() => setSalvouNaVitrine(false)}
          />
        </div>

        <div data-vitrine="barra-erro">
          <UnsavedBar
            avisarAoSair={false}
            visivel
            erro="Esse nome de usuario ja esta em uso por outra pessoa neste servidor."
            aoSalvar={() => undefined}
            aoDescartar={() => undefined}
          />
        </div>

        {salvouNaVitrine && (
          <InlineAlert tipo="sucesso" aoDispensar={() => setSalvouNaVitrine(false)}>
            A barra chamou quem salva.
          </InlineAlert>
        )}
      </SettingsSection>

      <SettingsSection
        titulo="Faixa de estado"
        descricao="A linha de instrumento do rodape, com o estado real do aplicativo."
      >
        {/*
          A faixa DE VERDADE, nao uma imitacao.

          Ela le a store e o controlador de voz direto. O elo pode aparecer de
          pe aqui — o login e persistente, entao abrir com sessao guardada
          conecta o gateway mesmo nesta tela. O que NAO existe na vitrine e
          chamada, e por isso latencia e contagem de voz tem que sair em traco.

          E o teste mais importante que a faixa tem, e so da para faze-lo com o
          componente real: uma imitacao de marcacao passaria sempre, porque quem
          a escreve escreve os tracos na mao.
        */}
        <div className="vitrine-linha" data-vitrine="faixa" style={{ display: 'block' }}>
          <BarraDeEstado />
        </div>
        <p className="vitrine-nota">
          O elo pode estar de pe aqui, porque o login e persistente. Chamada nao ha — entao
          latencia e voz saem em traco. Numero ali seria invencao.
        </p>
      </SettingsSection>

      <Dialog
        aberto={dialogoAberto}
        aoFechar={() => setDialogoAberto(false)}
        titulo="Criar canal"
        descricao="O nome pode ser trocado depois."
        acoes={
          <>
            <button className="btn" onClick={() => setDialogoAberto(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => setDialogoAberto(false)}>
              Criar
            </button>
          </>
        }
      >
        <TextField rotulo="Nome do canal" valor={nome} aoMudar={setNome} />
      </Dialog>

      <Drawer aberto={gavetaAberta} aoFechar={() => setGavetaAberta(false)} titulo="Membros">
        <EmptyState
          compacto
          titulo="Ninguem por aqui"
          descricao="Convide alguem para este servidor."
        />
      </Drawer>

      <ContextMenu
        ancora={ancoraDoMenu}
        aberto={menuAberto}
        aoFechar={() => setMenuAberto(false)}
        itens={[
          { rotulo: 'Copiar convite', icone: <Link size={14} />, aoAtivar: () => undefined },
          { rotulo: 'Editar canal', icone: <Edit size={14} />, aoAtivar: () => undefined },
          {
            rotulo: 'Apagar canal',
            icone: <Trash size={14} />,
            perigoso: true,
            aoAtivar: () => undefined,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Um quadro de participante sem chamada nenhuma por tras.
 *
 * O `ParticipantTile` recebe a imagem por `children`, e e justamente isso que
 * permite exercita-lo aqui: no produto entra um `<video>` com uma faixa do
 * SFU, e na vitrine entra um avatar. O cartao nao sabe a diferenca, que e o
 * sinal de que a fronteira do componente esta no lugar certo.
 */
function RostoFalso({
  nome,
  falando = false,
  semMicrofone = false,
  aoVivo = false,
  semImagem = false,
  aviso = false,
}: {
  nome: string;
  falando?: boolean;
  semMicrofone?: boolean;
  aoVivo?: boolean;
  semImagem?: boolean;
  aviso?: boolean;
}) {
  return (
    <ParticipantTile
      nome={nome}
      falando={falando}
      semMicrofone={semMicrofone}
      aoVivo={aoVivo}
      semImagem={semImagem}
      aviso={aviso ? <span className="mono tile-warn">instavel</span> : undefined}
      onClick={() => undefined}
    >
      {/* 44px e o tamanho que o palco de verdade usa fora do destaque. Com 56
          o rotulo cobria o rosto na grade, e a vitrine mostrava um defeito que
          o produto nao tem — que e tao ruim quanto esconder um que ele tem. */}
      <Avatar name={nome} size={44} />
    </ParticipantTile>
  );
}

// ---------------------------------------------------------------------------

/**
 * Um video 16/9 alimentado por um canvas, sem camera e sem rede.
 *
 * A vitrine roda sem conta e sem chamada, entao a unica forma de ter midia
 * real aqui e fabricar uma. `captureStream` de um canvas da um `MediaStream`
 * com largura e altura de verdade — que e exatamente o que faltava para o
 * quadro revelar o problema de encaixe.
 */
function VideoDeProva() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const tela = document.createElement('canvas');
    tela.width = 1920;
    tela.height = 1080;
    const pincel = tela.getContext('2d');
    if (!pincel) return;
    pincel.fillStyle = '#12202e';
    pincel.fillRect(0, 0, 1920, 1080);

    const fluxo = tela.captureStream(1);
    const video = ref.current;
    if (video) {
      video.srcObject = fluxo;
      void video.play().catch(() => undefined);
    }
    return () => {
      for (const faixa of fluxo.getTracks()) faixa.stop();
    };
  }, []);

  return <video ref={ref} autoPlay playsInline muted />;
}

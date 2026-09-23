/**
 * A guarda de entrada, nos dois jeitos de errar.
 *
 * Ela ja errou os dois, um em cada versao publicada:
 *
 *   FROUXA DEMAIS — o eco do gateway passava durante a conexao, entravamos
 *   duas vezes na sala e o servidor derrubava a primeira por identidade
 *   duplicada. A chamada caia ao entrar;
 *
 *   APERTADA DEMAIS — a versao seguinte olhou para `connecting`, que
 *   `joinChannel` liga antes de chamar `connect`. A guarda barrava a propria
 *   entrada que acabara de comecar, e a tela ficava em "Entrando na
 *   chamada..." para sempre.
 *
 * Por isso aqui nao ha so testes da funcao: ha uma SIMULACAO da sequencia real
 * do controlador, no fim do arquivo. Foi a sequencia que quebrou, e testar a
 * funcao isolada nao teria pego — a primeira versao quebrada passava em todos
 * os testes de unidade que ela tinha.
 */
import { describe, it, expect } from 'vitest';
import { devoIgnorarEntrada, devoAtenderTokenDoGateway } from './entrada.js';

const PARADO = { emVoo: null, connected: false, channelId: null, naSala: false };

describe('o que a guarda barra', () => {
  /*
    A corrida que derrubava a chamada: o eco do gateway chegando enquanto a
    entrada da pessoa ainda esta em voo.
  */
  it('pedido para um canal que ja tem entrada em voo', () => {
    expect(devoIgnorarEntrada({ ...PARADO, emVoo: 'play' }, 'play')).toBe(true);
  });

  it('e pedido para um canal em que ja estou conectado', () => {
    expect(
      devoIgnorarEntrada({ emVoo: null, connected: true, channelId: 'play', naSala: true }, 'play'),
    ).toBe(true);
  });
});

describe('o que a guarda DEIXA passar', () => {
  it('parado, sem nada em voo', () => {
    expect(devoIgnorarEntrada(PARADO, 'play')).toBe(false);
  });

  /*
    O limite que impede a guarda de virar travamento: a comparacao e por
    CANAL. Quem clica em Geral e muda de ideia para Play durante a conexao
    precisa que o segundo pedido passe.
  */
  it('entrada em voo para OUTRO canal nao bloqueia', () => {
    expect(devoIgnorarEntrada({ ...PARADO, emVoo: 'geral' }, 'play')).toBe(false);
  });

  it('nem estar conectado em outro canal', () => {
    expect(
      devoIgnorarEntrada({ emVoo: null, connected: true, channelId: 'geral', naSala: true }, 'play'),
    ).toBe(false);
  });

  /*
    ESTE E O TESTE DA REGRESSAO QUE FOI PUBLICADA.

    `joinChannel` emite `connecting: true` com o canal antes de chamar
    `connect`. A versao quebrada olhava para esse `connecting`, via o estado
    que ela mesma tinha acabado de escrever e desistia da propria entrada.

    A guarda de agora nao olha para `connecting` nenhum: sem marca de voo, o
    pedido passa.
  */
  it('estado dizendo "conectando" NAO basta para barrar', () => {
    // O mesmo formato que `joinChannel` emite antes de conectar de fato.
    const logoDepoisDoClique = { emVoo: null, connected: false, channelId: 'play', naSala: false };
    expect(devoIgnorarEntrada(logoDepoisDoClique, 'play')).toBe(false);
  });

  /*
    Canal marcado sem conexao e sem voo acontece depois de uma queda. Entrar
    tem que funcionar; uma guarda que trava aqui deixa a pessoa sem chamada ate
    reiniciar o aplicativo.
  */
  it('canal que sobrou de uma queda nao bloqueia a volta', () => {
    expect(
      devoIgnorarEntrada({ emVoo: null, connected: false, channelId: 'play', naSala: false }, 'play'),
    ).toBe(false);
  });
});

/**
 * A SEQUENCIA DE VERDADE.
 *
 * Reproduz o caminho do controlador com as mesmas ordens de operacao — a marca
 * de voo escrita no clique, a espera da API, o eco do gateway chegando no meio
 * — e conta quantas vezes a sala foi aberta.
 *
 * E o unico teste daqui que pegaria as DUAS versoes quebradas: a frouxa abriria
 * a sala duas vezes, a apertada nenhuma.
 */
function controladorDeMentira() {
  const situacao = {
    emVoo: null as string | null,
    connected: false,
    channelId: null as string | null,
    naSala: false,
  };
  let salasAbertas = 0;

  /** O trabalho de verdade. Nao consulta a guarda: quem chama ja consultou. */
  async function entrarNaSala(canal: string): Promise<void> {
    salasAbertas++;
    situacao.naSala = true;
    await Promise.resolve();
    situacao.connected = true;
    situacao.channelId = canal;
  }

  return {
    situacao,
    get salasAbertas() {
      return salasAbertas;
    },

    /** O clique da pessoa. */
    async joinChannel(canal: string): Promise<void> {
      if (devoIgnorarEntrada(situacao, canal)) return;
      situacao.emVoo = canal;
      // `joinChannel` anuncia a tentativa ANTES de ter token — e esse estado
      // que enganava a versao quebrada.
      situacao.channelId = canal;
      try {
        await Promise.resolve(); // a chamada de API
        await entrarNaSala(canal);
      } finally {
        situacao.emVoo = null;
      }
    },

    /** O eco do gateway. */
    async connect(canal: string): Promise<void> {
      if (devoIgnorarEntrada(situacao, canal)) return;
      situacao.emVoo = canal;
      try {
        await entrarNaSala(canal);
      } finally {
        situacao.emVoo = null;
      }
    },
  };
}

describe('a sequencia real: clique e eco do gateway', () => {
  it('o eco durante a entrada NAO abre uma segunda sala', async () => {
    const c = controladorDeMentira();
    const clique = c.joinChannel('play');
    // O eco chega enquanto o clique ainda esta em voo.
    await c.connect('play');
    await clique;

    expect(c.salasAbertas).toBe(1);
    expect(c.situacao.connected).toBe(true);
  });

  /*
    O outro lado, e o que foi publicado quebrado: a entrada precisa ACONTECER.
    Uma guarda apertada demais deixa tudo parado sem abrir sala nenhuma, e a
    tela fica em "Entrando na chamada..." para sempre.
  */
  it('e o clique sozinho abre a sala, sem barrar a si mesmo', async () => {
    const c = controladorDeMentira();
    await c.joinChannel('play');

    expect(c.salasAbertas).toBe(1);
    expect(c.situacao.connected).toBe(true);
  });

  it('o eco chegando primeiro tambem entra', async () => {
    const c = controladorDeMentira();
    await c.connect('play');

    expect(c.salasAbertas).toBe(1);
    expect(c.situacao.connected).toBe(true);
  });

  it('e depois de entrar, o eco atrasado nao derruba nada', async () => {
    const c = controladorDeMentira();
    await c.joinChannel('play');
    await c.connect('play');

    expect(c.salasAbertas).toBe(1);
  });

  it('trocar de canal durante a entrada continua abrindo a nova sala', async () => {
    const c = controladorDeMentira();
    const primeiro = c.joinChannel('geral');
    await c.connect('play');
    await primeiro;

    expect(c.salasAbertas).toBe(2);
  });
});

describe('o token que o gateway manda para TODAS as sessoes', () => {
  const parado = { emVoo: null, connected: false, channelId: null, naSala: false };

  /*
    O CASO QUE FOI VISTO ACONTECENDO.

    Uma segunda instancia do aplicativo, aberta na mesma maquina e logada na
    mesma conta, apareceu dentro da chamada sem receber um clique. O servidor
    emite o token com `emitToUser`, que entrega a todas as sessoes daquela
    pessoa — e o cliente parado obedecia.

    Nao e so incomodo: entrar na sala abre a faixa de audio local, entao um
    aparelho esquecido em outro comodo comeca a transmitir o microfone
    sozinho.
  */
  it('cliente parado, que nao pediu nada, IGNORA o token', () => {
    expect(devoAtenderTokenDoGateway(parado)).toBe(false);
  });

  it('mas quem tem entrada em voo atende: e a resposta ao proprio pedido', () => {
    expect(devoAtenderTokenDoGateway({ ...parado, emVoo: 'play' })).toBe(true);
  });

  /*
    O limite que preserva a moderacao. O servidor so emite o segundo token
    quando move alguem ENTRE canais de voz, e so move quem ja esta na voz —
    entao estar na sala e o sinal certo de "este token e para mim".
  */
  it('e quem ja esta na sala atende, porque pode estar sendo movido', () => {
    expect(devoAtenderTokenDoGateway({ ...parado, naSala: true })).toBe(true);
  });

  /*
    `naSala` e separado de `connected` porque durante uma reconexao do LiveKit
    a sala existe e `connected` oscila. Um moderador movendo a pessoa nesse
    intervalo nao pode ser ignorado.
  */
  it('sala aberta com a conexao oscilando ainda atende', () => {
    expect(
      devoAtenderTokenDoGateway({ emVoo: null, connected: false, channelId: 'play', naSala: true }),
    ).toBe(true);
  });
});

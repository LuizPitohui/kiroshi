/**
 * A corrida que derrubava chamadas.
 *
 * O caso central e o segundo teste daqui: um pedido de entrada que chega
 * enquanto o primeiro ainda esta em voo. Ele passava, e o resultado era o
 * cliente se derrubando sozinho — o servidor via duas conexoes com a mesma
 * identidade e fechava a primeira.
 *
 * O outro lado importa tanto quanto: a guarda NAO pode virar travamento. Quem
 * clica num canal e muda de ideia antes de conectar precisa que o segundo
 * pedido passe.
 */
import { describe, it, expect } from 'vitest';
import { jaEstouIndoPara } from './entrada.js';

const PARADO = { connected: false, connecting: false, channelId: null };

describe('o pedido repetido para o mesmo canal', () => {
  it('ja conectado: ignora, como antes', () => {
    const estado = { connected: true, connecting: false, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'geral')).toBe(true);
  });

  /*
    O CONSERTO.

    Entre o clique e a conexao ha de um a seis segundos em que o estado e
    "conectando". O eco `VOICE_SERVER_UPDATE` do gateway chega exatamente ai, e
    a guarda antiga — que so olhava `connected` — deixava passar.

    Medido no log de producao antes do conserto: tres entradas no mesmo canal,
    duas fechadas com DUPLICATE_IDENTITY depois de 1,3s e 5,9s.
  */
  it('AINDA CONECTANDO: ignora tambem, que e o defeito consertado', () => {
    const estado = { connected: false, connecting: true, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'geral')).toBe(true);
  });

  it('e durante uma reconexao do LiveKit, que marca os dois', () => {
    const estado = { connected: true, connecting: true, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'geral')).toBe(true);
  });
});

describe('trocar de canal continua passando', () => {
  /*
    O limite do conserto. A comparacao e por CANAL, nao por "estou ocupado" —
    senao a guarda viraria travamento: quem clica em Geral e logo em Play
    durante a conexao ficaria preso no primeiro.
  */
  it('conectando em um canal nao bloqueia a entrada em outro', () => {
    const estado = { connected: false, connecting: true, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'play')).toBe(false);
  });

  it('nem estando conectado em outro', () => {
    const estado = { connected: true, connecting: false, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'play')).toBe(false);
  });
});

describe('parado deixa entrar', () => {
  it('sem canal nenhum, o pedido passa', () => {
    expect(jaEstouIndoPara(PARADO, 'geral')).toBe(false);
  });

  /*
    Estado impossivel na pratica, mas a guarda nao pode depender disso: se um
    canal ficou marcado sem conexao nem tentativa — depois de uma queda, por
    exemplo — entrar tem que funcionar. Uma guarda que trava aqui deixa a
    pessoa sem chamada ate reiniciar o aplicativo.
  */
  it('canal marcado mas sem conexao nem tentativa nao bloqueia', () => {
    const estado = { connected: false, connecting: false, channelId: 'geral' };
    expect(jaEstouIndoPara(estado, 'geral')).toBe(false);
  });
});

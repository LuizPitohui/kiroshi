import { generateId, type Call } from '@kiroshi/shared';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { badRequest, forbidden } from '../errors.js';
import { logger } from '../logger.js';
import { emitToUser, subscribeUserToChannel } from '../gateway/events.js';
import { CHANNEL_INCLUDE, MESSAGE_INCLUDE, toChannel, toMessage, type MessageRow } from '../lib/serialize.js';
import { quemChamar } from '../lib/chamada.js';
import { bloqueioEntre } from './relacoes.js';
import { tirarDaVoz } from './voice.js';

/**
 * Chamadas em conversa direta (DM e grupo): tocar, atender, recusar, o
 * registro na conversa e a regra dos 3 minutos sozinho.
 *
 * Uma chamada existe enquanto houver alguem na voz da conversa. Nasce quando
 * a primeira pessoa entra (quem liga), toca para os outros e acaba quando a
 * ultima sai.
 *
 * Quem esta na chamada e o banco que diz (VoiceState). Aqui fica so o que o
 * banco nao guarda: quem esta sendo chamado, os relogios do toque e da
 * solidao, e quem passou pela chamada, para o registro final. Em memoria, como
 * as sessoes do gateway: a API reiniciada ja apaga os estados de voz no boot,
 * e uma chamada sem ninguem na voz nao existe.
 */

interface Chamada {
  channelId: string;
  messageId: string;
  iniciadaEm: Date;
  /** Quem esta sendo chamado, com o relogio do fim do toque de cada um. */
  tocando: Map<string, ReturnType<typeof setTimeout>>;
  /** Quem passou pela chamada, na ordem em que entrou. */
  participantes: string[];
  /** Quem esta sozinho na chamada, e o relogio que vai desliga-lo. */
  sozinho: { userId: string; relogio: ReturnType<typeof setTimeout> } | null;
}

const chamadas = new Map<string, Chamada>();

/*
  Uma fila por conversa.

  Entrar, sair, tocar e os relogios mexem na mesma chamada e esperam o banco
  no meio. Sem fila, duas pessoas entrando juntas numa conversa sem chamada
  criariam duas chamadas, duas mensagens e dois toques.
*/
const filas = new Map<string, Promise<void>>();

function emFila(channelId: string, trabalho: () => Promise<void>): Promise<void> {
  const anterior = filas.get(channelId) ?? Promise.resolve();
  const vez = anterior.then(trabalho);
  // A fila segue mesmo se este trabalho falhar; quem chamou recebe o erro.
  const seguinte = vez.catch(() => undefined);
  filas.set(channelId, seguinte);
  void seguinte.then(() => {
    if (filas.get(channelId) === seguinte) filas.delete(channelId);
  });
  return vez;
}

/** Para os ganchos da voz: nunca estoura, so registra. */
function emFilaSemErro(channelId: string, trabalho: () => Promise<void>): void {
  emFila(channelId, trabalho).catch((error: unknown) => {
    logger.error({ error, channelId }, 'chamada: falha no estado da chamada');
  });
}

function paraOCliente(chamada: Chamada): Call {
  return {
    channelId: chamada.channelId,
    messageId: chamada.messageId,
    ringing: [...chamada.tocando.keys()],
    startedAt: chamada.iniciadaEm.toISOString(),
  };
}

async function destinatariosDe(channelId: string): Promise<string[]> {
  const linhas = await prisma.channelRecipient.findMany({ where: { channelId }, select: { userId: true } });
  return linhas.map((l) => l.userId);
}

async function naVozDe(channelId: string): Promise<string[]> {
  const linhas = await prisma.voiceState.findMany({
    where: { channelId },
    select: { userId: true },
    orderBy: { joinedAt: 'asc' },
  });
  return linhas.map((l) => l.userId);
}

async function avisar(chamada: Chamada, evento: 'CALL_CREATE' | 'CALL_UPDATE'): Promise<void> {
  const payload = paraOCliente(chamada);
  for (const userId of await destinatariosDe(chamada.channelId)) emitToUser(userId, evento, payload);
}

function relogioDoToque(channelId: string, userId: string): ReturnType<typeof setTimeout> {
  const relogio = setTimeout(() => {
    emFilaSemErro(channelId, async () => {
      const chamada = chamadas.get(channelId);
      if (!chamada?.tocando.has(userId)) return;
      chamada.tocando.delete(userId);
      await avisar(chamada, 'CALL_UPDATE');
    });
  }, config.voice.toqueMs);
  relogio.unref();
  return relogio;
}

function pararRelogioDaSolidao(chamada: Chamada): void {
  if (chamada.sozinho) clearTimeout(chamada.sozinho.relogio);
  chamada.sozinho = null;
}

/**
 * A regra dos 3 minutos: quem fica sozinho numa chamada de DM e desligado.
 *
 * O servidor e quem sabe com certeza quantos estao na chamada, e e a internet
 * de casa que paga uma chamada esquecida, com camera ou tela ligada, sem
 * ninguem do outro lado (09-referencia-discord.md, "Quem fica sozinho").
 */
async function reavaliarSolidao(chamada: Chamada): Promise<void> {
  const naVoz = await naVozDe(chamada.channelId);
  if (naVoz.length !== 1) {
    pararRelogioDaSolidao(chamada);
    return;
  }
  const quem = naVoz[0]!;
  if (chamada.sozinho?.userId === quem) return;
  pararRelogioDaSolidao(chamada);
  const relogio = setTimeout(() => {
    emFilaSemErro(chamada.channelId, () => desligarQuemFicouSozinho(chamada.channelId, quem));
  }, config.voice.sozinhoMs);
  relogio.unref();
  chamada.sozinho = { userId: quem, relogio };
}

async function desligarQuemFicouSozinho(channelId: string, userId: string): Promise<void> {
  const chamada = chamadas.get(channelId);
  if (!chamada || chamada.sozinho?.userId !== userId) return;
  const naVoz = await naVozDe(channelId);
  // Alguem chegou no ultimo instante: a chamada segue.
  if (naVoz.length !== 1 || naVoz[0] !== userId) return;
  chamada.sozinho = null;
  logger.info({ channelId, userId }, 'chamada: sozinho por tempo demais, desligando');
  await tirarDaVoz(userId, { channelId }, 'ALONE_TIMEOUT');
}

/** A mensagem de sistema que registra a chamada, com quem liga como autor. */
async function registrarNaConversa(
  channelId: string,
  quemLigou: string,
  participantes: string[],
): Promise<string> {
  const id = generateId();
  const linha = await prisma.$transaction(async (tx) => {
    const criada = await tx.message.create({
      data: {
        id,
        channelId,
        guildId: null,
        authorId: quemLigou,
        /*
          O texto so aparece na 1.x, que nao conhece chamada e mostra a
          mensagem como qualquer outra. A interface nova desenha pelo registro
          da chamada e ignora o texto.
        */
        content: '📞 iniciou uma chamada',
        type: 'CALL',
        call: { participantIds: participantes, endedAt: null },
      },
      include: MESSAGE_INCLUDE,
    });
    await tx.channel.update({ where: { id: channelId }, data: { lastMessageId: id } });
    return criada;
  });
  const mensagem = toMessage(linha as unknown as MessageRow, quemLigou, config.publicBaseUrl);

  const destinatarios = await prisma.channelRecipient.findMany({
    where: { channelId },
    select: { userId: true, closed: true },
  });
  for (const destinatario of destinatarios) {
    // Conversa fechada volta a aparecer: e por ela que se atende.
    if (destinatario.closed) {
      await prisma.channelRecipient.update({
        where: { channelId_userId: { channelId, userId: destinatario.userId } },
        data: { closed: false },
      });
      const canal = await prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: CHANNEL_INCLUDE });
      subscribeUserToChannel(destinatario.userId, channelId);
      emitToUser(destinatario.userId, 'CHANNEL_CREATE', toChannel(canal));
    }
    emitToUser(destinatario.userId, 'MESSAGE_CREATE', mensagem);
  }

  // Como qualquer mensagem de DM, conta para quem nao ligou: a chamada
  // perdida fica no contador da conversa.
  await Promise.all(
    destinatarios
      .filter((d) => d.userId !== quemLigou)
      .map((d) =>
        prisma.readState.upsert({
          where: { userId_channelId: { userId: d.userId, channelId } },
          create: { userId: d.userId, channelId, mentionCount: 1 },
          update: { mentionCount: { increment: 1 } },
        }),
      ),
  );

  return id;
}

async function iniciar(channelId: string, quemLigou: string): Promise<Chamada | null> {
  const canal = await prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } });
  if (canal?.type !== 'DM' && canal?.type !== 'GROUP_DM') return null;

  const [destinatarios, naVoz] = await Promise.all([destinatariosDe(channelId), naVozDe(channelId)]);
  const participantes = [quemLigou, ...naVoz.filter((id) => id !== quemLigou)];

  const bloqueados = new Set<string>();
  for (const id of destinatarios) {
    if (id !== quemLigou && (await bloqueioEntre(quemLigou, id))) bloqueados.add(id);
  }
  const tocar = quemChamar({ destinatarios, naChamada: participantes, quemPede: quemLigou, bloqueados });

  const messageId = await registrarNaConversa(channelId, quemLigou, participantes);
  const chamada: Chamada = {
    channelId,
    messageId,
    iniciadaEm: new Date(),
    tocando: new Map(),
    participantes,
    sozinho: null,
  };
  for (const id of tocar) chamada.tocando.set(id, relogioDoToque(channelId, id));
  chamadas.set(channelId, chamada);

  logger.info({ channelId, quemLigou, tocando: tocar }, 'chamada: iniciada');
  await avisar(chamada, 'CALL_CREATE');
  return chamada;
}

async function entrar(channelId: string, userId: string): Promise<void> {
  let chamada = chamadas.get(channelId);
  if (!chamada) {
    chamada = (await iniciar(channelId, userId)) ?? undefined;
    if (!chamada) return;
  } else {
    if (!chamada.participantes.includes(userId)) chamada.participantes.push(userId);
    const toque = chamada.tocando.get(userId);
    if (toque) {
      // Atendeu: para de tocar em todos os aparelhos dela.
      clearTimeout(toque);
      chamada.tocando.delete(userId);
      await avisar(chamada, 'CALL_UPDATE');
    }
  }
  await reavaliarSolidao(chamada);
}

async function encerrar(chamada: Chamada): Promise<void> {
  chamadas.delete(chamada.channelId);
  for (const relogio of chamada.tocando.values()) clearTimeout(relogio);
  chamada.tocando.clear();
  pararRelogioDaSolidao(chamada);

  const destinatarios = await destinatariosDe(chamada.channelId);
  try {
    const linha = await prisma.message.update({
      where: { id: chamada.messageId },
      data: { call: { participantIds: chamada.participantes, endedAt: new Date().toISOString() } },
      include: MESSAGE_INCLUDE,
    });
    const mensagem = toMessage(linha as unknown as MessageRow, linha.authorId, config.publicBaseUrl);
    for (const userId of destinatarios) emitToUser(userId, 'MESSAGE_UPDATE', mensagem);
  } catch (error) {
    // A mensagem pode ter sido apagada durante a chamada; a chamada acaba igual.
    logger.warn({ error, channelId: chamada.channelId }, 'chamada: nao consegui fechar o registro');
  }
  for (const userId of destinatarios) emitToUser(userId, 'CALL_DELETE', { channelId: chamada.channelId });
  logger.info(
    { channelId: chamada.channelId, participantes: chamada.participantes.length },
    'chamada: encerrada',
  );
}

async function sair(channelId: string): Promise<void> {
  const chamada = chamadas.get(channelId);
  if (!chamada) return;
  if ((await naVozDe(channelId)).length === 0) {
    await encerrar(chamada);
    return;
  }
  await reavaliarSolidao(chamada);
}

// ---------------------------------------------------------------------------
// Ganchos da voz: sem esperar a fila, para nunca travar entrar e sair
// ---------------------------------------------------------------------------

/** Alguem entrou na voz de uma DM ou grupo (quem liga, ou quem atende). */
export function aoEntrarNaChamada(channelId: string, userId: string): void {
  emFilaSemErro(channelId, () => entrar(channelId, userId));
}

/** Alguem saiu da voz de uma DM ou grupo, por conta propria ou tirado. */
export function aoSairDaChamada(channelId: string): void {
  emFilaSemErro(channelId, () => sair(channelId));
}

// ---------------------------------------------------------------------------
// Pedidos das rotas
// ---------------------------------------------------------------------------

async function exigirParticipante(channelId: string, userId: string): Promise<string[]> {
  const destinatarios = await destinatariosDe(channelId);
  if (!destinatarios.includes(userId)) throw forbidden('Voce nao participa desta conversa.');
  return destinatarios;
}

/** Toca de novo para quem ainda nao entrou (ou so para alguns). So quem esta na chamada pede. */
export function tocar(channelId: string, quemPede: string, alvos?: string[]): Promise<void> {
  return emFila(channelId, async () => {
    const destinatarios = await exigirParticipante(channelId, quemPede);
    const chamada = chamadas.get(channelId);
    if (!chamada) throw badRequest('Nao ha chamada nesta conversa.');
    const naVoz = await naVozDe(channelId);
    if (!naVoz.includes(quemPede)) throw forbidden('Entre na chamada para chamar alguem.');

    const bloqueados = new Set<string>();
    for (const id of destinatarios) {
      if (id !== quemPede && (await bloqueioEntre(quemPede, id))) bloqueados.add(id);
    }
    const novos = quemChamar({
      destinatarios: alvos ? destinatarios.filter((id) => alvos.includes(id)) : destinatarios,
      naChamada: naVoz,
      quemPede,
      bloqueados,
    }).filter((id) => !chamada.tocando.has(id));
    if (novos.length === 0) return;

    for (const id of novos) chamada.tocando.set(id, relogioDoToque(channelId, id));
    await avisar(chamada, 'CALL_UPDATE');
  });
}

/**
 * Para de tocar. Sem lista, para quem pediu: e o "recusar", e vale em todos os
 * aparelhos da pessoa. Com lista, cancela o toque de outros — so quem esta na
 * chamada pode.
 */
export function pararDeTocar(channelId: string, quemPede: string, alvos?: string[]): Promise<void> {
  return emFila(channelId, async () => {
    await exigirParticipante(channelId, quemPede);
    const chamada = chamadas.get(channelId);
    if (!chamada) return;
    const quem = alvos ?? [quemPede];
    if (quem.some((id) => id !== quemPede) && !(await naVozDe(channelId)).includes(quemPede)) {
      throw forbidden('Entre na chamada para parar o toque de outra pessoa.');
    }
    let mudou = false;
    for (const id of quem) {
      const relogio = chamada.tocando.get(id);
      if (!relogio) continue;
      clearTimeout(relogio);
      chamada.tocando.delete(id);
      mudou = true;
    }
    if (mudou) await avisar(chamada, 'CALL_UPDATE');
  });
}

/** As chamadas no ar nestas conversas, para o READY. */
export function chamadasEm(channelIds: ReadonlySet<string>): Call[] {
  return [...chamadas.values()].filter((c) => channelIds.has(c.channelId)).map(paraOCliente);
}

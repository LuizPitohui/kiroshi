/**
 * Administracao pela linha de comando.
 *
 * O servidor nao tem painel web de administracao, de proposito: seria mais
 * superficie exposta para dez pessoas que se conhecem. Mas algumas tarefas
 * precisam existir em algum lugar — convidar alguem, ver quem entrou, tirar
 * acesso de quem saiu do grupo. Ficam aqui, alcancaveis so por quem ja tem o
 * servidor na mao.
 *
 * Dentro do container:
 *   docker compose exec api node packages/server/dist/admin.js <comando>
 *
 * Comandos:
 *   convite [servidor] [--usos N] [--dias N]   cria um codigo de convite
 *   contas                                     lista quem tem conta
 *   servidores                                 lista os servidores e donos
 *   convites [servidor]                        lista os convites ativos
 *   revogar <codigo>                           apaga um convite
 */

import { prisma } from './db.js';
import { createInvite } from './services/invites.js';

const [, , comando, ...resto] = process.argv;

/** Le `--chave valor` do resto dos argumentos. */
function opcao(nome: string): string | undefined {
  const i = resto.indexOf(`--${nome}`);
  return i >= 0 ? resto[i + 1] : undefined;
}

/** Os argumentos que nao sao `--chave valor`. */
function posicionais(): string[] {
  const saida: string[] = [];
  for (let i = 0; i < resto.length; i++) {
    const item = resto[i]!;
    if (item.startsWith('--')) {
      i++;
      continue;
    }
    saida.push(item);
  }
  return saida;
}

function quando(data: Date | null): string {
  if (!data) return 'nunca';
  const dias = Math.round((data.getTime() - Date.now()) / 86400000);
  if (dias < 0) return 'expirado';
  if (dias === 0) return 'hoje';
  return `em ${dias} dia${dias === 1 ? '' : 's'}`;
}

/**
 * Encontra o servidor pelo nome, pelo id, ou o unico que existir.
 *
 * Em um servidor pessoal quase sempre ha so um; pedir o id em toda chamada
 * seria burocracia sem ganho.
 */
async function acharServidor(termo?: string) {
  const servidores = await prisma.guild.findMany({
    select: { id: true, name: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (servidores.length === 0) {
    throw new Error('nao existe nenhum servidor ainda.');
  }

  if (!termo) {
    if (servidores.length === 1) return servidores[0]!;
    throw new Error(
      `existem ${servidores.length} servidores; diga qual:\n` +
        servidores.map((g) => `  ${g.name}`).join('\n'),
    );
  }

  const achado =
    servidores.find((g) => g.id === termo) ??
    servidores.find((g) => g.name.toLowerCase() === termo.toLowerCase()) ??
    servidores.find((g) => g.name.toLowerCase().includes(termo.toLowerCase()));

  if (!achado) throw new Error(`nao achei servidor com "${termo}".`);
  return achado;
}

async function main(): Promise<void> {
  switch (comando) {
    // -----------------------------------------------------------------------
    case 'convite': {
      const servidor = await acharServidor(posicionais()[0]);
      const usos = Number(opcao('usos') ?? 1);
      const dias = Number(opcao('dias') ?? 7);

      // O convite sai em nome do dono: o app mostra quem convidou, e um
      // convite sem autor deixaria a tela estranha.
      const invite = await createInvite(servidor.id, servidor.ownerId, {
        maxAgeSecs: dias > 0 ? dias * 86400 : 0,
        maxUses: usos > 0 ? usos : 0,
      });

      const dono = await prisma.user.findUnique({
        where: { id: servidor.ownerId },
        select: { username: true },
      });

      console.log('');
      console.log(`  Servidor : ${servidor.name}`);
      console.log(`  Convidou : ${dono?.username ?? '?'}`);
      console.log(`  Codigo   : ${invite.code}`);
      console.log(`  Vale para: ${usos > 0 ? `${usos} pessoa${usos === 1 ? '' : 's'}` : 'ilimitado'}`);
      console.log(`  Expira   : ${quando(invite.expiresAt ? new Date(invite.expiresAt) : null)}`);
      console.log('');
      console.log('  Quem receber instala o app, clica em "Criar uma" e usa esse codigo.');
      console.log('');
      break;
    }

    // -----------------------------------------------------------------------
    case 'contas': {
      const contas = await prisma.user.findMany({
        select: {
          username: true,
          createdAt: true,
          disabledAt: true,
          totpEnabled: true,
          _count: { select: { memberships: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Excluir a conta pelo app desativa em vez de apagar, para nao furar o
      // historico das conversas. Listar as duas situacoes igual daria a
      // impressao de que ha mais gente com acesso do que realmente ha.
      const ativas = contas.filter((c) => !c.disabledAt);
      const desativadas = contas.filter((c) => c.disabledAt);

      console.log(`\n  ${ativas.length} conta${ativas.length === 1 ? '' : 's'} ativa${ativas.length === 1 ? '' : 's'}\n`);
      for (const c of ativas) {
        const data = c.createdAt.toISOString().slice(0, 10);
        const dois = c.totpEnabled ? '2FA' : '   ';
        console.log(
          `  ${c.username.padEnd(20)} ${dois}  ${String(c._count.memberships).padStart(2)} servidor(es)  desde ${data}`,
        );
      }

      if (desativadas.length > 0) {
        console.log(`\n  ${desativadas.length} desativada(s), sem acesso:\n`);
        for (const c of desativadas) {
          console.log(
            `  ${c.username.padEnd(20)}      desde ${c.disabledAt!.toISOString().slice(0, 10)}`,
          );
        }
        console.log('\n  Continuam no banco para nao furar o historico das conversas.');
        console.log('  Para apagar de vez: admin.js remover <usuario> --confirmar');
      }
      console.log('');
      break;
    }

    // -----------------------------------------------------------------------
    case 'servidores': {
      const servidores = await prisma.guild.findMany({
        select: {
          name: true,
          createdAt: true,
          owner: { select: { username: true } },
          _count: { select: { members: true, channels: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      console.log(`\n  ${servidores.length} servidor(es)\n`);
      for (const g of servidores) {
        console.log(
          `  ${g.name.padEnd(24)} dono ${g.owner.username.padEnd(16)} ` +
            `${g._count.members} membro(s), ${g._count.channels} canal(is)`,
        );
      }
      console.log('');
      break;
    }

    // -----------------------------------------------------------------------
    case 'convites': {
      const servidor = await acharServidor(posicionais()[0]);
      const convites = await prisma.invite.findMany({
        where: { guildId: servidor.id },
        select: {
          code: true,
          uses: true,
          maxUses: true,
          expiresAt: true,
          inviter: { select: { username: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const vivos = convites.filter(
        (i) =>
          (!i.expiresAt || i.expiresAt.getTime() > Date.now()) &&
          (i.maxUses === 0 || i.uses < i.maxUses),
      );

      console.log(`\n  ${servidor.name}: ${vivos.length} convite(s) ativo(s)\n`);
      for (const i of vivos) {
        const usos = i.maxUses > 0 ? `${i.uses}/${i.maxUses}` : `${i.uses}/ilimitado`;
        console.log(
          `  ${i.code}  ${usos.padEnd(14)} expira ${quando(i.expiresAt).padEnd(12)} por ${i.inviter.username}`,
        );
      }
      if (convites.length > vivos.length) {
        console.log(`\n  (${convites.length - vivos.length} ja venceram ou esgotaram)`);
      }
      console.log('');
      break;
    }

    // -----------------------------------------------------------------------
    case 'remover': {
      const alvo = posicionais()[0];
      if (!alvo) throw new Error('diga qual conta remover.');

      const conta = await prisma.user.findFirst({
        where: { username: alvo },
        select: {
          id: true,
          username: true,
          createdAt: true,
          _count: { select: { memberships: true, messages: true } },
        },
      });
      if (!conta) throw new Error(`nao existe conta "${alvo}".`);

      // Apagar uma conta leva junto as mensagens dela, por cascata no banco.
      // Mostrar o tamanho do estrago antes e a diferenca entre uma ferramenta
      // e uma armadilha.
      if (!resto.includes('--confirmar')) {
        console.log('');
        console.log(`  ${conta.username}, criada em ${conta.createdAt.toISOString().slice(0, 10)}`);
        console.log(`  ${conta._count.messages} mensagem(ns) em ${conta._count.memberships} servidor(es)`);
        console.log('');
        console.log(`  Isso apaga a conta e tudo que ela escreveu, sem volta.`);
        console.log(`  Se e mesmo o que voce quer:`);
        console.log(`    admin.js remover ${conta.username} --confirmar`);
        console.log('');
        console.log(`  Para so tirar do servidor sem apagar nada, remova a pessoa pelo app.`);
        console.log('');
        break;
      }

      await prisma.user.delete({ where: { id: conta.id } });
      console.log(`\n  conta ${conta.username} removida.\n`);
      break;
    }

    // -----------------------------------------------------------------------
    case 'revogar': {
      const codigo = posicionais()[0];
      if (!codigo) throw new Error('diga qual codigo revogar.');
      const apagado = await prisma.invite.deleteMany({ where: { code: codigo } });
      console.log(
        apagado.count > 0
          ? `\n  convite ${codigo} revogado.\n`
          : `\n  nao existe convite ${codigo}.\n`,
      );
      break;
    }

    // -----------------------------------------------------------------------
    default:
      console.log(`
  Administracao do Kiroshi

    convite [servidor] [--usos N] [--dias N]   cria um codigo de convite
    contas                                     lista quem tem conta
    servidores                                 lista os servidores e donos
    convites [servidor]                        lista os convites ativos
    revogar <codigo>                           apaga um convite
    remover <usuario>                          apaga uma conta (pede confirmacao)

  Sem [servidor], usa o unico que existir.
  O convite padrao vale para 1 pessoa e 7 dias.
`);
      process.exitCode = comando ? 1 : 0;
  }
}

main()
  .catch((erro: unknown) => {
    console.error(`\n  ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../errors.js';
import { logger } from '../logger.js';

/**
 * Servir o instalador por um endereco fixo.
 *
 * Distribuir o executavel por mensagem nao funciona: sao 82 MB, acima do
 * limite de praticamente todo chat. O resultado era mandar cada pessoa para um
 * servico de transferencia diferente, com link que expira, e ninguem nunca
 * sabendo qual versao tinha em maos.
 *
 * O servidor ja e publico pelo tunel; servir o arquivo dali custa uma rota e
 * resolve de vez. O endereco nao muda entre versoes, entao o mesmo link vale
 * para sempre: basta colocar o arquivo novo na pasta.
 */

/** Onde os instaladores ficam, relativo ao diretorio de trabalho do servidor. */
const PASTA = process.env.KIROSHI_DOWNLOAD_DIR ?? './downloads';

/** So instalador do Windows por enquanto; o projeto ainda nao empacota outros. */
const PADRAO = /^Kiroshi-Setup-(\d+\.\d+\.\d+)\.exe$/;

interface Instalador {
  arquivo: string;
  versao: string;
  caminho: string;
  bytes: number;
}

/** Compara "1.10.0" com "1.9.0" pelo numero, nao pelo texto. */
function maior(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * O instalador mais novo que existir na pasta.
 *
 * Le o diretorio a cada pedido em vez de guardar em memoria: baixar o app e
 * raro, e assim colocar uma versao nova passa a valer na hora, sem reiniciar
 * nada.
 */
async function maisNovo(): Promise<Instalador | null> {
  let nomes: string[];
  try {
    nomes = await readdir(PASTA);
  } catch {
    return null;
  }

  const candidatos: Instalador[] = [];
  for (const arquivo of nomes) {
    const casou = PADRAO.exec(arquivo);
    if (!casou) continue;

    const caminho = path.join(PASTA, arquivo);
    try {
      const info = await stat(caminho);
      if (info.isFile()) {
        candidatos.push({ arquivo, versao: casou[1]!, caminho, bytes: info.size });
      }
    } catch {
      // Sumiu entre listar e medir; ignora.
    }
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => maior(b.versao, a.versao));
  return candidatos[0]!;
}

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  /** Qual versao esta publicada, sem baixar os 82 MB para descobrir. */
  app.get('/baixar/versao', async () => {
    const alvo = await maisNovo();
    if (!alvo) throw notFound('Instalador');
    return {
      versao: alvo.versao,
      arquivo: alvo.arquivo,
      bytes: alvo.bytes,
      megabytes: Math.round((alvo.bytes / 1024 / 1024) * 10) / 10,
    };
  });

  /**
   * O download em si.
   *
   * Fluxo em vez de ler tudo na memoria: 82 MB por pessoa que baixa ao mesmo
   * tempo derrubaria um servidor que tambem esta rodando o resto.
   */
  app.get('/baixar', async (request, reply) => {
    const alvo = await maisNovo();
    if (!alvo) throw notFound('Instalador');

    logger.info({ versao: alvo.versao, ip: request.ip }, 'instalador baixado');

    return (
      reply
        .header('content-type', 'application/vnd.microsoft.portable-executable')
        .header('content-length', alvo.bytes)
        // O nome com versao aparece na pasta de downloads de quem baixa, entao
        // da para saber o que se tem em maos sem abrir nada.
        .header('content-disposition', `attachment; filename="${alvo.arquivo}"`)
        // Sem cache: o endereco e fixo e o conteudo muda a cada versao.
        .header('cache-control', 'no-store')
        .send(createReadStream(alvo.caminho))
    );
  });

  /**
   * Os arquivos que a atualizacao automatica busca, cada um pelo nome.
   *
   * O aplicativo instalado le `latest.yml` para descobrir se ha versao nova, e
   * de la tira o nome do instalador e o hash. O `.blockmap` permite baixar so
   * as partes que mudaram entre duas versoes, em vez dos 82 MB inteiros — e a
   * diferenca entre uma atualizacao que passa despercebida e uma que trava a
   * internet de quem esta em chamada.
   *
   * Isto fica separado da rota sem caminho acima, que sempre entrega a versao
   * mais nova para quem esta instalando pela primeira vez.
   */
  app.get('/baixar/:arquivo', async (request, reply) => {
    const { arquivo } = request.params as { arquivo: string };

    /*
      Lista fechada de nomes, e nao "qualquer coisa que exista na pasta".

      A pasta fica dentro do servidor, e um nome com `..` ou barra sairia dela
      e serviria qualquer arquivo da maquina. Comparar com um padrao exato
      resolve sem depender de normalizar caminho, que e onde esse tipo de falha
      costuma passar.
    */
    const PERMITIDOS = [
      /^latest\.yml$/,
      /^Kiroshi-Setup-\d+\.\d+\.\d+\.exe$/,
      /^Kiroshi-Setup-\d+\.\d+\.\d+\.exe\.blockmap$/,
    ];
    if (!PERMITIDOS.some((padrao) => padrao.test(arquivo))) throw notFound('Arquivo');

    const caminho = path.join(PASTA, arquivo);
    let bytes: number;
    try {
      const info = await stat(caminho);
      if (!info.isFile()) throw notFound('Arquivo');
      bytes = info.size;
    } catch {
      throw notFound('Arquivo');
    }

    const tipo = arquivo.endsWith('.yml')
      ? 'text/yaml; charset=utf-8'
      : arquivo.endsWith('.blockmap')
        ? 'application/octet-stream'
        : 'application/vnd.microsoft.portable-executable';

    return (
      reply
        .header('content-type', tipo)
        .header('content-length', bytes)
        // Sem cache: `latest.yml` muda a cada versao publicada, e um cache
        // intermediario deixaria as pessoas presas na versao anterior.
        .header('cache-control', 'no-store')
        .send(createReadStream(caminho))
    );
  });
}

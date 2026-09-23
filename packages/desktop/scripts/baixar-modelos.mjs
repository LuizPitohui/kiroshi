#!/usr/bin/env node
/**
 * Baixa e VERIFICA os arquivos do DeepFilterNet3 que vao dentro do instalador.
 *
 *   npm run modelos                  baixa o que falta e verifica tudo
 *   npm run modelos -- --verificar   so verifica; falha se faltar algo (CI)
 *   npm run modelos -- --tolerante   como o padrao, mas sem rede nao falha
 *                                    (usado pelo `npm run dev`)
 *
 * Os arquivos ficam em `resources/modelos/` e NAO vao para o git: sao ~10 MB
 * de binario que mudam so quando o pacote muda. O que vai para o git e o
 * `manifesto.json`, que diz de onde cada um vem e qual hash ele tem que ter.
 *
 * TRES VERIFICACOES, e cada uma pega um defeito diferente:
 *
 *   HASH     o arquivo e exatamente o que foi aprovado. Pega download
 *            corrompido, pagina de erro salva como binario, e troca do
 *            arquivo na origem.
 *
 *   WASM     o binario casa com o codigo de cola embutido no pacote. O
 *            wasm-bindgen gera nomes de funcao com hash ("__wbg_..._344f42d3"),
 *            e WASM de outra versao tem outros nomes. O pacote nao reclama
 *            disso: o worklet falha calado e passa a repassar o som cru.
 *            Esta e a unica chance de pegar o problema antes do usuario.
 *
 *   MODELO   o .tar.gz tem as tres redes e a configuracao que a libDF espera.
 *
 * O HASH DO WASM COMECA VAZIO no manifesto. Na primeira execucao ele e
 * calculado, depois de passar na verificacao estrutural, e escrito no
 * manifesto — que entao precisa ir para o git. Dali em diante qualquer
 * diferenca e erro. (O modelo ja vem com hash porque foi baixado e conferido
 * do repositorio do autor quando esta integracao foi escrita.)
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = join(AQUI, '..', 'resources', 'modelos');
const MANIFESTO = join(PASTA, 'manifesto.json');

const argumentos = new Set(process.argv.slice(2));
const SO_VERIFICAR = argumentos.has('--verificar');
const TOLERANTE = argumentos.has('--tolerante');

/** Funcoes que o worklet chama no WASM. Sem elas o modelo nao roda. */
const EXPORTS_OBRIGATORIOS = ['df_create', 'df_process_frame', 'df_set_atten_lim', 'df_get_frame_length'];

/** O que a libDF procura dentro do .tar.gz. */
const ARQUIVOS_DO_MODELO = ['enc.onnx', 'erb_dec.onnx', 'df_dec.onnx', 'config.ini'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ok = (msg) => console.log(`  ok    ${msg}`);
const aviso = (msg) => console.warn(`  AVISO ${msg}`);

class Falha extends Error {}

async function existe(caminho) {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}

/** Onde o pacote esta instalado, e a versao dele. */
async function pacoteInstalado(nome) {
  const require = createRequire(import.meta.url);
  // O `exports` do pacote nao expoe o package.json; parte-se do arquivo
  // principal (dist/index.js) e sobe-se uma pasta.
  const principal = require.resolve(nome);
  const raiz = join(dirname(principal), '..');
  const pkg = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8'));
  return { raiz, versao: pkg.version };
}

/**
 * Os nomes que o codigo de cola do pacote oferece ao WASM.
 *
 * Lidos do proprio pacote instalado, e nao escritos aqui: assim a
 * verificacao acompanha o pacote, e nao uma lista que alguem esquece de
 * atualizar.
 */
async function importsDoPacote(raiz) {
  const codigo = await readFile(join(raiz, 'dist', 'index.esm.js'), 'utf8');
  const nomes = new Set();
  for (const m of codigo.matchAll(/(__wbg_[A-Za-z0-9_]+|__wbindgen_[A-Za-z0-9_]+)\s*:\s*function/g)) {
    nomes.add(m[1]);
  }
  if (nomes.size === 0) {
    throw new Falha('nao achei o codigo de cola no pacote: o formato dele mudou. Ver docs/SUPRESSAO-DE-RUIDO.md.');
  }
  return nomes;
}

async function verificarWasm(bytes, importsOferecidos) {
  let modulo;
  try {
    modulo = await WebAssembly.compile(bytes);
  } catch (erro) {
    throw new Falha(`nao e um WebAssembly valido (${erro.message})`);
  }

  const exportados = new Set(WebAssembly.Module.exports(modulo).map((e) => e.name));
  const faltando = EXPORTS_OBRIGATORIOS.filter((n) => !exportados.has(n));
  if (faltando.length > 0) {
    throw new Falha(`o WASM nao exporta ${faltando.join(', ')}: nao e a libDF`);
  }

  const pedidos = WebAssembly.Module.imports(modulo).filter((i) => i.kind === 'function');
  const semResposta = pedidos.filter((i) => !importsOferecidos.has(i.name)).map((i) => i.name);
  if (semResposta.length > 0) {
    throw new Falha(
      `o WASM e de outra versao do pacote: pede ${semResposta.join(', ')}, que o pacote instalado nao oferece. ` +
        'O modelo falharia calado dentro do worklet.',
    );
  }
}

function nomesNoTar(tar) {
  const nomes = [];
  for (let pos = 0; pos + 512 <= tar.length; ) {
    const cabecalho = tar.subarray(pos, pos + 512);
    if (cabecalho.every((b) => b === 0)) break;
    const nome = cabecalho.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const tamanho = parseInt(cabecalho.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    nomes.push(nome);
    pos += 512 + Math.ceil(tamanho / 512) * 512;
  }
  return nomes;
}

function verificarModelo(bytes) {
  let tar;
  try {
    tar = gunzipSync(bytes);
  } catch {
    throw new Falha('nao e um .tar.gz valido');
  }
  const nomes = nomesNoTar(tar).map((n) => n.split('/').pop());
  const faltando = ARQUIVOS_DO_MODELO.filter((n) => !nomes.includes(n));
  if (faltando.length > 0) {
    throw new Falha(`o arquivo do modelo nao tem ${faltando.join(', ')}`);
  }
}

async function baixar(url) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resposta.ok) throw new Falha(`download falhou: HTTP ${resposta.status} em ${url}`);
  return Buffer.from(await resposta.arrayBuffer());
}

async function main() {
  console.log('Modelos de limpeza de ruido (DeepFilterNet3)');

  const manifesto = JSON.parse(await readFile(MANIFESTO, 'utf8'));
  const pacote = await pacoteInstalado(manifesto.pacote.nome);

  if (pacote.versao !== manifesto.pacote.versao) {
    throw new Falha(
      `${manifesto.pacote.nome} instalado e ${pacote.versao}, mas o manifesto e de ${manifesto.pacote.versao}. ` +
        'O WASM precisa casar com a versao do pacote: siga "Atualizando o DeepFilterNet3" em docs/SUPRESSAO-DE-RUIDO.md.',
    );
  }
  ok(`${manifesto.pacote.nome}@${pacote.versao}`);

  const importsOferecidos = await importsDoPacote(pacote.raiz);
  let manifestoMudou = false;

  for (const arquivo of manifesto.arquivos) {
    const destino = join(PASTA, arquivo.caminho);
    let bytes;

    if (await existe(destino)) {
      bytes = await readFile(destino);
    } else if (SO_VERIFICAR) {
      throw new Falha(`${arquivo.caminho} nao existe. Rode "npm run modelos".`);
    } else {
      console.log(`  ...   baixando ${arquivo.caminho}`);
      bytes = await baixar(arquivo.origem);
    }

    // Estrutura primeiro: um hash so diz que o arquivo e o mesmo de antes,
    // nao que ele serve.
    if (arquivo.tipo === 'wasm') await verificarWasm(bytes, importsOferecidos);
    if (arquivo.tipo === 'modelo') verificarModelo(bytes);

    const hash = sha256(bytes);
    if (arquivo.sha256 === null) {
      arquivo.sha256 = hash;
      manifestoMudou = true;
      aviso(`${arquivo.caminho}: primeiro download, hash registrado (${hash.slice(0, 16)}...). Faca commit do manifesto.json.`);
    } else if (arquivo.sha256 !== hash) {
      throw new Falha(
        `${arquivo.caminho}: hash diferente do aprovado.\n        esperado ${arquivo.sha256}\n        obtido   ${hash}`,
      );
    }

    if (!(await existe(destino))) {
      await mkdir(dirname(destino), { recursive: true });
      // Escreve ao lado e renomeia: um download interrompido nunca deixa um
      // arquivo pela metade com o nome certo.
      await writeFile(`${destino}.parcial`, bytes);
      await rename(`${destino}.parcial`, destino);
    }
    ok(`${arquivo.caminho} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  if (manifestoMudou) {
    await writeFile(MANIFESTO, `${JSON.stringify(manifesto, null, 2)}\n`);
  }
  console.log('Pronto.');
}

main().catch((erro) => {
  const mensagem = erro instanceof Falha ? erro.message : (erro?.stack ?? String(erro));
  if (TOLERANTE) {
    aviso(`${mensagem}\n        Seguindo sem o DeepFilterNet3: o app vai usar o GTCRN.`);
    process.exit(0);
  }
  console.error(`\n  ERRO  ${mensagem}\n`);
  process.exit(1);
});

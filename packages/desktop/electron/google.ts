import { createServer, type Server } from 'node:http';
import { shell } from 'electron';

/**
 * O lado do aplicativo na conversa com o Google.
 *
 * O Google nao autentica dentro de webview embutida — devolve
 * `disallowed_useragent` e acabou. Entao a tela de consentimento abre no
 * navegador do sistema, e o aplicativo precisa de um jeito de receber a
 * resposta de volta.
 *
 * Esse jeito e um servidor HTTP minusculo em 127.0.0.1, numa porta sorteada,
 * que vive o tempo de um login. O servidor do Kiroshi termina a conversa com o
 * Google e manda o navegador para ca com um bilhete de uso unico.
 *
 * Por que loopback e nao um protocolo `kiroshi://`: registrar protocolo mexe
 * no registro do Windows, quebra quando ha duas instalacoes, e falha calado
 * quando o registro nao pegou. Uma porta local ou abre, ou nao abre.
 */

/** Cinco minutos: o tempo de escolher uma conta, digitar senha e passar o 2FA
 *  do proprio Google. Depois disso o `state` do servidor ja expirou tambem. */
const PRAZO_MS = 5 * 60 * 1000;

interface EsperaEmAndamento {
  servidor: Server;
  porta: number;
  resolver: (entrega: string) => void;
  rejeitar: (erro: Error) => void;
  relogio: NodeJS.Timeout;
}

let espera: EsperaEmAndamento | null = null;

/** A pagina que a pessoa ve no navegador quando volta. */
function pagina(titulo: string, recado: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0f14; color: #e6edf3;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { text-align: center; padding: 32px; max-width: 30rem; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0; color: #8b98a5; }
</style>
</head>
<body><main><h1>${titulo}</h1><p>${recado}</p></main></body>
</html>`;
}

function encerrar(): void {
  if (!espera) return;
  clearTimeout(espera.relogio);
  espera.servidor.close();
  espera = null;
}

/**
 * Levanta o ouvinte e devolve o endereco que o servidor deve chamar de volta.
 *
 * Fica separado de `abrirEEsperar` porque o endereco precisa existir ANTES de
 * pedir a URL de consentimento ao servidor — e o servidor assina esse endereco
 * dentro do `state`, entao ele nao pode mudar no meio do caminho.
 */
export async function prepararRetorno(): Promise<string> {
  // Um login de cada vez: comecar outro cancela o anterior, que ja esta orfao.
  cancelarEspera();

  return new Promise((resolve, reject) => {
    const servidor = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const entrega = url.searchParams.get('entrega');

      if (!entrega) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pagina('Algo saiu do lugar', 'Volte ao Kiroshi e tente de novo.'));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pagina('Pronto', 'Pode fechar esta aba e voltar ao Kiroshi.'));

      const atual = espera;
      if (atual) {
        // Resolve ANTES de encerrar: `encerrar` limpa a referencia.
        const resolver = atual.resolver;
        encerrar();
        resolver(entrega);
      }
    });

    servidor.on('error', (erro) => {
      espera = null;
      reject(erro);
    });

    /*
      Porta 0 = o sistema escolhe uma livre. E 127.0.0.1 explicito, nunca
      0.0.0.0: este servidor nao tem nada que atender a rede.
    */
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      if (!endereco || typeof endereco === 'string') {
        servidor.close();
        reject(new Error('nao consegui abrir uma porta local'));
        return;
      }

      espera = {
        servidor,
        porta: endereco.port,
        resolver: () => undefined,
        rejeitar: () => undefined,
        relogio: setTimeout(() => undefined, 0),
      };
      clearTimeout(espera.relogio);

      resolve(`http://127.0.0.1:${endereco.port}/pronto`);
    });
  });
}

/**
 * Abre a tela do Google no navegador do sistema e espera a volta.
 *
 * Resolve com o bilhete; rejeita se o prazo estourar ou se a espera for
 * cancelada. Nao interpreta o bilhete: quem sabe o que ele significa e o
 * servidor, e o aplicativo troca por HTTPS logo em seguida.
 */
export async function abrirEEsperar(url: string): Promise<string> {
  const atual = espera;
  if (!atual) throw new Error('chame prepararRetorno antes');

  const promessa = new Promise<string>((resolve, reject) => {
    atual.resolver = resolve;
    atual.rejeitar = reject;
    atual.relogio = setTimeout(() => {
      encerrar();
      reject(new Error('tempo esgotado'));
    }, PRAZO_MS);
  });

  await shell.openExternal(url);
  return promessa;
}

/** Desiste do login em andamento e fecha a porta. */
export function cancelarEspera(): void {
  const atual = espera;
  if (!atual) return;
  const rejeitar = atual.rejeitar;
  encerrar();
  rejeitar(new Error('cancelado'));
}

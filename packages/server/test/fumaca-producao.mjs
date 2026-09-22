/**
 * Teste de fumaca contra producao, com contas descartaveis.
 *
 * Exercita o caminho real que os usuarios vao percorrer: cadastro, servidor,
 * convite, mensagem em tempo real entre duas pessoas, e token de voz. No fim
 * apaga o que criou, para nao sujar o servidor de verdade.
 *
 * Com o cadastro fechado (que e o normal em producao), precisa de um codigo de
 * convite descartavel. Gere um com usos suficientes e revogue depois:
 *
 *   ssh arasaka
 *   cd ~/kiroshi/deploy
 *   docker compose exec -T api node packages/server/dist/admin.js convite --usos 2 --dias 1
 *
 *   node packages/server/test/fumaca-producao.mjs [https://servidor] [convite]
 */

import WebSocket from 'ws';

const BASE = (process.argv[2] ?? 'https://order.arasaka.fun').replace(/\/+$/, '');
const CONVITE = process.argv[3] ?? null;
const SUFIXO = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
const criados = [];

function check(nome, ok, detalhe = '') {
  if (ok) {
    console.log(`  OK   ${nome}`);
    passed++;
  } else {
    console.log(`  FALHA ${nome} ${detalhe}`);
    failed++;
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { raw: texto.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

function conectar(token, rotulo) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/gateway`);
    const aguardando = new Map();
    let ready = null;

    const prazo = setTimeout(() => reject(new Error(`${rotulo}: sem READY em 30s`)), 30000);

    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.op === 10) {
        socket.send(
          JSON.stringify({
            op: 2,
            d: { token, properties: { os: 'test', client: 'fumaca', version: '1' } },
          }),
        );
        return;
      }

      if (msg.op !== 0) return;

      if (msg.t === 'READY') {
        ready = msg.d;
        clearTimeout(prazo);
        resolve({
          socket,
          get ready() {
            return ready;
          },
          esperar(evento, ms = 20000) {
            return new Promise((res, rej) => {
              const t = setTimeout(() => rej(new Error(`timeout em ${evento}`)), ms);
              aguardando.set(evento, (d) => {
                clearTimeout(t);
                res(d);
              });
            });
          },
          fechar: () => socket.close(),
        });
      }

      const espera = aguardando.get(msg.t);
      if (espera) {
        aguardando.delete(msg.t);
        espera(msg.d);
      }
    });

    socket.on('error', (e) => {
      clearTimeout(prazo);
      reject(e);
    });
  });
}

console.log(`\nServidor: ${BASE}`);
console.log(`Contas de teste terminam em "${SUFIXO}" e sao apagadas no fim.\n`);

// ---------------------------------------------------------------------------
console.log('--- CADASTRO ---');

const SENHA = 'teste-de-fumaca-2026';

// Qual servidor este convite abre. Precisa ser agora: depois dos dois cadastros
// os usos acabam, o convite passa a ser invalido e a consulta nao responderia
// mais — e ai nao teria como sair dele na limpeza.
let anfitriaoId = null;
if (CONVITE) {
  const previa = await api('GET', `/invites/${CONVITE}`);
  anfitriaoId = previa.body?.guild?.id ?? null;
  check('o convite aponta para um servidor', Boolean(anfitriaoId), previa.body?.guild?.name ?? '');
}

const contaA = await api('POST', '/auth/register', {
  body: { email: `fumaca.a.${SUFIXO}@teste.local`, username: `fumaca_a_${SUFIXO}`, password: SENHA, inviteCode: CONVITE },
});
check('cria a primeira conta', contaA.status === 201, JSON.stringify(contaA.body).slice(0, 200));

const contaB = await api('POST', '/auth/register', {
  body: { email: `fumaca.b.${SUFIXO}@teste.local`, username: `fumaca_b_${SUFIXO}`, password: SENHA, inviteCode: CONVITE },
});
check('cria a segunda conta', contaB.status === 201);

if (contaA.status !== 201 || contaB.status !== 201) {
  console.log('\nsem contas nao da para seguir.\n');
  process.exit(1);
}

criados.push(contaA.body.user.id, contaB.body.user.id);
const tokenA = contaA.body.accessToken;
const tokenB = contaB.body.accessToken;

check('senha nao volta na resposta', !JSON.stringify(contaA.body).includes(SENHA));

// ---------------------------------------------------------------------------
console.log('\n--- GATEWAY PELO TUNEL ---');

const alice = await conectar(tokenA, 'alice');
const bob = await conectar(tokenB, 'bob');

check('duas sessoes simultaneas', Boolean(alice.ready && bob.ready));
check('READY identifica cada uma', alice.ready.user.id !== bob.ready.user.id);

// ---------------------------------------------------------------------------
console.log('\n--- SERVIDOR E CONVITE ---');

const servidor = await api('POST', '/guilds', {
  token: tokenA,
  body: { name: `Teste ${SUFIXO}`, withDefaultChannels: true },
});
check('cria servidor', servidor.status === 201, JSON.stringify(servidor.body).slice(0, 150));

const guildId = servidor.body.id;
criados.push(`guild:${guildId}`);

const canalTexto = servidor.body.channels.find((c) => c.type === 'GUILD_TEXT');
const canalVoz = servidor.body.channels.find((c) => c.type === 'GUILD_VOICE');
check('tem canal de texto e de voz', Boolean(canalTexto && canalVoz));

const convite = await api('POST', `/guilds/${guildId}/invites`, {
  token: tokenA,
  body: { maxAgeSecs: 3600, maxUses: 5 },
});
check('gera convite', convite.status === 201 && typeof convite.body?.code === 'string');

const bobEntra = bob.esperar('GUILD_CREATE');
const aceite = await api('POST', `/invites/${convite.body.code}`, { token: tokenB });
check('segunda conta entra pelo convite', aceite.status === 200 && aceite.body?.joined === true);
await bobEntra.catch(() => undefined);

// ---------------------------------------------------------------------------
console.log('\n--- TEMPO REAL ---');

const bobRecebe = bob.esperar('MESSAGE_CREATE');
const inicio = Date.now();

const enviada = await api('POST', `/channels/${canalTexto.id}/messages`, {
  token: tokenA,
  body: { content: `teste de producao <@${bob.ready.user.id}>`, nonce: `n-${SUFIXO}` },
});
check('envia mensagem', enviada.status === 201, JSON.stringify(enviada.body).slice(0, 150));

const recebida = await bobRecebe.catch(() => null);
const atraso = Date.now() - inicio;

check('a outra pessoa recebe pelo gateway', recebida?.id === enviada.body?.id);
check('entrega em menos de 3s', atraso < 3000, `${atraso}ms`);
check('mencao foi registrada', enviada.body?.mentionedUserIds?.includes(bob.ready.user.id));
console.log(`       ida e volta: ${atraso}ms`);

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
console.log('\n--- ANEXOS ---');

/*
  Envia uma imagem de verdade, nao so um arquivo qualquer.

  Este teste existe por um bug que ficou em producao sem ninguem ver: a coluna
  que guarda a miniatura embutida aceitava 64 caracteres, e a menor miniatura
  possivel ocupa 95. Arquivo comum passava — imagem, nunca. Como nenhum teste
  mandava imagem, o caminho quebrado era exatamente o mais usado.

  O PNG abaixo e um arquivo de verdade, gerado uma vez e embutido aqui. A
  primeira versao deste teste usava bytes montados na mao, com cabecalho valido
  e dados de pixel ruins: a biblioteca desta maquina aceitava, a do servidor
  recusava com "libspng read error", e o teste acusava um defeito no servidor
  que nao existia. Imagem de teste precisa ser imagem de verdade.
*/
const PNG_MINIMO = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAB' +
    'lklEQVR42hXRURVEIQhFUSMYgQhGMAIRiGCEE8EIRiACEYhABCLMG7/ZrMt1jMEcyGAN9kAHNjgD' +
    'BnfwBj6IQQ5q0IMxJnMikzXZE53Y5EyY3Mmb+CQmOalJzw8IUxBhCVtQwYQjIFzhCS6EkEIJLR9Y' +
    'zIUs1mIvdGGLs2BxF2/hi1jkoha9PrCZG9mszd7oxjZnw+Zu3sY3sclNbXp/QJmKKEvZiiqmHAXl' +
    'Kk9xJZRUSmn9gDENMZaxDTXMOAbGNZ7hRhhplNH2gcM8yGEd9kEPdjgHDvfwDn6IQx7q0OcD/wK/' +
    'Sr4jv9hfkG/1N/x/Fx44BCQU9Pc94zIvclmXfdGLXc79j9/Lu/glLnmpS98PPOZDHuuxH/qwx3n/' +
    '5ffxHv6IRz7q0e8DznTEWc521DHn+D/KdZ7jTjjplNP+gWAGEqxgBxpYcOIf/AYv8CCCDCro+EAy' +
    'E0lWshNNLDn5P/MmL/Ekkkwq6fxAMQspVrELLaw49S/lFq/wIoosquj6QDMbaVazG22sOf2v8Dav' +
    '8SaabKrp5geIAnAQC3NfwAAAAABJRU5ErkJggg==',
  'base64',
);

async function enviarArquivo(token, nome, tipo, dados) {
  const form = new FormData();
  form.append('file', new Blob([dados], { type: tipo }), nome);
  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { raw: texto.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const imagem = await enviarArquivo(tokenA, 'teste.png', 'image/png', PNG_MINIMO);
check(
  'envia uma imagem',
  imagem.status === 201,
  imagem.status === 201 ? '' : `status ${imagem.status}: ${JSON.stringify(imagem.body).slice(0, 180)}`,
);
check(
  'a miniatura embutida volta inteira',
  typeof imagem.body?.placeholder === 'string' && imagem.body.placeholder.startsWith('data:image/'),
  imagem.body?.placeholder ? `${imagem.body.placeholder.length} caracteres` : 'sem miniatura',
);
check(
  'a imagem tem largura e altura',
  Number(imagem.body?.width) > 0 && Number(imagem.body?.height) > 0,
  `${imagem.body?.width}x${imagem.body?.height}`,
);

const texto = await enviarArquivo(tokenA, 'notas.txt', 'text/plain', Buffer.from('ola'));
check('envia um arquivo comum', texto.status === 201, `status ${texto.status}`);

// Um tipo absurdamente longo no cabecalho nao pode derrubar o envio com erro
// de banco; deve ser cortado ou recusado, nunca estourar.
const tipoLongo = await enviarArquivo(
  tokenA,
  'estranho.bin',
  'application/' + 'x'.repeat(400),
  Buffer.from('dados'),
);
check(
  'tipo de conteudo enorme nao quebra o envio',
  tipoLongo.status === 201 || tipoLongo.status === 400,
  `status ${tipoLongo.status}`,
);

if (imagem.status === 201) {
  const comAnexo = await api('POST', `/channels/${canalTexto.id}/messages`, {
    token: tokenA,
    body: { content: 'com anexo', attachmentIds: [imagem.body.id] },
  });
  check('manda mensagem com a imagem junto', comAnexo.status === 201, `status ${comAnexo.status}`);
}
console.log('\n--- VOZ ---');

const bobVoz = bob.esperar('VOICE_STATE_UPDATE');
const voz = await api('POST', '/voice/join', { token: tokenA, body: { channelId: canalVoz.id } });

check('emite token de voz', voz.status === 200, JSON.stringify(voz.body).slice(0, 150));
check('SFU e o endereco publico', voz.body?.url?.startsWith('wss://'), voz.body?.url);
check('sala derivada do canal', voz.body?.roomName === `channel_${canalVoz.id}`);

if (voz.status === 200) {
  const payload = JSON.parse(
    Buffer.from(voz.body.token.split('.')[1], 'base64url').toString(),
  );
  check('pode publicar microfone', payload.video?.canPublishSources?.includes('microphone'));
  check('pode compartilhar tela', payload.video?.canPublishSources?.includes('screen_share'));
  check(
    'token vale algumas horas',
    payload.exp - Math.floor(Date.now() / 1000) > 3600,
    `${Math.round((payload.exp - Date.now() / 1000) / 3600)}h`,
  );
}

await api('POST', '/voice/leave', { token: tokenA });
await bobVoz.catch(() => undefined);

// ---------------------------------------------------------------------------
console.log('\n--- LIMPEZA ---');

alice.fechar();
bob.fechar();

const apagouServidor = await api('DELETE', `/guilds/${guildId}`, { token: tokenA });
check('apaga o servidor de teste', apagouServidor.status === 200, `status ${apagouServidor.status}`);

// As contas entraram no servidor de verdade porque o convite usado no cadastro
// aponta para la. Sem sair, cada rodada deixa duas pessoas a mais na lista de
// membros — desativadas, mas visiveis para quem usa o app todo dia.
if (anfitriaoId) {
  const saiuA = await api('POST', `/guilds/${anfitriaoId}/leave`, { token: tokenA });
  const saiuB = await api('POST', `/guilds/${anfitriaoId}/leave`, { token: tokenB });
  check(
    'sai do servidor que hospedou o teste',
    saiuA.status === 200 && saiuB.status === 200,
    `${saiuA.status}/${saiuB.status}`,
  );
}

const apagouA = await api('DELETE', '/users/@me', { token: tokenA });
const apagouB = await api('DELETE', '/users/@me', { token: tokenB });
check('desativa as contas de teste', apagouA.status === 200 && apagouB.status === 200);

console.log(`\n=========================================`);
console.log(`  ${passed} passaram, ${failed} falharam`);
console.log(`=========================================\n`);

process.exit(failed > 0 ? 1 : 0);

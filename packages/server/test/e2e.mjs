/**
 * Teste ponta a ponta contra o servidor rodando.
 * Exercita: login -> gateway -> READY -> mensagem -> evento em tempo real.
 */
import WebSocket from 'ws';

const API = 'http://127.0.0.1:4000';
const GW = 'ws://127.0.0.1:4000/gateway';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  OK   ${name}`);
    passed++;
  } else {
    console.log(`  FALHA ${name} ${detail}`);
    failed++;
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

function connectGateway(token, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GW);
    const events = [];
    let ready = null;
    let sessionId = null;
    const waiters = new Map();

    const timeout = setTimeout(() => reject(new Error(`${label}: timeout no READY`)), 15000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.op === 10) {
        ws.send(JSON.stringify({
          op: 2,
          d: { token, properties: { os: 'test', client: 'e2e', version: '1' } },
        }));
        return;
      }

      if (msg.op === 0) {
        events.push(msg);
        if (msg.t === 'READY') {
          ready = msg.d;
          sessionId = msg.d.sessionId;
          clearTimeout(timeout);
          resolve({
            ws,
            get ready() { return ready; },
            get sessionId() { return sessionId; },
            events,
            waitFor(eventName, ms = 8000) {
              const existing = events.find((e) => e.t === eventName && !waiters.has(e));
              if (existing) return Promise.resolve(existing.d);
              return new Promise((res, rej) => {
                const t = setTimeout(() => rej(new Error(`timeout esperando ${eventName}`)), ms);
                waiters.set(eventName, (d) => { clearTimeout(t); res(d); });
              });
            },
            close: () => ws.close(),
          });
        }
        const waiter = waiters.get(msg.t);
        if (waiter) { waiters.delete(msg.t); waiter(msg.d); }
      }
    });

    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

/**
 * Espera um evento que chegue DEPOIS da chamada e case com o filtro.
 *
 * O `waitFor` acima devolve o primeiro evento daquele tipo ja recebido, mesmo
 * antigo. Para conferir privacidade isso nao serve: o que importa e o que
 * chega depois de uma acao especifica. Chame ANTES da acao.
 */
function esperarNovo(conexao, nome, filtro = () => true, ms = 8000) {
  const inicio = conexao.events.length;
  return new Promise((resolve, reject) => {
    const limite = Date.now() + ms;
    const olhar = () => {
      const achado = conexao.events.slice(inicio).find((e) => e.t === nome && filtro(e.d));
      if (achado) return resolve(achado.d);
      if (Date.now() > limite) return reject(new Error(`timeout esperando ${nome}`));
      setTimeout(olhar, 50);
    };
    olhar();
  });
}

/** Verdadeiro se nenhum evento daquele tipo, casando com o filtro, chegar a tempo. */
async function naoChega(conexao, nome, filtro = () => true, ms = 2000) {
  try {
    await esperarNovo(conexao, nome, filtro, ms);
    return false;
  } catch {
    return true;
  }
}

/** O codigo com que o socket fecha, ou null se nao fechar a tempo. */
function codigoDeFechamento(ws, ms = 5000) {
  return new Promise((resolve) => {
    const prazo = setTimeout(() => resolve(null), ms);
    ws.once('close', (codigo) => {
      clearTimeout(prazo);
      resolve(codigo);
    });
  });
}

/**
 * Tenta um IDENTIFY e diz como terminou: 'READY', o codigo de fechamento, ou
 * 'timeout'. Para conferir que um token e recusado pelo gateway.
 */
function resultadoDoIdentify(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GW);
    const prazo = setTimeout(() => {
      ws.close();
      resolve('timeout');
    }, 10000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 10) {
        ws.send(JSON.stringify({ op: 2, d: { token, properties: { os: 'test', client: 'e2e', version: '1' } } }));
      }
      if (msg.op === 0 && msg.t === 'READY') {
        clearTimeout(prazo);
        ws.close();
        resolve('READY');
      }
    });
    ws.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve(codigo);
    });
    ws.on('error', () => undefined);
  });
}

async function main() {
  console.log('\n--- AUTENTICACAO ---');

  const badLogin = await api('POST', '/api/v1/auth/login', {
    body: { login: 'pitohui', password: 'senha-errada' },
  });
  check('senha errada e rejeitada', badLogin.status === 401, `status ${badLogin.status}`);

  const login = await api('POST', '/api/v1/auth/login', {
    body: { login: 'pitohui', password: 'ordem123456' },
  });
  check('login com senha correta', login.status === 200, JSON.stringify(login.body).slice(0, 200));
  const token = login.body?.accessToken;
  check('recebeu accessToken', typeof token === 'string' && token.length > 20);
  check('recebeu refreshToken', typeof login.body?.refreshToken === 'string');
  check('nao vazou passwordHash', !JSON.stringify(login.body).includes('passwordHash'));

  const login2 = await api('POST', '/api/v1/auth/login', {
    body: { login: 'kaya', password: 'ordem123456' },
  });
  const token2 = login2.body?.accessToken;
  check('segundo usuario logou', login2.status === 200);

  const noAuth = await api('GET', '/api/v1/users/@me');
  check('rota protegida exige token', noAuth.status === 401);

  const me = await api('GET', '/api/v1/users/@me', { token });
  check('users/@me responde', me.status === 200 && me.body?.username === 'pitohui');

  console.log('\n--- GATEWAY ---');

  const alice = await connectGateway(token, 'alice');
  check('READY recebido', Boolean(alice.ready));
  check('READY traz o usuario', alice.ready?.user?.username === 'pitohui');
  check('READY traz servidores', Array.isArray(alice.ready?.guilds) && alice.ready.guilds.length >= 1);

  const guild = alice.ready.guilds.find((g) => g.name === 'Arasaka');
  check('achou o servidor Arasaka', Boolean(guild));
  check('servidor tem canais', guild.channels.length >= 6, `${guild?.channels?.length}`);
  check('servidor tem cargos', guild.roles.length >= 3);
  check('servidor tem membros', guild.members.length === 5);
  check('permissoes sao string (BigInt serializado)', typeof guild.roles[0].permissions === 'string');

  const textChannel = guild.channels.find((c) => c.type === 'GUILD_TEXT' && c.name === 'geral');
  const voiceChannel = guild.channels.find((c) => c.type === 'GUILD_VOICE');
  check('achou canal de texto', Boolean(textChannel));
  check('achou canal de voz', Boolean(voiceChannel));

  const bob = await connectGateway(token2, 'bob');
  check('segunda sessao conectou', Boolean(bob.ready));

  console.log('\n--- MENSAGENS EM TEMPO REAL ---');

  const bobWaits = bob.waitFor('MESSAGE_CREATE');
  const sent = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token,
    body: { content: 'ola do teste e2e <@' + bob.ready.user.id + '>', nonce: 'nonce-123' },
  });
  check('mensagem criada', sent.status === 201, JSON.stringify(sent.body).slice(0, 200));
  check('eco do nonce', sent.body?.nonce === 'nonce-123');
  check('mencao detectada', sent.body?.mentionedUserIds?.includes(bob.ready.user.id));

  const received = await bobWaits;
  check('outro usuario recebeu em tempo real', received?.id === sent.body?.id);
  check('evento nao vaza nonce alheio', received?.nonce === null);

  console.log('\n--- HISTORICO E EDICAO ---');

  const history = await api('GET', `/api/v1/channels/${textChannel.id}/messages?limit=50`, { token });
  check('historico carrega', history.status === 200 && Array.isArray(history.body));
  check('historico em ordem crescente', history.body.length >= 6);
  const ids = history.body.map((m) => BigInt(m.id));
  check('ids ordenados', ids.every((id, i) => i === 0 || id > ids[i - 1]));

  const edited = await api('PATCH', `/api/v1/channels/${textChannel.id}/messages/${sent.body.id}`, {
    token, body: { content: 'texto editado' },
  });
  check('edicao funciona', edited.status === 200 && edited.body?.content === 'texto editado');
  check('marca editedAt', Boolean(edited.body?.editedAt));

  const foreignEdit = await api('PATCH', `/api/v1/channels/${textChannel.id}/messages/${sent.body.id}`, {
    token: token2, body: { content: 'invadido' },
  });
  check('nao edita mensagem alheia', foreignEdit.status === 403, `status ${foreignEdit.status}`);

  console.log('\n--- REACOES ---');

  const react = await api('PUT', `/api/v1/channels/${textChannel.id}/messages/${sent.body.id}/reactions`, {
    token: token2, body: { emoji: '🎉' },
  });
  check('reacao adicionada', react.status === 200, JSON.stringify(react.body).slice(0, 150));

  const withReaction = await api('GET', `/api/v1/channels/${textChannel.id}/messages?limit=5`, { token });
  const target = withReaction.body.find((m) => m.id === sent.body.id);
  check('reacao aparece na mensagem', target?.reactions?.[0]?.count === 1);

  console.log('\n--- PERMISSOES ---');

  const kickAttempt = await api('DELETE', `/api/v1/guilds/${guild.id}/members/${alice.ready.user.id}`, {
    token: token2,
  });
  check('membro comum nao expulsa o dono', kickAttempt.status === 403, `status ${kickAttempt.status}`);

  const roleAttempt = await api('POST', `/api/v1/guilds/${guild.id}/roles`, {
    token: token2, body: { name: 'hack', permissions: '16' },
  });
  check('membro sem MANAGE_ROLES nao cria cargo', roleAttempt.status === 403, `status ${roleAttempt.status}`);

  console.log('\n--- CANAIS E SERVIDORES ---');

  const newGuild = await api('POST', '/api/v1/guilds', {
    token, body: { name: 'Servidor Teste', withDefaultChannels: true },
  });
  check('cria servidor', newGuild.status === 201, JSON.stringify(newGuild.body).slice(0, 150));
  check('servidor novo tem canais padrao', newGuild.body?.channels?.length === 4);
  check('dono ja e membro', newGuild.body?.members?.length === 1);

  const newChannel = await api('POST', `/api/v1/guilds/${guild.id}/channels`, {
    token, body: { name: 'novo-canal', type: 'GUILD_TEXT' },
  });
  check('cria canal', newChannel.status === 201, JSON.stringify(newChannel.body).slice(0, 150));

  console.log('\n--- CONVITES ---');

  const invite = await api('POST', `/api/v1/guilds/${newGuild.body.id}/invites`, {
    token, body: { maxAgeSecs: 3600, maxUses: 5 },
  });
  check('cria convite', invite.status === 201 && typeof invite.body?.code === 'string');

  const preview = await api('GET', `/api/v1/invites/${invite.body.code}`);
  check('preview do convite sem login', preview.status === 200 && preview.body?.guild?.name === 'Servidor Teste');

  const accept = await api('POST', `/api/v1/invites/${invite.body.code}`, { token: token2 });
  check('aceita convite', accept.status === 200 && accept.body?.joined === true, JSON.stringify(accept.body).slice(0, 150));

  console.log('\n--- CARGOS, ACESSO E CONVITES (fatia 6) ---');
  {
    const g = newGuild.body.id;
    const kayaId = bob.ready.user.id;
    const cargosDe = async () => (await api('GET', `/api/v1/guilds/${g}`, { token })).body?.roles ?? [];
    const MANAGE_ROLES = String(1n << 2n);
    const BAN = 1n << 6n;
    const KICK = 1n << 5n;

    const mod = await api('POST', `/api/v1/guilds/${g}/roles`, {
      token, body: { name: 'Moderador', permissions: MANAGE_ROLES },
    });
    check('cargo novo nasce logo acima do everyone', mod.status === 201 && mod.body?.position === 1, JSON.stringify(mod.body));

    const deu = esperarNovo(bob, 'GUILD_MEMBER_UPDATE', (d) => d?.guildId === g && d?.roleIds?.includes(mod.body.id));
    const dar = await api('PUT', `/api/v1/guilds/${g}/members/${kayaId}/roles/${mod.body.id}`, { token });
    check('da um cargo so, sem mandar a lista inteira', dar.status === 200 && dar.body?.roleIds?.includes(mod.body.id), JSON.stringify(dar.body).slice(0, 150));
    check('quem recebeu o cargo fica sabendo na hora', Boolean(await deu.catch(() => null)));

    // O defeito que prendia todo mundo: so o dono conseguia criar cargo.
    const ajudante = await api('POST', `/api/v1/guilds/${g}/roles`, { token: token2, body: { name: 'Ajudante' } });
    check('moderador (nao dono) cria cargo', ajudante.status === 201, `status ${ajudante.status} ${JSON.stringify(ajudante.body).slice(0, 120)}`);
    const depois = await cargosDe();
    const pos = (id) => depois.find((r) => r.id === id)?.position;
    check('o cargo novo entra embaixo e os outros sobem', pos(ajudante.body?.id) === 1 && pos(mod.body.id) === 2, JSON.stringify(depois.map((r) => [r.name, r.position])));

    const subir = await api('PATCH', `/api/v1/guilds/${g}/roles`, {
      token: token2, body: { positions: [{ id: ajudante.body.id, position: 5 }] },
    });
    check('moderador nao sobe cargo acima do proprio', subir.status === 403, `status ${subir.status}`);
    const everyone = await api('PATCH', `/api/v1/guilds/${g}/roles`, {
      token, body: { positions: [{ id: g, position: 3 }] },
    });
    check('o everyone nao sai do lugar nem pelo dono', everyone.status === 400, `status ${everyone.status}`);

    // Editar: so os bits que mudam precisam caber no que o autor tem.
    const cofre = await api('POST', `/api/v1/guilds/${g}/roles`, { token, body: { name: 'Cofre', permissions: String(BAN) } });
    const cor = await api('PATCH', `/api/v1/guilds/${g}/roles/${cofre.body?.id}`, { token: token2, body: { color: '#dc2626' } });
    check('moderador muda a cor de cargo com permissao que ele nao tem', cor.status === 200, `status ${cor.status} ${JSON.stringify(cor.body).slice(0, 120)}`);
    const mais = await api('PATCH', `/api/v1/guilds/${g}/roles/${cofre.body?.id}`, {
      token: token2, body: { permissions: String(BAN | KICK) },
    });
    check('mas nao concede permissao que nao tem', mais.status === 403, `status ${mais.status}`);

    // Canal privado que o cargo abre: dar e tirar o cargo avisa na hora.
    const secreto = await api('POST', `/api/v1/guilds/${g}/channels`, { token, body: { name: 'secreto', type: 'GUILD_TEXT' } });
    const VIEW = String(1n << 0n);
    await api('PUT', `/api/v1/channels/${secreto.body.id}/permissions/${g}`, { token, body: { targetType: 'ROLE', allow: '0', deny: VIEW } });
    const vip = await api('POST', `/api/v1/guilds/${g}/roles`, { token, body: { name: 'VIP' } });
    await api('PUT', `/api/v1/channels/${secreto.body.id}/permissions/${vip.body.id}`, { token, body: { targetType: 'ROLE', allow: VIEW, deny: '0' } });
    check('sem o cargo, o canal privado fica fechado', (await api('GET', `/api/v1/channels/${secreto.body.id}`, { token: token2 })).status === 403);

    const abriu = esperarNovo(bob, 'CHANNEL_UPDATE', (d) => d?.id === secreto.body.id);
    await api('PUT', `/api/v1/guilds/${g}/members/${kayaId}/roles/${vip.body.id}`, { token });
    check('dar o cargo entrega o canal que ele abre', Boolean(await abriu.catch(() => null)));
    const fechou = esperarNovo(bob, 'CHANNEL_DELETE', (d) => d?.id === secreto.body.id);
    const tirar = await api('DELETE', `/api/v1/guilds/${g}/members/${kayaId}/roles/${vip.body.id}`, { token });
    check('tira um cargo so', tirar.status === 200 && !tirar.body?.roleIds?.includes(vip.body.id));
    check('tirar o cargo tira o canal da tela', Boolean(await fechou.catch(() => null)));

    // Heranca da categoria: o que o canal diz vence o que a categoria diz.
    const cat = await api('POST', `/api/v1/guilds/${g}/channels`, { token, body: { name: 'fechada', type: 'GUILD_CATEGORY' } });
    await api('PUT', `/api/v1/channels/${cat.body.id}/permissions/${g}`, { token, body: { targetType: 'ROLE', allow: '0', deny: VIEW } });
    const dentro = await api('POST', `/api/v1/guilds/${g}/channels`, { token, body: { name: 'aberto', type: 'GUILD_TEXT', parentId: cat.body.id } });
    const herdado = await api('POST', `/api/v1/guilds/${g}/channels`, { token, body: { name: 'herdado', type: 'GUILD_TEXT', parentId: cat.body.id } });
    await api('PUT', `/api/v1/channels/${dentro.body.id}/permissions/${g}`, { token, body: { targetType: 'ROLE', allow: VIEW, deny: '0' } });
    check('canal que libera dentro de categoria fechada fica aberto', (await api('GET', `/api/v1/channels/${dentro.body.id}`, { token: token2 })).status === 200);
    check('canal sem nada proprio segue a categoria fechada', (await api('GET', `/api/v1/channels/${herdado.body.id}`, { token: token2 })).status === 403);
    const sincronizar = await api('DELETE', `/api/v1/channels/${dentro.body.id}/permissions`, { token });
    check('sincronizar com a categoria apaga o que o canal dizia', sincronizar.status === 200 && sincronizar.body?.overwrites?.length === 0);
    check('sincronizado, volta a seguir a categoria', (await api('GET', `/api/v1/channels/${dentro.body.id}`, { token: token2 })).status === 403);
    const catDentro = await api('PATCH', `/api/v1/channels/${cat.body.id}`, { token, body: { parentId: cat.body.id } });
    check('categoria nao entra em categoria pelo PATCH', catDentro.status === 400, `status ${catDentro.status}`);
    const paiDeFora = await api('PATCH', `/api/v1/guilds/${g}/channels`, {
      token, body: { positions: [{ id: herdado.body.id, position: 0, parentId: textChannel.id }] },
    });
    check('reordenar nao aceita pai de outro servidor', paiDeFora.status === 400, `status ${paiDeFora.status}`);

    // Convite de um uso, duas pessoas ao mesmo tempo: entra uma so.
    const login3 = await api('POST', '/api/v1/auth/login', { body: { login: 'rafa', password: 'ordem123456' } });
    const login4 = await api('POST', '/api/v1/auth/login', { body: { login: 'bruno', password: 'ordem123456' } });
    const umUso = await api('POST', `/api/v1/guilds/${g}/invites`, { token, body: { maxAgeSecs: 600, maxUses: 1 } });
    const [a, b] = await Promise.all([
      api('POST', `/api/v1/invites/${umUso.body.code}`, { token: login3.body?.accessToken }),
      api('POST', `/api/v1/invites/${umUso.body.code}`, { token: login4.body?.accessToken }),
    ]);
    const entraram = [a, b].filter((r) => r.status === 200 && r.body?.joined).length;
    check('convite de um uso nao deixa duas pessoas entrarem juntas', entraram === 1, `${a.status}/${b.status}`);

    const lista = await api('GET', `/api/v1/guilds/${g}/invites`, { token });
    check('a lista de convites diz quem criou', lista.status === 200 && lista.body?.every((i) => i.inviter?.id === i.inviterId));

    const paraOLink = await api('POST', `/api/v1/guilds/${g}/invites`, { token, body: { maxAgeSecs: 600, maxUses: 0 } });
    const pagina = await fetch(`${API}/convite/${paraOLink.body.code}`);
    const html = await pagina.text();
    check('a pagina do convite abre no navegador', pagina.status === 200 && html.includes(`kiroshi://convite/${paraOLink.body.code}`) && html.includes('Servidor Teste'), `status ${pagina.status}`);
    const gasto = await fetch(`${API}/convite/${umUso.body.code}`);
    check('convite ja gasto da a pagina de convite invalido', gasto.status === 404, `status ${gasto.status}`);
    const invalida = await fetch(`${API}/convite/naoexiste9`);
    check('convite que nao existe da a pagina de convite invalido', invalida.status === 404);

    const auditoria = await api('GET', `/api/v1/guilds/${g}/audit-log?action=MEMBER_ROLE_UPDATE`, { token });
    check('auditoria filtra por acao', auditoria.status === 200 && auditoria.body.length >= 3 && auditoria.body.every((e) => e.action === 'MEMBER_ROLE_UPDATE'));
    check('auditoria traz a pessoa alvo', auditoria.body?.[0]?.targetUser?.id === kayaId);
    const daKaya = await api('GET', `/api/v1/guilds/${g}/audit-log?actorId=${kayaId}`, { token });
    check('auditoria filtra por quem fez', daKaya.status === 200 && daKaya.body.length >= 1 && daKaya.body.every((e) => e.actor.id === kayaId));

    const posse = await api('POST', `/api/v1/guilds/${g}/owner`, { token, body: { userId: '1' } });
    check('passar a posse para quem nao e membro da erro claro, nao 500', posse.status === 400, `status ${posse.status}`);
  }

  console.log('\n--- CONTA NOVA COM CADASTRO ABERTO (fatia 7) ---');
  {
    const info7 = await fetch(`${API}/api/info`).then((r) => r.json());
    if (!info7.openRegistration) {
      console.log('  (cadastro fechado nesta API: nada a conferir aqui)');
    } else {
      const sufixo = Date.now().toString(36).slice(-6);
      const reservado = await api('POST', '/api/v1/auth/register', {
        body: { email: `admin${sufixo}@teste.local`, username: 'admin', password: 'senha-da-conta-nova' },
      });
      check('nome reservado nao vira conta', reservado.status === 400, `status ${reservado.status}`);

      const nova = await api('POST', '/api/v1/auth/register', {
        body: { email: `nova${sufixo}@teste.local`, username: `nova_${sufixo}`, password: 'senha-da-conta-nova' },
      });
      check('cria conta sem convite', nova.status === 201 && typeof nova.body?.accessToken === 'string', `status ${nova.status} ${JSON.stringify(nova.body).slice(0, 120)}`);
      const tokenNova = nova.body?.accessToken;
      const idNova = nova.body?.user?.id;
      const vazia = await connectGateway(tokenNova, 'conta-nova');
      check('a conta nova nasce sem servidor nenhum', vazia.ready?.guilds?.length === 0);
      vazia.close();

      // Estranhos nao se chamam na DM: primeiro amizade ou servidor em comum.
      const estranho = await api('POST', '/api/v1/users/@me/channels', { token: tokenNova, body: { recipientIds: [me.body.id] } });
      check('conta nova nao abre DM com estranho', estranho.status === 403, `status ${estranho.status}`);
      const pedido = await api('POST', '/api/v1/relationships', { token: tokenNova, body: { username: 'pitohui' } });
      check('conta nova manda pedido de amizade', pedido.status === 200 || pedido.status === 201, `status ${pedido.status}`);
      const recebido = (await api('GET', '/api/v1/relationships', { token })).body?.find((r) => r.user?.id === idNova && r.type === 'PENDING_INCOMING');
      const aceito = await api('PUT', `/api/v1/relationships/${recebido?.id}`, { token });
      check('o outro lado aceita', aceito.status === 200, `status ${aceito.status}`);
      const agora = await api('POST', '/api/v1/users/@me/channels', { token: tokenNova, body: { recipientIds: [me.body.id] } });
      check('amigos abrem a DM', agora.status === 200 || agora.status === 201, `status ${agora.status}`);

      // Convite no cadastro aberto: a conta ja nasce dentro do servidor.
      const convite = await api('POST', `/api/v1/guilds/${newGuild.body.id}/invites`, { token, body: { maxAgeSecs: 600, maxUses: 1 } });
      const comConvite = await api('POST', '/api/v1/auth/register', {
        body: { email: `convidada${sufixo}@teste.local`, username: `convidada_${sufixo}`, password: 'senha-da-conta-nova', inviteCode: convite.body?.code },
      });
      check('cadastro com convite ja entra no servidor', comConvite.status === 201 && comConvite.body?.guildId === newGuild.body.id, JSON.stringify(comConvite.body).slice(0, 160));
      const deDentro = await api('GET', `/api/v1/guilds/${newGuild.body.id}`, { token: comConvite.body?.accessToken });
      check('e ve o servidor de dentro', deDentro.status === 200);

      // Perdeu o celular: o 2FA desliga com um codigo de recuperacao.
      const { authenticator } = await import('otplib');
      const setup = await api('POST', '/api/v1/auth/totp/setup', { token: tokenNova });
      const liga = await api('POST', '/api/v1/auth/totp/enable', {
        token: tokenNova,
        body: { code: authenticator.generate(setup.body?.secret), password: 'senha-da-conta-nova' },
      });
      check('liga o 2FA e recebe codigos de recuperacao', liga.status === 200 && liga.body?.backupCodes?.length > 0, `status ${liga.status}`);
      const desliga = await api('POST', '/api/v1/auth/totp/disable', {
        token: tokenNova,
        body: { backupCode: liga.body?.backupCodes?.[0], password: 'senha-da-conta-nova' },
      });
      check('desliga o 2FA com um codigo de recuperacao', desliga.status === 200, `status ${desliga.status} ${JSON.stringify(desliga.body).slice(0, 120)}`);
      const ninguem = await api('POST', '/api/v1/auth/totp/disable', {
        token: tokenNova,
        body: { code: '000000', password: 'senha-da-conta-nova' },
      });
      check('e o 2FA ficou desligado mesmo', ninguem.status === 400, `status ${ninguem.status}`);
    }
  }

  console.log('\n--- VOZ ---');

  const info = await fetch(`${API}/api/info`).then((r) => r.json());
  const voiceJoin = await api('POST', '/api/v1/voice/join', {
    token, body: { channelId: voiceChannel.id },
  });

  if (!info.voiceEnabled) {
    check('sem SFU configurado, a voz responde 503', voiceJoin.status === 503, `status ${voiceJoin.status}`);
  } else {
    check('emite token de voz', voiceJoin.status === 200, `status ${voiceJoin.status}`);
    check('token aponta para o SFU', typeof voiceJoin.body?.url === 'string' && voiceJoin.body.url.startsWith('ws'));
    check('sala e derivada do canal', voiceJoin.body?.roomName === `channel_${voiceChannel.id}`);

    // O token e um JWT do LiveKit; o payload diz o que a pessoa pode fazer.
    const claims = JSON.parse(
      Buffer.from(voiceJoin.body.token.split('.')[1], 'base64url').toString(),
    );
    check('dono pode publicar microfone', claims.video?.canPublishSources?.includes('microphone'));
    check('dono pode compartilhar tela', claims.video?.canPublishSources?.includes('screen_share'));
    // A moderacao de voz passa pelo servidor; o token do cliente nao abre a
    // API de administracao da sala para ninguem, nem para o dono.
    check('token de voz nao da administracao da sala', !claims.video?.roomAdmin);

    // Regressao: reconectar no mesmo canal precisa emitir token novo. Antes,
    // o servidor via que a pessoa "ja estava la" e nao mandava nada, deixando
    // o app presa sem conseguir entrar.
    const rejoin = await api('POST', '/api/v1/voice/join', {
      token, body: { channelId: voiceChannel.id },
    });
    check('reentrar no mesmo canal emite token novo', rejoin.status === 200, `status ${rejoin.status}`);

    // Um membro sem permissao de falar entra so como ouvinte.
    const listenerJoin = await api('POST', '/api/v1/voice/join', {
      token: token2, body: { channelId: voiceChannel.id },
    });
    check('outro membro tambem recebe token', listenerJoin.status === 200);

    await api('POST', '/api/v1/voice/leave', { token });
  }

  const foreignVoice = await api('POST', '/api/v1/voice/join', {
    token, body: { channelId: textChannel.id },
  });
  check(
    'nao emite token de voz para canal de texto',
    foreignVoice.status >= 400,
    `status ${foreignVoice.status}`,
  );

  console.log('\n--- TOKEN DE VOZ SO PARA A SESSAO QUE PEDIU ---');

  if (!info.voiceEnabled) {
    console.log('  (sem SFU configurado o token nao e emitido: nada a conferir aqui)');
  } else {
    // Duas sessoes da mesma conta, como computador e notebook. So a que manda
    // o opcode 4 pode receber o token: o outro aparelho entraria na chamada.
    const outroAparelho = await connectGateway(token, 'alice-2');
    const tokenQuePediu = esperarNovo(alice, 'VOICE_SERVER_UPDATE', (d) => d?.channelId === voiceChannel.id);
    const tokenNoOutro = naoChega(outroAparelho, 'VOICE_SERVER_UPDATE', () => true, 3000);

    alice.ws.send(JSON.stringify({
      op: 4,
      d: { guildId: guild.id, channelId: voiceChannel.id, selfMute: true, selfDeaf: false },
    }));

    check('a sessao que pediu recebe o token de voz', Boolean(await tokenQuePediu.catch(() => null)));
    check('outro aparelho da mesma conta nao recebe o token', await tokenNoOutro);

    alice.ws.send(JSON.stringify({
      op: 4,
      d: { guildId: guild.id, channelId: null, selfMute: true, selfDeaf: false },
    }));
    outroAparelho.close();
  }

  console.log('\n--- CHAMADA EM DM ---');
  {
    // Ligar e atender nao tem rota propria: e entrar na voz da conversa
    // (opcode 4). O servidor faz tocar, para de tocar e registra a chamada.
    const aliceId = me.body.id;
    const bobId = (await api('GET', '/api/v1/users/@me', { token: token2 })).body?.id;
    const dm = await api('POST', '/api/v1/users/@me/channels', { token, body: { recipientIds: [bobId] } });
    check('abre a DM para ligar', dm.status === 200 || dm.status === 201, `status ${dm.status}`);
    const dmId = dm.body?.id;
    const entrar = (conexao, channelId) =>
      conexao.ws.send(JSON.stringify({ op: 4, d: { guildId: null, channelId, selfMute: true, selfDeaf: false } }));

    // O segundo aparelho de quem recebe: o toque vai para todos, e para em todos.
    const bobNoNotebook = await connectGateway(token2, 'bob-2');
    const tocouNoBob = esperarNovo(bob, 'CALL_CREATE', (d) => d?.channelId === dmId);
    const tocouNoNotebook = esperarNovo(bobNoNotebook, 'CALL_CREATE', (d) => d?.channelId === dmId);
    const registrou = esperarNovo(bob, 'MESSAGE_CREATE', (d) => d?.channelId === dmId && d?.type === 'CALL');

    entrar(alice, dmId);

    const chamada = await tocouNoBob.catch(() => null);
    check('ligar faz tocar para o outro lado', Boolean(chamada?.ringing?.includes(bobId)), JSON.stringify(chamada));
    check('toca em todos os aparelhos de quem recebe', Boolean(await tocouNoNotebook.catch(() => null)));
    const registro = await registrou.catch(() => null);
    check(
      'a chamada fica registrada na conversa, com quem ligou',
      registro?.call?.endedAt === null && registro?.call?.participantIds?.[0] === aliceId,
      JSON.stringify(registro?.call),
    );

    const pararam = esperarNovo(bobNoNotebook, 'CALL_UPDATE', (d) => d?.channelId === dmId && !d.ringing.includes(bobId));
    const recusa = await api('POST', `/api/v1/channels/${dmId}/call/stop-ringing`, { token: token2 });
    check('recusar responde', recusa.status === 200, `status ${recusa.status}`);
    check('recusar para de tocar nos outros aparelhos', Boolean(await pararam.catch(() => null)));

    const tocouDeNovo = esperarNovo(bob, 'CALL_UPDATE', (d) => d?.channelId === dmId && d.ringing.includes(bobId));
    const deNovo = await api('POST', `/api/v1/channels/${dmId}/call/ring`, { token });
    check('quem esta na chamada toca de novo', deNovo.status === 200 && Boolean(await tocouDeNovo.catch(() => null)));

    const semEntrar = await api('POST', `/api/v1/channels/${dmId}/call/ring`, { token: token2 });
    check('quem nao entrou na chamada nao toca para ninguem', semEntrar.status === 403, `status ${semEntrar.status}`);

    const atendeu = esperarNovo(alice, 'CALL_UPDATE', (d) => d?.channelId === dmId && d.ringing.length === 0);
    entrar(bob, dmId);
    check('atender para o toque', Boolean(await atendeu.catch(() => null)));

    const acabou = esperarNovo(bobNoNotebook, 'CALL_DELETE', (d) => d?.channelId === dmId);
    const fechou = esperarNovo(bob, 'MESSAGE_UPDATE', (d) => d?.id === registro?.id && Boolean(d?.call?.endedAt));
    entrar(bob, null);
    entrar(alice, null);
    check('a chamada acaba quando a ultima pessoa sai', Boolean(await acabou.catch(() => null)));
    const fechada = await fechou.catch(() => null);
    check(
      'o registro final guarda quem participou',
      fechada?.call?.participantIds?.length === 2 && fechada.call.participantIds.includes(bobId),
      JSON.stringify(fechada?.call),
    );
    bobNoNotebook.close();
  }

  console.log('\n--- NOTIFICACOES POR SERVIDOR E SEGURANCA ---');
  {
    const avisou = esperarNovo(alice, 'USER_GUILD_SETTINGS_UPDATE', (d) => d?.guildId === guild.id);
    const ate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const silenciou = await api('PATCH', `/api/v1/users/@me/guilds/${guild.id}/settings`, {
      token,
      body: { muted: true, mutedUntil: ate, notificationLevel: 'MENTIONS' },
    });
    check(
      'silenciar o servidor por um prazo',
      silenciou.status === 200 && Boolean(silenciou.body?.mutedUntil) && silenciou.body?.notificationLevel === 'MENTIONS',
      JSON.stringify(silenciou.body),
    );
    check('os outros aparelhos ficam sabendo do ajuste', Boolean(await avisou.catch(() => null)));

    const canalCalado = await api('PATCH', `/api/v1/users/@me/channels/${textChannel.id}/settings`, {
      token,
      body: { muted: true, mutedUntil: null },
    });
    check('silenciar um canal ate reativar', canalCalado.status === 200 && canalCalado.body?.muted === true && canalCalado.body?.mutedUntil === null);

    const lidos = await api('GET', '/api/v1/users/@me/settings', { token });
    check(
      'a leitura traz servidores e canais em listas separadas',
      Array.isArray(lidos.body?.guilds) && lidos.body.guilds.some((g) => g.guildId === guild.id) && lidos.body?.channels?.some((c) => c.channelId === textChannel.id),
      JSON.stringify(lidos.body).slice(0, 200),
    );

    // Volta como estava, para as proximas rodadas.
    await api('PATCH', `/api/v1/users/@me/guilds/${guild.id}/settings`, { token, body: { muted: false, notificationLevel: 'ALL' } });
    await api('PATCH', `/api/v1/users/@me/channels/${textChannel.id}/settings`, { token, body: { muted: false } });

    const seguranca = await api('GET', '/api/v1/users/@me/security', { token });
    check(
      'a seguranca diz se ha senha, sem o hash',
      seguranca.status === 200 && seguranca.body?.hasPassword === true && !JSON.stringify(seguranca.body).includes('$'),
      JSON.stringify(seguranca.body),
    );
  }

  console.log('\n--- MENCOES INVALIDAS (regressao) ---');

  // Um id inventado quebrava o envio com 500 por violacao de chave
  // estrangeira em ReadState, depois da mensagem ja ter sido criada.
  const fakeMention = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: 'ola <@999999999999999999>' },
  });
  check(
    'mencao a usuario inexistente nao derruba o envio',
    fakeMention.status === 201,
    `status ${fakeMention.status} ${JSON.stringify(fakeMention.body).slice(0, 160)}`,
  );
  check(
    'mencao invalida e descartada',
    Array.isArray(fakeMention.body?.mentionedUserIds) &&
      fakeMention.body.mentionedUserIds.length === 0,
    JSON.stringify(fakeMention.body?.mentionedUserIds),
  );

  const fakeRole = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: 'atencao <@&999999999999999999>' },
  });
  check('mencao a cargo inexistente nao derruba o envio', fakeRole.status === 201);
  check(
    'mencao de cargo invalido e descartada',
    fakeRole.body?.mentionedRoleIds?.length === 0,
  );

  // Mencao valida continua sendo gravada.
  const realMention = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: `oi <@${bob.ready.user.id}>` },
  });
  check(
    'mencao valida e preservada',
    realMention.body?.mentionedUserIds?.includes(bob.ready.user.id),
  );

  console.log('\n--- CANAL PRIVADO NAO VAZA PELO GATEWAY ---');

  // Um canal que so o dono (e quem tem ADMINISTRATOR) ve: o everyone perde o
  // bit 0, VIEW_CHANNEL. O segundo usuario do seed nao e administrador.
  const privado = await api('POST', `/api/v1/guilds/${guild.id}/channels`, {
    token, body: { name: 'privado-e2e', type: 'GUILD_TEXT' },
  });
  check('cria o canal do teste de privacidade', privado.status === 201, `status ${privado.status}`);
  const privadoId = privado.body?.id;

  const bobPerde = esperarNovo(bob, 'CHANNEL_DELETE', (d) => d?.id === privadoId);
  const fechar = await api('PUT', `/api/v1/channels/${privadoId}/permissions/${guild.id}`, {
    token, body: { targetType: 'ROLE', allow: '0', deny: '1' },
  });
  check('fecha o canal para o everyone', fechar.status === 200, `status ${fechar.status}`);
  check(
    'quem perdeu o acesso recebe CHANNEL_DELETE',
    Boolean(await bobPerde.catch(() => null)),
  );

  const historicoAlheio = await api('GET', `/api/v1/channels/${privadoId}/messages`, { token: token2 });
  check('o canal ficou mesmo fechado para o outro usuario', historicoAlheio.status === 403, `status ${historicoAlheio.status}`);

  // Mensagem e digitacao no canal privado nao podem chegar a quem nao o ve.
  const semMensagem = naoChega(bob, 'MESSAGE_CREATE', (d) => d?.channelId === privadoId, 2500);
  const semDigitacao = naoChega(bob, 'TYPING_START', (d) => d?.channelId === privadoId, 2500);
  alice.ws.send(JSON.stringify({ op: 12, d: { channelId: privadoId } }));
  const segredo = await api('POST', `/api/v1/channels/${privadoId}/messages`, {
    token, body: { content: 'so para quem ve o canal' },
  });
  check('o dono escreve no canal privado', segredo.status === 201, `status ${segredo.status}`);
  check('mensagem de canal privado nao chega a quem nao ve', await semMensagem);
  check('digitacao em canal privado nao chega a quem nao ve', await semDigitacao);

  // Controle: a mesma conexao continua recebendo o canal aberto. Sem isto, as
  // duas checagens acima passariam tambem com o gateway quebrado.
  const bobRecebeAberto = esperarNovo(bob, 'MESSAGE_CREATE', (d) => d?.channelId === textChannel.id);
  const aberto = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: 'mensagem no canal aberto' },
  });
  const recebidaAberta = await bobRecebeAberto.catch(() => null);
  check('no canal aberto a mesma conexao recebe', recebidaAberta?.id === aberto.body?.id);

  console.log('\n--- AROUND SO DENTRO DO PROPRIO CANAL ---');

  // A mensagem-alvo do `around` tem que ser do canal pedido: pedir em volta de
  // uma mensagem do canal privado, pelo canal aberto, nao pode devolve-la.
  const cruzado = await api(
    'GET',
    `/api/v1/channels/${textChannel.id}/messages?around=${segredo.body?.id}&limit=5`,
    { token: token2 },
  );
  check(
    'around nao traz mensagem de outro canal',
    cruzado.status === 200 && Array.isArray(cruzado.body) && !cruzado.body.some((m) => m.id === segredo.body?.id),
    `status ${cruzado.status}`,
  );
  const noProprio = await api(
    'GET',
    `/api/v1/channels/${textChannel.id}/messages?around=${aberto.body?.id}&limit=5`,
    { token: token2 },
  );
  check(
    'around continua trazendo a mensagem do proprio canal',
    Array.isArray(noProprio.body) && noProprio.body.some((m) => m.id === aberto.body?.id),
  );

  // Apagar o canal privado: o aviso vai so para quem o via.
  const semAvisoDeExclusao = naoChega(bob, 'CHANNEL_DELETE', (d) => d?.id === privadoId, 2000);
  const apagouPrivado = await api('DELETE', `/api/v1/channels/${privadoId}`, { token });
  check('apaga o canal privado', apagouPrivado.status === 200, `status ${apagouPrivado.status}`);
  check('quem nao via o canal nao e avisado de que ele sumiu', await semAvisoDeExclusao);

  console.log('\n--- SESSAO ENCERRADA DERRUBA O GATEWAY ---');

  // Uma segunda sessao de login da mesma conta, como um segundo aparelho.
  const segundoLogin = await api('POST', '/api/v1/auth/login', {
    body: { login: 'pitohui', password: 'ordem123456' },
  });
  check('abre uma segunda sessao de login', segundoLogin.status === 200, `status ${segundoLogin.status}`);
  const tokenDoAparelho = segundoLogin.body?.accessToken;
  const aparelho = await connectGateway(tokenDoAparelho, 'aparelho-revogado');

  const listaDeSessoes = await api('GET', '/api/v1/auth/sessions', { token: tokenDoAparelho });
  const idDoAparelho = Array.isArray(listaDeSessoes.body)
    ? listaDeSessoes.body.find((s) => s.current)?.id
    : undefined;
  check('a sessao nova aparece na lista de aparelhos', Boolean(idDoAparelho));

  // Revogar pelo outro aparelho: o gateway da sessao revogada fecha com 4004,
  // que o app 1.15 trata renovando o token e, sem sessao, indo para o login.
  const aparelhoFechou = codigoDeFechamento(aparelho.ws);
  const revogar = await api('DELETE', `/api/v1/auth/sessions/${idDoAparelho}`, { token });
  check('revoga a sessao do outro aparelho', revogar.status === 200, `status ${revogar.status}`);
  const codigoDoAparelho = await aparelhoFechou;
  check('o gateway da sessao revogada fecha com 4004', codigoDoAparelho === 4004, `codigo ${codigoDoAparelho}`);

  // O access token dela ainda e um JWT valido por alguns minutos. O gateway
  // precisa recusar mesmo assim, conferindo a sessao no banco.
  const novaTentativa = await resultadoDoIdentify(tokenDoAparelho);
  check('token de sessao encerrada nao entra mais no gateway', novaTentativa === 4004, `resultado ${novaTentativa}`);

  // Quem revogou continua conectado: a revogacao e so daquele aparelho.
  const aliceSegue = esperarNovo(alice, 'MESSAGE_CREATE', (d) => d?.channelId === textChannel.id);
  const depoisDaRevogacao = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: 'ainda conectada' },
  });
  check(
    'a sessao de quem revogou segue recebendo',
    (await aliceSegue.catch(() => null))?.id === depoisDaRevogacao.body?.id,
  );

  console.log('\n--- CORPO VAZIO COM CONTENT-TYPE JSON (regressao) ---');

  // Clientes HTTP mandam content-type json mesmo sem corpo; o Fastify
  // rejeitava isso com 400 antes do parser tolerante.
  const bobFechou = codigoDeFechamento(bob.ws);
  const emptyBody = await fetch(`${API}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
  });
  check('POST sem corpo com content-type json funciona', emptyBody.status === 200, `status ${emptyBody.status}`);
  // E o logout encerra a conexao em tempo real da propria sessao.
  const codigoDoBob = await bobFechou;
  check('logout derruba o gateway da propria sessao', codigoDoBob === 4004, `codigo ${codigoDoBob}`);

  console.log('\n--- VALIDACAO E RATE LIMIT ---');

  const badMessage = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: '' },
  });
  check('rejeita mensagem vazia', badMessage.status === 400, `status ${badMessage.status}`);

  const longMessage = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
    token, body: { content: 'x'.repeat(5000) },
  });
  check('rejeita mensagem longa demais', longMessage.status === 400);

  let limited = false;
  for (let i = 0; i < 15; i++) {
    const r = await api('POST', `/api/v1/channels/${textChannel.id}/messages`, {
      token, body: { content: `spam ${i}` },
    });
    if (r.status === 429) { limited = true; break; }
  }
  check('rate limit dispara', limited);

  alice.close();
  bob.close();

  console.log(`\n=========================================`);
  console.log(`  ${passed} passaram, ${failed} falharam`);
  console.log(`=========================================\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });

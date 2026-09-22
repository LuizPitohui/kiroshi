import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/**
 * As tres paginas publicas do Kiroshi.
 *
 * Existem por uma exigencia concreta: para publicar o login com Google fora do
 * modo de teste, o Google pede uma pagina inicial e uma politica de
 * privacidade acessiveis no dominio autorizado. Sem elas o botao de publicar
 * nem aparece.
 *
 * Sao servidas daqui, e nao de um site separado, porque o servidor ja e
 * publico pelo tunel e ja serve o instalador. Um segundo lugar para hospedar
 * duas paginas seria mais uma coisa para manter viva.
 *
 * DUAS DECISOES sobre o texto:
 *
 * 1. Ele e acentuado, ao contrario do resto do produto. A interface e lida por
 *    dez amigos acostumados com ela; estas paginas sao lidas por gente de fora
 *    e por quem revisa no Google. Politica de privacidade sem acento parece
 *    descuido, e descuido numa pagina dessas e o pior lugar para parecer.
 *
 * 2. O que a politica diz foi tirado do schema, tabela por tabela. Um modelo
 *    pronto da internet seria mais rapido e afirmaria coisas que aqui nao sao
 *    verdade — inclusive promessas de seguranca que o produto nao cumpre.
 */

/**
 * Prova de posse do dominio para o Search Console do Google.
 *
 * NAO e segredo: o proposito deste valor e ficar visivel no HTML publico, e
 * ele sozinho nao da acesso a nada. Fica no codigo, e nao no .env, porque e
 * fixo para este dominio e porque um passo a menos na maquina do servidor e um
 * passo a menos para dar errado. Quem levantar uma copia do Kiroshi em outro
 * dominio troca esta linha, ou define `GOOGLE_SITE_VERIFICATION`.
 *
 * Se sair daqui, o Google desverifica o dominio — inclusive depois de ja ter
 * verificado uma vez.
 */
const VERIFICACAO_DO_GOOGLE =
  process.env.GOOGLE_SITE_VERIFICATION ?? 'S3owJ0kni-T6_NsHdB-ZpuJbVUiDFjwfVQSEriD92SM';

/*
  Datas separadas de proposito.

  Cada documento tem a data da ULTIMA vez que o texto dele mudou, nao a data
  do deploy. Um documento que diz "atualizado hoje" sem nada ter mudado ensina
  a ignorar a data — e a data e o unico jeito de alguem saber se precisa ler de
  novo.
*/
const PRIVACIDADE_EM = '21 de setembro de 2026';
const TERMOS_EM = '22 de setembro de 2026';

const ESTILO = `
  :root {
    color-scheme: dark;
    --canvas: #080c12;
    --superficie: #151f2c;
    --borda: #2b3b4f;
    --texto: #eef4ff;
    --secundario: #a8b8cc;
    --apagado: #7f91a8;
    --optico: #20e0d0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--canvas);
    color: var(--texto);
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .envelope { max-width: 46rem; margin: 0 auto; padding: 56px 20px 96px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; }
  .marca {
    font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
    font-size: 14px; color: var(--texto);
  }
  .marca b { color: var(--optico); font-weight: 700; }
  h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.2; margin: 0 0 16px; }
  h2 {
    font-size: 1.15rem; margin: 40px 0 10px; color: var(--texto);
    padding-top: 24px; border-top: 1px solid var(--borda);
  }
  h2:first-of-type { border-top: none; padding-top: 0; }
  p, li { color: var(--secundario); }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  strong { color: var(--texto); }
  a { color: var(--optico); }
  .chamada {
    display: inline-block; margin-top: 8px; padding: 12px 22px;
    background: var(--optico); color: #062b28; border-radius: 8px;
    font-weight: 600; text-decoration: none;
  }
  .cartao {
    background: var(--superficie); border: 1px solid var(--borda);
    border-radius: 12px; padding: 20px 22px; margin: 24px 0;
  }
  .rodape {
    margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--borda);
    color: var(--apagado); font-size: 14px;
  }
  .rodape a { color: var(--apagado); }
  .data { color: var(--apagado); font-size: 14px; margin-top: -8px; }
  /* A frase que explica o app em uma linha, logo abaixo do nome. */
  .linha-fina {
    font-size: 1.15rem; color: var(--texto); margin: -8px 0 20px;
  }
`;

/**
 * Como pedir alguma coisa sobre os proprios dados.
 *
 * Sem e-mail configurado a pagina nao inventa um endereco: manda falar com
 * quem administra pelo proprio aplicativo, que continua sendo verdade e
 * continua funcionando.
 */
function contato(): string {
  const email = config.contatoPrivacidade;
  if (!email) return 'fale com quem administra este servidor pelo próprio aplicativo.';
  return `<a href="mailto:${email}">${email}</a>.`;
}

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<meta name="description" content="Kiroshi: conversa, voz e transmissão de tela em servidor próprio.">
<meta name="google-site-verification" content="${VERIFICACAO_DO_GOOGLE}">
<style>${ESTILO}</style>
</head>
<body>
  <div class="envelope">
    <header><span class="marca">KIR<b>O</b>SHI</span></header>
    ${corpo}
    <div class="rodape">
      <a href="/">Início</a> &middot; <a href="/termos">Termos</a> &middot;
      <a href="/privacidade">Privacidade</a> &middot; <a href="/baixar">Baixar</a>
    </div>
  </div>
</body>
</html>`;
}

const INICIO = moldura(
  'Kiroshi',
  `
  <h1>Kiroshi</h1>
  <p class="linha-fina">Conversa, voz e transmissão de tela — no seu próprio servidor.</p>
  <p>
    O <strong>Kiroshi</strong> é um aplicativo de mensagens e chamadas de voz
    para grupos fechados, com transmissão de tela em alta qualidade. Ele roda em
    um servidor próprio: não há empresa no meio guardando as conversas, nem
    conta de terceiro necessária para usar.
  </p>
  <p>
    O aplicativo é instalado no computador. Você cria uma conta com e-mail e
    senha, ou entra com sua conta do Google, e passa a conversar com as pessoas
    do grupo por texto, por voz e por vídeo.
  </p>

  <p><a class="chamada" href="/baixar">Baixar para Windows</a></p>

  <h2>O que ele faz</h2>
  <ul>
    <li>Canais de texto e mensagens diretas, com anexos e reações.</li>
    <li>Canais de voz com cancelamento de eco e supressão de ruído.</li>
    <li>Transmissão de tela até 1080p60, com o som do que está sendo transmitido.</li>
    <li>Volume individual por pessoa, e separado para o som da transmissão.</li>
    <li>Verificação em duas etapas por aplicativo autenticador.</li>
  </ul>

  <h2>Quem pode entrar</h2>
  <div class="cartao">
    <p style="margin:0">
      <strong>Este servidor é fechado.</strong> Criar conta exige um código de
      convite de quem já está dentro. Entrar com o Google confirma quem você é,
      mas não substitui o convite.
    </p>
  </div>

  <h2>Sobre os seus dados</h2>
  <p>
    O aplicativo guarda o mínimo para funcionar, e não usa o que você escreve
    para nada além de entregar a mensagem a quem ela foi endereçada. O detalhe
    está na <a href="/privacidade">política de privacidade</a>.
  </p>
`,
);

const PRIVACIDADE = moldura(
  'Privacidade — Kiroshi',
  `
  <h1>Política de privacidade</h1>
  <p class="data">Atualizada em ${PRIVACIDADE_EM}.</p>

  <p>
    O Kiroshi é um serviço privado, operado por uma pessoa física, para um grupo
    fechado de conhecidos. Não é um produto comercial: não há anúncios, não há
    cobrança, e nada do que é coletado é vendido, alugado ou compartilhado para
    fins de publicidade ou de análise de comportamento.
  </p>

  <h2>O que é guardado</h2>
  <p>Ao criar e usar uma conta, o servidor guarda:</p>
  <ul>
    <li><strong>Conta:</strong> e-mail, nome de usuário, nome de exibição e o
      resumo criptográfico da senha. A senha em si nunca é guardada.</li>
    <li><strong>Perfil, se você preencher:</strong> foto, capa, biografia,
      pronomes, cor de destaque e recado de status.</li>
    <li><strong>Mensagens:</strong> o texto que você envia, os anexos que você
      sobe, as reações, e a marca de até onde você leu cada canal.</li>
    <li><strong>Sessões:</strong> para manter você conectado, guardamos o
      endereço IP e a identificação do navegador ou aplicativo de cada
      dispositivo conectado, com a data do último uso.</li>
    <li><strong>Presença e voz:</strong> se você está online, em qual canal de
      voz está, e se está com microfone, câmera ou transmissão ligados.</li>
    <li><strong>Segurança:</strong> se você ativar a verificação em duas etapas,
      o segredo do autenticador e os códigos de recuperação — estes últimos
      guardados como resumo criptográfico.</li>
    <li><strong>Registro de administração:</strong> ações de moderação, como
      banir, expulsar ou alterar cargos, ficam registradas com quem fez e
      quando.</li>
  </ul>

  <h2>Conteúdo de voz e de tela</h2>
  <div class="cartao">
    <p style="margin:0">
      <strong>Chamadas e transmissões de tela não são gravadas.</strong> O áudio
      e o vídeo passam pelo servidor em tempo real e não são escritos em disco em
      momento algum. O que fica registrado é apenas que a chamada aconteceu: quem
      estava conectado e por quanto tempo.
    </p>
  </div>

  <h2>Entrar com o Google</h2>
  <p>
    Vincular sua conta do Google é opcional, e serve para entrar sem digitar
    senha. Quando você faz isso, pedimos ao Google apenas três informações
    básicas: o identificador da sua conta, seu e-mail e seu nome público.
  </p>
  <ul>
    <li>Não pedimos, não recebemos e não temos acesso ao seu Gmail, aos seus
      contatos, à sua agenda ou aos seus arquivos.</li>
    <li>Guardamos o identificador do Google e o e-mail retornado, apenas para
      reconhecer você no próximo login.</li>
    <li>Não guardamos sua senha do Google, nem token de acesso contínuo à conta
      dele.</li>
    <li>Você pode desfazer o vínculo quando quiser, nos Ajustes do aplicativo.</li>
  </ul>

  <h2>Com quem os dados são compartilhados</h2>
  <p>Com ninguém para fins comerciais. Tecnicamente, passam por:</p>
  <ul>
    <li><strong>Cloudflare:</strong> o tráfego entre você e o servidor passa por
      um túnel da Cloudflare. Quando a conexão direta de voz não é possível, o
      áudio e o vídeo também passam pelo serviço de retransmissão dela.</li>
    <li><strong>Google:</strong> apenas se você escolher vincular sua conta, e
      apenas no momento do login.</li>
  </ul>
  <p>
    Não há ferramenta de análise de comportamento, rastreador de terceiros nem
    cookie de publicidade em nenhuma parte do aplicativo ou deste site.
  </p>

  <h2>Por quanto tempo</h2>
  <p>
    Mensagens e anexos ficam guardados até serem apagados por você ou por quem
    administra o canal. Sessões expiram em 60 dias sem uso, e você pode encerrar
    qualquer uma delas quando quiser, nos Ajustes. Apagar sua conta apaga junto
    suas mensagens, anexos, relações e configurações.
  </p>

  <h2>Seus pedidos</h2>
  <p>
    Você pode pedir uma cópia do que está guardado sobre você, corrigir qualquer
    dado, ou pedir que sua conta e seu conteúdo sejam apagados. O pedido é feito
    direto a quem administra o servidor, pelo próprio aplicativo ou pelo e-mail
    de contato abaixo.
  </p>

  <h2>Segurança, com honestidade</h2>
  <p>
    As senhas são guardadas com Argon2, nunca em texto claro, e a conexão entre o
    aplicativo e o servidor é cifrada.
    <strong>As mensagens não são cifradas de ponta a ponta entre usuários:</strong>
    quem administra o servidor tem acesso técnico ao banco de dados e, portanto,
    ao conteúdo das mensagens. Isso vale para qualquer serviço deste tipo que não
    anuncie cifragem ponta a ponta — e preferimos dizer a deixar subentendido.
  </p>

  <h2>Mudanças</h2>
  <p>
    Se esta política mudar, a data no topo muda junto. Alterações relevantes são
    avisadas dentro do próprio aplicativo.
  </p>

  <h2>Contato</h2>
  <p>Dúvidas ou pedidos sobre seus dados: ${contato()}</p>
`,
);

const TERMOS = moldura(
  'Termos de uso — Kiroshi',
  `
  <h1>Termos de uso</h1>
  <p class="data">Atualizados em ${TERMOS_EM}.</p>

  <p>
    O Kiroshi é um serviço privado, mantido por uma pessoa física, sem cobrança
    e sem fim comercial, para um grupo fechado de conhecidos. Usar o serviço
    significa concordar com o que está escrito aqui.
  </p>

  <h2>Quem pode usar</h2>
  <p>
    O acesso é por convite de quem já participa. Não há cadastro aberto. Quem
    administra o servidor pode encerrar o acesso de qualquer conta, a qualquer
    momento, sem precisar justificar — é um espaço privado, não um serviço
    contratado.
  </p>

  <h2>Sua conta</h2>
  <ul>
    <li>Você é responsável por manter sua senha em segredo e por tudo que
      acontecer na sua conta.</li>
    <li>Não crie conta em nome de outra pessoa nem se passe por alguém.</li>
    <li>Se desconfiar que alguém entrou na sua conta, troque a senha e avise
      quem administra.</li>
  </ul>

  <h2>O que você não pode fazer aqui</h2>
  <ul>
    <li>Nada que a lei brasileira proíba.</li>
    <li>Assediar, ameaçar ou expor dados de outra pessoa sem consentimento.</li>
    <li>Publicar material sexual envolvendo menores — isto leva a remoção
      imediata e comunicação às autoridades.</li>
    <li>Distribuir programa malicioso, ou tentar invadir, sobrecarregar ou
      derrubar o servidor.</li>
    <li>Usar o serviço para revender, hospedar ou distribuir coisa alguma a
      terceiros.</li>
  </ul>

  <h2>O que você escreve continua seu</h2>
  <p>
    O conteúdo que você envia é seu. Ao enviar, você autoriza o servidor a
    guardar e transmitir esse conteúdo às pessoas a quem ele foi endereçado —
    que é a única forma de o serviço funcionar. Essa autorização existe para
    isso e para nada mais: nada do que você escreve é usado para publicidade,
    treinamento de modelo ou análise de comportamento.
  </p>
  <p>
    Quem administra o servidor pode remover conteúdo que viole estes termos, e
    quem administra um canal pode apagar mensagens dele.
  </p>

  <h2>Sem garantia, e isso é sério</h2>
  <div class="cartao">
    <p style="margin:0 0 10px">
      <strong>O serviço é oferecido como está, sem garantia de nada.</strong>
      Ele roda em um servidor doméstico, em uma conexão doméstica. Pode sair do
      ar sem aviso, por queda de luz, de internet, por falha de equipamento ou
      simplesmente porque quem mantém decidiu desligar.
    </p>
    <p style="margin:0">
      <strong>Pode haver perda de dados.</strong> Se alguma conversa, arquivo ou
      registro importa para você, guarde uma cópia fora daqui. Não há promessa
      de backup, de recuperação, nem de prazo para consertar qualquer coisa.
    </p>
  </div>

  <h2>Responsabilidade</h2>
  <p>
    Na medida permitida pela lei, quem mantém o Kiroshi não responde por
    prejuízo decorrente do uso ou da indisponibilidade do serviço, nem pelo
    conteúdo que outras pessoas publicarem nele. Cada um responde pelo que
    escreve.
  </p>

  <h2>Encerramento</h2>
  <p>
    Você pode parar de usar quando quiser e pedir que sua conta seja apagada.
    Quem administra pode encerrar o serviço inteiro, ou o acesso de uma conta,
    a qualquer momento. Se o serviço for encerrado de vez, o aviso será dado
    dentro do próprio aplicativo com a antecedência que for possível.
  </p>

  <h2>Mudanças nestes termos</h2>
  <p>
    Se mudarem, a data no topo muda junto, e alterações relevantes são avisadas
    dentro do aplicativo. Continuar usando depois disso significa concordar com
    a versão nova.
  </p>

  <h2>Lei aplicável</h2>
  <p>
    Estes termos seguem a lei brasileira. Questões sobre dados pessoais estão
    na <a href="/privacidade">política de privacidade</a>.
  </p>

  <h2>Contato</h2>
  <p>Para qualquer dúvida sobre estes termos: ${contato()}</p>
`,
);

export async function paginasRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(INICIO);
  });

  app.get('/privacidade', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(PRIVACIDADE);
  });

  app.get('/termos', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(TERMOS);
  });
}

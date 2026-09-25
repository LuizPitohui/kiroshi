/**
 * As provas curtas do login com Google, e o que elas NAO podem fazer.
 *
 * Depois que o Google confirma quem a pessoa e, o servidor emite um bilhete
 * assinado com um proposito escrito dentro. Dois propositos existem hoje:
 *
 *   `registro` — "esta identidade do Google pode criar uma conta nova";
 *   `senha`    — "este usuario pode definir uma senha sem saber a antiga".
 *
 * O SEGUNDO E UMA CHAVE MESTRA. Quem tiver uma prova de `senha` valida troca a
 * senha de uma conta sem nenhuma outra credencial. Por isso a checagem de
 * proposito e o que estes testes cercam: sem ela, uma prova emitida para
 * cadastrar alguem novo abriria a troca de senha de qualquer conta cujo id o
 * atacante conhecesse.
 *
 * Nao e hipotese distante: os dois propositos saem da mesma funcao, sao
 * assinados com a mesma chave e tem o mesmo formato. A unica coisa que os
 * separa e um campo.
 */

import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';

// O modulo de config valida o ambiente ao ser importado; preenche antes.
process.env.DATABASE_URL ??= 'postgresql://teste:teste@localhost:5432/teste';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const { assinarProva, conferirProva, assinarEstado, conferirEstado } = await import('./google.js');
const { config } = await import('../config.js');

const IDENTIDADE = {
  id: '1234567890',
  email: 'alguem@gmail.com',
  emailVerificado: true,
  nome: 'Alguem',
  foto: null,
};

describe('provas: ida e volta', () => {
  it('a prova de registro volta com a identidade inteira', async () => {
    const token = await assinarProva({ proposito: 'registro', google: IDENTIDADE });
    const prova = await conferirProva(token, 'registro');
    expect(prova.google.id).toBe('1234567890');
    expect(prova.google.emailVerificado).toBe(true);
  });

  it('a prova de senha volta com o usuario', async () => {
    const token = await assinarProva({ proposito: 'senha', userId: 'abc123' });
    const prova = await conferirProva(token, 'senha');
    expect(prova.userId).toBe('abc123');
  });
});

describe('uma prova nao serve para outro proposito', () => {
  /*
    O teste central deste arquivo. Se ele passar a reprovar, alguem tirou a
    checagem de proposito — e o login com Google virou uma forma de trocar a
    senha de outra pessoa.
  */
  it('prova de REGISTRO nao abre a troca de senha', async () => {
    const token = await assinarProva({ proposito: 'registro', google: IDENTIDADE });
    await expect(conferirProva(token, 'senha')).rejects.toThrow();
  });

  it('prova de SENHA nao abre a criacao de conta', async () => {
    const token = await assinarProva({ proposito: 'senha', userId: 'abc123' });
    await expect(conferirProva(token, 'registro')).rejects.toThrow();
  });

  /*
    A de recuperacao (fatia 7) nasce SEM sessao, de quem esqueceu a senha. Se
    ela abrisse a troca de senha "logada" ou a criacao de conta, ou fosse
    aberta por elas, o caminho publico viraria atalho para os outros.
  */
  it('prova de RECUPERACAO so serve para recuperar', async () => {
    const token = await assinarProva({ proposito: 'recuperacao', userId: 'abc123' });
    const prova = await conferirProva(token, 'recuperacao');
    expect(prova.userId).toBe('abc123');
    await expect(conferirProva(token, 'senha')).rejects.toThrow();
    await expect(conferirProva(token, 'registro')).rejects.toThrow();
  });

  it('nem a de senha nem a de registro abrem a recuperacao', async () => {
    const senha = await assinarProva({ proposito: 'senha', userId: 'abc123' });
    const registro = await assinarProva({ proposito: 'registro', google: IDENTIDADE });
    await expect(conferirProva(senha, 'recuperacao')).rejects.toThrow();
    await expect(conferirProva(registro, 'recuperacao')).rejects.toThrow();
  });
});

describe('provas forjadas ou de outra origem', () => {
  it('assinada com outra chave nao vale', async () => {
    const outraChave = new TextEncoder().encode('uma-chave-completamente-diferente-e-longa');
    const token = await new SignJWT({ proposito: 'senha', userId: 'vitima' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('kiroshi')
      .setAudience('kiroshi-google-prova')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(outraChave);

    await expect(conferirProva(token, 'senha')).rejects.toThrow();
  });

  /*
    A plateia separa os tres tipos de token que este servidor emite com a MESMA
    chave: acesso, estado do OAuth e prova. Sem ela, um `state` — que viaja na
    barra de enderecos, a vista de todo mundo — seria aceito como prova.
  */
  it('um token de acesso normal nao passa por prova', async () => {
    const token = await new SignJWT({ proposito: 'senha', userId: 'vitima' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('kiroshi')
      .setAudience('kiroshi-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(config.jwtSecret);

    await expect(conferirProva(token, 'senha')).rejects.toThrow();
  });

  it('o estado do OAuth tambem nao vira prova', async () => {
    const estado = await assinarEstado({
      intencao: 'senha',
      retorno: 'http://127.0.0.1:53114/pronto',
      userId: 'vitima',
    });
    await expect(conferirProva(estado, 'senha')).rejects.toThrow();
  });

  it('e uma prova nao vira estado', async () => {
    const token = await assinarProva({ proposito: 'senha', userId: 'abc123' });
    await expect(conferirEstado(token)).rejects.toThrow();
  });

  it('lixo nao derruba a verificacao, so reprova', async () => {
    for (const lixo of ['', 'nao-e-jwt', 'a.b.c']) {
      await expect(conferirProva(lixo, 'senha'), JSON.stringify(lixo)).rejects.toThrow();
    }
  });
});

describe('estado do OAuth', () => {
  it('a intencao de recuperar volta sem usuario (quem pede nao tem sessao)', async () => {
    const token = await assinarEstado({ intencao: 'recuperar', retorno: 'http://127.0.0.1:53114/pronto' });
    const estado = await conferirEstado(token);
    expect(estado.intencao).toBe('recuperar');
    expect(estado.userId).toBeUndefined();
  });

  it('ida e volta preserva intencao, retorno e usuario', async () => {
    const token = await assinarEstado({
      intencao: 'vincular',
      retorno: 'http://127.0.0.1:53114/pronto',
      userId: 'abc123',
    });
    const estado = await conferirEstado(token);
    expect(estado.intencao).toBe('vincular');
    expect(estado.retorno).toBe('http://127.0.0.1:53114/pronto');
    expect(estado.userId).toBe('abc123');
  });

  /*
    O endereco de retorno e conferido de NOVO na volta, e nao so na ida. Um
    estado assinado com destino de fora — se algum caminho futuro esquecer de
    validar antes de assinar — morre aqui.
  */
  it('estado com retorno de fora e recusado na volta', async () => {
    const token = await assinarEstado({
      intencao: 'entrar',
      retorno: 'https://atacante.example/pega',
    });
    await expect(conferirEstado(token)).rejects.toThrow();
  });
});

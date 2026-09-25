import { describe, expect, it } from 'vitest';
import { ROTA_INICIAL, escreverRota, lerRota, type Rota } from './rotas.js';

const G = '359457146259185664';
const C = '359457146259185665';

describe('lerRota', () => {
  it('hash vazio ou so a cerquilha e o inicio', () => {
    expect(lerRota('')).toEqual(ROTA_INICIAL);
    expect(lerRota('#')).toEqual(ROTA_INICIAL);
    expect(lerRota('#/')).toEqual(ROTA_INICIAL);
  });

  it('servidor com e sem canal', () => {
    expect(lerRota(`#/s/${G}`)).toEqual({ tela: 'servidor', guildId: G, canalId: null });
    expect(lerRota(`#/s/${G}/${C}`)).toEqual({ tela: 'servidor', guildId: G, canalId: C });
  });

  it('canal que nao e id vira servidor sem canal, e nao tela quebrada', () => {
    expect(lerRota(`#/s/${G}/geral`)).toEqual({ tela: 'servidor', guildId: G, canalId: null });
  });

  it('ajustes do servidor ficam dentro do servidor', () => {
    expect(lerRota(`#/s/${G}/ajustes/cargos`)).toEqual({
      tela: 'ajustes-servidor',
      guildId: G,
      pagina: 'cargos',
    });
    expect(lerRota(`#/s/${G}/ajustes/inventada`)).toEqual({
      tela: 'ajustes-servidor',
      guildId: G,
      pagina: 'visao-geral',
    });
  });

  it('pagina de ajuste desconhecida cai no perfil', () => {
    expect(lerRota('#/ajustes/voz-e-video')).toEqual({ tela: 'ajustes', pagina: 'voz-e-video' });
    expect(lerRota('#/ajustes/nao-existe')).toEqual({ tela: 'ajustes', pagina: 'perfil' });
    expect(lerRota('#/ajustes')).toEqual({ tela: 'ajustes', pagina: 'perfil' });
  });

  it('abas do inicio', () => {
    expect(lerRota('#/inicio/pendentes')).toEqual({ tela: 'inicio', aba: 'pendentes' });
    expect(lerRota('#/inicio/qualquer')).toEqual({ tela: 'inicio', aba: 'online' });
  });

  it('dm e convite validam o formato', () => {
    expect(lerRota(`#/dm/${C}`)).toEqual({ tela: 'dm', canalId: C });
    expect(lerRota('#/dm/abc')).toEqual(ROTA_INICIAL);
    expect(lerRota('#/convite/Ab3dEf9h')).toEqual({ tela: 'convite', codigo: 'Ab3dEf9h' });
    expect(lerRota('#/convite/curto')).toEqual(ROTA_INICIAL);
    expect(lerRota('#/convite/tem-hifen!')).toEqual(ROTA_INICIAL);
  });

  it('endereco desconhecido nunca deixa a tela em branco', () => {
    expect(lerRota('#/nada/disso')).toEqual(ROTA_INICIAL);
    expect(lerRota(`#/s/nao-e-id/${C}`)).toEqual(ROTA_INICIAL);
  });

  it('aceita barra sobrando e partes codificadas', () => {
    expect(lerRota(`#/s/${G}/${C}/`)).toEqual({ tela: 'servidor', guildId: G, canalId: C });
    expect(lerRota(`#/s/%33%35%39457146259185664`)).toEqual({
      tela: 'servidor',
      guildId: G,
      canalId: null,
    });
  });
});

describe('escreverRota', () => {
  const rotas: Rota[] = [
    { tela: 'inicio', aba: 'online' },
    { tela: 'inicio', aba: 'bloqueados' },
    { tela: 'dm', canalId: C },
    { tela: 'servidor', guildId: G, canalId: null },
    { tela: 'servidor', guildId: G, canalId: C },
    { tela: 'ajustes', pagina: 'notificacoes' },
    { tela: 'ajustes-servidor', guildId: G, pagina: 'membros' },
    { tela: 'convite', codigo: 'Ab3dEf9h' },
  ];

  it.each(rotas)('ida e volta: %o', (rota) => {
    expect(lerRota(escreverRota(rota))).toEqual(rota);
  });

  it('o inicio padrao tem o endereco mais curto', () => {
    expect(escreverRota(ROTA_INICIAL)).toBe('#/inicio');
  });
});

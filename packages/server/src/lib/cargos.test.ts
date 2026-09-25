import { describe, expect, it } from 'vitest';
import { cargoMaisAlto, reordenarCargos, type CargoNaOrdem } from './cargos.js';

const G = 'g';
// De baixo para cima: E(1) D(2) C(3) B(4) A(5), e o everyone em 0.
const atuais: CargoNaOrdem[] = [
  { id: G, position: 0 },
  { id: 'E', position: 1 },
  { id: 'D', position: 2 },
  { id: 'C', position: 3 },
  { id: 'B', position: 4 },
  { id: 'A', position: 5 },
];
const dono = { dono: true } as const;
const autorC = { dono: false, topoDoAutor: 'C' } as const;

function ordem(resultado: ReturnType<typeof reordenarCargos>): string[] {
  if (!resultado.ok) throw new Error(resultado.motivo);
  return [...resultado.posicoes].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

describe('reordenarCargos', () => {
  it('o dono pode mandar qualquer ordem', () => {
    const r = reordenarCargos(atuais, [{ id: 'E', position: 9 }], G, dono);
    expect(ordem(r)).toEqual(['D', 'C', 'B', 'A', 'E']);
  });

  it('renumera de 1 em diante, sem buracos nem repetidos', () => {
    const esparsos = [{ id: G, position: 0 }, { id: 'X', position: 7 }, { id: 'Y', position: 7 }, { id: 'Z', position: 40 }];
    const r = reordenarCargos(esparsos, [], G, dono);
    expect(r.ok && [...r.posicoes.values()].sort()).toEqual([1, 2, 3]);
  });

  it('abaixo do proprio topo, quem tem o cargo C troca D e E', () => {
    const r = reordenarCargos(atuais, [{ id: 'D', position: 1 }, { id: 'E', position: 2 }], G, autorC);
    expect(ordem(r)).toEqual(['D', 'E', 'C', 'B', 'A']);
  });

  it('a lista inteira renumerada nao conta como mexer nos cargos de cima', () => {
    const acima = [{ id: G, position: 0 }, { id: 'E', position: 1 }, { id: 'D', position: 2 }, { id: 'C', position: 3 }, { id: 'B', position: 7 }, { id: 'A', position: 9 }];
    const pedido = [
      { id: 'A', position: 5 },
      { id: 'B', position: 4 },
      { id: 'C', position: 3 },
      { id: 'E', position: 2 },
      { id: 'D', position: 1 },
    ];
    expect(ordem(reordenarCargos(acima, pedido, G, autorC))).toEqual(['D', 'E', 'C', 'B', 'A']);
  });

  it('nao sobe um cargo acima do proprio topo', () => {
    const r = reordenarCargos(atuais, [{ id: 'E', position: 4 }], G, autorC);
    expect(r).toEqual({ ok: false, motivo: 'HIERARQUIA' });
  });

  it('nao mexe no proprio cargo mais alto', () => {
    const r = reordenarCargos(atuais, [{ id: 'C', position: 1 }], G, autorC);
    expect(r).toEqual({ ok: false, motivo: 'HIERARQUIA' });
  });

  it('nao mexe num cargo acima, nem para baixo', () => {
    const r = reordenarCargos(atuais, [{ id: 'A', position: 0 }], G, autorC);
    expect(r).toEqual({ ok: false, motivo: 'HIERARQUIA' });
  });

  it('quem so tem o everyone nao reordena nada', () => {
    const r = reordenarCargos(atuais, [{ id: 'D', position: 1 }, { id: 'E', position: 2 }], G, { dono: false, topoDoAutor: null });
    expect(r).toEqual({ ok: false, motivo: 'HIERARQUIA' });
  });

  it('um pedido que nao muda nada passa, ate para quem so tem o everyone', () => {
    const r = reordenarCargos(atuais, [{ id: 'A', position: 5 }], G, { dono: false, topoDoAutor: null });
    expect(r.ok).toBe(true);
  });

  it('recusa o everyone, id repetido e cargo de fora', () => {
    expect(reordenarCargos(atuais, [{ id: G, position: 3 }], G, dono)).toEqual({ ok: false, motivo: 'EVERYONE' });
    expect(
      reordenarCargos(atuais, [{ id: 'A', position: 1 }, { id: 'A', position: 2 }], G, dono),
    ).toEqual({ ok: false, motivo: 'REPETIDO' });
    expect(reordenarCargos(atuais, [{ id: 'Q', position: 1 }], G, dono)).toEqual({ ok: false, motivo: 'DESCONHECIDO' });
  });
});

describe('cargoMaisAlto', () => {
  it('ignora o everyone', () => {
    expect(cargoMaisAlto([{ id: G, position: 0 }], G)).toBeNull();
    expect(cargoMaisAlto(atuais, G)).toBe('A');
  });
});

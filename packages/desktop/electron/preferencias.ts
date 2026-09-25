import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcaoDeAtalho, Atalho, PreferenciasDoApp } from './preload.js';

/**
 * As preferencias que o processo principal precisa ler sozinho, sem a
 * interface aberta: fechar para a bandeja, abrir escondido e os atalhos
 * globais. Num JSON na pasta de dados do app, e nao no localStorage da
 * interface — a janela pode nem ter carregado quando a pessoa aperta a tecla
 * de falar ou fecha o app.
 */

/** Os do Discord: Ctrl+Shift+M muta, Ctrl+Shift+D ensurdece. Falar nao tem padrao. */
const ATALHOS_PADRAO: Record<AcaoDeAtalho, Atalho | null> = {
  falar: null,
  mutar: { tipo: 'tecla', codigo: 'KeyM', ctrl: true, shift: true, alt: false, meta: false },
  ensurdecer: { tipo: 'tecla', codigo: 'KeyD', ctrl: true, shift: true, alt: false, meta: false },
};

const PADRAO: PreferenciasDoApp = {
  fecharParaBandeja: true,
  iniciarEscondido: true,
  atalhos: ATALHOS_PADRAO,
};

let atuais: PreferenciasDoApp | null = null;

const arquivo = (): string => join(app.getPath('userData'), 'preferencias.json');

export function lerPreferencias(): PreferenciasDoApp {
  if (atuais) return atuais;
  try {
    const salvas = JSON.parse(readFileSync(arquivo(), 'utf8')) as Partial<PreferenciasDoApp>;
    atuais = {
      fecharParaBandeja: typeof salvas.fecharParaBandeja === 'boolean' ? salvas.fecharParaBandeja : PADRAO.fecharParaBandeja,
      iniciarEscondido: typeof salvas.iniciarEscondido === 'boolean' ? salvas.iniciarEscondido : PADRAO.iniciarEscondido,
      atalhos: { ...ATALHOS_PADRAO, ...(salvas.atalhos ?? {}) },
    };
  } catch {
    // Sem arquivo (primeira vez) ou estragado: o padrao, sem quebrar a abertura.
    atuais = PADRAO;
  }
  return atuais;
}

export function gravarPreferencias(patch: Partial<PreferenciasDoApp>): PreferenciasDoApp {
  const antes = lerPreferencias();
  atuais = {
    ...antes,
    ...patch,
    atalhos: { ...antes.atalhos, ...(patch.atalhos ?? {}) },
  };
  try {
    writeFileSync(arquivo(), JSON.stringify(atuais, null, 2));
  } catch {
    // Disco cheio ou sem permissao: vale ate fechar o app, e nada quebra.
  }
  return atuais;
}

/**
 * A primeira vez que o app abre nesta pasta de dados. Marca na hora: a
 * pergunta so pode ter "sim" como resposta uma vez.
 */
export function primeiraExecucao(): boolean {
  const marca = join(app.getPath('userData'), 'primeira-execucao.ok');
  if (existsSync(marca)) return false;
  try {
    writeFileSync(marca, new Date().toISOString());
  } catch {
    return false;
  }
  return true;
}

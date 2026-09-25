// Empacota o Kiroshi Beta: o canal de teste, como app separado (outra
// identidade no Windows, outro canal de atualizacao). Desde a 2.0.0 a interface
// e a mesma do normal: o Beta recebe cada mudanca antes de todo mundo.
//
//   npm run dist:beta      instalador em release-beta/
//   npm run dist:beta:dir  so a pasta win-unpacked (mais rapido, para testar)
//
// Em Node, e nao numa linha de package.json, porque VITE_INTERFACE=nova na
// frente do comando nao funciona no cmd do Windows.
//
// Atencao: out/ e o mesmo do build normal. Depois disto, `npx electron
// out/main/index.js` abre a interface nova; o dist:win e o dist:dir normais
// recompilam antes de empacotar, entao nao herdam nada daqui.
import { execSync } from 'node:child_process';

/*
  A versao do Beta: 1.16 e o numero de commits. Cresce sozinha a cada commit,
  e e isso que a atualizacao automatica compara — com todo Beta saindo como
  1.15.0, o instalado nunca via o novo. Nao conflita com o Kiroshi normal: e
  outro app, com outro canal (/baixar/beta).
*/
const commits = execSync('git rev-list --count HEAD').toString().trim();
const versao = `1.16.${commits}`;

// KIROSHI_CANAL=beta: a identidade de Beta (appId, bandeja, notificacoes). A
// interface e a nova, a mesma do Kiroshi normal desde a 2.0.0.
const env = { ...process.env, VITE_INTERFACE: 'nova', KIROSHI_CANAL: 'beta', KIROSHI_VERSAO: versao };
const rodar = (comando) => execSync(comando, { stdio: 'inherit', env });

console.log(`Kiroshi Beta ${versao}`);
rodar('node scripts/baixar-modelos.mjs --verificar');
rodar('npx electron-vite build');
rodar(
  `npx electron-builder --config electron-builder.beta.yml --win${process.argv.includes('--dir') ? ' --dir' : ''} -c.extraMetadata.version=${versao} --publish never`,
);

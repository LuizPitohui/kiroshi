// Empacota o Kiroshi de todo mundo: a interface nova (desde a 2.0.0) com a
// identidade e o canal de atualizacao do Kiroshi normal (/baixar).
//
//   npm run dist:win   instalador em release/
//   npm run dist:dir   so a pasta win-unpacked (mais rapido, para testar)
//
// A versao e a do package.json: e ela que a atualizacao de quem ja tem o
// Kiroshi compara com a publicada.
//
// Em Node, e nao numa linha de package.json, porque variavel de ambiente na
// frente do comando nao funciona no cmd do Windows.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = { ...process.env, VITE_INTERFACE: 'nova', KIROSHI_CANAL: 'normal' };
delete env.KIROSHI_VERSAO;
const rodar = (comando) => execSync(comando, { stdio: 'inherit', env });

console.log(`Kiroshi ${version}`);
rodar('npx electron-vite build');
rodar(`npx electron-builder --win${process.argv.includes('--dir') ? ' --dir' : ''} --publish never`);

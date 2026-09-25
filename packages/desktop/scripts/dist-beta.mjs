// Empacota o Kiroshi Beta: a interface nova, como app separado.
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

const env = { ...process.env, VITE_INTERFACE: 'nova' };
const rodar = (comando) => execSync(comando, { stdio: 'inherit', env });

rodar('node scripts/baixar-modelos.mjs --verificar');
rodar('npx electron-vite build');
rodar(
  `npx electron-builder --config electron-builder.beta.yml --win${process.argv.includes('--dir') ? ' --dir' : ''} --publish never`,
);

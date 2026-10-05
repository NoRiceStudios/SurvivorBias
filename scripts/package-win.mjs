// Packages the built game as a portable Windows x64 folder + zip in release/.
import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const stage = 'release/stage';
rmSync('release', { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync('dist', `${stage}/dist`, { recursive: true });
writeFileSync(`${stage}/package.json`, JSON.stringify({ name: 'survivor-bias', productName: 'Survivor Bias', version: '0.1.0', main: 'dist/electron/main.js' }, null, 2));
const [dir] = await packager({ dir: stage, out: 'release', platform: 'win32', arch: 'x64', name: 'SurvivorBias', overwrite: true, asar: true, appCopyright: 'NoRiceStudios' });
execSync(`cd release && zip -qr SurvivorBias-win32-x64.zip ${dir.split('/').pop()}`);
console.log('packaged', dir, '-> release/SurvivorBias-win32-x64.zip');

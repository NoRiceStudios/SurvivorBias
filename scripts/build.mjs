// Bundles the renderer (browser) and Electron main process with esbuild.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/renderer/fonts`, { recursive: true });

await build({
  entryPoints: { app: 'src/ui/main.ts', gallery: 'src/ui/gallery.ts' },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: `${out}/renderer`,
  sourcemap: true,
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/electron/main.ts', 'src/electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: `${out}/electron`,
  external: ['electron'],
  logLevel: 'warning',
});

cpSync('src/ui/index.html', `${out}/renderer/index.html`);
cpSync('src/ui/gallery.html', `${out}/renderer/gallery.html`);
cpSync('src/ui/style.css', `${out}/renderer/style.css`);
const fonts = [
  ['@fontsource/vt323/files/vt323-latin-400-normal.woff2', 'vt323.woff2'],
  ['@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2', 'silkscreen.woff2'],
  ['@fontsource/silkscreen/files/silkscreen-latin-700-normal.woff2', 'silkscreen-bold.woff2'],
  ['@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff2', 'pixelify.woff2'],
  ['@fontsource/pixelify-sans/files/pixelify-sans-latin-700-normal.woff2', 'pixelify-bold.woff2'],
];
for (const [src, dst] of fonts) cpSync(`node_modules/${src}`, `${out}/renderer/fonts/${dst}`);
console.log('build ok');

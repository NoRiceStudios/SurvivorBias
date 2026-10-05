// Quick screenshot of a built page: node scripts/shot.mjs gallery.html out.png [w] [h] [script-to-eval]
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
const [page = 'index.html', out = 'screenshots/shot.png', w = '1280', h = '800', evalJs] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto('file://' + resolve('dist/renderer', page));
await p.waitForTimeout(300);
if (evalJs) { await p.evaluate(evalJs); await p.waitForTimeout(300); }
await p.screenshot({ path: out });
if (errors.length) console.log('ERRORS:', errors.join('\n'));
await browser.close();
console.log('saved', out);

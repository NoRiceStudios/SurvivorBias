// Drives the real UI in Chromium through every screen and saves screenshots.
// Usage: node scripts/screenshots.mjs [outdir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + resolve('dist/renderer/index.html'));
await page.waitForTimeout(800);
const shot = async (name) => { await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
await shot('01-title');

await page.evaluate(() => window.sb.newGame('single', 0.4));
const tabs = ['briefing', 'operations', 'squadrons', 'hangar', 'factory', 'training', 'research', 'intel'];
for (const [i, t] of tabs.entries()) {
  await page.evaluate((tab) => window.sb.go({ kind: 'hq', side: 0, tab }), t);
  await shot(`1${i}-hq-${t}`);
}
// Fly a few weeks so the debrief has history.
for (let k = 0; k < 3; k++) await page.evaluate(() => window.sb.launch(0));
await page.evaluate(() => window.sb.launch(0));
await page.waitForTimeout(6000);
await shot('20-radio');
const dtabs = ['aircraft', 'reports', 'missing', 'home'];
for (const [i, t] of dtabs.entries()) {
  await page.evaluate((tab) => window.sb.go({ kind: 'debrief', side: 0, tab }), t);
  await shot(`3${i}-debrief-${t}`);
}
await page.evaluate(() => window.sb.go({ kind: 'hq', side: 0, tab: 'hangar' }));
await shot('40-hangar-after');
// Play to the end.
await page.evaluate(async () => { let g = 0; while (!window.sb.state.outcome && g++ < 40) await window.sb.launch(0); });
for (const t of ['summary', 'archive', 'ledger']) {
  await page.evaluate((tab) => window.sb.go({ kind: 'end', side: 0, tab }), t);
  await shot(`5-end-${t}`);
}
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();

// Screenshots of the newspaper and the prisoners' interrogations.
// Usage: node scripts/press-shots.mjs [outdir]   (after npm run build)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1366), height: Number(process.env.H ?? 820) } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + resolve('dist/renderer/index.html'));
await page.waitForTimeout(600);
const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
await page.evaluate(() => window.sb.newGame('single', 0.4));
// Fly until a week brings prisoners in.
const week = await page.evaluate(async () => {
  for (let g = 0; g < 30 && !window.sb.state.outcome; g++) {
    const sb = window.sb;
    sb.fitToStores(0);
    await sb.launch(0);
    const d = sb.state.lastDebriefs[0];
    if ((sb.state.sides[0].prisoners ?? []).some((p) => p.week === d.turn)) return d.turn;
  }
  return -1;
});
console.log('prisoners in week', week);
await page.evaluate(() => window.sb.go({ kind: 'debrief', side: 0, tab: 'prisoners' }));
await shot('p1-debrief-prisoners');
await page.evaluate(() => window.sb.fileReports(0));
await shot('p2-letter');
await page.evaluate(() => window.sb.afterLetter(0));
await shot('p3-paper');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => { window.sb.go({ kind: 'hq', side: 0, tab: 'war' }); document.querySelectorAll('.tray-tab').forEach((b) => { if (b.textContent.startsWith('Press')) b.click(); }); });
await shot('p4-intray-press');
await page.evaluate(() => window.sb.go({ kind: 'hq', side: 0, tab: 'intel' }));
await page.evaluate(() => document.querySelector('.pow-file')?.scrollIntoView());
await shot('p5-intel-file');
// Play to the end.
await page.evaluate(async () => {
  let g = 0;
  while (!window.sb.state.outcome && g++ < 60) {
    const w = window.sb.state.turn;
    await (window.sb.fitToStores(0), window.sb.launch(0));
    if (window.sb.state.turn === w && !window.sb.state.outcome) window.sb.plans[0].raid = null;
  }
  window.sb.go({ kind: 'end', side: 0, tab: 'papers' });
});
await shot('p6-end-papers');
await page.evaluate(() => { window.sb.go({ kind: 'end', side: 0, tab: 'archive' }); document.querySelector('.pow-archive')?.scrollIntoView(); });
await shot('p7-end-prisoners');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();

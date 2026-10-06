// Walks through the whole tutorial in Chromium, doing what each step asks.
// Usage: npm run build && node scripts/tutorial-smoke.mjs
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('file://' + resolve('dist/renderer/index.html'));
await p.waitForTimeout(500);
await p.click('text=Tutorial');
await p.waitForTimeout(300);

const seen = [];
for (let i = 0; i < 60; i++) {
  const card = await p.$('#tutorial');
  const active = await p.evaluate(() => window.sb.state?.tutorial !== undefined);
  if (!active) break;
  if (!card) {
    // The step belongs to another screen: move the game along the way a player would.
    await p.evaluate(() => {
      const sb = window.sb;
      if (sb.screen.kind === 'radio') sb.go({ kind: 'debrief', side: 0, tab: 'aircraft' });
    });
    await p.waitForTimeout(150);
    continue;
  }
  const title = await card.$eval('h3', (e) => e.textContent);
  if (seen[seen.length - 1] !== title) {
    seen.push(title);
    if ([1, 5, 9, 18].includes(seen.length)) await p.screenshot({ path: `screenshots/t${String(seen.length).padStart(2, '0')}-tutorial.png` });
  }
  const next = await card.$('button.primary');
  if (next) {
    await next.click();
  } else {
    // A "do it" step: click what it points at, or launch / file reports.
    const target = await p.$('.tut-target');
    const tag = target ? await target.evaluate((e) => e.getAttribute('data-tab') ?? e.className) : '';
    if (tag.includes('launch')) await p.evaluate(() => { window.sb.fitToStores(0); return window.sb.launch(0); });
    else if (target && /^[a-z]+$/.test(tag)) await target.click();
    else await p.evaluate(() => {
      const sb = window.sb;
      if (sb.screen.kind === 'radio') sb.go({ kind: 'debrief', side: 0, tab: 'aircraft' });
      else if (sb.screen.kind === 'debrief') sb.afterDebrief(0);
    });
  }
  await p.waitForTimeout(150);
}
const finished = await p.evaluate(() => window.sb.state?.tutorial === undefined);
console.log(`steps seen: ${seen.length}\n  ${seen.join('\n  ')}`);
if (!finished) errors.push('tutorial did not finish');
if (seen.length < 15) errors.push(`only ${seen.length} steps were shown`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await b.close();
process.exit(errors.length ? 1 : 0);

// Plays a hotseat campaign through the real UI (both commanders) and reports page errors.
// Usage: npm run build && node scripts/hotseat-smoke.mjs
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file://' + resolve('dist/renderer/index.html'));
const out = await p.evaluate(async () => {
  const sb = window.sb; sb.newGame('hotseat');
  const screens = [];
  for (let w = 0; w < 25 && !sb.state.outcome; w++) {
    await sb.launch(0); screens.push(sb.screen.kind);
    await sb.launch(1);
    for (const side of [0, 1]) {
      sb.afterDebrief(side); screens.push(sb.screen.kind);
      if (sb.screen.kind === 'theater') { sb.continueAfterTheater(); screens.push('after:' + sb.screen.kind); }
    }
  }
  return { turn: sb.state.turn, theater: sb.state.theater.index, results: sb.state.theaterResults.map((r) => r.winner), screens: [...new Set(screens)] };
});
console.log(JSON.stringify(out), errs.length ? 'ERRORS ' + errs.join('|') : 'no errors');
await b.close();

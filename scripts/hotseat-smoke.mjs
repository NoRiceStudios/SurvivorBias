// Plays a hotseat campaign through the real UI (both commanders), exercising
// feints, sealed orders across a save/load, the privacy cover, theater changes
// and the end-of-war diaries. Saves screenshots and reports page errors.
// Usage: npm run build && node scripts/hotseat-smoke.mjs [outdir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file://' + resolve('dist/renderer/index.html'));
await p.waitForTimeout(500);
const shot = async (name) => { await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${name}.png` }); };
const check = (cond, msg) => { if (!cond) { errs.push('CHECK FAILED: ' + msg); } };

// Setup screen with commander names.
await p.click('text=Two Commanders (Hotseat)');
await p.fill('.name-input >> nth=0', 'Cdre Ashworth');
await p.fill('.name-input >> nth=1', 'Oberst Voigt');
await shot('h0-setup');
await p.click('text=Begin the war');
await shot('h1-handover');
check(await p.isVisible('text=Cdre Ashworth'), 'handover names the first commander');
await p.click('text=Open the folder');

// Commander 1 plans a feint with a spare fighter squadron.
await p.evaluate(() => {
  const sb = window.sb;
  const side = sb.state.sides[0];
  const plan = sb.plans[0];
  const spare = side.squadrons.find((q) => q.kind === 'fighter' && !plan.defense.includes(q.id) && !plan.raid.squadronIds.includes(q.id))
    ?? side.squadrons.find((q) => q.kind === 'fighter' && plan.raid.squadronIds.includes(q.id));
  plan.raid.squadronIds = plan.raid.squadronIds.filter((id) => id !== spare.id);
  const main = sb.state.theater.sites.find((x) => x.id === plan.raid.siteId).sector;
  plan.feint = { squadronIds: [spare.id], sector: main === 3 ? 4 : 3 };
  sb.go({ kind: 'hq', side: 0, tab: 'operations' });
});
await shot('h2-operations-feint');
await p.keyboard.press('Escape');
await shot('h3-cover');
check(await p.isVisible('#cover'), 'Esc closes the folder');
await p.keyboard.press('Escape');
check(!(await p.isVisible('#cover')), 'Esc opens the folder again');

// Seal orders, then save and reload: the game must resume with commander 2.
await p.evaluate(() => (window.sb.fitToStores(0), window.sb.launch(0)));
await p.waitForTimeout(200);
const resumed = await p.evaluate(async () => {
  const sb = window.sb;
  const sealed = !!sb.state.sealed[0];
  sb.state = null;
  await sb.loadSlot('autosave');
  return { sealed, screen: sb.screen.kind, side: sb.screen.side, feint: !!sb.state.sealed[0]?.feint };
});
check(resumed.sealed && resumed.screen === 'handover' && resumed.side === 1 && resumed.feint, `resume after sealing: ${JSON.stringify(resumed)}`);
await shot('h4-handover-sealed');
await p.click('text=Open the folder');
await p.evaluate(() => (window.sb.fitToStores(1), window.sb.launch(1)));
await p.waitForTimeout(300);
await p.click('text=Open the folder');
await p.evaluate(() => window.sb.go({ kind: 'debrief', side: 0, tab: 'home' }));
await shot('h5-debrief-home');
await p.evaluate(() => { window.sb.afterDebrief(0); });
await p.evaluate(() => window.sb.go({ kind: 'debrief', side: 1, tab: 'home' }));
await shot('h6-debrief-home-side1');

// Play on to the end of the war.
const result = await p.evaluate(async () => {
  const sb = window.sb;
  sb.afterDebrief(1);
  const screens = new Set();
  for (let w = 0; w < 40 && !sb.state.outcome; w++) {
    await (sb.fitToStores(0), sb.launch(0)); screens.add(sb.screen.kind);
    await (sb.fitToStores(1), sb.launch(1));
    for (const side of [0, 1]) {
      sb.afterDebrief(side); screens.add(sb.screen.kind);
      if (sb.screen.kind === 'theater') { sb.continueAfterTheater(); screens.add('after:' + sb.screen.kind); }
    }
  }
  sb.go({ kind: 'end', side: 0, tab: 'diaries' });
  return { turn: sb.state.turn, outcome: sb.state.outcome, theaters: sb.state.theaterResults.map((r) => r.winner), screens: [...screens] };
});
await shot('h7-end-diaries');
check(!!result.outcome, 'campaign reached an outcome');
console.log(JSON.stringify(result));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await b.close();
process.exit(errs.length ? 1 : 0);

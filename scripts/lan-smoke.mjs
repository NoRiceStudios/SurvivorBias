// End-to-end LAN test: two Electron instances on this machine, one hosting and
// one joining over TCP. Plays several weeks, checks the joining player sees no
// hidden information, that their commands reach the host, and that a client
// can drop out after sealing and rejoin.
// Usage: npm run build && xvfb-run -a node scripts/lan-smoke.mjs
import { _electron as electron } from 'playwright-core';

const PORT = 41999;
const errors = [];
const exe = './node_modules/electron/dist/electron';
const check = (cond, msg) => { if (!cond) errors.push('CHECK FAILED: ' + msg); else console.log('ok  ' + msg); };

async function open(label) {
  const app = await electron.launch({ args: ['--no-sandbox', '.'], executablePath: exe });
  const w = await app.firstWindow();
  w.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  await w.waitForTimeout(800);
  return { app, w };
}
async function waitFor(w, fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await w.evaluate(fn)) return true;
    await w.waitForTimeout(150);
  }
  errors.push(`timeout waiting for ${what}`);
  return false;
}
const screen = (w) => w.evaluate(() => window.sb.screen.kind);

// Host through the real setup screen.
const host = await open('host');
await host.w.evaluate(() => window.sb.go({ kind: 'lanSetup' }));
const hostForm = host.w.locator('.lan-forms .col').nth(0);
await hostForm.locator('input').nth(0).fill('Cdre Ashworth');
await hostForm.locator('input').nth(1).fill(String(PORT));
await hostForm.locator('button.lan-go').click();
await waitFor(host.w, () => ['hq', 'letter'].includes(window.sb.screen.kind), 'host briefing');

// Join through the real setup screen.
let client = await open('client');
async function join(c) {
  await c.w.evaluate(() => window.sb.go({ kind: 'lanSetup' }));
  const form = c.w.locator('.lan-forms .col').nth(1);
  await form.locator('input').nth(0).fill('Oberst Voigt');
  await form.locator('input').nth(1).fill('127.0.0.1');
  await form.locator('input').nth(2).fill(String(PORT));
  await form.locator('button.lan-go').click();
}
await join(client);
await waitFor(client.w, () => window.sb.state && window.sb.lanSide === 1 && ['hq', 'lanWait', 'letter'].includes(window.sb.screen.kind), 'client briefing');
await waitFor(host.w, () => window.sb.state.sides[1].commander === 'Oberst Voigt', 'host learns the opponent name');
await client.w.screenshot({ path: 'screenshots/lan-client-briefing.png' });
await host.w.screenshot({ path: 'screenshots/lan-host-briefing.png' });

// The joining player sees nothing of the enemy wing or the hidden truth.
const leak = await client.w.evaluate(() => {
  const s = window.sb.state;
  return { enemySq: s.sides[0].squadrons.length, leth: s.lethality.medium.cockpit, rng: s.rng.s, own: s.sides[1].squadrons.length };
});
check(leak.enemySq === 0 && leak.leth === 0 && leak.rng === 0 && leak.own > 0, `client view is redacted (${JSON.stringify(leak)})`);

// A management command made by the client reaches the host when orders are sealed.
await client.w.evaluate(() => window.sb.cmd(1, { k: 'focus', v: 'gunnery' }));
async function week(order) {
  for (const who of order) {
    const c = who === 'host' ? host : client;
    await c.w.evaluate((side) => (window.sb.fitToStores(side), window.sb.launch(side)), who === 'host' ? 0 : 1);
  }
  await waitFor(host.w, () => window.sb.screen.kind === 'radio', 'host radio');
  await waitFor(client.w, () => window.sb.screen.kind === 'radio', 'client radio');
  for (const [c, side] of [[host, 0], [client, 1]]) {
    await c.w.evaluate((s) => {
      window.sb.go({ kind: 'debrief', side: s, tab: 'aircraft' });
      window.sb.afterDebrief(s);
      if (window.sb.screen.kind === 'theater') window.sb.continueAfterTheater();
    }, side);
  }
}
await week(['client', 'host']);
check(await host.w.evaluate(() => window.sb.state.sides[1].training.focus === 'gunnery'), 'client command replayed on the host');
check(await client.w.evaluate(() => window.sb.state.sides[1].training.focus === 'gunnery'), 'client keeps its own change after results');
await client.w.evaluate(() => window.sb.go({ kind: 'debrief', side: 1, tab: 'reports' }));
await client.w.screenshot({ path: 'screenshots/lan-client-debrief.png' });
await client.w.evaluate(() => window.sb.go({ kind: 'hq', side: 1, tab: 'briefing' }));
// Sealed orders can be taken back and amended, on either side, until the week is fought.
// Commands sent with the first seal must not be replayed twice on the host.
const queued = await host.w.evaluate(() => window.sb.state.sides[1].factory.queue.length);
await client.w.evaluate(() => { window.sb.state.sides[1].resources.supplies += 200; window.sb.cmd(1, { k: 'build', kind: 'fighter' }); });
await host.w.evaluate(() => { window.sb.state.sides[1].resources.supplies += 200; });
await client.w.evaluate(() => (window.sb.fitToStores(1), window.sb.launch(1)));
await waitFor(host.w, () => !!window.sb.state.sealed[1], 'host holds the first seal');
check(await client.w.evaluate(() => window.sb.screen.kind === 'lanWait' && !!document.querySelector('.orders-table')), 'client sees an overview of its sealed orders');
await client.w.screenshot({ path: 'screenshots/lan-client-sealed.png' });
await client.w.click('text=Amend orders');
await waitFor(client.w, () => window.sb.screen.kind === 'hq', 'client gets its orders back');
check(await host.w.evaluate(() => !window.sb.state.sealed[1]), 'host released the client orders');
await client.w.evaluate(() => window.sb.cmd(1, { k: 'build', kind: 'fighter' }));
await client.w.evaluate(() => (window.sb.fitToStores(1), window.sb.launch(1)));
await waitFor(host.w, () => !!window.sb.state.sealed[1], 'host holds the second seal');
check(await host.w.evaluate((q) => window.sb.state.sides[1].factory.queue.length === q + 2, queued), 'each client command applied exactly once');
await host.w.evaluate(() => (window.sb.fitToStores(0), window.sb.launch(0)));
await waitFor(client.w, () => window.sb.screen.kind === 'radio', 'week fought after the amended seal');
for (const [c, side] of [[host, 0], [client, 1]]) {
  await c.w.evaluate((s) => { window.sb.afterDebrief(s); if (window.sb.screen.kind === 'theater') window.sb.continueAfterTheater(); }, side);
}
// The host seals, then thinks better of it.
await host.w.evaluate(() => (window.sb.fitToStores(0), window.sb.launch(0)));
await waitFor(client.w, () => window.sb.lan.opponentSealed, 'client told the host sealed');
await host.w.click('text=Amend orders');
await waitFor(client.w, () => !window.sb.lan.opponentSealed, 'client told the host reopened its orders');
check(await host.w.evaluate(() => window.sb.screen.kind === 'hq' && !window.sb.state.sealed[0]), 'host amends its own orders');
await week(['host', 'client']);

for (let i = 0; i < 4; i++) await week(i % 2 ? ['host', 'client'] : ['client', 'host']);
const turns = await Promise.all([host.w.evaluate(() => window.sb.state.turn), client.w.evaluate(() => window.sb.state.turn)]);
check(turns[0] === turns[1] && turns[0] >= 8, `both commanders are in the same week (${turns.join(' / ')})`);

// The client seals, drops out, and rejoins: its orders are safe with the host.
await client.w.evaluate(() => (window.sb.fitToStores(1), window.sb.launch(1)));
await waitFor(host.w, () => !!window.sb.state.sealed[1], 'host holds sealed client orders');
await client.app.close();
await host.w.waitForTimeout(500);
client = await open('client2');
await join(client);
await waitFor(client.w, () => window.sb.screen.kind === 'lanWait', 'rejoined client waits on its sealed orders');
await host.w.evaluate(() => (window.sb.fitToStores(0), window.sb.launch(0)));
await waitFor(client.w, () => window.sb.screen.kind === 'radio', 'rejoined client receives the results');
await host.w.screenshot({ path: 'screenshots/lan-host-radio.png' });

await host.app.close();
await client.app.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
process.exit(errors.length ? 1 : 0);

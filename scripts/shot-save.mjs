// Renders a screen of the real UI from a play.ts save file.
// Usage: node scripts/shot-save.mjs <save.json> <screen> <out.png> [squadronId]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [file, screen, out, sqId] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const save = JSON.parse(readFileSync(file, 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
await p.goto('file://' + resolve(root, 'dist/renderer/index.html'));
await p.waitForTimeout(400);
await p.evaluate(({ state, plan, screen, sqId }) => {
  const sb = window.sb;
  if (screen === 'title') return;
  sb.state = JSON.parse(state);
  sb.plans = [plan, plan];
  if (sqId) sb.selected = sqId;
  const [kind, tab] = screen.split('-');
  if (kind === 'radio') sb.go({ kind: 'radio', side: 0 });
  else if (kind === 'debrief') sb.go({ kind: 'debrief', side: 0, tab: tab ?? 'aircraft' });
  else if (kind === 'end') sb.go({ kind: 'end', side: 0, tab: tab ?? 'summary' });
  else sb.go({ kind: 'hq', side: 0, tab: kind });
}, { state: save.state, plan: save.plan, screen, sqId });
await p.waitForTimeout(screen === 'radio' ? 9000 : 500);
await p.screenshot({ path: out });
await b.close();

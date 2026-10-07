/**
 * High Command's letter, in full screen: the answer to the week's returns and
 * the week's weighty memos on one sheet of paper, typed out quickly (a click
 * finishes the typing), with the change in confidence stamped at the foot and
 * one button to acknowledge it.
 */
import type { SideId } from '../core/types';
import type { App } from './app';
import { sfxKey, sfxStamp } from './audio';
import { h } from './dom';
import { HIGH_COMMAND, memoDispatch, portraitCanvas, type DispatchLine } from './general';
import { strikeAt } from './warroom';

export function renderLetter(app: App, sideId: SideId, mode: 'returns' | 'week'): HTMLElement {
  const st = app.state!;
  const side = st.sides[sideId];
  const hc = HIGH_COMMAND[sideId];
  const d = mode === 'returns' ? st.lastDebriefs[sideId] : null;
  const memos: DispatchLine[] = memoDispatch(side, st.turn, 6)?.lines ?? [];
  const typed: HTMLElement[] = [];
  const para = (text: string, cls = 'typed') => {
    const p = h('p', { class: `letter-text ${cls}`, 'data-full': text });
    typed.push(p);
    return p;
  };
  const sections: HTMLElement[] = [];
  // The directives first, as one line each, with the way to act on them.
  const orders = side.orders.filter((o) => !o.done && o.deadline >= st.turn);
  if (orders.length && !st.outcome) {
    sections.push(h('div', { class: 'letter-orders' },
      h('div', { class: 'letter-kicker' }, 'You are to:'),
      orders.map((o) => {
        const site = o.siteId ? st.theater.sites.find((x) => x.id === o.siteId && x.owner !== sideId) : undefined;
        const current = site && app.plans[sideId].raid?.siteId === site.id;
        return h('div', { class: 'lo-row' }, h('b', null, o.text), h('span', { class: 'muted small' }, ` by week ${o.deadline}`),
          site && !current ? h('button', { class: 'btn small', onclick: (e: MouseEvent) => { e.stopPropagation(); strikeAt(app, side, site); } }, 'Make target ▸') : current ? h('span', { class: 'small good' }, ' ✓ target set') : null);
      })));
  }
  if (d) {
    sections.push(h('div', { class: 'letter-section' },
      h('div', { class: 'letter-meta' }, h('span', { class: 'stamp notice' }, 'SIGNAL'), h('span', null, `Re: your returns for week ${d.turn}`)),
      (d.hqResponse.length ? d.hqResponse : ['Returns acknowledged. No comment.']).map((x) => para(x))));
  }
  for (const m of memos) {
    const o = typeof m === 'string' ? { text: m } : m;
    // A directive is already in the "You are to" box.
    if (o.kind === 'order' && orders.some((x) => x.text === o.text)) continue;
    // Background (intelligence, notices) in a lighter hand than orders and praise or blame.
    const minor = o.kind === 'intel' || o.kind === 'notice';
    sections.push(h('div', { class: `letter-section ${o.kind ? `memo-${o.kind}` : ''} ${minor ? 'minor' : ''}` },
      h('div', { class: 'letter-meta' }, o.stamp ? h('span', { class: `stamp ${o.kind ?? ''}` }, o.stamp) : null, o.from ? h('span', null, o.from) : null),
      h('div', { class: 'letter-row' },
        o.portrait ? h('div', { class: `letter-photo ${o.mourning ? 'mourning' : ''}` }, o.portrait, o.caption ? h('div', { class: 'small' }, o.caption) : null) : null,
        para(o.text))));
  }
  if (!sections.length) sections.push(h('div', { class: 'letter-section' }, para('Nothing further this week.')));
  const before = d?.trustBefore;
  const delta = before === undefined ? 0 : side.trust - before;
  const ack = () => {
    sfxStamp();
    if (mode === 'returns') app.afterDebrief(sideId);
    else app.go({ kind: 'hq', side: sideId, tab: 'war' });
  };
  const btn = h('button', { class: 'btn primary launch', onclick: (e: MouseEvent) => { e.stopPropagation(); ack(); } }, mode === 'returns' && st.outcome ? 'The war is over ▸' : 'Acknowledged ▸');
  // Type out the paragraphs one after another; a click (or Enter) finishes them all.
  let done = false;
  const finish = () => {
    done = true;
    for (const p of typed) p.textContent = p.dataset.full ?? '';
  };
  const run = async () => {
    for (const p of typed) {
      const full = p.dataset.full ?? '';
      for (let k = 0; k <= full.length && !done; k += 3) {
        if (!p.isConnected) return;
        p.textContent = full.slice(0, k);
        if (k % 12 === 0) sfxKey();
        await new Promise((r) => setTimeout(r, 14));
      }
      p.textContent = full;
      if (done) return;
    }
    done = true;
  };
  setTimeout(() => void run(), 200);
  const onKey = (e: KeyboardEvent) => {
    if (!sheet.isConnected) return window.removeEventListener('keydown', onKey);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!done) finish();
      else { window.removeEventListener('keydown', onKey); ack(); }
    }
  };
  window.addEventListener('keydown', onKey);
  const sheet = h('div', { class: 'letter paper', onclick: () => { if (!done) finish(); } },
    h('div', { class: 'letter-head' },
      h('div', { class: 'letter-face' }, portraitCanvas('general', sideId, 3)),
      h('div', null,
        h('div', { class: 'letter-kicker' }, mode === 'returns' ? 'Signal from High Command' : 'From High Command'),
        h('h1', null, hc.name),
        h('div', { class: 'muted' }, `${hc.title} · to ${side.commander}, week ${mode === 'returns' && d ? d.turn : st.turn}`)),
      before !== undefined
        ? h('div', { class: `stamp big conf ${delta > 0 ? 'notice' : delta < 0 ? 'reprimand' : 'order'}` }, `CONFIDENCE ${side.trust}`, h('small', null, delta ? ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}` : ' ='))
        : null),
    h('div', { class: 'letter-body' }, sections),
    h('div', { class: 'letter-foot' },
      h('span', { class: 'muted small' }, mode === 'returns' ? 'High Command judges you on the returns you send, not on what happened.' : 'Directives are kept under Standing orders in the War Room.'),
      btn));
  return h('div', { class: 'letter-screen' }, sheet);
}

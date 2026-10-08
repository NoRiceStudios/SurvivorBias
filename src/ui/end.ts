import { nationAt } from './nation';
import { AIRCRAFT, ZONE_LABEL } from '../core/data';
import { KINDS } from '../core/lethality';
import { rulesOf } from '../core/factions';
import { SECTORS, THEATERS } from '../core/theaters';
import type { AircraftKind, GameState, Hit, Outcome, SideId, ZoneId } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick, sfxKey } from './audio';
import { countUp, h, plural } from './dom';
import { aircraftCanvas } from './sprites';
import { prisonerArchive } from './prisoners';
import { moodLabel } from '../core/press';

const OUTCOME_TEXT: Record<Outcome, [string, string]> = {
  victory: ['VICTORY', 'The enemy has asked for terms. The war is over, and you will be remembered as the commander who won it, whatever the archives say.'],
  pyrrhic: ['PYRRHIC VICTORY', 'The enemy is beaten. Almost nobody who flew with you in the first week is alive to see it.'],
  stalemate: ['ARMISTICE', 'Neither side could break the other. The line on the map is where it was. The cemeteries are not.'],
  relieved: ['RELIEVED OF COMMAND', 'The Air Council has lost confidence in your leadership. You are posted to a training command in the north.'],
  collapse: ['THE FRONT HAS COLLAPSED', 'Enemy armour is on the airfield perimeter. The wing is ordered to withdraw what it can.'],
  mutiny: ['THE CREWS WILL NOT FLY', 'Aircrews have refused to take off. The official term is "lack of moral fibre". The unofficial one is that they have done the arithmetic.'],
  grounded: ['GROUNDED', 'There is nothing left to fly and nothing left to build it with.'],
  defeat: ['DEFEAT', 'The enemy\'s industry outlasted ours. Terms are being discussed.'],
};

export function renderEnd(app: App, sideId: SideId, tab: string): HTMLElement {
  const st = app.state!;
  const outcome = st.outcome![sideId];
  const [title, text] = OUTCOME_TEXT[outcome];
  const other = (1 - sideId) as SideId;
  const nav = h('nav', { class: 'tabs' },
    [['summary', 'Outcome'], ['archive', 'Declassified'], ['ledger', 'The Ledger'], ...(st.sides[sideId].press?.papers.length ? [['papers', 'The Papers']] : []), ...(st.mode !== 'single' ? [['diaries', 'Both War Diaries']] : [])].map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, onclick: () => { sfxClick(); app.go({ kind: 'end', side: sideId, tab: id }); } }, label)),
    st.mode !== 'single' ? h('button', { class: 'tab', onclick: () => app.go({ kind: 'end', side: other, tab }) }, `View ${st.sides[other].short}`) : null,
    h('div', { class: 'tabs-spacer' }),
    h('div', { class: 'quiet-links' }, h('button', { class: 'quiet-link', onclick: () => { app.endLan(); app.go({ kind: 'title' }); } }, 'Leave')),
  );
  const trueLost = st.archive.reduce((a, e) => a + e.trueLosses[sideId], 0);
  const trueKills = st.archive.reduce((a, e) => a + e.trueKills[sideId], 0);
  const claimed = st.archive.reduce((a, e) => a + e.claimed[sideId], 0);
  const toHq = st.archive.reduce((a, e) => a + e.reportedToHq[sideId], 0);
  let body: HTMLElement;
  if (tab === 'archive') {
    const surv = st.archive.flatMap((e) => e.survivorHits[sideId]);
    const lost = st.archive.flatMap((e) => e.lostHits[sideId]);
    // Old saves have untagged hits: those were all bomber hits.
    const ofKind = (hits: Hit[], k: AircraftKind) => hits.filter((x) => (x.kind ?? 'medium') === k);
    const kinds = KINDS.filter((k) => ofKind(surv, k).length + ofKind(lost, k).length > 0);
    const NAMES: Record<AircraftKind, string> = { fighter: 'fighters', medium: 'medium bombers', heavy: 'heavy bombers', recon: 'reconnaissance aircraft' };
    body = h('div', { class: 'col' },
      kinds.map((k, i) => {
        const sv = ofKind(surv, k);
        const ls = ofKind(lost, k);
        const fatal = ls.filter((x) => x.lethal);
        // How this side's nation builds its aircraft changes the odds too (an armored seat, tanks that burn).
        const nat = rulesOf(st.sides[sideId]).lethality;
        const leth = Object.fromEntries(Object.entries(st.lethality[k]).map(([z, v]) => [z, v * (nat[z as ZoneId] ?? 1)])) as typeof st.lethality[typeof k];
        const maxL = Math.max(...Object.values(leth));
        const scale = k === 'heavy' ? 3 : k === 'medium' ? 4 : 5;
        return h('section', { class: 'paper panel declass' },
          i === 0 ? h('div', { class: 'stamp big declass-stamp' }, 'DECLASSIFIED') : null,
          h('h2', null, `Where our ${NAMES[k]} were hit — ${nationAt(sideId).aircraft[k]}`),
          h('div', { class: 'composite-row three' },
            h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: sv, dots: true }, scale)), h('figcaption', null, `What you saw: ${plural(sv.length, 'hole')} on aircraft that returned.`)),
            h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: ls, dots: true, dotColor: '#e3ebf2' }, scale)), h('figcaption', null, `What you never saw: ${plural(ls.length, 'hole')} on aircraft that did not return.`)),
            h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: fatal, dots: true, dotColor: '#ff3b30' }, scale)), h('figcaption', null, `The ${fatal.length} hits that brought them down.`)),
          ),
          h('h3', null, `This war's ${nationAt(sideId).aircraft[k]}: chance that one hit brings her down (unarmored)`),
          ZONES.map((z) => h('div', { class: 'bar-row' }, h('span', null, ZONE_LABEL[z]), h('span', { class: 'bar red' }, h('i', { style: `width:${Math.round((leth[z] / maxL) * 100)}%` })), h('span', null, `${Math.round(leth[z] * 100)}%`))),
        );
      }),
      h('section', { class: 'paper panel' },
        h('p', { class: 'handwritten' }, 'The holes in the returning aircraft show where an aircraft can be hit and still come home. Every type is different, and every war.'),
      ),
      prisonerArchive(app, sideId),
    );
  } else if (tab === 'papers') {
    body = papersArchive(st, sideId);
  } else if (tab === 'diaries') {
    const [a, b] = st.sides;
    const sum = (f: (e: (typeof st.archive)[number]) => number) => st.archive.reduce((x, e) => x + f(e), 0);
    body = h('div', { class: 'col' },
      h('section', { class: 'paper panel' },
        h('h2', null, 'Two war diaries, one war'),
        h('p', null, `${a.commander} (${a.short}) and ${b.commander} (${b.short}) each fought the war they were told about. Here is what each was told, next to what happened.`),
        h('div', { class: 'stats diaries-totals' },
          h('div', null, h('span', null, `${a.short} crews claimed`), h('b', null, String(sum((e) => e.claimed[0])))),
          h('div', null, h('span', null, `${b.short} aircraft actually lost`), h('b', { class: 'truth' }, String(sum((e) => e.trueLosses[1])))),
          h('div', null, h('span', null, `${b.short} crews claimed`), h('b', null, String(sum((e) => e.claimed[1])))),
          h('div', null, h('span', null, `${a.short} aircraft actually lost`), h('b', { class: 'truth' }, String(sum((e) => e.trueLosses[0])))),
          h('div', null, h('span', null, `${a.short} told High Command`), h('b', null, String(sum((e) => e.reportedToHq[0])))),
          h('div', null, h('span', null, `${b.short} told High Command`), h('b', null, String(sum((e) => e.reportedToHq[1])))),
        ),
      ),
      h('section', { class: 'paper panel' },
        h('table', { class: 'ledger diaries' },
          h('thead', null,
            h('tr', null, h('th', null, ''), h('th', null, ''), h('th', { colspan: '3', class: 'grp' }, a.short), h('th', { colspan: '3', class: 'grp' }, b.short), h('th', null, '')),
            h('tr', null, ['Week', 'Theater', 'Claimed', 'To HQ', 'Destroyed', 'Claimed', 'To HQ', 'Destroyed', 'Sectors'].map((x) => h('th', null, x))),
          ),
          h('tbody', null, st.archive.map((e) => h('tr', null,
            h('td', null, String(e.turn)), h('td', null, THEATERS[e.theater].name),
            h('td', null, String(e.claimed[0])), h('td', null, String(e.reportedToHq[0])), h('td', { class: 'truth' }, String(e.trueKills[0])),
            h('td', null, String(e.claimed[1])), h('td', null, String(e.reportedToHq[1])), h('td', { class: 'truth' }, String(e.trueKills[1])),
            h('td', null, `${e.sectors0} : ${SECTORS - e.sectors0}`),
          ))),
        ),
      ),
    );
  } else if (tab === 'ledger') {
    // Grouped by theater with a subtotal each; runs of quiet weeks folded into one row.
    const rows: HTMLElement[] = [];
    const held = (e: (typeof st.archive)[number]) => (sideId === 0 ? e.sectors0 : SECTORS - e.sectors0);
    const truthCell = (kills: number, claimedN: number) => h('td', { class: kills < claimedN ? 'truth' : '' }, String(kills));
    for (const [ti, th] of THEATERS.entries()) {
      const weeks = st.archive.filter((e) => e.theater === ti);
      if (!weeks.length) continue;
      rows.push(h('tr', { class: 'grp-row' }, h('td', { colspan: '6' }, th.name)));
      for (let i = 0; i < weeks.length; i++) {
        const e = weeks[i];
        const quiet = (x: typeof e) => x.claimed[sideId] === 0 && x.trueKills[sideId] === 0 && x.trueLosses[sideId] === 0;
        if (quiet(e)) {
          let j = i;
          while (j + 1 < weeks.length && quiet(weeks[j + 1])) j++;
          if (j > i) {
            rows.push(h('tr', { class: 'quiet' }, h('td', null, `${e.turn}–${weeks[j].turn}`), h('td', { colspan: '4', class: 'muted' }, 'No claims, no losses'), h('td', null, `${held(weeks[j])} / ${SECTORS}`)));
            i = j;
            continue;
          }
        }
        rows.push(h('tr', null, h('td', null, String(e.turn)), h('td', null, String(e.claimed[sideId])), h('td', null, String(e.reportedToHq[sideId])),
          truthCell(e.trueKills[sideId], e.claimed[sideId]), h('td', null, String(e.trueLosses[sideId])), h('td', null, `${held(e)} / ${SECTORS}`)));
      }
      const sum = (f: (x: (typeof weeks)[number]) => number) => weeks.reduce((a, x) => a + f(x), 0);
      rows.push(h('tr', { class: 'sub-row' }, h('td', null, 'Total'), h('td', null, String(sum((x) => x.claimed[sideId]))), h('td', null, String(sum((x) => x.reportedToHq[sideId]))),
        truthCell(sum((x) => x.trueKills[sideId]), sum((x) => x.claimed[sideId])), h('td', null, String(sum((x) => x.trueLosses[sideId]))), h('td', null, '')));
    }
    body = h('section', { class: 'paper panel' },
      h('h2', null, 'Claims against the truth, week by week'),
      ledgerChart(st.archive, sideId),
      h('table', { class: 'ledger' },
        h('thead', null, h('tr', null, ['Week', 'Crews claimed', 'Reported to HQ', 'Actually destroyed', 'Our losses', 'Sectors held'].map((x) => h('th', null, x)))),
        h('tbody', null, rows)),
    );
  } else {
    body = h('section', { class: 'paper panel end-summary' },
      h('div', { class: `stamp big outcome ${outcome}` }, title),
      h('p', { class: 'typed big' }, text),
      h('div', { class: 'reveal' },
        reveal('Claimed by our crews', claimed, 0),
        reveal('Reported to High Command', toHq, 250),
        reveal('Actually destroyed', trueKills, 500, 'truth'),
      ),
      h('p', { class: 'muted' }, `${st.archive.length} weeks of operations. ${trueLost} of our aircraft lost.`),
      h('div', { class: 'theater-record end-record' }, st.theaterResults.map((r) =>
        h('div', { class: `theater-step ${r.winner === sideId ? 'won' : r.winner === null ? 'drawn' : 'lost'}` },
          h('b', null, r.name), h('span', null, `${r.weeks} weeks`), h('span', { class: 'step-label' }, r.winner === null ? 'DRAWN' : r.winner === sideId ? (r.decisive ? 'BROKE THROUGH' : 'WON') : r.decisive ? 'BROKEN' : 'LOST')))),
      (() => {
        // The most-flown type, as a preview of the archives: what you saw, what you never saw, what killed them.
        const surv = st.archive.flatMap((e) => e.survivorHits[sideId]);
        const lostH = st.archive.flatMap((e) => e.lostHits[sideId]);
        const kinds = KINDS.map((k) => [k, surv.filter((x) => (x.kind ?? 'medium') === k).length + lostH.filter((x) => (x.kind ?? 'medium') === k).length] as const).sort((a, b) => b[1] - a[1]);
        const k = kinds[0]?.[1] ? kinds[0][0] : null;
        if (!k) return null;
        const of = (hs: Hit[]) => hs.filter((x) => (x.kind ?? 'medium') === k);
        return h('div', { class: 'preview-strip' },
          h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: of(surv), dots: true }, 3)), h('figcaption', null, 'What you saw')),
          h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: of(lostH), dots: true, dotColor: '#e3ebf2' }, 3)), h('figcaption', null, 'What you never saw')),
          h('figure', null, h('div', { class: 'blueprint-wrap' }, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: of(lostH).filter((x) => x.lethal), dots: true, dotColor: '#ff3b30' }, 3)), h('figcaption', null, 'What brought them down')));
      })(),
      h('button', { class: 'btn primary launch', onclick: () => { sfxClick(); app.go({ kind: 'end', side: sideId, tab: 'archive' }); } }, 'Open the archives ▸'),
    );
  }
  return h('div', { class: 'hq end' }, h('div', { class: 'hq-body' }, nav, h('main', { class: 'content' }, body)));
}

/** A big figure that counts up after a delay, then gets stamped. */
function reveal(label: string, value: number, delay: number, cls = ''): HTMLElement {
  const el: HTMLElement = h('div', { class: `reveal-item ${cls}` }, countUp(value, 200 + delay, '', 550, () => {
    el.classList.add('done');
    // The truth lands: the red pencil goes through what was claimed and reported.
    if (cls === 'truth') el.parentElement?.querySelectorAll('.reveal-item:not(.truth)').forEach((x, i) => setTimeout(() => { x.classList.add('struck'); sfxKey(); }, 150 + i * 300));
  }), h('span', null, label));
  return el;
}

/** Claims, returns to HQ and the truth per week, as lines; weeks a sector was lost shaded. */
function ledgerChart(archive: GameState['archive'], side: SideId): HTMLElement {
  const W = 900;
  const H = 180;
  const n = archive.length;
  const max = Math.max(4, ...archive.flatMap((e) => [e.claimed[side], e.reportedToHq[side], e.trueKills[side]]));
  const x = (i: number) => 30 + (i / Math.max(1, n - 1)) * (W - 40);
  const y = (v: number) => H - 20 - (v / max) * (H - 40);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'ledger-chart');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  archive.forEach((e, i) => {
    const prev = archive[i - 1];
    const held = (a: typeof e) => (side === 0 ? a.sectors0 : SECTORS - a.sectors0);
    if (prev && prev.theater === e.theater && held(e) < held(prev)) add('rect', { x: x(i) - 8, y: 10, width: 16, height: H - 30, fill: 'rgba(168,53,42,0.15)' });
  });
  // A band per theater, labelled.
  for (let ti = 0; ti < THEATERS.length; ti++) {
    const idx = archive.map((e, i) => (e.theater === ti ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const x0 = x(idx[0]) - 6;
    const x1 = x(idx[idx.length - 1]) + 6;
    add('rect', { x: x0, y: 24, width: x1 - x0, height: H - 44, fill: ti % 2 ? 'rgba(95,111,71,0.08)' : 'rgba(42,38,32,0.05)' });
    add('text', { x: (x0 + x1) / 2, y: H - 4, fill: '#5e5546', 'font-size': 14, 'text-anchor': 'middle' }, THEATERS[ti].name);
  }
  // Value ticks.
  for (const v of [0, Math.round(max / 2), max]) {
    add('line', { x1: 26, y1: y(v), x2: W - 10, y2: y(v), stroke: 'rgba(42,38,32,0.15)', 'stroke-width': 1 });
    add('text', { x: 4, y: y(v) + 4, fill: '#5e5546', 'font-size': 14 }, String(v));
  }
  add('line', { x1: 30, y1: H - 20, x2: W - 10, y2: H - 20, stroke: '#5e5546', 'stroke-width': 1 });
  const line = (f: (e: (typeof archive)[number]) => number, color: string, dash = '') =>
    add('polyline', { points: archive.map((e, i) => `${x(i)},${y(f(e))}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-dasharray': dash });
  line((e) => e.claimed[side], '#5e5546', '6 4');
  line((e) => e.reportedToHq[side], '#2f4a7a', '2 3');
  line((e) => e.trueKills[side], '#a8352a');
  const key = (cls: string, label: string) => h('span', { class: `lk lk-${cls}` }, h('i', null), label);
  return h('div', { class: 'ledger-chart-wrap' },
    h('div', { class: 'ledger-key' }, key('claimed', 'claimed by crews'), key('hq', 'reported to HQ'), key('truth', 'actually destroyed'), key('lost', 'week a sector was lost')),
    svg as unknown as HTMLElement);
}

/** Every front page of the war as a cutting, with the truth of that week pencilled underneath. */
function papersArchive(st: GameState, side: SideId): HTMLElement {
  const papers = st.sides[side].press?.papers ?? [];
  const week = (w: number) => st.archive.find((e) => e.turn === w);
  const printed = papers.reduce((a, p) => a + p.claimed, 0);
  const truly = papers.reduce((a, p) => a + (week(p.week)?.trueKills[side] ?? 0), 0);
  const told = papers.reduce((a, p) => a + p.ministryLosses, 0);
  const lost = papers.reduce((a, p) => a + (week(p.week)?.trueLosses[side] ?? p.lost), 0);
  const bonds = papers.reduce((a, p) => a + p.bonds, 0);
  const peak = papers.reduce((a, p) => (p.mood > a.mood ? p : a), papers[0]);
  return h('div', { class: 'col' },
    h('section', { class: 'paper panel' },
      h('div', { class: 'stamp big declass-stamp' }, 'DECLASSIFIED'),
      h('h2', null, 'What the papers said, and what happened'),
      h('div', { class: 'stats diaries-totals' },
        h('div', null, h('span', null, 'Enemy aircraft the papers printed as destroyed'), h('b', null, String(printed))),
        h('div', null, h('span', null, 'Actually destroyed'), h('b', { class: 'truth' }, String(truly))),
        h('div', null, h('span', null, 'Our losses the Ministry admitted'), h('b', null, String(told))),
        h('div', null, h('span', null, 'Our aircraft actually lost'), h('b', { class: 'truth' }, String(lost))),
        h('div', null, h('span', null, 'Supplies bought with war bonds'), h('b', null, String(bonds))),
        peak ? h('div', null, h('span', null, `The public at its happiest (week ${peak.week})`), h('b', null, moodLabel(peak.mood))) : null)),
    h('div', { class: 'cuttings' }, papers.map((p, i) => {
      const e = week(p.week);
      return h('article', { class: 'cutting', style: `transform: rotate(${[-0.8, 0.5, -0.3, 0.9][i % 4]}deg)` },
        h('div', { class: 'cut-mast' }, p.name, h('small', null, ` · No. ${p.week}`)),
        h('div', { class: 'cut-head' }, p.headline),
        h('p', { class: 'cut-deck' }, p.deck),
        h('div', { class: 'cut-truth handwritten' },
          h('div', null, `Printed: ${p.claimed} destroyed. In truth: `, h('b', null, String(e?.trueKills[side] ?? '?'))),
          h('div', null, `Our losses "${p.ministryLosses === 0 ? 'none' : p.ministryLosses}". In truth: `, h('b', null, String(e?.trueLosses[side] ?? p.lost)))));
    })));
}

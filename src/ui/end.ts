import { AIRCRAFT, ZONE_LABEL } from '../core/data';
import { KINDS } from '../core/lethality';
import { SECTORS, THEATERS } from '../core/theaters';
import type { AircraftKind, GameState, Hit, Outcome, SideId } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h, plural } from './dom';
import { aircraftCanvas } from './sprites';

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
    [['summary', 'Outcome'], ['archive', 'Declassified'], ['ledger', 'The Ledger'], ...(st.mode !== 'single' ? [['diaries', 'Both War Diaries']] : [])].map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, onclick: () => { sfxClick(); app.go({ kind: 'end', side: sideId, tab: id }); } }, label)),
    st.mode !== 'single' ? h('button', { class: 'tab', onclick: () => app.go({ kind: 'end', side: other, tab }) }, `View ${st.sides[other].short}`) : null,
    h('div', { class: 'tabs-spacer' }),
    h('button', { class: 'tab small', onclick: () => { app.endLan(); app.go({ kind: 'title' }); } }, 'Main Menu'),
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
        const leth = st.lethality[k];
        const maxL = Math.max(...Object.values(leth));
        const scale = k === 'heavy' ? 3 : k === 'medium' ? 4 : 5;
        return h('section', { class: 'paper panel declass' },
          i === 0 ? h('div', { class: 'stamp big declass-stamp' }, 'DECLASSIFIED') : null,
          h('h2', null, `Where our ${NAMES[k]} were hit — ${AIRCRAFT[k].name[sideId]}`),
          h('div', { class: 'composite-row three' },
            h('figure', null, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: sv, dots: true }, scale), h('figcaption', null, `What you saw: ${plural(sv.length, 'hole')} on aircraft that returned.`)),
            h('figure', null, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: ls, dots: true, dotColor: '#5a5040' }, scale), h('figcaption', null, `What you never saw: ${plural(ls.length, 'hole')} on aircraft that did not return.`)),
            h('figure', null, aircraftCanvas(k, { side: sideId, style: 'blueprint', hits: fatal, dots: true, dotColor: '#d02020' }, scale), h('figcaption', null, `The ${fatal.length} hits that brought them down.`)),
          ),
          h('h3', null, `This war's ${AIRCRAFT[k].name[sideId]}: chance that one hit brings her down (unarmored)`),
          ZONES.map((z) => h('div', { class: 'bar-row' }, h('span', null, ZONE_LABEL[z]), h('span', { class: 'bar red' }, h('i', { style: `width:${Math.round((leth[z] / maxL) * 100)}%` })), h('span', null, `${Math.round(leth[z] * 100)}%`))),
        );
      }),
      h('section', { class: 'paper panel' },
        h('p', { class: 'handwritten' }, 'The holes in the returning aircraft show where an aircraft can be hit and still come home. Every type is different, and every war.'),
      ),
    );
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
    body = h('section', { class: 'paper panel' },
      h('h2', null, 'Claims against the truth, week by week'),
      ledgerChart(st.archive, sideId),
      h('table', { class: 'ledger' },
        h('thead', null, h('tr', null, ['Week', 'Theater', 'Crews claimed', 'Reported to HQ', 'Actually destroyed', 'Our losses', 'Sectors held'].map((x) => h('th', null, x)))),
        h('tbody', null, st.archive.map((e) => h('tr', null,
          h('td', null, String(e.turn)), h('td', null, THEATERS[e.theater].name), h('td', null, String(e.claimed[sideId])), h('td', null, String(e.reportedToHq[sideId])),
          h('td', { class: 'truth' }, String(e.trueKills[sideId])), h('td', null, String(e.trueLosses[sideId])),
          h('td', null, `${sideId === 0 ? e.sectors0 : SECTORS - e.sectors0} / ${SECTORS}`),
        ))),
      ),
    );
  } else {
    body = h('section', { class: 'paper panel end-summary' },
      h('div', { class: `stamp big outcome ${outcome}` }, title),
      h('p', { class: 'typed big' }, text),
      h('div', { class: 'reveal' },
        reveal('Claimed by our crews', claimed, 0),
        reveal('Reported to High Command', toHq, 900),
        reveal('Actually destroyed', trueKills, 1800, 'truth'),
      ),
      h('p', { class: 'muted' }, `${st.archive.length} weeks of operations. ${trueLost} of our aircraft lost.`),
      h('div', { class: 'theater-record end-record' }, st.theaterResults.map((r) =>
        h('div', { class: `theater-step ${r.winner === sideId ? 'won' : r.winner === null ? 'drawn' : 'lost'}` },
          h('b', null, r.name), h('span', null, `${r.weeks} weeks`), h('span', { class: 'step-label' }, r.winner === null ? 'DRAWN' : r.winner === sideId ? (r.decisive ? 'BROKE THROUGH' : 'WON') : r.decisive ? 'BROKEN' : 'LOST')))),
      h('p', { class: 'muted' }, 'The archives are open. See "Declassified" for what your returning aircraft could never tell you.'),
    );
  }
  return h('div', { class: 'hq end' }, h('div', { class: 'hq-body' }, nav, h('main', { class: 'content' }, body)));
}

/** A big figure that counts up after a delay, then gets stamped. */
function reveal(label: string, value: number, delay: number, cls = ''): HTMLElement {
  const b = h('b', { class: cls }, '0');
  const el = h('div', { class: `reveal-item ${cls}` }, b, h('span', null, label));
  const steps = 20;
  let k = 0;
  const tick = () => {
    if (k > 0 && !el.isConnected) return;
    k++;
    b.textContent = String(Math.round((value * Math.min(k, steps)) / steps));
    if (k < steps) setTimeout(tick, 45);
    else el.classList.add('done');
  };
  setTimeout(tick, 400 + delay);
  return el;
}

/** Claims, returns to HQ and the truth per week, as lines; weeks a sector was lost shaded. */
function ledgerChart(archive: GameState['archive'], side: SideId): SVGElement {
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
  add('line', { x1: 30, y1: H - 20, x2: W - 10, y2: H - 20, stroke: '#5e5546', 'stroke-width': 1 });
  const line = (f: (e: (typeof archive)[number]) => number, color: string, dash = '') =>
    add('polyline', { points: archive.map((e, i) => `${x(i)},${y(f(e))}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-dasharray': dash });
  line((e) => e.claimed[side], '#5e5546', '6 4');
  line((e) => e.reportedToHq[side], '#2f4a7a');
  line((e) => e.trueKills[side], '#a8352a');
  add('text', { x: 34, y: 18, fill: '#5e5546', 'font-size': 16 }, '— — claimed by crews');
  add('text', { x: 230, y: 18, fill: '#2f4a7a', 'font-size': 16 }, '—— reported to HQ');
  add('text', { x: 420, y: 18, fill: '#a8352a', 'font-size': 16 }, '—— actually destroyed');
  add('text', { x: 640, y: 18, fill: '#a8352a', 'font-size': 16, opacity: 0.7 }, '▮ week a sector was lost');
  return svg;
}

/**
 * The end of a theater: first a report on what happened there (verdict, how the
 * front moved week by week, what it cost), then a separate, loud redeployment
 * card for the next theater (or the end of the war).
 */
import { highCommand, portraitCanvas } from './general';
import { campaignTheaters, SECTOR_PRESSURE, SECTORS, THEATERS } from '../core/theaters';
import type { GameState, SecondaryObjective, SideId, TheaterResult } from '../core/types';
import type { App } from './app';
import { sfxPaper, sfxStamp, startDrone, stopDrone } from './audio';
import { countUp, h } from './dom';
import { theaterMap } from './theaterui';
import { tip } from './tip';

const OBJECTIVE_WORD: Record<SecondaryObjective['status'], string> = {
  confirmed: 'ACCOMPLISHED',
  claimed: 'CLAIMED, NEVER CHECKED',
  discredited: 'CLAIM DISCREDITED',
  overrun: 'TAKEN INTACT, NO CREDIT',
  open: 'NOT ACHIEVED',
};

/** Shown when a theater is decided and the wing redeploys (or the war ends). */
export function renderTheaterChange(app: App, side: SideId, _next: unknown): HTMLElement {
  const st = app.state!;
  const res = st.theaterResults[st.theaterResults.length - 1];
  const root = h('div', { class: 'letter-screen theater-change-screen' });
  const done = () => { sfxStamp(); const go = app.continueAfterTheater; app.continueAfterTheater = null; go?.(); };
  const show = (page: HTMLElement) => { root.replaceChildren(page); root.scrollTop = 0; };
  const toRedeploy = () => { sfxPaper(); show(redeployPage(st, side, res, done)); window.setTimeout(sfxStamp, 650); };
  show(reportPage(st, side, res, st.outcome ? done : toRedeploy));
  return root;
}

interface WeekPoint { turn: number; pressure: number; held: number }

/** The theater week by week from our side: pressure on the front and sectors held. */
function weekPoints(st: GameState, side: SideId, res: TheaterResult): WeekPoint[] {
  const sign = side === 0 ? 1 : -1;
  return st.archive.filter((e) => e.theater === res.index).map((e) => ({ turn: e.turn, pressure: e.front * sign, held: side === 0 ? e.sectors0 : SECTORS - e.sectors0 }));
}

/** Sectors that changed hands: which week, which sector, who took it. */
function sectorEvents(st: GameState, side: SideId, res: TheaterResult): { week: number; text: string; ours: boolean }[] {
  const names = THEATERS[res.index].sectors;
  const out: { week: number; text: string; ours: boolean }[] = [];
  let prev = SECTORS / 2;
  st.archive.filter((e) => e.theater === res.index).forEach((e, i) => {
    if (e.sectors0 !== prev) {
      const side0Advanced = e.sectors0 > prev;
      const sector = side0Advanced ? prev : e.sectors0;
      const ours = side0Advanced === (side === 0);
      out.push({ week: i + 1, ours, text: `${names[sector]} ${ours ? 'taken by our Army' : 'lost to the enemy'}` });
    }
    prev = e.sectors0;
  });
  return out;
}

/** Pressure over the weeks, the ±threshold at which a sector falls, and the weeks sectors changed hands. */
function pressureChart(points: WeekPoint[], events: { week: number; ours: boolean }[]): SVGElement {
  const W = 560;
  const H = 190;
  const P = SECTOR_PRESSURE;
  const top = 18;
  const bottom = H - 22;
  const n = Math.max(2, points.length);
  const x = (i: number) => 34 + (i / (n - 1)) * (W - 48);
  const y = (v: number) => top + (1 - (Math.max(-P * 1.25, Math.min(P * 1.25, v)) + P * 1.25) / (P * 2.5)) * (bottom - top);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'tc-chart');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  add('rect', { x: 34, y: y(P * 1.25), width: W - 48, height: y(P) - y(P * 1.25), fill: 'rgba(79,107,46,0.14)' });
  add('rect', { x: 34, y: y(-P), width: W - 48, height: y(-P * 1.25) - y(-P), fill: 'rgba(176,48,42,0.14)' });
  for (const v of [P, 0, -P]) add('line', { x1: 34, x2: W - 14, y1: y(v), y2: y(v), stroke: v === 0 ? '#5a5040' : '#8a826f', 'stroke-width': 1, 'stroke-dasharray': v === 0 ? '' : '4 3' });
  add('text', { x: 4, y: y(P) + 4, fill: '#4f6b2e', 'font-size': 13 }, `+${P}`);
  add('text', { x: 4, y: y(0) + 4, fill: '#5a5040', 'font-size': 13 }, '0');
  add('text', { x: 4, y: y(-P) + 4, fill: '#b0302a', 'font-size': 13 }, `-${P}`);
  add('text', { x: 40, y: y(P) - 4, fill: '#4f6b2e', 'font-size': 12 }, 'sector taken');
  add('text', { x: 40, y: y(-P) + 14, fill: '#b0302a', 'font-size': 12 }, 'sector lost');
  for (const e of events) add('line', { x1: x(e.week - 1), x2: x(e.week - 1), y1: top, y2: bottom, stroke: e.ours ? '#4f6b2e' : '#b0302a', 'stroke-width': 6, opacity: 0.25 });
  add('polyline', { points: points.map((p, i) => `${x(i)},${y(p.pressure)}`).join(' '), fill: 'none', stroke: '#2a2620', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
  points.forEach((p, i) => add('circle', { cx: x(i), cy: y(p.pressure), r: 3, fill: '#2a2620' }));
  points.forEach((p, i) => { if (points.length <= 12 || i % 2 === 0) add('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', fill: '#5e5546', 'font-size': 12 }, String(i + 1)); });
  return svg as unknown as SVGElement;
}

function reportPage(st: GameState, side: SideId, res: TheaterResult, next: () => void): HTMLElement {
  const won = res.winner === side;
  const verdict = res.winner === null ? 'STALEMATE' : won ? 'VICTORY' : 'DEFEAT';
  const points = weekPoints(st, side, res);
  const events = sectorEvents(st, side, res);
  const lastPressure = points[points.length - 1]?.pressure ?? 0;
  const weeks = st.archive.filter((e) => e.theater === res.index);
  const lost = weeks.reduce((a, e) => a + e.trueLosses[side], 0);
  const claimed = weeks.reduce((a, e) => a + e.claimed[side], 0);
  const roll = (st.sides[side].roll ?? []).filter((e) => e.theater === res.index);
  const fate = { missing: 'missing', prisoner: 'prisoner of war', returned: 'returned', killed: 'killed' };
  const big = (v: number, label: string, cls = '', delay = 300) => h('div', { class: `kpi ${cls}` }, countUp(v, delay), h('span', null, label));
  const taken = Math.max(0, (side === 0 ? 1 : -1) * (res.gain ?? 0));
  const obj = res.objectives?.find((o) => o.side === side);
  const lastTheater = !!st.outcome;
  // A defeat is heard as well as read: a low drone under the verdict.
  if (!won && res.winner !== null) { startDrone(); window.setTimeout(stopDrone, 2600); }
  return h('div', { class: `tc paper ${!won && res.winner !== null ? 'defeat' : ''}` },
    h('div', { class: 'tc-old' },
      h('div', { class: 'letter-kicker' }, `Theater report · ${res.name} · ${res.weeks} weeks`),
      h('div', { class: `stamp big drop ${won ? 'notice' : res.winner === null ? 'order' : 'reprimand'}` }, verdict),
      h('p', { class: 'typed big' }, res.winner === null
        ? lastPressure > 15 ? 'The pressure was ours, but the Army took no ground. High Command records a stalemate.'
          : lastPressure < -15 ? 'The enemy held the advantage but took no ground. The armies dig in where they stand.'
          : 'Neither air force could break the other. The armies dig in where they stand.'
        : won ? (res.decisive ? 'The enemy front has broken. The Army is through.' : 'The season ends with the advantage ours.')
        : res.decisive ? 'Our front has broken. The Army is falling back.' : 'The season ends with the advantage theirs.'),
      h('div', { class: 'tc-kpis' },
        big(lost, 'our aircraft lost', lost ? 'bad' : ''),
        big(claimed, 'enemy claimed by our crews', '', 900),
        big(taken, 'sectors taken', taken > 0 ? 'good' : '', 1500)),
      generalVerdict(st, side, res)),
    h('div', { class: 'tc-mid' },
      h('h3', null, 'How the front moved'),
      h('div', { class: 'muted small' }, 'Army liaison\'s pressure on the front at the end of each week. Green bars: a sector we took. Red bars: a sector we lost.'),
      pressureChart(points, events),
      h('div', { class: 'tc-events' },
        events.length ? events.map((e) => h('div', { class: `tc-event ${e.ours ? 'good' : 'bad'}` }, h('b', null, `Week ${e.week}`), ` ${e.text}`))
          : h('div', { class: 'tc-event' }, 'No sector changed hands.')),
      obj ? h('div', { class: 'tc-objective' }, h('b', null, 'Secondary objective '), h('span', { class: `stamp ${obj.status === 'confirmed' ? 'notice' : obj.status === 'claimed' || obj.status === 'open' ? 'order' : 'reprimand'}` }, OBJECTIVE_WORD[obj.status]), h('div', { class: 'small muted' }, obj.text.split(': ')[0] + (obj.text.includes(': ') ? `: ${obj.text.split(': ')[1].split('.')[0]}` : ''))) : null,
      roll.length ? h('div', { class: 'roll' },
        h('h3', null, `Roll of the missing (${roll.length})`),
        h('div', { class: 'tags' }, roll.map((e, i) => h('div', { class: `tag ${e.fate}`, style: `animation-delay:${300 + i * 25}ms`, ...tip({ head: e.name, text: `${e.crew > 1 ? `With ${e.crew - 1} crew. ` : ''}${e.serial}, ${e.squadron}, missing since week ${e.week}.` }) },
          h('span', { class: 'tag-name' }, e.name), h('span', { class: 'tag-fate' }, fate[e.fate].toUpperCase()))))) : null),
    h('div', { class: 'tc-foot' }, h('button', { class: 'btn primary launch', onclick: next }, lastTheater ? 'Continue ▸' : 'Redeploy ▸')));
}

/** The big card for the move: where the war goes next, what is different there, the objective. */
function redeployPage(st: GameState, side: SideId, res: TheaterResult, go: () => void): HTMLElement {
  const def = THEATERS[st.theater.index];
  const order = campaignTheaters(st);
  const step = order.findIndex((o) => o.index === st.theater.index);
  const obj = st.theater.objectives.find((o) => o.side === side);
  const from = THEATERS[res.index];
  const pips = order.map(({ def: d, index }, pos) => {
    const r = st.theaterResults.find((x) => x.index === index);
    const cls = r ? (r.winner === side ? 'won' : r.winner === null ? 'drawn' : 'lost') : index === st.theater.index ? 'now' : '';
    return h('div', { class: `rd-pip ${cls}`, style: `--pip:${d.look.accent}` }, h('b', null, String(pos + 1)), h('span', null, d.name.replace(/^The /, '')), h('i', null, r ? (r.winner === side ? 'WON' : r.winner === null ? 'DRAWN' : 'LOST') : index === st.theater.index ? 'NEXT' : ''));
  });
  return h('div', { class: 'rd', style: `--accent:${def.look.accent}` },
    h('div', { class: 'rd-steps' }, pips),
    h('div', { class: 'rd-kicker' }, `Theater ${step + 1} of ${order.length} · ${def.season}`),
    h('h1', { class: 'rd-name' }, def.name),
    h('div', { class: 'rd-route' },
      h('span', null, from.name.replace(/^The /, '')),
      h('div', { class: 'rd-line' }, h('i', { class: 'rd-plane' }, '✈')),
      h('span', null, def.name.replace(/^The /, ''))),
    h('p', { class: 'rd-blurb' }, def.blurb),
    h('div', { class: 'rd-body' },
      h('div', { class: 'rd-map' }, theaterMap(st, { viewer: side, scale: 2 })),
      h('div', { class: 'rd-side' },
        h('h3', null, 'What is different here'),
        h('ul', { class: 'rd-features' }, def.features.map((f) => h('li', null, h('b', null, f.title), h('span', null, f.text)))),
        obj ? h('div', { class: 'rd-obj' }, h('b', null, 'Secondary objective'), h('span', null, obj.text)) : null,
        h('div', { class: 'rd-note' }, 'Aircraft in repair have been made serviceable during the move. Squadrons are rested.'))),
    h('div', { class: 'tc-foot' }, h('button', { class: 'btn primary launch', onclick: go }, 'Take command ▸')));
}

/** The commander's own general gives the verdict and the cost, in person. */
function generalVerdict(st: GameState, side: SideId, res: TheaterResult): HTMLElement {
  const won = res.winner === side;
  const lost = st.archive.filter((e) => e.theater === res.index).reduce((a, e) => a + e.trueLosses[side], 0);
  const roll = (st.sides[side].roll ?? []).filter((e) => e.theater === res.index);
  const count = (f: string) => roll.filter((e) => e.fate === f).length;
  const hc = highCommand(side);
  const mid = res.name.replace(/^The /, 'the ');
  const verdict = res.winner === null
    ? `${res.name} ends in stalemate after ${res.weeks} weeks. Nobody will write songs about it.`
    : won ? `${res.name} is ours, after ${res.weeks} weeks. The Army sends its thanks, and so do I.` : `We have lost ${mid} after ${res.weeks} weeks. I will not pretend otherwise.`;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const cost = `${n(lost, 'aircraft', 'of our aircraft')} lost. ${n(roll.length, 'crew', 'crews')} posted missing: ${count('killed')} known dead, ${n(count('prisoner'), 'prisoner', 'prisoners')}, ${count('returned')} back with us, ${count('missing')} still unaccounted for.`;
  // The Army's last word on where the line stood, against what it took to break it.
  const lastFront = [...st.archive].reverse().find((e) => e.theater === res.index)?.front ?? 0;
  const ours = side === 0 ? lastFront : 0 - lastFront;
  const line = res.winner === null ? ` At the end the Army put the line at ${ours >= 0 ? '+' : ''}${ours}; a sector needs about ${SECTOR_PRESSURE} to break.` : '';
  return h('div', { class: 'verdict' },
    portraitCanvas('general', side, 2),
    h('div', null,
      h('div', { class: 'tut-from' }, `${hc.name} · ${hc.title}`),
      h('p', { class: 'typed' }, `"${verdict} ${cost}${line}"`)));
}

import { AIRCRAFT, APPROACH_LABEL, ARCHETYPE_INFO, ZONE_LABEL } from '../core/data';
import { nationAt } from './nation';
import type { AircraftKind, Archetype, Debrief, FighterApproach, Hit, SideId, SquadronReport, ZoneId } from '../core/types';
import { leaderPortrait } from './general';
import { REPORTS_LIKE } from './squadronsui';
import { sqLabel } from './warroom';
import { pressureGauge, theaterMap } from './theaterui';
import { setTip, tip } from './tip';
import type { App } from './app';
import { sfxClick, sfxKey, sfxPaper, sfxRing, sfxStamp, sfxStatic, startDrone, stopDrone } from './audio';
import { animOn, h, meter, plural } from './dom';
import { topBar } from './hq';
import { aircraftCanvas, spriteDef } from './sprites';

/* ---------------- Radio room ---------------- */
let speed = 1;

export function renderRadio(app: App, sideId: SideId): HTMLElement {
  const st = app.state!;
  const d = st.lastDebriefs[sideId]!;
  const side = st.sides[sideId];
  const lines = d.radio;
  const log = h('div', { class: 'radio-log', 'data-keep-scroll': 'radio' }, h('div', { class: 'radio-line watch' }, h('span', { class: 'tx' }, '— LISTENING WATCH OPENED T+000 —')));
  const maxT = Math.max(60, ...lines.map((l) => l.t));
  const map = plotMap(app, sideId, maxT, d.reports.map((r) => { const sq = side.squadrons.find((q) => q.id === r.squadronId); return sq ? nationAt(sideId).callsigns[sq.insignia % nationAt(sideId).callsigns.length] : ''; }).filter(Boolean));
  let shown = 0;
  let typing = false;
  let done = false;
  const sent = d.reports.reduce((a, r) => a + r.sent, 0);
  let calls = 0;
  let troubles = 0;
  let lastTrouble = false;
  // One row per squadron that flew, by its call sign: how many went, how many called in trouble.
  const groups = d.reports.map((r) => {
    const sq = side.squadrons.find((q) => q.id === r.squadronId);
    const cs = sq ? nationAt(sideId).callsigns[sq.insignia % nationAt(sideId).callsigns.length] : r.squadronName;
    return { cs, name: r.squadronName, sent: r.sent, trouble: new Set<string>(), aborted: new Set<string>() };
  });
  const tally = h('div', { class: 'radio-tally' });
  const paintTally = () => tally.replaceChildren(
    h('div', { class: 'rt-sum' }, h('span', null, h('b', null, String(sent)), ' took off'), h('span', null, h('b', null, String(calls)), ' calls heard'), h('span', { class: troubles ? 'bad' : '' }, h('b', null, String(troubles)), ' in trouble'), h('span', { class: 'muted' }, done ? 'Who came back: at the debrief' : 'Who came back: ?')),
    ...groups.map((g) => h('div', { class: 'rt-row' }, h('b', null, g.cs.toUpperCase()), h('span', { class: 'muted' }, g.name),
      h('span', { class: 'rt-planes' }, Array.from({ length: g.sent }, (_, i) => {
        const cs = `${g.cs} ${i + 1}`;
        return h('i', { class: g.trouble.has(cs) ? 'down' : g.aborted.has(cs) ? 'abort' : '' }, g.trouble.has(cs) ? '✕' : '');
      })),
      h('span', { class: g.trouble.size ? 'bad' : g.aborted.size ? 'warnc' : 'muted' }, [g.trouble.size ? `${g.trouble.size} in trouble` : '', g.aborted.size ? `${g.aborted.size} turned back` : ''].filter(Boolean).join(' · ')))));
  paintTally();
  // Dawn at dispersal: the field telephone rings as the debrief comes up.
  const proceed = h('button', { class: 'btn primary launch', onclick: () => { stopDrone(); sfxRing(); app.go({ kind: 'debrief', side: sideId, tab: 'returns' }); } }, 'Debrief the crews ▸');
  const speeds = h('div', { class: 'seg mini' }, [1, 2].map((v) => h('button', { class: `seg-btn ${speed === v ? 'on' : ''}`, onclick: (e: MouseEvent) => {
    speed = v;
    for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.classList.toggle('on', b === e.currentTarget);
  } }, `▶ ${v}×`)), h('button', { class: 'seg-btn', onclick: () => finish() }, '⏭ Skip'));

  const addLine = (i: number, instant: boolean) => {
    const l = lines[i];
    const isOther = l.callsign === 'Ground' || l.t >= 200;
    const dead = /no further|carrier wave|static\]|cry/.test(l.text);
    const trouble = /going down|gone in|blew up|falling out|burning|on fire|won't answer|coming off|spinning|no further|carrier/.test(l.text);
    calls++;
    if (trouble) {
      lastTrouble = true;
      troubles++;
      groups.find((g) => l.callsign.startsWith(`${g.cs} `))?.trouble.add(l.callsign);
    } else if (/abort|turning back|going home|heading home|returning to base|turn(ing)? for home|breaking off/i.test(l.text)) {
      groups.find((g) => l.callsign.startsWith(`${g.cs} `))?.aborted.add(l.callsign);
    }
    paintTally();
    const row = h('div', { class: `radio-line ${isOther ? 'home' : ''} ${dead ? 'dead' : ''} ${trouble ? 'trouble' : ''}` },
      h('span', { class: 'rt' }, l.t >= 200 ? `HOME` : `T+${String(l.t).padStart(3, '0')}`),
      h('span', { class: 'cs' }, l.callsign),
      h('span', { class: 'tx' }),
    );
    log.append(row);
    const tx = row.querySelector('.tx')! as HTMLElement;
    map.mark(l.t >= 200 ? -1 : l.t, trouble, l.callsign);
    if (instant) {
      tx.textContent = l.text;
      return Promise.resolve();
    }
    sfxStatic(0.18);
    return new Promise<void>((res) => {
      let k = 0;
      const step = () => {
        if (done) {
          tx.textContent = l.text;
          res();
          return;
        }
        k += 2 * speed;
        tx.textContent = l.text.slice(0, k);
        if (k % 6 === 0) sfxKey();
        log.scrollTop = log.scrollHeight;
        if (k < l.text.length) setTimeout(step, 22);
        else res();
      };
      setTimeout(step, 250 / speed);
    });
  };

  const end = () => {
    done = true;
    paintTally();
    speeds.remove();
    proceed.classList.add('ready');
  };
  const finish = () => {
    if (done) return;
    done = true;
    while (shown < lines.length) void addLine(shown++, true);
    log.scrollTop = log.scrollHeight;
    end();
  };

  const run = async () => {
    if (typing) return;
    typing = true;
    startDrone();
    while (shown < lines.length && !done) {
      lastTrouble = false;
      await addLine(shown++, false);
      // A crew going down: a burst of static, the plot flickers, then silence before the next call.
      if (lastTrouble) {
        sfxStatic(0.12);
        map.el.classList.add('hit');
        setTimeout(() => map.el.classList.remove('hit'), 160);
        await new Promise((r) => setTimeout(r, 400));
      }
      await new Promise((r) => setTimeout(r, 380 / speed));
      if (!log.isConnected) return;
    }
    end();
  };
  setTimeout(() => void run(), 400);
  if (lines.length === 0) log.append(h('div', { class: 'radio-line dead' }, h('span', { class: 'tx' }, 'Radio silence. No operations reported this week.')));

  return h('div', { class: 'radio-screen' },
    h('div', { class: 'from-black' }),
    topBar(app, side, d.turn, 'operations'),
    h('div', { class: 'radio-body' },
      h('div', { class: 'radio-left' },
        h('div', { class: 'radio-title' }, 'OPERATIONS ROOM — PLOTTING TABLE'),
        map.el,
        tally),
      h('div', { class: 'radio-right' }, h('div', { class: 'radio-title' }, 'R/T LOG'), log)),
    h('div', { class: 'launchbar' },
      h('div', { class: 'launch-summary small' }, side.research.includes('radios')
        ? 'VHF sets: clear reception. You hear nearly everything said in the air.'
        : 'Old HF sets: many calls are lost in the static, and you rarely hear the last words of crews who don\'t return. VHF Radio Sets (Works › Development) fix this.'),
      h('div', { class: 'launch-actions' }, speeds, proceed)),
  );
}

/** The theater map at night, with the operation plotted on it as the calls come in. */
function plotMap(app: App, sideId: SideId, maxT: number, callsigns: string[] = []) {
  const st = app.state!;
  const plan = app.plans[sideId];
  const base = theaterMap(st, { viewer: sideId, raid: plan.raid ?? undefined, scale: 3 });
  base.classList.add('night');
  const [hx, hy, tx, ty, W, H] = JSON.parse(base.dataset.route ?? '[20,140,240,140,480,264]') as number[];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'pix plot-overlay';
  const g = c.getContext('2d')!;
  const el = h('div', { class: 'plot' }, base, c);
  // The call signs that took off, at the head of the route.
  if (callsigns.length) {
    g.font = '8px monospace';
    const text = callsigns.map((x) => x.toUpperCase()).join(' · ');
    const w = g.measureText(text).width;
    const lx = Math.max(2, Math.min(W - w - 6, hx - w / 2));
    // Above the home airfield, clear of its symbol.
    g.fillStyle = 'rgba(15,17,13,0.75)';
    g.fillRect(lx - 2, hy - 24, w + 4, 10);
    g.fillStyle = '#f0d070';
    g.fillText(text, lx, hy - 16);
  }
  const pos = (t: number) => {
    // Outbound until ~55% of the timeline, then home again.
    const f = Math.min(1, t / (maxT * 0.55));
    const back = t > maxT * 0.55 ? Math.min(1, (t - maxT * 0.55) / (maxT * 0.45)) : 0;
    const k = f - back;
    return [hx + (tx - hx) * k, hy + (ty - hy) * k + (back > 0 ? 8 : 0)];
  };
  return {
    el,
    mark(t: number, loss: boolean, callsign = '') {
      if (t < 0) return;
      const [x0, y0] = pos(t);
      // Spread the plots of one moment a little, so a busy fight reads as a crowd.
      const n = parseInt(callsign.split(' ').pop() ?? '0', 10) || 0;
      const x = Math.round(x0 + ((n * 5) % 11) - 5);
      const y = Math.round(y0 + ((callsign.charCodeAt(0) || 0) % 9) - 4);
      g.font = '8px monospace';
      if (loss) {
        g.fillStyle = '#ff5a44';
        for (let i = -3; i <= 3; i++) {
          g.fillRect(x + i, y + i, 2, 2);
          g.fillRect(x + i, y - i, 2, 2);
        }
        g.fillStyle = 'rgba(15,17,13,0.75)';
        const w = g.measureText(callsign.toUpperCase()).width;
        g.fillRect(x + 5, y - 5, w + 4, 10);
        g.fillStyle = '#ffb0a0';
        g.fillText(callsign.toUpperCase(), x + 7, y + 3);
      } else {
        g.fillStyle = '#f0d070';
        g.fillRect(x - 1, y - 1, 3, 3);
      }
    },
  };
}

/* ---------------- Debrief ---------------- */
const DTABS: [string, string][] = [
  ['returns', 'The Returns'],
  ['reports', 'Reports & Front'],
];

/** Old sheet names lead to the sheet that now holds them. */
export const DEBRIEF_ALIAS: Record<string, string> = { aircraft: 'returns', missing: 'returns', home: 'reports' };

/** Which aircraft type the damage board shows, when more than one flew. */
let boardKind: AircraftKind | null = null;

/**
 * The debrief in two sheets: what came back (and what did not), then what the
 * crews say and what the Army saw at the front. Filing the reports brings
 * High Command's answer.
 */
export function renderDebrief(app: App, sideId: SideId, tabIn: string): HTMLElement {
  const tab = DEBRIEF_ALIAS[tabIn] ?? tabIn;
  const st = app.state!;
  const d = st.lastDebriefs[sideId]!;
  const side = st.sides[sideId];
  const nav = h('nav', { class: 'tabs' },
    DTABS.map(([id, label]) => h('button', { class: `tab ${tab === id ? 'active' : ''}`, 'data-tab': id, onclick: () => { sfxClick(); app.go({ kind: 'debrief', side: sideId, tab: id }); } }, label,
      id === 'returns' && d.missing.length ? h('span', { class: 'badge' }, String(d.missing.length)) : null)),
  );
  const body = tab === 'reports' ? reportsSheet(app, d) : returnsSheet(app, d);
  const at = DTABS.findIndex(([id]) => id === tab);
  const next = DTABS[at + 1];
  const file = () => { sfxStamp(); app.fileReports(sideId); };
  const policy = app.plans[sideId].embellish >= 0.65 ? 'Creative' : app.plans[sideId].embellish >= 0.2 ? 'Optimistic' : 'Accurate';
  return h('div', { class: 'hq debrief' },
    topBar(app, side, d.turn),
    h('div', { class: 'hq-body' }, nav, h('main', { class: 'content', 'data-keep-scroll': `db-${tab}` }, kpis(app, d), body)),
    h('div', { class: 'launchbar' },
      h('div', { class: 'launch-summary' },
        h('span', { class: 'debrief-steps' }, DTABS.map(([id, label], i) => h('span', { class: `step ${id === tab ? 'on' : i < at ? 'done' : ''}` }, `${i + 1}. ${label}`))),
        h('span', { class: 'small muted', ...tip({ head: 'Returns policy', text: 'How the adjutant presented this week\'s results to High Command. Set it in the War Room.' }) }, `Returns filed: ${policy}`)),
      h('div', { class: 'launch-actions' },
        next ? h('button', { class: 'btn small choice', onclick: file }, 'File now') : null,
        next
          ? h('button', { class: 'btn primary launch', onclick: () => { sfxClick(); app.go({ kind: 'debrief', side: sideId, tab: next[0] }); } }, `Next: ${next[1]} ▸`)
          : h('button', { class: 'btn primary launch', onclick: file }, 'File reports ▸')),
    ),
  );
}

/** The week at a glance, in big figures, above both sheets. */
function kpis(app: App, d: Debrief): HTMLElement {
  const st = app.state!;
  const side = st.sides[d.side];
  const sent = d.reports.reduce((a, r) => a + r.sent, 0);
  const back = d.reports.reduce((a, r) => a + r.returned, 0);
  const claims = d.reports.reduce((a, r) => a + r.claims, 0);
  const front = side.perceived.front;
  const df = d.frontBefore === undefined ? null : front - d.frontBefore;
  const news = d.theaterNews.filter((x) => !STATUS.test(x));
  const landing = firstLook(app, d);
  const kpi = (value: string, label: string, cls: string, t: string, count?: number) => {
    const b = h('b', null, value);
    // The first time the sheet opens, "back" counts up as the aircraft land.
    if (count !== undefined && landing && animOn()) {
      const [, of] = value.split('/');
      let k = 0;
      b.textContent = `0/${of}`;
      const tick = () => { if (k > 0 && !b.isConnected) return; b.textContent = `${Math.min(count, k)}/${of}`; if (k++ < count) setTimeout(tick, 120); };
      setTimeout(tick, 200);
    }
    return h('div', { class: `kpi ${cls}`, ...tip({ head: label, text: t }) }, b, h('span', null, label));
  };
  return h('section', { class: 'kpis' },
    kpi(sent ? `${back}/${sent}` : '—', 'back', '', 'Aircraft that came home of those that took off.', sent ? back : undefined),
    kpi(String(d.missing.length), 'missing', d.missing.length ? 'bad' : 'good', 'Did not return. Their damage was never recorded.'),
    kpi(String(claims), 'enemy claimed', '', 'What our crews claim to have destroyed. Unverified.'),
    h('div', { class: `kpi ${front >= 0 ? 'good' : 'bad'}`, ...tip({ head: 'Front pressure', text: 'The Army liaison\'s figure for pressure on the front. A sector falls at about ±24.' }) },
      h('b', null, `${front >= 0 ? '+' : ''}${front}`), h('span', null, 'front pressure'), df ? h('small', { class: df > 0 ? 'up' : 'down' }, `${df > 0 ? '▲' : '▼'}${Math.abs(df)} this week`) : null),
    news.length ? h('div', { class: 'kpi-news paper' }, h('span', { class: 'stamp intel' }, 'TELEPHONE'), news.map((x) => h('p', { class: 'typed' }, x))) : null,
  );
}

/** News of the wing's own men: it belongs with the telegrams, not the headlines. */
const STATUS = /presumed killed|is alive|prisoner|Red Cross|is back with|is missing with/i;

/** Weeks whose debrief has been opened once already (the landing plays only the first time). */
const looked = new Set<string>();
function firstLook(app: App, d: Debrief): boolean {
  const k = `${app.state!.seed}:${d.side}:${d.turn}`;
  if (looked.has(k)) return false;
  // Marked after this render, so both the figures and the hardstanding animate on the same first look.
  setTimeout(() => looked.add(k), 0);
  return true;
}

/* ---------- Sheet 1: the returns ---------- */

function returnsSheet(app: App, d: Debrief): HTMLElement {
  const side = app.state!.sides[d.side];
  const sqName = (id: string) => side.squadrons.find((s) => s.id === id)?.name ?? 'Disbanded';
  const kinds = [...new Set([...d.returned.map((r) => r.kind), ...d.missing.map((m) => m.kind)])]
    .sort((a, b) => ['heavy', 'medium', 'fighter', 'recon'].indexOf(a) - ['heavy', 'medium', 'fighter', 'recon'].indexOf(b));
  if (!boardKind || !kinds.includes(boardKind)) boardKind = kinds[0] ?? null;
  const kind = boardKind;
  const board = kind ? damageBoard(app, d, kind) : h('p', { class: 'muted' }, 'Nothing flew this week.');
  const damaged = d.returned.filter((r) => r.hits.length > 0 || r.fate !== 'returned');
  const clean = d.returned.filter((r) => !damaged.includes(r));
  const landing = firstLook(app, d);
  const status = d.theaterNews.filter((x) => STATUS.test(x));
  return h('div', { class: 'col' },
    h('section', { class: 'paper panel damage-board' },
      h('div', { class: 'board-head' },
        h('h2', null, 'The damage board'),
        kinds.length > 1 ? h('div', { class: 'seg mini' }, kinds.map((k) => h('button', { class: `seg-btn ${k === kind ? 'on' : ''}`, onclick: () => { boardKind = k; app.render(); } }, nationAt(d.side).aircraft[k]))) : null),
      board),
    h('section', { class: 'paper panel dispersal-panel' },
      h('h2', null, 'Dispersal: who came home'),
      dispersal(app, d, landing),
      h('p', { class: 'small muted' }, `${damaged.length} damaged or written off · ${clean.length} without a scratch · ${d.missing.length} pan${d.missing.length === 1 ? '' : 's'} empty. Hover a pan for the aircraft.`)),
    d.missing.length || status.length ? h('section', { class: 'paper panel telegrams' },
      h('h2', null, 'Telegrams'),
      status.length ? h('div', { class: 'status-updates' }, status.map((x) => h('p', { class: 'typed' }, h('span', { class: 'stamp notice' }, 'STATUS'), ' ', x))) : null,
      d.missing.length ? h('h3', null, 'Missing from operations') : null,
      d.missing.length ? h('table', { class: 'missing' },
        h('thead', null, h('tr', null, h('th', null, 'Serial'), h('th', null, 'Unit'), h('th', null, 'Captain and crew'), h('th', null, 'Last heard'))),
        h('tbody', null, d.missing.map((m) => h('tr', null,
          h('td', null, m.serial, h('div', { class: 'small muted' }, nationAt(d.side).aircraft[m.kind])), h('td', null, sqName(m.squadronId)),
          h('td', null, `${m.captain ?? 'Unknown'}${AIRCRAFT[m.kind].crew > 1 && !m.captain?.includes('(') ? ` and ${AIRCRAFT[m.kind].crew - 1} crew` : ''}`),
          h('td', { class: 'typed' }, m.lastWords ? `"${m.lastWords}"` : 'Nothing heard.', m.witnessed ? h('div', { class: 'small muted' }, m.witnessed) : null))))) : null,
      d.missing.length ? h('p', { class: 'muted small' }, 'Next-of-kin telegrams will be sent in due course.') : null) : null,
  );
}

/** What came back, hole by hole, next to the aircraft that did not. */
function damageBoard(app: App, d: Debrief, kind: AircraftKind): HTMLElement {
  const st = app.state!;
  const back = d.returned.filter((r) => r.kind === kind);
  const hits = back.flatMap((r) => r.hits);
  const lost = d.missing.filter((m) => m.kind === kind);
  // Earlier weeks' holes on this type, faint: the pattern building up.
  const earlier = st.archive.slice(-10, -1).flatMap((e) => e.survivorHits[d.side]).filter((x) => (x.kind ?? 'medium') === kind);
  const scale = kind === 'heavy' ? 5 : kind === 'medium' ? 6 : 8;
  const holder = h('div', { class: 'hero-plot' });
  const draw = (n: number) => holder.replaceChildren(aircraftCanvas(kind, { side: d.side, style: 'blueprint', hits: hits.slice(0, n), faintHits: earlier, dots: true, bigDots: true }, scale));
  // The holes are stamped onto the plot one batch at a time.
  const steps = animOn() ? Math.min(15, hits.length) : 0;
  let k = 0;
  const paint = () => {
    const n = steps ? Math.round((k / steps) * hits.length) : hits.length;
    draw(n);
    if (k > 0 && n > 0) sfxKey();
    k++;
    // Stop once the sheet has been left (the first frame is drawn before it is on screen).
    if (k <= steps && (k === 1 || holder.isConnected)) setTimeout(paint, 80);
  };
  paint();
  const byZone: Partial<Record<ZoneId, number>> = {};
  for (const x of hits) byZone[x.zone] = (byZone[x.zone] ?? 0) + 1;
  const tally = (Object.entries(byZone) as [ZoneId, number][]).sort((a, b) => b[1] - a[1]);
  return h('div', { class: 'damage-hero' },
    h('figure', { class: 'hero-left' },
      h('div', { class: 'hero-row' }, holder,
        h('ul', { class: 'zone-tally' }, tally.map(([z, n]) => h('li', null, h('span', null, ZONE_LABEL[z]), h('b', null, String(n)))),
          tally.length ? null : h('li', { class: 'muted' }, 'No holes'))),
      h('figcaption', null, h('b', null, `${hits.length} holes`), ` on ${back.length} ${nationAt(d.side).aircraft[kind]} that came back`, earlier.length ? h('span', { class: 'muted' }, ` · faint: ${earlier.length} from earlier weeks`) : null),
      h('p', { class: 'handwritten' }, fitterSays(hits))),
    h('div', { class: 'hero-right' },
      h('h3', null, lost.length ? `${lost.length} did not return` : 'Every one came back'),
      lost.length ? h('div', { class: 'ghosts' }, lost.slice(0, 6).map((m) => h('div', { class: 'ghost' },
        h('div', { class: 'ghost-wrap' }, h('div', { class: 'ghost-plane' }, aircraftCanvas(kind, { side: d.side, style: 'blueprint' }, kind === 'fighter' ? 3 : 2)), h('span', { class: 'stamp reprimand no-record' }, 'NO RECORD')),
        h('div', { class: 'af-serial' }, m.serial),
        h('div', { class: 'small typed' }, m.lastWords ? `"${m.lastWords}"` : 'Nothing heard.')))) : null,
      h('p', { class: 'small muted' }, lost.length ? 'Their damage was not recorded: there is nothing left to inspect. Their last calls are the only clue to what brings an aircraft down.' : 'No missing aircraft of this type this week.')),
  );
}

/**
 * The dispersal: a strip of concrete with one pan per aircraft that went out,
 * grouped by squadron. Those that came home park in their pans, taxiing in the
 * first time the sheet opens; the pans of the missing stay empty, a chalk
 * outline and a question mark where the aircraft should be.
 */
function dispersal(app: App, d: Debrief, landing: boolean): HTMLElement {
  const side = app.state!.sides[d.side];
  type Pan = { kind: AircraftKind; serial: string; sq: string; back?: Debrief['returned'][number]; lost?: Debrief['missing'][number]; x: number; y: number };
  const order = [...new Set([...d.returned.map((r) => r.squadronId), ...d.missing.map((m) => m.squadronId)])];
  const W = 1100;
  const pans: Pan[] = [];
  const labels: { x: number; y: number; w: number; text: string }[] = [];
  let x = 14;
  let row = 0;
  const ROW = 96;
  for (const id of order) {
    const sq = side.squadrons.find((q) => q.id === id);
    const items: Pan[] = [
      ...d.returned.filter((r) => r.squadronId === id).map((r) => ({ kind: r.kind, serial: r.serial, sq: id, back: r, x: 0, y: 0 })),
      ...d.missing.filter((m) => m.squadronId === id).map((m) => ({ kind: m.kind, serial: m.serial, sq: id, lost: m, x: 0, y: 0 })),
    ];
    const pw = (k: AircraftKind) => spriteDef(k).w + 10;
    const groupW = items.reduce((a, p) => a + pw(p.kind), 0);
    if (x > 14 && x + Math.min(groupW, W - 28) > W - 14) { x = 14; row++; }
    // Only the call sign over each group, so neighbouring labels never run into each other.
    labels.push({ x, y: row * ROW + 16, w: Math.min(groupW, W - 28) - 6, text: sq ? nationAt(d.side).callsigns[sq.insignia % nationAt(d.side).callsigns.length].toUpperCase() : 'DISBANDED' });
    for (const p of items) {
      if (x + pw(p.kind) > W - 14) { x = 14; row++; }
      p.x = x + pw(p.kind) / 2;
      p.y = row * ROW + 58;
      pans.push(p);
      x += pw(p.kind);
    }
    x += 22;
  }
  const H = (row + 1) * ROW + 8;
  const c = h('canvas', { class: 'pix dispersal', width: W, height: H }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  // The concrete, drawn once.
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const b = base.getContext('2d')!;
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  b.fillStyle = '#6d6a62';
  b.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.08; i++) { b.fillStyle = rnd() > 0.5 ? '#77746b' : '#625f58'; b.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 1); }
  for (let r = 0; r <= row; r++) {
    // The perimeter track along each row, with its centre line.
    b.fillStyle = '#5a5851';
    b.fillRect(0, r * ROW + 22, W, 10);
    b.fillStyle = '#c9a24a';
    for (let k = 0; k < W; k += 14) b.fillRect(k, r * ROW + 26, 7, 1);
  }
  const sprites = new Map<Pan, HTMLCanvasElement>();
  pans.forEach((p, i) => {
    const sw = spriteDef(p.kind).w;
    b.fillStyle = '#5f5c55';
    b.beginPath();
    b.ellipse(p.x, p.y, sw / 2 + 4, 22, 0, 0, Math.PI * 2);
    b.fill();
    b.fillStyle = '#4e4c46';
    b.font = '8px monospace';
    b.fillText(String(i + 1), p.x - sw / 2 - 2, p.y + 20);
    sprites.set(p, p.back
      ? aircraftCanvas(p.kind, { side: d.side, hits: p.back.hits, seed: p.serial.length }, 1)
      : aircraftCanvas(p.kind, { side: d.side, style: 'outline', lineColor: '#e8e4d8' }, 1));
  });
  b.font = '9px monospace';
  for (const l of labels) {
    let t = l.text;
    while (t.length > 2 && b.measureText(t).width > l.w) t = t.slice(0, -1);
    b.fillStyle = '#e8e4d8';
    b.fillText(t, l.x, l.y);
  }
  const start = performance.now();
  const anim = landing && animOn();
  const draw = (now: number) => {
    g.drawImage(base, 0, 0);
    let moving = false;
    pans.forEach((p, i) => {
      const sp = sprites.get(p)!;
      const sw = sp.width;
      const sh = sp.height;
      if (p.lost) {
        g.globalAlpha = 0.85;
        g.drawImage(sp, Math.round(p.x - sw / 2), Math.round(p.y - sh / 2));
        g.globalAlpha = 1;
        g.fillStyle = '#e8e4d8';
        g.font = '16px monospace';
        g.fillText('?', p.x - 4, p.y + 6);
        g.font = '8px monospace';
        g.fillText(p.serial, p.x - sw / 2 + 2, p.y + 30);
        return;
      }
      // Taxi in: along the track from the left, then turn into the pan.
      let px = p.x;
      let py = p.y;
      if (anim) {
        const t = (now - start - i * 120) / 700;
        if (t < 1) {
          moving = true;
          if (t < 0) return;
          const trackY = Math.floor((p.y - 58) / ROW) * ROW + 27;
          px = t < 0.7 ? -40 + (p.x + 40) * (t / 0.7) : p.x;
          py = t < 0.7 ? trackY : trackY + (p.y - trackY) * ((t - 0.7) / 0.3);
        }
      }
      g.drawImage(sp, Math.round(px - sw / 2), Math.round(py - sh / 2));
      const holes = p.back!.hits.length;
      if (holes && px === p.x && py === p.y) {
        g.fillStyle = '#a8322a';
        g.fillRect(Math.round(p.x + sw / 2 - 10), Math.round(p.y - sh / 2) - 2, holes > 9 ? 14 : 9, 10);
        g.fillStyle = '#fff';
        g.font = '8px monospace';
        g.fillText(String(holes), Math.round(p.x + sw / 2 - 8), Math.round(p.y - sh / 2) + 6);
      }
      if (p.back!.fate === 'crashed' && px === p.x) {
        g.strokeStyle = '#a8322a';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p.x - sw / 2, p.y - sh / 2);
        g.lineTo(p.x + sw / 2, p.y + sh / 2);
        g.stroke();
      }
    });
    if (moving && c.isConnected !== false) requestAnimationFrame(draw);
  };
  draw(start);
  if (anim) requestAnimationFrame(draw);
  // Hover a pan for the aircraft in it (or the one that should be).
  c.addEventListener('mousemove', (e) => {
    const r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    const my = ((e.clientY - r.top) / r.height) * H;
    const p = pans.find((q) => Math.abs(q.x - mx) < spriteDef(q.kind).w / 2 + 4 && Math.abs(q.y - my) < 24);
    if (!p) return setTip(c, null);
    const sqn = side.squadrons.find((q) => q.id === p.sq)?.name ?? 'Disbanded';
    if (p.lost) return setTip(c, { head: `${p.serial} · did not return`, text: `${sqn}. ${p.lost.captain ? `${p.lost.captain}. ` : ''}${p.lost.lastWords ? `Last heard: "${p.lost.lastWords}"` : 'Nothing heard.'}`, source: 'there is nothing left to inspect' });
    const af = side.squadrons.flatMap((q) => q.airframes).find((a) => a.id === p.back!.airframeId);
    const fate = p.back!.fate === 'crashed' ? 'Written off on landing.' : p.back!.fate === 'aborted' ? 'Turned back early.' : p.back!.hits.length ? `${p.back!.hits.length} holes.` : 'Not a mark on her.';
    setTip(c, { head: `${p.serial} · ${sqn}`, text: `${p.back!.role}. ${fate}${af ? af.status === 'repair' ? ` In repair for ${af.repairTurns} week${af.repairTurns > 1 ? 's' : ''}.` : ' Serviceable.' : ''}` });
  });
  return c;
}

/* ---------- Sheet 2: reports and the front ---------- */

function reportsSheet(app: App, d: Debrief): HTMLElement {
  const st = app.state!;
  const side = st.sides[d.side];
  const defIds = new Set(d.returned.filter((r) => r.role === 'defense').map((r) => r.squadronId));
  const claims = d.reports.reduce((a, r) => a + r.claims, 0);
  const siteName = (id: string) => st.theater.sites.find((x) => x.id === id)?.name ?? 'target';
  return h('div', { class: 'reports-sheet' },
    h('div', { class: 'col' },
      d.reports.length ? h('div', { class: 'sheet-sub' },
        h('b', null, 'Form 541 · '), `squadrons claim ${claims} enemy aircraft destroyed. `, h('span', { class: 'muted' }, side.research.includes('gunCameras') ? 'Gun camera film has struck off some claims.' : 'Claims are unverified.'),
        side.research.includes('intelOfficer') && d.reports.length > 1 ? h('div', { class: 'handwritten' }, intelNote(d)) : null) : h('section', { class: 'paper panel' }, h('p', null, 'No squadrons flew this week.')),
      d.reports.length ? formStack(app, d, defIds) : null,
    ),
    h('div', { class: 'col' },
      h('section', { class: 'paper panel front-panel' },
        h('h2', null, 'The front this week'),
        theaterMap(st, { viewer: d.side, scale: 1 }),
        pressureGauge(side.perceived.front, { from: d.frontBefore, band: side.perceived.frontBand }),
        d.pressure?.length ? h('table', { class: 'ledger pressure-ledger' }, h('tbody', null, d.pressure.map((p) => h('tr', null,
          h('td', null, p.label), h('td', { class: `glyph ${p.sign > 0 ? 'good' : p.sign < 0 ? 'bad' : 'muted'}` }, liaisonArrow(p.sign, p.effect)), h('td', { class: p.sign > 0 ? 'good' : p.sign < 0 ? 'bad' : 'muted' }, p.effect))))) : null,
        h('p', { class: 'muted small' }, 'The Army\'s impression, not a measurement.')),
      h('section', { class: 'paper panel' }, h('h2', null, 'Home front'), d.defenseSummary.map((x) => h('p', null, x)),
        d.recon ? h('div', { class: 'recon-photo' }, h('span', { class: 'stamp intel' }, 'PHOTOGRAPHIC INTERPRETATION'), h('p', null, `Photographs of the ${siteName(d.recon.siteId)} show the facility at ${d.recon.condition}% of capacity.`)) : null),
      d.station?.length ? h('section', { class: 'paper panel station' }, h('h2', null, 'Station life'), d.station.map((x) => h('p', { class: 'handwritten' }, x))) : null,
    ),
  );
}

/**
 * The week's Form 541s: a comparison table on top (who claims what, and how
 * each leader tends to report), then the forms themselves as a stack. Lines
 * every squadron wrote alike are lifted out into one "All squadrons" line.
 */
function formStack(app: App, d: Debrief, defIds: Set<string>): HTMLElement {
  const side = app.state!.sides[d.side];
  const arch = (r: SquadronReport) => side.squadrons.find((q) => q.id === r.squadronId)?.leader.archetype ?? r.leader.archetype;
  const count = new Map<string, number>();
  for (const r of d.reports) for (const x of new Set(r.remarks)) count.set(x, (count.get(x) ?? 0) + 1);
  const shared = new Set(d.reports.length > 1 ? [...count].filter(([, n]) => n >= 2).map(([x]) => x) : []);
  const key = `${app.state!.seed}:${d.side}:${d.turn}`;
  const topId = formTop.get(key) ?? d.reports[0].squadronId;
  const top = d.reports.find((r) => r.squadronId === topId) ?? d.reports[0];
  const pick = (id: string) => { formTop.set(key, id); sfxPaper(); app.render(); };
  return h('div', { class: 'forms' },
    h('table', { class: 'ledger compare' },
      h('thead', null, h('tr', null, ['Squadron', 'Leader', 'Back', 'Claimed', 'Fighters seen', 'Results', 'Adjutant'].map((x) => h('th', null, x)))),
      h('tbody', null, d.reports.map((r) => h('tr', { class: r === top ? 'on' : '', onclick: () => pick(r.squadronId) },
        h('td', null, sqLabel(r.squadronName)),
        h('td', null, h('span', { class: 'trait' }, ARCHETYPE_INFO[arch(r)].label)),
        h('td', { class: r.returned < r.sent ? 'bad' : '' }, `${r.returned}/${r.sent}`),
        h('td', null, r.noReport ? '—' : String(r.claims)),
        h('td', null, r.noReport ? '—' : r.enemyFightersReported > 0 ? `≈${r.enemyFightersReported}` : 'none'),
        h('td', { class: 'small' }, r.noReport ? 'no report' : results(r, defIds.has(r.squadronId))),
        h('td', { class: 'handwritten small' }, REPORTS_LIKE[arch(r)]))))),
    shared.size ? h('div', { class: 'all-sq' }, h('b', null, 'All squadrons: '), [...shared].map((x) => h('div', { class: 'typed' }, x))) : null,
    h('div', { class: 'stack' },
      h('div', { class: 'stack-edges' }, d.reports.filter((r) => r !== top).map((r, i) => h('button', { class: 'stack-edge', style: `transform: rotate(${i % 2 ? 0.4 : -0.4}deg)`, onclick: () => pick(r.squadronId) }, r.squadronName))),
      reportForm(top, defIds.has(top.squadronId), arch(top), d.side, shared)));
}

/** What a squadron says it did to the target, in words. */
function results(r: SquadronReport, isDefense: boolean): string {
  return isDefense || r.mission === 'sweep' || r.mission === 'feint' ? '—' : r.targetDamageReported === null ? 'unobserved'
    : r.mission === 'support' ? `enemy positions ${r.targetDamageReported > 25 ? 'heavily' : r.targetDamageReported > 10 ? 'well' : 'lightly'} hit`
    : r.targetDamageReported < 3 ? 'bombs fell wide; little or no damage seen'
    : `target ${r.targetDamageReported > 25 ? 'heavily' : r.targetDamageReported > 10 ? 'well' : 'lightly'} hit (est. ${r.targetDamageReported}% destroyed)`;
}

/** The form on top of the stack, per week and side. */
const formTop = new Map<string, string>();

function reportForm(r: SquadronReport, isDefense: boolean, archetype: Archetype, sideId: SideId, omit: Set<string> = new Set()): HTMLElement {
  const total = r.approachReported.tail + r.approachReported.headOn + r.approachReported.beam;
  const mostly = total > 0 ? (Object.keys(r.approachReported) as FighterApproach[]).sort((a, b) => r.approachReported[b] - r.approachReported[a])[0] : null;
  return h('article', { class: 'paper report' },
    h('div', { class: 'form-head' }, h('span', null, 'FORM 541 — OPERATIONS RECORD BOOK'), h('span', { class: `stamp ${r.noReport ? 'reprimand' : 'notice'}` }, r.noReport ? 'NO REPORT' : `RETURNED ${r.returned}/${r.sent}`)),
    h('div', { class: 'form-grid' },
      h('span', null, 'Unit'), h('b', null, r.squadronName),
      h('span', null, 'Reporting officer'), h('b', null, `${r.leader.rank} ${r.leader.name}`),
      h('span', null, 'Role'), h('b', null, isDefense ? 'Interception' : 'Offensive operation'),
      ...(r.noReport ? [] : [
        h('span', null, 'Enemy aircraft claimed'), h('b', null, `${r.claims} destroyed`),
        h('span', null, isDefense ? 'Escorting fighters seen' : 'Enemy fighters encountered'), h('b', null, r.enemyFightersReported > 0 ? `approx. ${r.enemyFightersReported}` : 'none seen'),
        h('span', null, 'Attacks came mostly'), h('b', null, mostly ? APPROACH_LABEL[mostly].toLowerCase() : '—'),
        h('span', null, 'Flak'), h('b', null, isDefense ? '—' : r.flakReported),
        h('span', null, r.mission === 'support' ? 'Results at the front' : 'Bombing results'), h('b', null, results(r, isDefense)),
      ]),
    ),
    h('div', { class: 'remarks' }, h('span', null, 'Remarks:'), r.remarks.filter((x) => !omit.has(x)).map((x) => h('div', { class: 'typed' }, x))),
    h('div', { class: 'report-corner' }, leaderPortrait(r.leader, sideId, 1), h('span', { class: 'trait' }, ARCHETYPE_INFO[archetype].label)),
    h('div', { class: 'margin-note handwritten' }, `Adj.: ${REPORTS_LIKE[archetype]}`),
  );
}

function intelNote(d: Debrief): string {
  const est = d.reports.filter((r) => !r.noReport).map((r) => r.enemyFightersReported);
  if (est.length < 2) return 'Intelligence Section: insufficient reports to cross-check.';
  const lo = Math.min(...est);
  const hi = Math.max(...est);
  return hi > lo * 1.8 ? `Intelligence Section: estimates of enemy fighters range from ${lo} to ${hi}. At least one squadron is badly wrong.` : `Intelligence Section: squadron estimates broadly agree (${lo}–${hi}).`;
}

/** The liaison's words as an arrow: doubled when the words are strong, a dash when nothing moved. */
function liaisonArrow(sign: number, words: string): string {
  if (sign === 0) return '—';
  const strong = /hard|heav|strong|great|badly|much|well/i.test(words);
  return sign > 0 ? (strong ? '▸▸' : '▸') : strong ? '◂◂' : '◂';
}

/** The chief fitter reads the holes he can see, and only those. */
function fitterSays(hits: Hit[]): string {
  if (hits.length === 0) return 'Chief Fitter: "Not a mark on them, sir. Somebody up there likes us."';
  const count: Partial<Record<ZoneId, number>> = {};
  for (const x of hits) count[x.zone] = (count[x.zone] ?? 0) + 1;
  const top = (Object.entries(count) as [ZoneId, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([z]) => ZONE_LABEL[z].toLowerCase());
  const lines = [
    `Chief Fitter: "${top.join(' and ')} again, sir. Like a pepper pot."`,
    `Chief Fitter: "Most of it's in the ${top[0]}. If I had more plate, that's where I'd put it."`,
    `Chief Fitter: "${top[0]}, ${top[0]}, ${top[0]}. They can't stop hitting it."`,
  ];
  return lines[hits.length % lines.length].replace(/"(\w)/, (_, c: string) => `"${c.toUpperCase()}`);
}

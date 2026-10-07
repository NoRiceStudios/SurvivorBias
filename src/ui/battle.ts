import { AIRCRAFT, APPROACH_LABEL, ARCHETYPE_INFO, ZONE_LABEL } from '../core/data';
import type { AircraftKind, Archetype, Debrief, FighterApproach, Hit, SideId, SquadronReport, ZoneId } from '../core/types';
import { leaderPortrait } from './general';
import { REPORTS_LIKE } from './squadronsui';
import { pressureGauge, theaterMap } from './theaterui';
import { tip } from './tip';
import type { App } from './app';
import { sfxClick, sfxKey, sfxStamp, sfxStatic, startDrone, stopDrone } from './audio';
import { h, meter, plural } from './dom';
import { topBar } from './hq';
import { aircraftCanvas } from './sprites';

/* ---------------- Radio room ---------------- */
let speed = 1;

export function renderRadio(app: App, sideId: SideId): HTMLElement {
  const st = app.state!;
  const d = st.lastDebriefs[sideId]!;
  const side = st.sides[sideId];
  const lines = d.radio;
  const log = h('div', { class: 'radio-log', 'data-keep-scroll': 'radio' });
  const maxT = Math.max(60, ...lines.map((l) => l.t));
  const map = radioMap(maxT);
  let shown = 0;
  let typing = false;
  let done = false;
  const sent = d.reports.reduce((a, r) => a + r.sent, 0);
  let calls = 0;
  let troubles = 0;
  const tally = h('div', { class: 'radio-tally' });
  const paintTally = () => tally.replaceChildren(
    h('span', null, h('b', null, String(sent)), ' took off'),
    h('span', null, h('b', null, String(calls)), ' calls heard'),
    h('span', { class: troubles ? 'bad' : '' }, h('b', null, String(troubles)), ' in trouble'),
    h('span', { class: 'muted' }, 'Who came back: ', h('b', null, done ? 'at the debrief' : '?')));
  paintTally();
  const proceed = h('button', { class: 'btn primary launch', onclick: () => { stopDrone(); sfxStamp(); app.go({ kind: 'debrief', side: sideId, tab: 'returns' }); } }, 'Debrief the crews ▸');
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
    if (trouble) troubles++;
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
      await addLine(shown++, false);
      await new Promise((r) => setTimeout(r, 380 / speed));
      if (!log.isConnected) return;
    }
    end();
  };
  setTimeout(() => void run(), 400);
  if (lines.length === 0) log.append(h('div', { class: 'radio-line dead' }, h('span', { class: 'tx' }, 'Radio silence. No operations reported this week.')));

  return h('div', { class: 'radio-screen' },
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

function radioMap(maxT: number) {
  const W = 220;
  const H = 150;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'pix radio-map';
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f3a2b';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 10) {
    g.fillStyle = '#36432f';
    g.fillRect(0, y, W, 1);
  }
  for (let x = 0; x < W; x += 10) {
    g.fillStyle = '#36432f';
    g.fillRect(x, 0, 1, H);
  }
  // Coastline
  g.fillStyle = '#3f5a6a';
  for (let y = 0; y < H; y++) g.fillRect(Math.round(80 + Math.sin(y / 11) * 6), y, 14, 1);
  const base = [20, 110];
  const tgt = [190, 40];
  g.fillStyle = '#d8cca6';
  g.fillRect(base[0] - 2, base[1] - 2, 5, 5);
  g.fillStyle = '#b0302a';
  g.fillRect(tgt[0] - 2, tgt[1] - 2, 5, 5);
  // Route dashes
  g.fillStyle = '#c9c1ae';
  for (let i = 0; i < 40; i += 2) {
    const f = i / 40;
    g.fillRect(Math.round(base[0] + (tgt[0] - base[0]) * f), Math.round(base[1] + (tgt[1] - base[1]) * f), 1, 1);
  }
  const pos = (t: number) => {
    // Outbound until ~60% of the timeline, then back.
    const f = Math.min(1, t / (maxT * 0.55));
    const back = t > maxT * 0.55 ? Math.min(1, (t - maxT * 0.55) / (maxT * 0.45)) : 0;
    const k = f - back;
    return [base[0] + (tgt[0] - base[0]) * k, base[1] + (tgt[1] - base[1]) * k + (back > 0 ? 8 : 0)];
  };
  return {
    el: c,
    mark(t: number, loss: boolean, callsign = '') {
      if (t < 0) return;
      const [x0, y0] = pos(t);
      // Spread the plots of one moment a little, so a busy fight reads as a crowd.
      const jit = ((callsign.length * 7 + t * 3) % 9) - 4;
      const x = x0 + jit * 0.8;
      const y = y0 + ((callsign.charCodeAt(0) || 0) % 7) - 3;
      g.fillStyle = loss ? '#e04a3a' : '#e0c070';
      if (loss) {
        for (let i = -2; i <= 2; i++) {
          g.fillRect(Math.round(x + i), Math.round(y + i), 1, 1);
          g.fillRect(Math.round(x + i), Math.round(y - i), 1, 1);
        }
        g.font = '6px monospace';
        g.fillText(callsign.split(' ').slice(-1)[0].slice(0, 8), Math.round(x + 4), Math.round(y + 2));
      } else {
        g.fillRect(Math.round(x), Math.round(y), 2, 2);
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
  const kpi = (value: string, label: string, cls: string, t: string) => h('div', { class: `kpi ${cls}`, ...tip({ head: label, text: t }) }, h('b', null, value), h('span', null, label));
  return h('section', { class: 'kpis' },
    kpi(sent ? `${back}/${sent}` : '—', 'back', sent && back < sent ? 'bad' : 'good', 'Aircraft that came home of those that took off.'),
    kpi(String(d.missing.length), 'missing', d.missing.length ? 'bad' : 'good', 'Did not return. Their damage was never recorded.'),
    kpi(String(claims), 'enemy claimed', '', 'What our crews claim to have destroyed. Unverified.'),
    kpi(`${front >= 0 ? '+' : ''}${front}`, df === null || df === 0 ? 'front pressure' : `front ${df > 0 ? '▲' : '▼'}${Math.abs(df)}`, front >= 0 ? 'good' : 'bad', 'The Army liaison\'s figure for pressure on the front. A sector falls at about ±24.'),
    d.theaterNews.length ? h('div', { class: 'kpi-news' }, d.theaterNews.map((x) => h('p', { class: 'typed' }, x))) : null,
  );
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
  return h('div', { class: 'col' },
    h('section', { class: 'paper panel damage-board' },
      h('div', { class: 'board-head' },
        h('h2', null, 'The damage board'),
        kinds.length > 1 ? h('div', { class: 'seg mini' }, kinds.map((k) => h('button', { class: `seg-btn ${k === kind ? 'on' : ''}`, onclick: () => { boardKind = k; app.render(); } }, AIRCRAFT[k].name[d.side]))) : null),
      board),
    h('section', { class: 'paper panel' },
      h('h2', null, 'On the hardstanding'),
      h('div', { class: 'fleet' },
        damaged.map((r) => {
          const af = side.squadrons.flatMap((s) => s.airframes).find((a) => a.id === r.airframeId);
          const tag = r.fate === 'crashed' ? 'Written off on landing' : r.fate === 'aborted' ? 'Turned back early' : `${r.hits.length} hole${r.hits.length > 1 ? 's' : ''}`;
          return h('div', { class: `airframe ${r.fate}` },
            aircraftCanvas(r.kind, { side: d.side, hits: r.hits, seed: r.serial.length, patches: af?.patches ? af.patches - r.hits.length : 0 }, r.kind === 'fighter' || r.kind === 'recon' ? 3 : 2),
            h('div', { class: 'af-serial' }, r.serial),
            h('div', { class: 'small muted' }, `${sqName(r.squadronId)} · ${r.role}`),
            h('div', { class: `small ${r.fate === 'crashed' ? 'bad' : ''}` }, tag),
            af ? h('div', { class: 'small' }, af.status === 'repair' ? `Repairs: ${af.repairTurns} week${af.repairTurns > 1 ? 's' : ''}` : 'Serviceable') : null);
        }),
        clean.length ? h('div', { class: 'fleet-fine' },
          h('div', { class: 'fine-sprites' }, clean.slice(0, 16).map((r) => h('span', tip(`${r.serial} · ${sqName(r.squadronId)} · not a mark on her`), aircraftCanvas(r.kind, { side: d.side, seed: r.serial.length }, 1)))),
          h('div', { class: 'small muted' }, `+${clean.length} back without a scratch`)) : null,
        d.returned.length === 0 ? h('p', { class: 'muted' }, 'Nothing came back to inspect.') : null)),
    d.missing.length ? h('section', { class: 'paper panel telegrams' },
      h('h2', null, 'Telegrams: missing from operations'),
      h('table', { class: 'missing' },
        h('thead', null, h('tr', null, h('th', null, 'Serial'), h('th', null, 'Unit'), h('th', null, 'Captain and crew'), h('th', null, 'Last heard'))),
        h('tbody', null, d.missing.map((m) => h('tr', null,
          h('td', null, m.serial, h('div', { class: 'small muted' }, AIRCRAFT[m.kind].name[d.side])), h('td', null, sqName(m.squadronId)),
          h('td', null, `${m.captain ?? 'Unknown'}${AIRCRAFT[m.kind].crew > 1 && !m.captain?.includes('(') ? ` and ${AIRCRAFT[m.kind].crew - 1} crew` : ''}`),
          h('td', { class: 'typed' }, m.lastWords ? `"${m.lastWords}"` : 'Nothing heard.', m.witnessed ? h('div', { class: 'small muted' }, m.witnessed) : null))))),
      h('p', { class: 'muted small' }, 'Next-of-kin telegrams will be sent in due course.')) : null,
  );
}

/** What came back, hole by hole, next to the aircraft that did not. */
function damageBoard(app: App, d: Debrief, kind: AircraftKind): HTMLElement {
  const back = d.returned.filter((r) => r.kind === kind);
  const hits = back.flatMap((r) => r.hits);
  const lost = d.missing.filter((m) => m.kind === kind);
  const scale = kind === 'heavy' ? 5 : kind === 'medium' ? 6 : 8;
  const holder = h('div', { class: 'hero-plot' });
  // The holes are stamped onto the plot one batch at a time.
  const steps = Math.min(15, hits.length);
  let k = 0;
  const paint = () => {
    const n = steps ? Math.round((k / steps) * hits.length) : 0;
    holder.replaceChildren(aircraftCanvas(kind, { side: d.side, style: 'blueprint', hits: hits.slice(0, n), dots: true }, scale));
    if (k > 0 && n > 0) sfxKey();
    k++;
    // Stop once the sheet has been left (the first frame is drawn before it is on screen).
    if (k <= steps && (k === 1 || holder.isConnected)) setTimeout(paint, 80);
  };
  paint();
  return h('div', { class: 'damage-hero' },
    h('figure', { class: 'hero-left' }, holder,
      h('figcaption', null, h('b', null, `${hits.length} holes`), ` on ${back.length} ${AIRCRAFT[kind].name[d.side]} that came back.`),
      h('p', { class: 'handwritten' }, fitterSays(hits))),
    h('div', { class: 'hero-right' },
      h('h3', null, lost.length ? `${lost.length} did not return` : 'Every one came back'),
      lost.length ? h('div', { class: 'ghosts' }, lost.slice(0, 6).map((m) => h('div', { class: 'ghost' },
        h('div', { class: 'ghost-wrap' }, h('div', { class: 'ghost-plane' }, aircraftCanvas(kind, { side: d.side, style: 'blueprint' }, kind === 'fighter' ? 3 : 2)), h('span', { class: 'ghost-q' }, '?')),
        h('div', { class: 'af-serial' }, m.serial),
        h('div', { class: 'small typed' }, m.lastWords ? `"${m.lastWords}"` : 'Nothing heard.')))) : null,
      h('p', { class: 'small muted' }, lost.length ? 'Their damage was not recorded: there is nothing left to inspect. Their last calls are the only clue to what brings an aircraft down.' : 'No missing aircraft of this type this week.')),
  );
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
      d.reports.length ? h('section', { class: 'paper panel claims-head' },
        h('h2', null, 'Form 541: squadron reports'),
        h('p', null, `Squadrons claim ${claims} enemy aircraft destroyed this week. `, side.research.includes('gunCameras') ? h('span', { class: 'muted' }, 'Gun camera film has struck off some claims.') : h('span', { class: 'muted' }, 'Claims are unverified.')),
        side.research.includes('intelOfficer') && d.reports.length > 1 ? h('p', { class: 'handwritten' }, intelNote(d)) : null) : h('section', { class: 'paper panel' }, h('p', null, 'No squadrons flew this week.')),
      h('div', { class: 'reports' }, d.reports.map((r) => reportForm(r, defIds.has(r.squadronId), side.squadrons.find((q) => q.id === r.squadronId)?.leader.archetype ?? r.leader.archetype, d.side))),
    ),
    h('div', { class: 'col' },
      h('section', { class: 'paper panel front-panel' },
        h('h2', null, 'The front this week'),
        theaterMap(st, { viewer: d.side, scale: 1 }),
        pressureGauge(side.perceived.front, { from: d.frontBefore, band: side.perceived.frontBand }),
        d.pressure?.length ? h('table', { class: 'ledger pressure-ledger' }, h('tbody', null, d.pressure.map((p) => h('tr', null,
          h('td', null, p.label), h('td', { class: `glyph ${p.sign > 0 ? 'good' : p.sign < 0 ? 'bad' : 'muted'}` }, p.sign > 0 ? '▸' : p.sign < 0 ? '◂' : '·'), h('td', { class: p.sign > 0 ? 'good' : p.sign < 0 ? 'bad' : 'muted' }, p.effect))))) : null,
        h('p', { class: 'muted small' }, 'The Army\'s impression, not a measurement.')),
      h('section', { class: 'paper panel' }, h('h2', null, 'Home front'), d.defenseSummary.map((x) => h('p', null, x)),
        d.recon ? h('div', { class: 'recon-photo' }, h('span', { class: 'stamp intel' }, 'PHOTOGRAPHIC INTERPRETATION'), h('p', null, `Photographs of the ${siteName(d.recon.siteId)} show the facility at ${d.recon.condition}% of capacity.`)) : null),
      d.station?.length ? h('section', { class: 'paper panel station' }, h('h2', null, 'Station life'), d.station.map((x) => h('p', { class: 'handwritten' }, x))) : null,
    ),
  );
}

function reportForm(r: SquadronReport, isDefense: boolean, archetype: Archetype, sideId: SideId): HTMLElement {
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
        h('span', null, r.mission === 'support' ? 'Results at the front' : 'Bombing results'), h('b', null, isDefense || r.mission === 'sweep' || r.mission === 'feint' ? '—' : r.targetDamageReported === null ? 'unobserved'
          : r.mission === 'support' ? `enemy positions ${r.targetDamageReported > 25 ? 'heavily' : r.targetDamageReported > 10 ? 'well' : 'lightly'} hit`
          : r.targetDamageReported < 3 ? 'bombs fell wide; little or no damage seen'
          : `target ${r.targetDamageReported > 25 ? 'heavily' : r.targetDamageReported > 10 ? 'well' : 'lightly'} hit (est. ${r.targetDamageReported}% destroyed)`),
      ]),
    ),
    h('div', { class: 'remarks' }, h('span', null, 'Remarks:'), r.remarks.map((x) => h('div', { class: 'typed' }, x))),
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

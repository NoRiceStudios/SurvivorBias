import { AIRCRAFT, APPROACH_LABEL, TARGETS, ZONE_LABEL } from '../core/data';
import type { Debrief, FighterApproach, Hit, SideId, SquadronReport, ZoneId } from '../core/types';
import type { App } from './app';
import { sfxClick, sfxKey, sfxStamp, sfxStatic, startDrone, stopDrone } from './audio';
import { h, meter, plural } from './dom';
import { topBar } from './hq';
import { aircraftCanvas } from './sprites';

/* ---------------- Radio room ---------------- */
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
  const proceed = h('button', { class: 'btn primary', onclick: () => { stopDrone(); sfxStamp(); app.go({ kind: 'debrief', side: sideId, tab: 'aircraft' }); } }, 'Debrief the crews ▸');
  const skip = h('button', { class: 'btn', onclick: () => { finish(); } }, 'Skip');

  const addLine = (i: number, instant: boolean) => {
    const l = lines[i];
    const isOther = l.callsign === 'Ground' || l.t >= 200;
    const row = h('div', { class: `radio-line ${isOther ? 'home' : ''} ${/no further|carrier wave|static\]|cry/.test(l.text) ? 'dead' : ''}` },
      h('span', { class: 'rt' }, l.t >= 200 ? `HOME` : `T+${String(l.t).padStart(3, '0')}`),
      h('span', { class: 'cs' }, l.callsign),
      h('span', { class: 'tx' }),
    );
    log.append(row);
    const tx = row.querySelector('.tx')! as HTMLElement;
    map.mark(l.t >= 200 ? -1 : l.t, /going down|gone in|blew up|falling out|burning|on fire|won't answer|coming off|spinning|no further|carrier/.test(l.text));
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
        k += 2;
        tx.textContent = l.text.slice(0, k);
        if (k % 6 === 0) sfxKey();
        log.scrollTop = log.scrollHeight;
        if (k < l.text.length) setTimeout(step, 22);
        else res();
      };
      setTimeout(step, 250);
    });
  };

  const finish = () => {
    if (done) return;
    done = true;
    while (shown < lines.length) void addLine(shown++, true);
    log.scrollTop = log.scrollHeight;
    skip.remove();
  };

  const run = async () => {
    if (typing) return;
    typing = true;
    startDrone();
    while (shown < lines.length && !done) {
      await addLine(shown++, false);
      await new Promise((r) => setTimeout(r, 380));
      if (!log.isConnected) return;
    }
    done = true;
    skip.remove();
  };
  setTimeout(() => void run(), 400);
  if (lines.length === 0) log.append(h('div', { class: 'radio-line dead' }, h('span', { class: 'tx' }, 'Radio silence. No operations reported this week.')));

  return h('div', { class: 'radio-screen' },
    topBar(app, side, d.turn, 'operations'),
    h('div', { class: 'radio-body' },
      h('div', { class: 'radio-left' },
        h('div', { class: 'radio-title' }, 'OPERATIONS ROOM — R/T LOG'),
        map.el,
        h('div', { class: 'muted small' }, 'Plots are approximate. Crosses mark calls of aircraft in trouble.'),
        side.research.includes('radios')
          ? h('div', { class: 'small radio-set vhf' }, 'VHF sets: clear reception. You hear nearly everything said in the air.')
          : h('div', { class: 'small radio-set hf' }, 'Old HF sets: poor reception. Many calls are lost in the static, and you rarely hear the last words of crews who don\'t return. VHF Radio Sets (Research) fix this. Tower and ground reports come by telephone.'),
      ),
      h('div', { class: 'radio-right' }, log, h('div', { class: 'radio-actions' }, skip, proceed)),
    ),
  );
}

function radioMap(maxT: number) {
  const W = 220;
  const H = 150;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'pix radio-map';
  c.style.width = `${W * 2}px`;
  c.style.height = `${H * 2}px`;
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
    mark(t: number, loss: boolean) {
      if (t < 0) return;
      const [x, y] = pos(t);
      g.fillStyle = loss ? '#e04a3a' : '#e0c070';
      if (loss) {
        for (let i = -2; i <= 2; i++) {
          g.fillRect(Math.round(x + i), Math.round(y + i), 1, 1);
          g.fillRect(Math.round(x + i), Math.round(y - i), 1, 1);
        }
      } else {
        g.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
    },
  };
}

/* ---------------- Debrief ---------------- */
const DTABS: [string, string][] = [
  ['aircraft', 'Returned Aircraft'],
  ['reports', 'Squadron Reports'],
  ['missing', 'Missing'],
  ['home', 'Home Front & HQ'],
];

export function renderDebrief(app: App, sideId: SideId, tab: string): HTMLElement {
  const st = app.state!;
  const d = st.lastDebriefs[sideId]!;
  const side = st.sides[sideId];
  const nav = h('nav', { class: 'tabs' },
    DTABS.map(([id, label]) => h('button', { class: `tab ${tab === id ? 'active' : ''}`, 'data-tab': id, onclick: () => { sfxClick(); app.go({ kind: 'debrief', side: sideId, tab: id }); } }, label,
      id === 'missing' && d.missing.length ? h('span', { class: 'badge' }, String(d.missing.length)) : null)),
  );
  let body: HTMLElement;
  if (tab === 'reports') body = reportsView(app, d);
  else if (tab === 'missing') body = missingView(app, d);
  else if (tab === 'home') body = homeView(app, d);
  else body = aircraftView(app, d);
  const sent = d.reports.reduce((a, r) => a + r.sent, 0);
  const back = d.reports.reduce((a, r) => a + r.returned, 0);
  return h('div', { class: 'hq debrief' },
    topBar(app, side, d.turn),
    h('div', { class: 'hq-body' }, nav, h('main', { class: 'content', 'data-keep-scroll': `db-${tab}` }, body)),
    h('div', { class: 'launchbar' },
      h('div', { class: 'launch-summary' }, `Week ${d.turn} debrief · ${back} of ${sent} aircraft returned`),
      h('button', { class: 'btn primary', onclick: () => { sfxStamp(); app.afterDebrief(sideId); } }, st.outcome ? 'The war is over ▸' : 'File reports ▸'),
    ),
  );
}

function aircraftView(app: App, d: Debrief): HTMLElement {
  const side = app.state!.sides[d.side];
  const bombersBack = d.returned.filter((r) => r.kind === 'medium' || r.kind === 'heavy');
  const allHits = bombersBack.flatMap((r) => r.hits);
  const sqName = (id: string) => side.squadrons.find((s) => s.id === id)?.name ?? 'Disbanded';
  const cards = d.returned.map((r) => {
    const af = side.squadrons.flatMap((s) => s.airframes).find((a) => a.id === r.airframeId);
    const tag = r.fate === 'crashed' ? 'Written off on landing' : r.fate === 'aborted' ? 'Turned back early' : r.hits.length === 0 ? 'Undamaged' : `${r.hits.length} hole${r.hits.length > 1 ? 's' : ''}`;
    return h('div', { class: `airframe ${r.fate}` },
      aircraftCanvas(r.kind, { side: d.side, hits: r.hits, seed: r.serial.length, patches: af?.patches ? af.patches - r.hits.length : 0 }, r.kind === 'heavy' ? 2 : r.kind === 'medium' ? 2 : 3),
      h('div', { class: 'af-serial' }, r.serial),
      h('div', { class: 'small muted' }, `${sqName(r.squadronId)} · ${r.role}`),
      h('div', { class: `small ${r.fate === 'crashed' ? 'bad' : ''}` }, tag),
      af ? h('div', { class: 'small' }, af.status === 'repair' ? `Repairs: ${af.repairTurns} week${af.repairTurns > 1 ? 's' : ''}` : 'Serviceable') : null,
    );
  });
  return h('div', { class: 'col' },
    d.theaterNews.length ? h('section', { class: 'paper panel news' }, h('h2', null, 'News'), d.theaterNews.map((x) => h('p', { class: 'typed' }, x))) : null,
    bombersBack.length ? h('section', { class: 'paper panel' },
      h('h2', null, 'Ground Crew Damage Plot — this operation'),
      h('div', { class: 'composite-row' },
        aircraftCanvas(bombersBack[0].kind, { side: d.side, style: 'blueprint', hits: allHits, dots: true }, 4),
        h('div', null,
          h('p', null, `${plural(allHits.length, 'hole')} counted on ${plural(bombersBack.length, 'returning bomber')}.`),
          h('p', { class: 'muted' }, (() => {
            const n = d.missing.filter((m) => m.kind !== 'fighter').length;
            return n === 0 ? 'Every bomber came back.' : `${plural(n, 'bomber')} did not return. ${n === 1 ? 'Its' : 'Their'} damage was not recorded.`;
          })()),
          h('p', { class: 'handwritten' }, fitterSays(allHits)),
        ),
      ),
    ) : null,
    h('section', { class: 'paper panel' }, h('h2', null, 'On the Hardstanding'), cards.length ? h('div', { class: 'fleet' }, cards) : h('p', { class: 'muted' }, 'Nothing came back to inspect.')),
  );
}

function reportForm(r: SquadronReport, isDefense: boolean): HTMLElement {
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
  );
}

function reportsView(app: App, d: Debrief): HTMLElement {
  const side = app.state!.sides[d.side];
  const defIds = new Set(d.returned.filter((r) => r.role === 'defense').map((r) => r.squadronId));
  if (d.reports.length === 0) return h('section', { class: 'paper panel' }, h('p', null, 'No squadrons flew this week.'));
  const claims = d.reports.reduce((a, r) => a + r.claims, 0);
  return h('div', { class: 'col' },
    h('section', { class: 'paper panel' }, h('h2', null, 'Summary of Claims'),
      h('p', null, `Squadrons claim ${claims} enemy aircraft destroyed this week.`),
      side.research.includes('gunCameras') ? h('p', { class: 'muted' }, 'Gun camera film has been reviewed; some claims were struck off.') : h('p', { class: 'muted' }, 'Claims are unverified.'),
      side.research.includes('intelOfficer') && d.reports.length > 1 ? h('p', { class: 'handwritten' }, intelNote(d)) : null,
    ),
    h('div', { class: 'reports' }, d.reports.map((r) => reportForm(r, defIds.has(r.squadronId) || !!side.squadrons.find((s) => s.id === r.squadronId && d.returned.some((x) => x.squadronId === s.id && x.role === 'defense'))))),
  );
}

function intelNote(d: Debrief): string {
  const est = d.reports.filter((r) => !r.noReport).map((r) => r.enemyFightersReported);
  if (est.length < 2) return 'Intelligence Section: insufficient reports to cross-check.';
  const lo = Math.min(...est);
  const hi = Math.max(...est);
  return hi > lo * 1.8 ? `Intelligence Section: estimates of enemy fighters range from ${lo} to ${hi}. At least one squadron is badly wrong.` : `Intelligence Section: squadron estimates broadly agree (${lo}–${hi}).`;
}

function missingView(app: App, d: Debrief): HTMLElement {
  const side = app.state!.sides[d.side];
  if (d.missing.length === 0) return h('section', { class: 'paper panel' }, h('h2', null, 'Missing'), h('p', null, 'All aircraft accounted for.'));
  const sqName = (id: string) => side.squadrons.find((s) => s.id === id)?.name ?? 'Disbanded unit';
  return h('section', { class: 'paper panel' },
    h('h2', null, 'Aircraft Missing from Operations'),
    h('p', { class: 'muted' }, 'Next-of-kin telegrams will be sent in due course.'),
    h('table', { class: 'missing' },
      h('thead', null, h('tr', null, h('th', null, 'Serial'), h('th', null, 'Type'), h('th', null, 'Unit'), h('th', null, 'Captain and crew'), h('th', null, 'Last heard'))),
      h('tbody', null, d.missing.map((m) => h('tr', null,
        h('td', null, m.serial), h('td', null, AIRCRAFT[m.kind].name[d.side]), h('td', null, sqName(m.squadronId)),
        h('td', null, `${m.captain ?? 'Unknown'}${AIRCRAFT[m.kind].crew > 1 ? ` and ${AIRCRAFT[m.kind].crew - 1} crew` : ''}`),
        h('td', { class: 'typed' }, m.lastWords ? `"${m.lastWords}"` : 'Nothing heard.', m.witnessed ? h('div', { class: 'small muted' }, m.witnessed) : null),
      ))),
    ),
    h('div', { class: 'missing-planes' }, d.missing.slice(0, 12).map((m) => aircraftCanvas(m.kind, { side: d.side, style: 'silhouette' }, 1))),
  );
}

function homeView(app: App, d: Debrief): HTMLElement {
  const siteName = (id: string) => app.state!.theater.sites.find((x) => x.id === id)?.name ?? 'target';
  return h('div', { class: 'grid2' },
    h('section', { class: 'paper panel' }, h('h2', null, 'Home Front'), d.defenseSummary.map((x) => h('p', null, x)),
      d.recon ? h('div', { class: 'recon-photo' }, h('span', { class: 'stamp intel' }, 'PHOTOGRAPHIC INTERPRETATION'), h('p', null, `Photographs of the ${siteName(d.recon.siteId)} show the facility at ${d.recon.condition}% of capacity.`)) : null,
    ),
    d.pressure?.length ? h('section', { class: 'paper panel' }, h('h2', null, 'Army Liaison: the Front This Week'),
      h('table', { class: 'ledger pressure-ledger' }, h('tbody', null, d.pressure.map((p) => h('tr', null,
        h('td', null, p.label), h('td', { class: p.sign > 0 ? 'good' : p.sign < 0 ? 'bad' : 'muted' }, p.effect))))),
      h('p', { class: 'muted small' }, 'The Army\'s impression, not a measurement. Weather and the fortunes of war are folded into the fighting in the air.'),
    ) : null,
    h('section', { class: 'paper panel' }, h('h2', null, 'Signal from High Command'), d.hqResponse.length ? d.hqResponse.map((x) => h('p', { class: 'typed' }, x)) : h('p', { class: 'muted' }, 'Returns acknowledged. No comment.'),
      h('p', { class: 'muted small' }, 'High Command judges you on the returns you send, not on what happened.'),
    ),
  );
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

/**
 * Squadrons: a roster on the left, the selected squadron's dossier on the right.
 * The dossier holds the leader, the doctrine with what it does, the armor laid
 * over the evidence (holes on the aircraft that came back, last calls of those
 * that did not), and the aircraft themselves.
 */
import { armorUsed, COSTS } from '../core/actions';
import { AIRCRAFT, ARCHETYPE_INFO, MAX_ARMOR_PER_ZONE, TRAIT_INFO, ZONE_LABEL } from '../core/data';
import { armorBudget, availableMods, MOD_IDS, MOD_SLOTS, MODS } from '../core/mods';
import { flyable } from '../core/sim';
import { describeFlightCommander } from '../core/turn';
import type { Archetype, Hit, SideState, Squadron, ZoneId } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { doctrinePanel } from './doctrine';
import { h, meter, plural } from './dom';
import { leaderPortrait } from './general';
import { aircraftCanvas, PLATE_FILL, repaintAircraft, spriteDef, zoneAt, zoneCentres } from './sprites';
import { setTip, tip } from './tip';
import { pips } from './widgets';
import { requestCard, sqLabel } from './warroom';

/** How each kind of leader colours his reports, as the adjutant puts it. */
export const REPORTS_LIKE: Record<Archetype, string> = {
  braggart: 'Claims run high; bombing results generous.',
  pessimist: 'Sees more fighters than there were; claims little.',
  gloryHunter: 'Claims high and sees the enemy everywhere.',
  byTheBook: 'Claims what he is sure of; often reports "unobserved".',
  timid: 'Flak always heavier, results a little thin.',
};

/** Armor changes apply to every squadron of the type unless the commander says otherwise. */
let armorWholeType = true;

export function squadronsScreen(app: App, side: SideState): HTMLElement {
  const sqs = side.squadrons;
  if (!app.selected || !sqs.find((s) => s.id === app.selected)) app.selected = sqs.find((s) => s.airframes.length > 0)?.id ?? sqs[0]?.id ?? null;
  const sq = sqs.find((s) => s.id === app.selected);
  return h('div', { class: 'sq-screen' },
    roster(app, side),
    sq ? dossier(app, side, sq) : h('p', { class: 'muted' }, 'No squadrons.'));
}

function taskOf(app: App, side: SideState, sq: Squadron): string {
  const plan = app.plans[side.id];
  if (plan.raid?.squadronIds.includes(sq.id)) return sq.kind === 'fighter' ? (plan.raid.target === 'sweep' ? 'SWEEP' : 'ESCORT') : 'BOMB';
  if (plan.defense.includes(sq.id)) return 'DEFEND';
  if (plan.feint?.squadronIds.includes(sq.id)) return 'FEINT';
  if (plan.recon?.squadronId === sq.id) return 'PHOTO';
  return 'REST';
}

/** The wing at a glance, under the roster: strength by type and how long each type will last. */
function wingSummary(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const kinds = (['fighter', 'medium', 'heavy', 'recon'] as const).filter((k) => side.squadrons.some((q) => q.kind === k && q.airframes.length));
  const avgFat = side.squadrons.filter((q) => q.airframes.length).reduce((a, q, _, all) => a + q.fatigue / all.length, 0);
  return h('div', { class: 'wing-summary paper' },
    h('h3', null, 'The wing'),
    kinds.map((k) => {
      const sqs = side.squadrons.filter((q) => q.kind === k);
      const have = sqs.reduce((a, q) => a + q.airframes.length, 0);
      const crews = sqs.reduce((a, q) => a + q.crews, 0);
      const lost3 = (side.roll ?? []).filter((e) => e.week >= st.turn - 3 && sqs.some((q) => q.name === e.squadron)).length;
      const onOrder = side.factory.queue.filter((x) => x === k).length;
      const weeks = lost3 > onOrder ? Math.max(1, Math.round((have / (lost3 - onOrder)) * 3)) : null;
      return h('div', { class: 'ws-row', ...tip({ head: AIRCRAFT[k].name[side.id], text: `${have} aircraft, ${crews} crews, ${onOrder} on order. Lost in the last three weeks: ${lost3}.` }) },
        h('span', null, AIRCRAFT[k].name[side.id]), h('b', null, `${have}`), h('small', { class: 'muted' }, ` a/c · ${crews} crews`),
        weeks !== null && weeks <= 8 ? h('div', { class: 'small bad' }, `gone in ~${weeks} weeks at this rate`) : null);
    }),
    h('div', { class: 'ws-row' }, h('span', null, 'Average fatigue'), pips(avgFat, 6, 0.6)));
}

function roster(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  return h('nav', { class: 'roster' }, wingRows(app, side, st), wingSummary(app, side));
}

function wingRows(app: App, side: SideState, st: NonNullable<App['state']>): HTMLElement[] {
  return side.squadrons.map((q) => {
    const flags = [
      side.requests.some((r) => r.squadronId === q.id) ? '✉' : '',
      q.candidate && q.candidateWeek === st.turn ? '★' : '',
      q.leader.trait === 'shaken' && !q.leader.restedOnce && !q.leader.resting ? '✚' : '',
    ].join('');
    const task = taskOf(app, side, q);
    return h('button', { class: `roster-row ${q.id === app.selected ? 'on' : ''} ${q.airframes.length === 0 ? 'empty' : ''}`, onclick: () => { app.selected = q.id; sfxClick(); app.render(); } },
      h('div', { class: 'rr-face' }, leaderPortrait(q.leader, side.id, 1)),
      h('div', { class: 'rr-main' },
        h('div', { class: 'rr-name' }, sqLabel(q.name), flags ? h('span', { class: 'rr-flags', ...tip([flags.includes('✉') ? '✉ a request from this squadron' : '', flags.includes('★') ? '★ a new CO to confirm this week' : '', flags.includes('✚') ? '✚ the medical officer is worried about the CO' : ''].filter(Boolean).join(' · ')) }, flags) : null),
        h('div', { class: 'rr-sub' }, `${AIRCRAFT[q.kind].name[side.id]} · ${flyable(q).length}/${q.airframes.length}`),
        h('div', { class: 'rr-pips' }, pips(q.fatigue, 6, 0.6), pips(q.morale, 6, 0.3, true))),
      h('span', { class: `task-chip ${task === 'REST' ? 'rest' : ''}` }, task));
  });
}

function dossier(app: App, side: SideState, sq: Squadron): HTMLElement {
  const st = app.state!;
  const info = ARCHETYPE_INFO[sq.leader.archetype];
  const repairs = sq.airframes.filter((a) => a.status === 'repair').length;
  const trait = sq.leader.trait ? TRAIT_INFO[sq.leader.trait] : null;
  const actions = [
    sq.candidate && sq.candidateWeek === st.turn
      ? h('div', { class: 'action-row' },
        h('div', { class: 'cand-photo' }, leaderPortrait(sq.candidate, side.id, 1)),
        h('span', { class: 'small' }, describeFlightCommander(sq.candidate, `The other flight commander, ${sq.candidate.rank} ${sq.candidate.name}`), ' This week only: '),
        h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'appoint', sq: sq.id }) }, 'Appoint him'))
      : null,
    sq.leader.resting
      ? h('div', { class: 'action-row small' }, `${sq.leader.rank} ${sq.leader.name} is on the medical officer's rest: ${plural(sq.leader.resting, 'week', 'weeks')} to go. His deputy leads.`)
      : sq.leader.trait === 'shaken' && !sq.leader.restedOnce
        ? h('div', { class: 'action-row' }, h('span', { class: 'small' }, 'The medical officer could take him off operations for two weeks. He usually comes back steadier; morale and confidence fall a little.'),
          h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'restCO', sq: sq.id }) }, 'Two weeks\' rest'))
        : null,
    sq.airframes.length <= 2 && side.squadrons.some((q) => q !== sq && q.kind === sq.kind)
      ? h('div', { class: 'action-row' }, h('span', { class: 'small' }, `Down to ${plural(sq.airframes.length, 'aircraft', 'aircraft')}. Merge into: `),
        side.squadrons.filter((q) => q !== sq && q.kind === sq.kind).map((q) => h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'merge', from: sq.id, into: q.id }) }, q.name)))
      : null,
  ].filter(Boolean);
  return h('div', { class: 'dossier' },
    h('section', { class: 'paper panel dossier-head' },
      h('div', { class: 'leader-photo' }, leaderPortrait(sq.leader, side.id, 2)),
      h('div', { class: 'dh-main' },
        h('div', { class: 'dh-unit' }, sqLabel(sq.name)),
        h('div', { class: 'dh-type' }, `${AIRCRAFT[sq.kind].name[side.id]}, ${AIRCRAFT[sq.kind].role.toLowerCase()}`),
        h('div', { class: 'leader' }, `${sq.leader.rank} ${sq.leader.name} `,
          h('span', { class: 'trait', ...tip({ head: info.label, text: info.blurb }) }, info.label),
          trait ? h('span', { class: `trait rep ${sq.leader.trait}`, ...tip({ head: trait.label, text: trait.blurb }) }, trait.label) : null,
          h('span', { class: 'small muted' }, ` ${sq.leader.ops ?? 0} ops`)),
        h('div', { class: 'reports-like handwritten' }, `How he reports: ${REPORTS_LIKE[sq.leader.archetype]}`),
        sq.deputy ? h('div', { class: 'small muted' }, describeFlightCommander(sq.deputy, `Next in line: ${sq.deputy.rank} ${sq.deputy.name}`)) : null,
        actions,
        side.requests.filter((r) => r.squadronId === sq.id).map((r) => h('div', { class: 'bubble' }, requestCard(app, side, r)))),
      h('div', { class: 'dh-stats' },
        stat('Aircraft', `${flyable(sq).length}/${sq.airframes.length}`, repairs ? `${repairs} in repair` : 'ready / on strength'),
        stat('Crews', String(sq.crews), sq.crews < sq.airframes.length ? 'short of crews' : 'enough to fly them'),
        h('div', { class: 'stat', ...tip({ head: 'Skill', text: 'Gunnery and flying. Rises with experience, falls as veterans are replaced by new crews.' }) }, h('span', null, 'Skill'), meter(sq.skill, 1, 8)),
        h('div', { class: 'stat', ...tip({ head: 'Morale', text: 'Falls with losses. If the wing\'s average stays very low for three weeks, the crews refuse to fly.' }) }, h('span', null, 'Morale'), meter(sq.morale, 1, 8, sq.morale < 0.3 ? 'bad' : '')),
        h('div', { class: 'stat', ...tip({ head: 'Fatigue', text: 'Rises every week the squadron flies, falls by about a third when it rests. Tired crews shoot and fly worse; above 6/10 morale slides.' }) }, h('span', null, 'Fatigue'), meter(sq.fatigue, 1, 8, sq.fatigue > 0.6 ? 'bad' : 'warn')),
      ),
    ),
    h('div', { class: 'dossier-cols' },
      h('section', { class: 'paper panel' }, doctrinePanel(app, side, sq)),
      h('section', { class: 'paper panel' }, armorEditor(app, side, sq)),
    ),
    h('section', { class: 'paper panel' }, modsPanel(app, side, sq)),
    fleet(side, sq),
    sq.leader.log?.length || sq.notables.length ? h('section', { class: 'paper panel' },
      h('h2', null, 'Squadron record'),
      sq.notables.length ? h('ul', { class: 'notables' }, sq.notables.slice(0, 4).map((n) => h('li', null, n))) : null,
      sq.leader.log?.length ? h('ul', { class: 'notables' }, [...sq.leader.log].reverse().slice(0, 6).map((e) => h('li', null, `Week ${e.week}: ${e.text}.`))) : null) : null,
  );
}

function stat(label: string, value: string, sub: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', null, label), h('b', null, value), h('small', { class: 'muted' }, sub));
}

/* ---------------- Armor over the evidence ---------------- */

function survivorHits(app: App, side: SideState, sq: Squadron): Hit[] {
  // Every hole the ground crews logged on this type over the last ten weeks.
  return app.state!.archive.slice(-10).flatMap((e) => e.survivorHits[side.id]).filter((x) => (x.kind ?? 'medium') === sq.kind);
}

function armorEditor(app: App, side: SideState, sq: Squadron): HTMLElement {
  const budget = armorBudget(sq);
  const used = armorUsed(sq);
  const comp = survivorHits(app, side, sq);
  const holes: Record<string, number> = {};
  for (const x of comp) holes[x.zone] = (holes[x.zone] ?? 0) + 1;
  const total = comp.length || 1;
  const calls = side.perceived.lastCalls?.[sq.kind];
  const sameType = side.squadrons.filter((q) => q !== sq && q.kind === sq.kind);
  const all = armorWholeType && sameType.length > 0;
  const set = (z: ZoneId, v: number) => app.cmd(side.id, { k: 'armor', sq: sq.id, zone: z, value: v, all });

  const def = spriteDef(sq.kind);
  const scale = Math.max(3, Math.min(9, Math.floor(400 / def.w)));
  const opts = { side: side.id, style: 'blueprint' as const, zonePlates: sq.armor, hits: comp, dots: true, bigDots: true };
  const c = aircraftCanvas(sq.kind, opts, scale);
  c.classList.add('armor-canvas');
  // A badge on every plated zone with its number of plates: the drawing says where the armor is without hovering.
  const centres = zoneCentres(sq.kind);
  const badges = new Map<ZoneId, HTMLElement>();
  for (const z of ZONES) {
    const at = centres[z];
    if (!at) continue;
    const b = h('span', { class: `plate-badge p${Math.min(3, sq.armor[z])}`, style: `left:${at[0] * scale}px;top:${at[1] * scale}px` }, sq.armor[z] ? String(sq.armor[z]) : '');
    badges.set(z, b);
  }
  let lit: ZoneId | null = null;
  const highlight = (z: ZoneId | null) => {
    if (z === lit) return;
    lit = z;
    repaintAircraft(c, sq.kind, z ? { ...opts, zoneTint: { [z]: '#4f9fc0' } } : opts);
    for (const [k, b] of badges) b.classList.toggle('lit', k === z);
    for (const r of rowsByZone.values()) r.classList.remove('lit');
    if (z) rowsByZone.get(z)?.classList.add('lit');
  };
  const zoneUnder = (e: MouseEvent) => {
    const r = c.getBoundingClientRect();
    return zoneAt(sq.kind, ((e.clientX - r.left) / r.width) * def.w, ((e.clientY - r.top) / r.height) * def.h);
  };
  const zoneTip = (z: ZoneId) => ({
    head: ZONE_LABEL[z],
    text: `${sq.armor[z]} of ${MAX_ARMOR_PER_ZONE} plates. ${holes[z] ?? 0} holes found on returning aircraft${calls?.[z] ? `; ${plural(calls[z], 'crew')} who did not return called it out` : ''}. Click to add a plate, right-click to take one off.`,
  });
  c.addEventListener('mousemove', (e) => {
    const z = zoneUnder(e);
    c.style.cursor = z ? 'pointer' : '';
    setTip(c, z ? zoneTip(z) : null);
    highlight(z);
  });
  c.addEventListener('mouseleave', () => highlight(null));
  c.addEventListener('click', (e) => { const z = zoneUnder(e); if (z) set(z, sq.armor[z] + 1); });
  c.addEventListener('contextmenu', (e) => { e.preventDefault(); const z = zoneUnder(e); if (z) set(z, sq.armor[z] - 1); });
  const callTotal = calls ? ZONES.reduce((a, z) => a + (calls[z] ?? 0), 0) : 0;
  const rowsByZone = new Map<ZoneId, HTMLElement>();
  const rows = ZONES.map((z) => {
    const r = h('tr', { ...tip(zoneTip(z)), class: sq.armor[z] ? 'plated' : '', onmouseenter: () => highlight(z), onmouseleave: () => highlight(null) },
      h('td', null, h('i', { class: `zone-swatch p${Math.min(3, sq.armor[z])}` }), ZONE_LABEL[z]),
      h('td', { class: 'plates' }, Array.from({ length: MAX_ARMOR_PER_ZONE }, (_, i) => h('i', { class: i < sq.armor[z] ? 'on' : '' }))),
      h('td', null,
        h('button', { class: 'btn tiny', disabled: sq.armor[z] === 0, onclick: () => set(z, sq.armor[z] - 1) }, '−'),
        h('button', { class: 'btn tiny', disabled: sq.armor[z] >= MAX_ARMOR_PER_ZONE || used >= budget, onclick: () => set(z, sq.armor[z] + 1) }, '+')),
      h('td', { class: 'num' }, comp.length ? h('span', { class: 'holes' }, `${holes[z] ?? 0}`, h('small', null, ` ${Math.round(((holes[z] ?? 0) / total) * 100)}%`)) : '—'),
      h('td', { class: 'num lastcall' }, calls?.[z] ? `📻 ${calls[z]}` : ''));
    rowsByZone.set(z, r);
    return r;
  });
  const legend = h('div', { class: 'armor-legend' },
    h('span', null, h('i', { class: 'zone-swatch p0' }), 'no plate'),
    [1, 2, 3].map((n) => h('span', null, h('i', { class: `zone-swatch p${n}`, style: `background:${PLATE_FILL[n]}` }), plural(n, 'plate'))),
    h('span', null, h('i', { class: 'hole-swatch' }), 'hole on a returning aircraft'));
  return h('div', { class: 'armor-editor' },
    h('h3', null, `Armor · ${AIRCRAFT[sq.kind].name[side.id]}`),
    sameType.length ? h('div', { class: 'seg mini scope' },
      h('button', { class: `seg-btn ${all ? 'on' : ''}`, ...tip(`Every change is made on ${[sq, ...sameType].map((q) => q.name).join(', ')} at once.`), onclick: () => { armorWholeType = true; app.render(); } }, `All ${sameType.length + 1} ${AIRCRAFT[sq.kind].name[side.id]} squadrons`),
      h('button', { class: `seg-btn ${!all ? 'on' : ''}`, onclick: () => { armorWholeType = false; app.render(); } }, 'This squadron only')) : null,
    h('div', { class: 'blueprint-wrap' }, h('div', { class: 'blueprint-stage' }, c, [...badges.values()])),
    legend,
    h('p', { class: 'handwritten fitter' }, comp.length > 30 ? 'Steel grey is plate, lighter for more; the number is how many plates. Orange crosses are holes on aircraft that came back: they show where an aircraft can be hit and still come home.' : 'Too few returns yet to see a pattern. Steel grey is plate (the number counts the plates); orange marks are holes on aircraft that came back.'),
    h('div', { class: 'weight', ...tip({ head: 'Weight', text: 'Each plate adds weight: a slower aircraft is caught more often and an armored fighter is less nimble.' }) },
      h('span', null, `Plates ${used}/${budget}`),
      h('span', { class: `weight-bar ${used > AIRCRAFT[sq.kind].armorBudget / 2 ? 'heavy' : ''}` }, h('i', { style: `width:${Math.min(100, (used / budget) * 100)}%` })),
      h('span', { class: 'small muted' }, `${COSTS.armorChange} supplies a plate${all ? ' per squadron' : ''}; removing is free`)),
    h('table', { class: 'armor-table' },
      h('thead', null, h('tr', null, h('th', null, 'Zone'), h('th', null, 'Plates'), h('th', null, ''), h('th', null, 'Holes seen'), h('th', null, callTotal ? 'Last calls' : ''))),
      h('tbody', null, rows)),
    callTotal ? h('p', { class: 'small muted' }, `Last calls: what ${plural(callTotal, 'crew')} who did not come back said over the radio as they went down.`) : null,
  );
}

/* ---------------- Field modifications ---------------- */

function modsPanel(app: App, side: SideState, sq: Squadron): HTMLElement {
  const fitted = sq.mods ?? [];
  const sameType = side.squadrons.filter((q) => q !== sq && q.kind === sq.kind);
  const all = armorWholeType && sameType.length > 0;
  const free = side.freeMods ?? 0;
  const open = availableMods(side, sq);
  const locked = MOD_IDS.map((id) => MODS[id]).filter((m) => m.rare && m.kinds.includes(sq.kind) && !open.includes(m));
  const full = fitted.length >= MOD_SLOTS;
  return h('div', { class: 'mods' },
    h('h2', null, 'Field modifications'),
    h('p', { class: 'small muted' }, `Kits fitted by the squadron's own fitters. Room for ${MOD_SLOTS}; taking one off refunds nothing.${all ? ` Changes are made on every ${AIRCRAFT[sq.kind].name[side.id]} squadron (see Armor).` : ''}${free ? ` ${plural(free, 'kit')} from High Command: the next ${free === 1 ? 'fitting costs' : `${free} fittings cost`} nothing.` : ''}`),
    h('div', { class: 'mod-slots' }, Array.from({ length: MOD_SLOTS }, (_, i) => {
      const m = fitted[i] ? MODS[fitted[i]] : null;
      return h('div', { class: `mod-slot ${m ? 'on' : ''}` }, m
        ? [h('b', null, m.name), h('button', { class: 'btn tiny', ...tip('Take it off (nothing refunded)'), onclick: () => app.cmd(side.id, { k: 'mod', sq: sq.id, mod: m.id, on: false, all }) }, '✕')]
        : h('span', { class: 'muted' }, 'empty slot'));
    })),
    h('div', { class: 'mod-list' },
      open.filter((m) => !fitted.includes(m.id)).map((m) => h('div', { class: `mod-card ${m.rare ? 'rare' : ''}` },
        h('div', { class: 'mod-name' }, m.name, m.rare ? h('span', { class: 'mod-rare' }, ' PROTOTYPE') : null),
        h('div', { class: 'small' }, m.desc),
        h('button', { class: 'btn small', disabled: full || (!free && side.resources.supplies < m.cost), ...tip(full ? 'Both slots are taken: take a modification off first.' : 'Fit to this squadron\'s aircraft.'), onclick: () => app.cmd(side.id, { k: 'mod', sq: sq.id, mod: m.id, on: true, all }) }, free ? 'Fit (free)' : `Fit (${m.cost})`))),
      locked.map((m) => h('div', { class: 'mod-card locked', ...tip({ head: m.name, text: m.desc }) },
        h('div', { class: 'mod-name' }, m.name),
        h('div', { class: 'small muted' }, 'A prototype. Released only by High Command, as a rare offer.')))),
  );
}

/* ---------------- Aircraft ---------------- */

function fleet(side: SideState, sq: Squadron): HTMLElement {
  const worn = sq.airframes.filter((a) => a.status === 'repair' || a.condition < 100);
  const fine = sq.airframes.filter((a) => !worn.includes(a));
  return h('section', { class: 'paper panel' },
    h('h2', null, `Aircraft of ${sq.name}`),
    h('div', { class: 'fleet' },
      worn.map((af) => h('div', { class: `airframe ${af.status}` },
        aircraftCanvas(af.kind, { side: side.id, seed: sq.insignia + af.sorties, hits: af.hits, patches: af.patches }, 2),
        h('div', { class: 'af-serial' }, af.serial),
        h('div', { class: 'small' }, af.status === 'repair' ? `In repair (${af.repairTurns}w)` : `${af.condition}% · ${af.sorties} sorties`),
        meter(af.condition, 100, 6, af.condition < 50 ? 'bad' : ''))),
      fine.length ? h('div', { class: 'fleet-fine' },
        h('div', { class: 'fine-sprites' }, fine.slice(0, 12).map((af) => h('span', tip(`${af.serial} · ${af.sorties} sorties`), aircraftCanvas(af.kind, { side: side.id, seed: sq.insignia + af.sorties, patches: af.patches }, 1)))),
        h('div', { class: 'small muted' }, `${fine.length} serviceable, undamaged`)) : null,
      sq.airframes.length === 0 ? h('p', { class: 'muted' }, 'No aircraft on strength.') : null));
}

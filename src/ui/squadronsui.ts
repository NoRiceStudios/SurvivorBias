/**
 * Squadrons: a roster on the left, the selected squadron's dossier on the right.
 * The dossier holds the leader, the doctrine with what it does, the armor laid
 * over the evidence (holes on the aircraft that came back, last calls of those
 * that did not), and the aircraft themselves.
 */
import { spec } from '../core/factions';
import { nationAt } from './nation';
import { armorUsed, COSTS } from '../core/actions';
import { AIRCRAFT, ARCHETYPE_INFO, MAX_ARMOR_PER_ZONE, TRAIT_INFO, ZONE_LABEL } from '../core/data';
import { flyable } from '../core/sim';
import { describeFlightCommander } from '../core/turn';
import type { Archetype, Hit, SideState, Squadron, ZoneId } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { doctrinePanel } from './doctrine';
import { h, meter, plural } from './dom';
import { leaderPortrait } from './general';
import { aircraftCanvas, spriteDef, zoneAt } from './sprites';
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
      return h('div', { class: 'ws-row', ...tip({ head: nationAt(side.id).aircraft[k], text: `${have} aircraft, ${crews} crews, ${onOrder} on order. Lost in the last three weeks: ${lost3}.` }) },
        h('span', null, nationAt(side.id).aircraft[k]), h('b', null, `${have}`), h('small', { class: 'muted' }, ` a/c · ${crews} crews`),
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
        h('div', { class: 'rr-sub' }, `${nationAt(side.id).aircraft[q.kind]} · ${flyable(q).length}/${q.airframes.length}`),
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
        h('div', { class: 'dh-type' }, `${nationAt(side.id).aircraft[sq.kind]}, ${AIRCRAFT[sq.kind].role.toLowerCase()}`),
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
  const budget = spec(side, sq.kind).armorBudget;
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
  const c = aircraftCanvas(sq.kind, { side: side.id, style: 'blueprint', zonePlates: sq.armor, hits: comp, dots: true, bigDots: true }, scale);
  c.classList.add('armor-canvas');
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
  });
  c.addEventListener('click', (e) => { const z = zoneUnder(e); if (z) set(z, sq.armor[z] + 1); });
  c.addEventListener('contextmenu', (e) => { e.preventDefault(); const z = zoneUnder(e); if (z) set(z, sq.armor[z] - 1); });
  const callTotal = calls ? ZONES.reduce((a, z) => a + (calls[z] ?? 0), 0) : 0;
  const rows = ZONES.map((z) => h('tr', tip(zoneTip(z)),
    h('td', null, ZONE_LABEL[z]),
    h('td', { class: 'plates' }, Array.from({ length: MAX_ARMOR_PER_ZONE }, (_, i) => h('i', { class: i < sq.armor[z] ? 'on' : '' }))),
    h('td', null,
      h('button', { class: 'btn tiny', disabled: sq.armor[z] === 0, onclick: () => set(z, sq.armor[z] - 1) }, '−'),
      h('button', { class: 'btn tiny', disabled: sq.armor[z] >= MAX_ARMOR_PER_ZONE || used >= budget, onclick: () => set(z, sq.armor[z] + 1) }, '+')),
    h('td', { class: 'num' }, comp.length ? h('span', { class: 'holes' }, `${holes[z] ?? 0}`, h('small', null, ` ${Math.round(((holes[z] ?? 0) / total) * 100)}%`)) : '—'),
    h('td', { class: 'num lastcall' }, calls?.[z] ? `📻 ${calls[z]}` : '')));
  return h('div', { class: 'armor-editor' },
    h('h3', null, `Armor · ${nationAt(side.id).aircraft[sq.kind]}`),
    sameType.length ? h('div', { class: 'seg mini scope' },
      h('button', { class: `seg-btn ${all ? 'on' : ''}`, ...tip(`Every change is made on ${[sq, ...sameType].map((q) => q.name).join(', ')} at once.`), onclick: () => { armorWholeType = true; app.render(); } }, `All ${sameType.length + 1} ${nationAt(side.id).aircraft[sq.kind]} squadrons`),
      h('button', { class: `seg-btn ${!all ? 'on' : ''}`, onclick: () => { armorWholeType = false; app.render(); } }, 'This squadron only')) : null,
    h('div', { class: 'blueprint-wrap' }, c),
    h('p', { class: 'handwritten fitter' }, comp.length > 30 ? 'Orange crosses: holes on aircraft that came back. White hatching: plate. The holes show where an aircraft can be hit and still come home.' : 'Too few returns yet to see a pattern. Orange marks are holes on aircraft that came back; white hatching is plate.'),
    h('div', { class: 'weight', ...tip({ head: 'Weight', text: 'Each plate adds weight: a slower aircraft is caught more often and an armored fighter is less nimble.' }) },
      h('span', null, `Plates ${used}/${budget}`),
      h('span', { class: `weight-bar ${used > budget / 2 ? 'heavy' : ''}` }, h('i', { style: `width:${(used / budget) * 100}%` })),
      h('span', { class: 'small muted' }, `${COSTS.armorChange} supplies a plate${all ? ' per squadron' : ''}; removing is free`)),
    h('table', { class: 'armor-table' },
      h('thead', null, h('tr', null, h('th', null, 'Zone'), h('th', null, 'Plates'), h('th', null, ''), h('th', null, 'Holes seen'), h('th', null, callTotal ? 'Last calls' : ''))),
      h('tbody', null, rows)),
    callTotal ? h('p', { class: 'small muted' }, `Last calls: what ${plural(callTotal, 'crew')} who did not come back said over the radio as they went down.`) : null,
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

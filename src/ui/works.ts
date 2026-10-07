/**
 * Works: the aircraft works, the training school and the development projects
 * on one screen, stacked. The works and the school each show their building
 * across the full width, with their controls in columns beneath it. Every
 * locked or unaffordable action says why.
 */
import { researchCost, spec as buildSpec } from '../core/factions';
import { nationAt } from './nation';
import { canBuild, COSTS, crewNeed, crewPrice, researchTurns } from '../core/actions';
import { AIRCRAFT, BRANCHES, RESEARCH } from '../core/data';
import { crewShortfall, LIVE_FIRE_STORES } from '../core/turn';
import type { AircraftKind, SideState, TrainingFocus } from '../core/types';
import type { App } from './app';
import { schoolScene, worksScene } from './buildings';
import { h, meter } from './dom';
import { aircraftCanvas } from './sprites';
import { tip } from './tip';
import { seg } from './widgets';

const short = (s: number, have: number) => (have < s ? `short ${s - have}` : '');

export function worksScreen(app: App, side: SideState): HTMLElement {
  return h('div', { class: 'works' }, factoryCol(app, side), schoolCol(app, side), researchCol(app, side));
}

function banner(scene: HTMLElement): HTMLElement {
  return h('div', { class: 'banner' }, scene);
}

/** The controls under a building, in columns side by side. */
function cols(...parts: (HTMLElement | null)[][]): HTMLElement {
  return h('div', { class: 'works-cols' }, parts.map((p) => h('div', { class: 'works-sub' }, p)));
}

function factoryCol(app: App, side: SideState): HTMLElement {
  const f = side.factory;
  const sup = side.resources.supplies;
  const rate = (2 + f.level * 2.5) * (0.4 + 0.6 * side.facilities.industry / 100) * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
  const kinds: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
  let cum = -f.progress;
  const queue = f.queue.map((k, i) => {
    cum += AIRCRAFT[k].build;
    const weeks = Math.max(1, Math.ceil(cum / Math.max(0.1, rate)));
    return h('li', null, h('span', null, nationAt(side.id).aircraft[k]), h('span', { class: 'small muted' }, ` arrives wk ${app.state!.turn + weeks}`),
      h('button', { class: 'btn tiny', ...tip('Cancel the order (supplies refunded)'), onclick: () => app.cmd(side.id, { k: 'cancel', i }) }, '✕'));
  });
  const upCost = COSTS.factoryUpgrade(f.level);
  return h('section', { class: 'paper panel works-col works-factory' },
    banner(worksScene(side)),
    cols([
      h('div', { class: 'kv' },
        h('span', null, 'Level'), h('b', null, `${f.level}/5`),
        h('span', tip({ head: 'Works condition', text: 'Enemy bombing wrecks our works; output falls with it. Emergency repairs are under Intelligence.' }), 'Condition'), meter(side.facilities.industry, 100, 10, side.facilities.industry < 50 ? 'bad' : ''),
        h('span', tip('Build points a week. Each aircraft takes a number of points.'), 'Output'), h('b', null, `${rate.toFixed(1)} pts/wk`)),
      h('button', { class: 'btn small', disabled: f.level >= 5 || sup < upCost, ...tip({ text: 'More output every week.', effect: `+2.5 pts/week for ${upCost} supplies` }), onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'factory' }) }, f.level >= 5 ? 'Fully expanded' : `Expand (${upCost})`, short(upCost, sup) ? h('small', null, ` ${short(upCost, sup)}`) : null),
      h('h3', tip({ head: 'Quality control', text: 'Rushed production is faster, but some aircraft will have faults nobody finds until they fail in the air.' }), 'Quality control'),
      seg([{ value: 'rushed', label: 'Rushed', tip: { text: 'Faster, with hidden faults.', effect: '+40% output' } }, { value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict', tip: { text: 'Slower, sound aircraft.', effect: '−25% output' } }], f.qc, (v) => app.cmd(side.id, { k: 'qc', v }), 'mini'),
    ], [
      h('h3', null, 'Order aircraft'),
      h('div', { class: 'build-list' }, kinds.map((k) => {
        const spec = buildSpec(side, k);
        const ok = canBuild(side, k);
        const req = RESEARCH.find((r) => r.id === spec.requires)?.name;
        return h('div', { class: `build ${ok ? '' : 'locked'}`, ...tip({ head: nationAt(side.id).aircraft[k], text: `${spec.role}. Crew of ${spec.crew}. ${spec.build} build points.` }) },
          aircraftCanvas(k, { side: side.id, seed: 2 }, 1),
          h('div', { class: 'b-name' }, h('div', { class: 'sq-name' }, nationAt(side.id).aircraft[k]), ok ? null : h('div', { class: 'small muted' }, `Needs ${req}`)),
          ok ? h('button', { class: 'btn small', disabled: sup < spec.cost, onclick: () => app.cmd(side.id, { k: 'build', kind: k }) }, `Order ${spec.cost}`) : null);
      })),
    ], [
      h('h3', null, 'On order'),
      queue.length ? h('ol', { class: 'queue', ...tip('New aircraft join the squadron of their type with the fewest machines.') }, queue) : h('p', { class: 'small muted' }, 'Nothing on order.'),
      h('h3', null, 'Ground defences'),
      h('div', { class: 'small' }, `Flak around our works and airfields: ${Math.round(side.flak * 100)}`),
      h('button', { class: 'btn small', disabled: side.flak >= 1.5 || sup < COSTS.flakUpgrade(side.flak) || side.resources.stores < 20, onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'flak' }) }, side.flak >= 1.5 ? 'Flak at maximum' : `Add batteries (${COSTS.flakUpgrade(side.flak)} + 20 stores)`),
    ]),
  );
}

function schoolCol(app: App, side: SideState): HTMLElement {
  const t = side.training;
  const sup = side.resources.supplies;
  const up = COSTS.trainingUpgrade(t.level);
  const focus: { value: TrainingFocus; label: string; tip: string }[] = [
    { value: 'balanced', label: 'Balanced', tip: 'The standard syllabus.' },
    { value: 'gunnery', label: 'Gunnery', tip: 'Better shots. Graduates start more skilled.' },
    { value: 'evasion', label: 'Evasion', tip: 'Better at staying alive. Graduates start more skilled.' },
    { value: 'reporting', label: 'Reporting', tip: 'Observation and debrief discipline: reports are more accurate, combat skill suffers.' },
  ];
  return h('section', { class: 'paper panel works-col works-school' },
    banner(schoolScene(side)),
    cols([
      h('div', { class: 'kv' },
        h('span', null, 'Level'), h('b', null, `${t.level}/5`),
        h('span', null, 'Intake a week'), h('b', null, `${1 + t.level * 2} crews`),
        h('span', null, 'In training'), h('b', null, String(t.inTraining)),
        h('span', tip('Recruits waiting for a place at the school.'), 'Awaiting intake'), h('b', null, String(side.resources.replacements)),
        h('span', { class: crewNeed(side) ? 'bad' : '' }, 'Aircraft without crews'), h('b', { class: crewNeed(side) ? 'bad' : '' }, String(crewNeed(side)))),
      h('button', { class: 'btn small', disabled: t.level >= 5 || sup < up, ...tip({ text: `Takes more pupils at once and turns out better shots. Pays when many aircraft wait for crews (now ${crewShortfall(side)}).`, effect: `+2 intake a week for ${up} supplies` }), onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'training' }) }, t.level >= 5 ? 'Fully expanded' : `Expand (${up})`),
    ], [
      h('h3', null, 'Trained crews from the Ministry'),
      h('div', { class: 'small muted' }, `${crewPrice(side)} supplies each; dearer the less High Command trusts you.`),
      h('div', null, [1, 3].map((n) => h('button', { class: 'btn small', disabled: crewNeed(side) === 0 || sup < n * crewPrice(side), onclick: () => app.cmd(side.id, { k: 'crews', n }) }, `+${n} (${n * crewPrice(side)})`))),
      crewNeed(side) === 0 ? h('div', { class: 'small muted' }, 'Not needed: every aircraft has a crew.') : null,
    ], [
      h('h3', tip('Crews follow the aircraft: the Ministry posts aircrew, and the school takes pupils, only for aircraft the wing has or has on order.'), 'Syllabus'),
      seg(focus.map((f) => ({ value: f.value, label: f.label, tip: f.tip })), t.focus, (v) => app.cmd(side.id, { k: 'focus', v }), 'mini'),
      h('div', { class: 'small muted' }, focus.find((f) => f.value === t.focus)?.tip),
      h('h3', tip('Pupils fly with live ammunition and real fuel. Their graduates start more skilled, but every pupil uses stores each week. If the depots cannot spare them, the class trains on the ground.'), 'Live-fire practice'),
      seg<number>([
        { value: 0, label: 'Ground school', tip: 'No stores used.' },
        { value: 1, label: 'Live fire', tip: { text: 'Graduates start noticeably more skilled.', effect: `− ${LIVE_FIRE_STORES} stores a week per pupil (up to ${(1 + t.level * 2) * LIVE_FIRE_STORES})` } },
      ], t.liveFire ? 1 : 0, (v) => app.cmd(side.id, { k: 'liveFire', on: v === 1 }), 'mini'),
      t.liveFire && t.inTraining > 0 ? h('div', { class: 'small muted' }, t.liveFireClass ? `This class is on live fire (${t.inTraining * LIVE_FIRE_STORES} stores paid).` : 'This class trains on the ground: the depots could not spare the stores.') : null,
    ]),
  );
}

function researchCol(app: App, side: SideState): HTMLElement {
  const current = RESEARCH.find((r) => r.id === side.researching);
  const sup = side.resources.supplies;
  const done = RESEARCH.filter((r) => side.research.includes(r.id)).length;
  return h('section', { class: 'paper panel works-col works-research' },
    h('h2', null, 'Development'),
    current
      ? h('div', { class: 'in-works' }, h('span', { class: 'stamp order' }, 'IN THE WORKS'), ' ', h('b', null, current.name),
        h('div', { class: 'progress' }, h('i', { style: `width:${(side.researchProgress / researchTurns(researchCost(side, current))) * 100}%` })),
        h('div', { class: 'small muted' }, `${side.researchProgress}/${researchTurns(researchCost(side, current))} weeks · ${current.desc}`))
      : h('p', { class: 'small warnc' }, 'Engineers idle: fund one project. One at a time.'),
    h('div', { class: 'small muted' }, `${done} of ${RESEARCH.length} in service.`),
    BRANCHES.map((b) => {
      // A lane per branch on a fixed grid of tiers: a project sits one column right of the one it builds on.
      const items = RESEARCH.filter((r) => r.branch === b.id);
      const tier = (r: (typeof items)[number]): number => {
        const parent = items.find((x) => x.id === r.requires);
        return parent ? tier(parent) + 1 : 0;
      };
      return h('div', { class: 'lane' },
        h('div', { class: 'lane-name' }, b.name),
        h('div', { class: 'lane-grid' }, items.map((r) => {
          const isDone = side.research.includes(r.id);
          const locked = !!r.requires && !side.research.includes(r.requires);
          const active = side.researching === r.id;
          const need = RESEARCH.find((x) => x.id === r.requires)?.name;
          const can = !isDone && !active && !locked && !side.researching && sup >= researchCost(side, r);
          return h('button', {
            class: `r-chip ${isDone ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''} ${can ? 'can' : ''}`,
            style: `grid-column:${tier(r) + 1}`,
            ...tip({ head: r.name, text: r.desc, effect: isDone ? 'in service' : locked ? `-needs ${need}` : `${researchCost(side, r)} supplies, ${researchTurns(researchCost(side, r))} weeks` }),
            disabled: !can,
            onclick: () => app.cmd(side.id, { k: 'research', id: r.id }),
          }, h('span', { class: 'r-name' }, `${tier(r) ? '▸ ' : ''}${r.name}`), h('span', { class: 'r-sub' }, isDone ? '✓ in service' : active ? 'in the works' : locked ? 'locked' : `${researchCost(side, r)} · ${researchTurns(researchCost(side, r))}w`));
        })));
    }),
  );
}

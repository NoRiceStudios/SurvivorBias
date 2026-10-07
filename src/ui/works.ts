/**
 * Works: the aircraft works, the training school and the development projects
 * on one screen, in three columns. Every locked or unaffordable action says why.
 */
import { canBuild, COSTS, crewNeed, crewPrice, researchTurns } from '../core/actions';
import { AIRCRAFT, BRANCHES, RESEARCH } from '../core/data';
import { crewShortfall } from '../core/turn';
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

function factoryCol(app: App, side: SideState): HTMLElement {
  const f = side.factory;
  const sup = side.resources.supplies;
  const rate = (2 + f.level * 2.5) * (0.4 + 0.6 * side.facilities.industry / 100) * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
  const kinds: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
  let cum = -f.progress;
  const queue = f.queue.map((k, i) => {
    cum += AIRCRAFT[k].build;
    const weeks = Math.max(1, Math.ceil(cum / Math.max(0.1, rate)));
    return h('li', null, h('span', null, AIRCRAFT[k].name[side.id]), h('span', { class: 'small muted' }, ` arrives wk ${app.state!.turn + weeks}`),
      h('button', { class: 'btn tiny', ...tip('Cancel the order (supplies refunded)'), onclick: () => app.cmd(side.id, { k: 'cancel', i }) }, '✕'));
  });
  const upCost = COSTS.factoryUpgrade(f.level);
  return h('section', { class: 'paper panel works-col works-factory' },
    banner(worksScene(side)),
    h('h2', null, 'Aircraft works'),
    h('div', { class: 'kv' },
      h('span', null, 'Level'), h('b', null, `${f.level}/5`),
      h('span', tip({ head: 'Works condition', text: 'Enemy bombing wrecks our works; output falls with it. Emergency repairs are under Intelligence.' }), 'Condition'), meter(side.facilities.industry, 100, 10, side.facilities.industry < 50 ? 'bad' : ''),
      h('span', tip('Build points a week. Each aircraft takes a number of points.'), 'Output'), h('b', null, `${rate.toFixed(1)} pts/wk`)),
    h('button', { class: 'btn small', disabled: f.level >= 5 || sup < upCost, ...tip({ text: 'More output every week.', effect: `+2.5 pts/week for ${upCost} supplies` }), onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'factory' }) }, f.level >= 5 ? 'Fully expanded' : `Expand (${upCost})`, short(upCost, sup) ? h('small', null, ` ${short(upCost, sup)}`) : null),
    h('h3', null, 'Order aircraft'),
    h('div', { class: 'build-list' }, kinds.map((k) => {
      const spec = AIRCRAFT[k];
      const ok = canBuild(side, k);
      const req = RESEARCH.find((r) => r.id === spec.requires)?.name;
      return h('div', { class: `build ${ok ? '' : 'locked'}`, ...tip({ head: spec.name[side.id], text: `${spec.role}. Crew of ${spec.crew}. ${spec.build} build points.` }) },
        aircraftCanvas(k, { side: side.id, seed: 2 }, 1),
        h('div', { class: 'b-name' }, h('div', { class: 'sq-name' }, spec.name[side.id]), ok ? null : h('div', { class: 'small muted' }, `Needs ${req}`)),
        ok ? h('button', { class: 'btn small', disabled: sup < spec.cost, onclick: () => app.cmd(side.id, { k: 'build', kind: k }) }, `Order ${spec.cost}`) : null);
    })),
    h('h3', null, 'On order'),
    queue.length ? h('ol', { class: 'queue', ...tip('New aircraft join the squadron of their type with the fewest machines.') }, queue) : h('p', { class: 'small muted' }, 'Nothing on order.'),
    h('h3', tip({ head: 'Quality control', text: 'Rushed production is faster, but some aircraft will have faults nobody finds until they fail in the air.' }), 'Quality control'),
    seg([{ value: 'rushed', label: 'Rushed', tip: { text: 'Faster, with hidden faults.', effect: '+40% output' } }, { value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict', tip: { text: 'Slower, sound aircraft.', effect: '−25% output' } }], f.qc, (v) => app.cmd(side.id, { k: 'qc', v }), 'mini'),
    h('h3', null, 'Ground defences'),
    h('div', { class: 'small' }, `Flak around our works and airfields: ${Math.round(side.flak * 100)}`),
    h('button', { class: 'btn small', disabled: side.flak >= 1.5 || sup < COSTS.flakUpgrade(side.flak) || side.resources.stores < 20, onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'flak' }) }, side.flak >= 1.5 ? 'Flak at maximum' : `Add batteries (${COSTS.flakUpgrade(side.flak)} + 20 stores)`),
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
    h('h2', null, 'Training school'),
    h('div', { class: 'kv' },
      h('span', null, 'Level'), h('b', null, `${t.level}/5`),
      h('span', null, 'Intake a week'), h('b', null, `${1 + t.level * 2} crews`),
      h('span', null, 'In training'), h('b', null, String(t.inTraining)),
      h('span', tip('Recruits waiting for a place at the school.'), 'Awaiting intake'), h('b', null, String(side.resources.replacements)),
      h('span', { class: crewNeed(side) ? 'bad' : '' }, 'Aircraft without crews'), h('b', { class: crewNeed(side) ? 'bad' : '' }, String(crewNeed(side)))),
    h('button', { class: 'btn small', disabled: t.level >= 5 || sup < up, ...tip({ text: `Takes more pupils at once and turns out better shots. Pays when many aircraft wait for crews (now ${crewShortfall(side)}).`, effect: `+2 intake a week for ${up} supplies` }), onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'training' }) }, t.level >= 5 ? 'Fully expanded' : `Expand (${up})`),
    h('h3', null, 'Trained crews from the Ministry'),
    h('div', { class: 'small muted' }, `${crewPrice(side)} supplies each; dearer the less High Command trusts you.`),
    h('div', null, [1, 3].map((n) => h('button', { class: 'btn small', disabled: crewNeed(side) === 0 || sup < n * crewPrice(side), onclick: () => app.cmd(side.id, { k: 'crews', n }) }, `+${n} (${n * crewPrice(side)})`))),
    crewNeed(side) === 0 ? h('div', { class: 'small muted' }, 'Not needed: every aircraft has a crew.') : null,
    h('h3', tip('Crews follow the aircraft: the Ministry posts aircrew, and the school takes pupils, only for aircraft the wing has or has on order.'), 'Syllabus'),
    seg(focus.map((f) => ({ value: f.value, label: f.label, tip: f.tip })), t.focus, (v) => app.cmd(side.id, { k: 'focus', v }), 'mini'),
    h('div', { class: 'small muted' }, focus.find((f) => f.value === t.focus)?.tip),
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
        h('div', { class: 'progress' }, h('i', { style: `width:${(side.researchProgress / researchTurns(current.cost)) * 100}%` })),
        h('div', { class: 'small muted' }, `${side.researchProgress}/${researchTurns(current.cost)} weeks · ${current.desc}`))
      : h('p', { class: 'small warnc' }, 'Engineers idle: fund one project. One at a time.'),
    h('div', { class: 'small muted' }, `${done} of ${RESEARCH.length} in service.`),
    BRANCHES.map((b) => {
      // A lane per branch: each project followed by the ones that build on it.
      const items = RESEARCH.filter((r) => r.branch === b.id);
      const ordered: typeof items = [];
      const visit = (r: (typeof items)[number]) => { ordered.push(r); for (const c of items.filter((x) => x.requires === r.id)) visit(c); };
      for (const r of items.filter((x) => !x.requires || !items.some((y) => y.id === x.requires))) visit(r);
      return h('div', { class: 'lane' },
        h('div', { class: 'lane-name' }, b.name),
        h('div', { class: 'lane-chips' }, ordered.map((r, i) => {
          const isDone = side.research.includes(r.id);
          const locked = !!r.requires && !side.research.includes(r.requires);
          const active = side.researching === r.id;
          const need = RESEARCH.find((x) => x.id === r.requires)?.name;
          const can = !isDone && !active && !locked && !side.researching && sup >= r.cost;
          const chip = h('button', {
            class: `r-chip ${isDone ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''} ${can ? 'can' : ''}`,
            ...tip({ head: r.name, text: r.desc, effect: isDone ? 'in service' : locked ? `-needs ${need}` : `${r.cost} supplies, ${researchTurns(r.cost)} weeks` }),
            disabled: !can,
            onclick: () => app.cmd(side.id, { k: 'research', id: r.id }),
          }, h('span', { class: 'r-name' }, r.name), h('span', { class: 'r-sub' }, isDone ? '✓ in service' : active ? 'in the works' : locked ? 'locked' : `${r.cost} · ${researchTurns(r.cost)}w`));
          return i > 0 && r.requires === ordered[i - 1].id ? [h('span', { class: 'lane-arrow' }, '▸'), chip] : [i > 0 ? h('span', { class: 'lane-gap' }) : null, chip];
        })));
    }),
  );
}

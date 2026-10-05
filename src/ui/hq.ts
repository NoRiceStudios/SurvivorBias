import {
  armorUsed,
  cancelQueued,
  canBuild,
  COSTS,
  planCost,
  queueAircraft,
  researchTurns,
  setApproach,
  setArmor,
  setDoctrine,
  setQc,
  setTrainingFocus,
  startResearch,
  upgradeFactory,
  upgradeFlak,
  upgradeTraining,
} from '../core/actions';
import {
  AIRCRAFT,
  APPROACH_LABEL,
  ARCHETYPE_INFO,
  MAX_ARMOR_PER_ZONE,
  RESEARCH,
  TARGETS,
  ZONE_LABEL,
} from '../core/data';
import { flyable } from '../core/sim';
import { act } from '../core/turn';
import type { AircraftKind, FighterApproach, Hit, SideId, SideState, Squadron, TargetId, TrainingFocus } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h, meter, pct, slider } from './dom';
import { icon } from './icons';
import { aircraftCanvas } from './sprites';

const TABS: [string, string][] = [
  ['briefing', 'Briefing'],
  ['operations', 'Operations'],
  ['squadrons', 'Squadrons'],
  ['hangar', 'Hangar'],
  ['factory', 'Factory'],
  ['training', 'Training'],
  ['research', 'Research'],
  ['intel', 'Intelligence'],
];

export const ACT_NAME = ['', 'Act I — The Early War', 'Act II — Attrition', 'Act III — The Decision'];

export function topBar(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const r = side.resources;
  const front = side.perceived.front;
  const res = (name: string, v: number, title: string) => h('div', { class: 'res', title }, icon(name, 18), h('span', null, String(v)));
  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: `crest side${side.id}` }, h('div', { class: 'crest-name' }, side.id === 0 ? 'No. 7 Composite Wing' : 'Kampfgeschwader Nord'), h('div', { class: 'crest-sub' }, side.name)),
    h('div', { class: 'week' }, icon('week', 18), h('span', null, `Week ${st.turn} / ${st.maxTurns}`), h('span', { class: 'act' }, ACT_NAME[act(st.turn, st.maxTurns)])),
    h('div', { class: 'resources' },
      res('supplies', r.supplies, 'Supplies: upgrades, repairs, production, research'),
      res('fuel', r.fuel, 'Fuel: every aircraft that flies burns it'),
      res('munitions', r.munitions, 'Munitions: bombs and ammunition'),
      res('crew', r.replacements, 'Replacement aircrew awaiting training'),
      h('div', { class: 'res', title: 'Confidence of High Command in your leadership' }, icon('trust', 18), meter(side.trust, 100, 10, side.trust < 25 ? 'bad' : '')),
      h('div', { class: 'res', title: 'Front line as reported by Army liaison (+ favours us)' }, icon('front', 18), h('span', { class: front >= 0 ? 'good' : 'bad' }, `${front >= 0 ? '+' : ''}${front}`)),
    ),
  );
}

export function renderHq(app: App, sideId: SideId, tab: string): HTMLElement {
  const side = app.state!.sides[sideId];
  const nav = h(
    'nav',
    { class: 'tabs' },
    TABS.map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, onclick: () => { sfxClick(); app.go({ kind: 'hq', side: sideId, tab: id }); } }, label),
    ),
    h('div', { class: 'tabs-spacer' }),
    h('button', { class: 'tab small', onclick: () => { void app.save(`week${app.state!.turn}`).then(() => app.toast('Campaign saved')); } }, 'Save'),
    h('button', { class: 'tab small', onclick: () => { void app.save().then(() => app.go({ kind: 'title' })); } }, 'Main Menu'),
  );
  let body: HTMLElement;
  switch (tab) {
    case 'operations': body = operations(app, side); break;
    case 'squadrons': body = squadrons(app, side); break;
    case 'hangar': body = hangar(app, side); break;
    case 'factory': body = factory(app, side); break;
    case 'training': body = training(app, side); break;
    case 'research': body = research(app, side); break;
    case 'intel': body = intel(app, side); break;
    default: body = briefing(app, side);
  }
  const plan = app.plans[sideId];
  const c = planCost(side, plan);
  const launch = h(
    'div',
    { class: 'launchbar' },
    h('div', { class: 'launch-summary' },
      plan.raid && plan.raid.squadronIds.length ? `${TARGETS[plan.raid.target].name}: ${countPlanes(side, plan.raid.squadronIds)} aircraft` : 'No raid planned',
      ' · ',
      `Defence: ${countPlanes(side, plan.defense)} fighters`,
      ' · ',
      h('span', { class: c.fuel > side.resources.fuel ? 'bad' : '' }, `Fuel ${c.fuel}/${side.resources.fuel}`),
      ' · ',
      h('span', { class: c.munitions > side.resources.munitions ? 'bad' : '' }, `Munitions ${c.munitions}/${side.resources.munitions}`),
    ),
    h('button', { class: 'btn primary launch', onclick: () => void app.launch(sideId) }, app.state!.mode === 'hotseat' && sideId === 0 ? 'Seal Orders ▸' : 'Launch Operation ▸'),
  );
  return h('div', { class: 'hq' }, topBar(app, side), h('div', { class: 'hq-body' }, nav, h('main', { class: 'content', 'data-keep-scroll': `hq-${tab}` }, body)), launch);
}

function countPlanes(side: SideState, ids: string[]): number {
  return ids.reduce((a, id) => {
    const sq = side.squadrons.find((s) => s.id === id);
    return a + (sq ? flyable(sq).length : 0);
  }, 0);
}

type PanelChild = Node | string | null | false | undefined | PanelChild[];
function panel(title: string, ...children: PanelChild[]): HTMLElement {
  return h('section', { class: 'paper panel' }, h('h2', null, title), ...children);
}

function stampFor(kind: string): HTMLElement {
  const label = { order: 'DIRECTIVE', intel: 'INTELLIGENCE', supply: 'SUPPLY', reprimand: 'REPRIMAND', commendation: 'COMMENDED', notice: 'NOTICE' }[kind] ?? 'MEMO';
  return h('span', { class: `stamp ${kind}` }, label);
}

/* ---------------- Briefing ---------------- */
function briefing(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const orders = side.orders.map((o) =>
    h('li', { class: 'order' }, h('span', { class: 'order-text' }, o.text), h('span', { class: 'order-due' }, o.deadline <= st.turn ? 'DUE THIS WEEK' : `due week ${o.deadline}`)),
  );
  const memos = side.memos.slice(0, 12).map((m) =>
    h('article', { class: `memo memo-${m.kind}` },
      h('div', { class: 'memo-head' }, stampFor(m.kind), h('span', { class: 'memo-from' }, `From: ${m.from}`), h('span', { class: 'memo-week' }, `Week ${m.turn}`)),
      h('div', { class: 'memo-subject' }, m.subject),
      h('div', { class: 'memo-body' }, m.body),
    ),
  );
  return h('div', { class: 'grid2' },
    h('div', { class: 'col' },
      panel('Standing Orders from High Command', orders.length ? h('ul', { class: 'orders' }, orders) : h('p', { class: 'muted' }, 'No outstanding directives.')),
      panel('War Map (as reported)', warMap(side)),
      panel('Returns Policy',
        h('p', { class: 'muted' }, 'How your adjutant presents results to High Command. Optimistic returns raise confidence, until someone checks.'),
        h('div', { class: 'choice-row' },
          [['Accurate', 0], ['Optimistic', 0.4], ['Creative', 0.9]].map(([label, v]) =>
            h('button', { class: `btn choice ${Math.abs(app.plans[side.id].embellish - (v as number)) < 0.05 ? 'on' : ''}`, onclick: () => app.act(() => { app.plans[side.id].embellish = v as number; }) }, label as string),
          ),
        ),
      ),
    ),
    h('div', { class: 'col' }, panel('Correspondence', h('div', { class: 'memos' }, memos))),
  );
}

function warMap(side: SideState): HTMLElement {
  const W = 200;
  const H = 90;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'pix warmap';
  const g = c.getContext('2d')!;
  // Our territory left, theirs right. Front x by reported value.
  const fx = Math.round(W / 2 + (side.perceived.front / 100) * (W / 2 - 10));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const wob = Math.round(Math.sin(y / 7) * 3 + Math.sin(y / 3) * 1);
      const ours = x < fx + wob;
      const n = ((x * 13 + y * 7) % 11) / 11;
      g.fillStyle = ours ? (n > 0.8 ? '#cfc39c' : '#d8cca6') : n > 0.8 ? '#bfae88' : '#c7b690';
      if (Math.abs(x - (fx + wob)) < 1) g.fillStyle = '#b0302a';
      g.fillRect(x, y, 1, 1);
    }
  // Coast and markers
  g.fillStyle = '#2a2620';
  g.fillRect(14, 40, 3, 3);
  g.fillRect(W - 18, 22, 3, 3);
  g.fillRect(W - 30, 62, 3, 3);
  g.fillRect(W - 46, 44, 3, 3);
  c.style.width = `${W * 2}px`;
  c.style.height = `${H * 2}px`;
  return h('div', { class: 'warmap-wrap' }, c,
    h('div', { class: 'map-legend' }, h('span', null, '■ Base'), h('span', null, 'Enemy works · airfields · depots →'), h('span', { class: 'red' }, '| Front')),
    h('div', { class: 'muted small' }, `Reported enemy facility condition — Works ${side.perceived.enemyFacilities.industry}% · Airfields ${side.perceived.enemyFacilities.airfield}% · Depots ${side.perceived.enemyFacilities.fuel}%`),
    h('div', { class: 'muted small' }, `Our facilities — Works ${side.facilities.industry}% · Airfields ${side.facilities.airfield}% · Depots ${side.facilities.fuel}%`),
  );
}

/* ---------------- Operations ---------------- */
function operations(app: App, side: SideState): HTMLElement {
  const plan = app.plans[side.id];
  const target = plan.raid?.target ?? 'industry';
  const targets = (Object.keys(TARGETS) as TargetId[]).map((t) =>
    h('button', {
      class: `target-card ${plan.raid && target === t ? 'on' : ''}`,
      onclick: () => app.act(() => {
        if (!plan.raid) plan.raid = { target: t, squadronIds: [] };
        plan.raid.target = t;
        if (t === 'sweep') plan.raid.squadronIds = plan.raid.squadronIds.filter((id) => side.squadrons.find((s) => s.id === id)?.kind === 'fighter');
      }),
    },
      h('div', { class: 'target-name' }, TARGETS[t].name),
      h('div', { class: 'target-desc' }, TARGETS[t].desc),
      t !== 'sweep' ? h('div', { class: 'target-cond' }, `Believed condition: ${side.perceived.enemyFacilities[t]}%`) : null,
    ),
  );
  const assign = (sq: Squadron, role: 'raid' | 'defense' | 'rest' | 'recon') => {
    plan.defense = plan.defense.filter((i) => i !== sq.id);
    if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.filter((i) => i !== sq.id);
    if (plan.recon?.squadronId === sq.id) plan.recon = null;
    if (role === 'raid') {
      if (!plan.raid) plan.raid = { target: sq.kind === 'fighter' ? 'sweep' : 'industry', squadronIds: [] };
      if (plan.raid.target === 'sweep' && sq.kind !== 'fighter') return { ok: false, reason: 'Only fighters fly sweeps. Choose a bombing target first.' };
      plan.raid.squadronIds.push(sq.id);
    }
    if (role === 'defense') plan.defense.push(sq.id);
    if (role === 'recon') plan.recon = { squadronId: sq.id, target: target === 'sweep' ? 'industry' : target };
    return { ok: true };
  };
  const rows = side.squadrons.map((sq) => {
    const role = plan.raid?.squadronIds.includes(sq.id) ? 'raid' : plan.defense.includes(sq.id) ? 'defense' : plan.recon?.squadronId === sq.id ? 'recon' : 'rest';
    const ready = flyable(sq).length;
    const roles: ['raid' | 'defense' | 'rest' | 'recon', string][] =
      sq.kind === 'fighter' ? [['raid', plan.raid?.target === 'sweep' ? 'Sweep' : 'Escort'], ['defense', 'Defend'], ['rest', 'Stand down']]
      : sq.kind === 'recon' ? [['recon', 'Photograph'], ['rest', 'Stand down']]
      : [['raid', 'Bomb'], ['rest', 'Stand down']];
    return h('tr', { class: role !== 'rest' ? 'active' : '' },
      h('td', { class: 'sq-cell' }, aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 1), h('div', null, h('div', { class: 'sq-name' }, sq.name), h('div', { class: 'muted small' }, `${AIRCRAFT[sq.kind].name[side.id]} · ${sq.leader.rank} ${sq.leader.name}`))),
      h('td', null, `${ready}`, h('span', { class: 'muted small' }, ` / ${sq.airframes.length}`)),
      h('td', null, meter(sq.morale, 1, 6, sq.morale < 0.3 ? 'bad' : '')),
      h('td', null, meter(1 - sq.fatigue, 1, 6, sq.fatigue > 0.6 ? 'bad' : '')),
      h('td', { class: 'roles' }, roles.map(([r, label]) => h('button', { class: `btn choice ${role === r ? 'on' : ''}`, onclick: () => app.act(() => assign(sq, r)) }, label))),
    );
  });
  const appr = side.approach;
  const setAppr = (k: FighterApproach, v: number) => app.act(() => setApproach(side, { ...appr, [k]: Math.max(0.01, v) }));
  return h('div', { class: 'col' },
    panel('Target for this week\'s operation', h('div', { class: 'targets' }, targets),
      plan.raid ? h('button', { class: 'btn small', onclick: () => app.act(() => { plan.raid = null; }) }, 'Cancel raid (defensive week)') : null),
    panel('Squadron Assignments',
      h('table', { class: 'sq-table' },
        h('thead', null, h('tr', null, h('th', null, 'Squadron'), h('th', null, 'Ready'), h('th', null, 'Morale'), h('th', null, 'Rested'), h('th', null, 'Assignment'))),
        h('tbody', null, rows),
      ),
      plan.recon ? h('div', { class: 'recon-row' }, 'Photo target: ',
        (['industry', 'airfield', 'fuel'] as const).map((t) => h('button', { class: `btn choice ${plan.recon!.target === t ? 'on' : ''}`, onclick: () => app.act(() => { plan.recon!.target = t; }) }, TARGETS[t].name))) : null,
    ),
    panel('Interceptor Tactics',
      h('p', { class: 'muted' }, 'How your fighters are briefed to attack enemy bombers. Gunners cover the tail best; a head-on pass is brief but meets fewer guns.'),
      (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) =>
        h('div', { class: 'appr-row' }, h('span', { class: 'appr-label' }, APPROACH_LABEL[k]), slider(appr[k], (v) => setAppr(k, v), '', pct(appr[k]))),
      ),
    ),
  );
}

/* ---------------- Squadrons ---------------- */
function squadrons(app: App, side: SideState): HTMLElement {
  const cards = side.squadrons.map((sq) => {
    const info = ARCHETYPE_INFO[sq.leader.archetype];
    const d = sq.doctrine;
    const set = (k: keyof typeof d) => (v: number) => app.act(() => setDoctrine(side, sq.id, { [k]: v }));
    const repairs = sq.airframes.filter((a) => a.status === 'repair').length;
    return h('section', { class: 'paper panel sq-card' },
      h('div', { class: 'sq-head' },
        aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 2),
        h('div', null,
          h('h2', null, sq.name),
          h('div', { class: 'muted' }, `${AIRCRAFT[sq.kind].name[side.id]} — ${AIRCRAFT[sq.kind].role}`),
          h('div', { class: 'leader' }, `${sq.leader.rank} ${sq.leader.name}`, h('span', { class: 'trait', title: info.blurb }, info.label)),
          h('div', { class: 'muted small' }, info.blurb),
        ),
      ),
      h('div', { class: 'stats' },
        h('div', null, h('span', null, 'Aircraft'), h('b', null, `${sq.airframes.length}`), repairs ? h('span', { class: 'muted small' }, ` (${repairs} in repair)`) : null),
        h('div', null, h('span', null, 'Crews'), h('b', null, `${sq.crews}`)),
        h('div', null, h('span', null, 'Skill'), meter(sq.skill, 1, 8)),
        h('div', null, h('span', null, 'Morale'), meter(sq.morale, 1, 8, sq.morale < 0.3 ? 'bad' : '')),
        h('div', null, h('span', null, 'Fatigue'), meter(sq.fatigue, 1, 8, sq.fatigue > 0.6 ? 'bad' : 'warn')),
      ),
      h('div', { class: 'doctrine' },
        h('h3', null, 'Doctrine'),
        h('div', { class: 'doc-row' }, h('span', null, 'Aggression'), slider(d.aggression, set('aggression'), 'Preserve', 'Press on')),
        h('div', { class: 'doc-row' }, h('span', null, 'Formation'), slider(d.formation, set('formation'), 'Loose', 'Tight box')),
        h('div', { class: 'doc-row' }, h('span', null, 'Altitude'), slider(d.altitude, set('altitude'), 'Low', 'High')),
        h('div', { class: 'doc-row' }, h('span', null, 'Break off at'), slider(d.breakOff, set('breakOff'), '10% lost', 'Never'), h('span', { class: 'small' }, pct(d.breakOff))),
      ),
      sq.notables.length ? h('ul', { class: 'notables' }, sq.notables.slice(0, 3).map((n) => h('li', null, n))) : null,
    );
  });
  return h('div', { class: 'cards' }, cards);
}

/* ---------------- Hangar ---------------- */
function survivorComposite(app: App, side: SideState, kind: AircraftKind): Hit[] {
  const st = app.state!;
  if (kind === 'fighter' || kind === 'recon') {
    const d = st.lastDebriefs[side.id];
    return d ? d.returned.filter((r) => r.kind === kind).flatMap((r) => r.hits) : [];
  }
  return st.archive.slice(-10).flatMap((e) => e.survivorHits[side.id]);
}

const PLATE_TINT = ['', '#c5c8a0', '#9aa774', '#6f7f4f'];

function hangar(app: App, side: SideState): HTMLElement {
  const sqs = side.squadrons;
  if (!app.selected || !sqs.find((s) => s.id === app.selected)) app.selected = sqs.find((s) => s.kind !== 'fighter')?.id ?? sqs[0]?.id ?? null;
  const sq = sqs.find((s) => s.id === app.selected);
  const picker = h('div', { class: 'picker' }, sqs.map((s) =>
    h('button', { class: `btn choice ${s.id === app.selected ? 'on' : ''}`, onclick: () => { app.selected = s.id; sfxClick(); app.render(); } }, s.name),
  ));
  if (!sq) return h('div', null, picker);
  const budget = AIRCRAFT[sq.kind].armorBudget;
  const used = armorUsed(sq);
  const tint = Object.fromEntries(ZONES.map((z) => [z, PLATE_TINT[sq.armor[z]]]).filter(([, v]) => v));
  const comp = survivorComposite(app, side, sq.kind);
  const compCount: Record<string, number> = {};
  for (const hh of comp) compCount[hh.zone] = (compCount[hh.zone] ?? 0) + 1;
  const total = comp.length || 1;
  const rows = ZONES.map((z) =>
    h('tr', null,
      h('td', null, ZONE_LABEL[z]),
      h('td', { class: 'plates' }, Array.from({ length: MAX_ARMOR_PER_ZONE }, (_, i) => h('i', { class: i < sq.armor[z] ? 'on' : '' }))),
      h('td', null,
        h('button', { class: 'btn tiny', onclick: () => app.act(() => setArmor(side, sq.id, z, sq.armor[z] - 1)) }, '−'),
        h('button', { class: 'btn tiny', onclick: () => app.act(() => setArmor(side, sq.id, z, sq.armor[z] + 1)) }, '+'),
      ),
      h('td', { class: 'muted' }, comp.length ? `${compCount[z] ?? 0} holes (${Math.round(((compCount[z] ?? 0) / total) * 100)}%)` : '—'),
    ),
  );
  const fleet = sq.airframes.map((af) =>
    h('div', { class: `airframe ${af.status}` },
      aircraftCanvas(af.kind, { side: side.id, seed: sq.insignia + af.sorties, hits: af.hits, patches: af.patches }, 2),
      h('div', { class: 'af-serial' }, af.serial),
      h('div', { class: 'small' }, af.status === 'repair' ? `In repair (${af.repairTurns}w)` : `Ready · ${af.sorties} sorties`),
      meter(af.condition, 100, 6, af.condition < 50 ? 'bad' : ''),
    ),
  );
  return h('div', { class: 'col' },
    picker,
    h('div', { class: 'grid2' },
      panel(`Armor Layout — ${AIRCRAFT[sq.kind].name[side.id]}`,
        h('div', { class: 'blueprint-wrap' }, aircraftCanvas(sq.kind, { side: side.id, style: 'blueprint', zoneTint: tint }, sq.kind === 'heavy' ? 4 : sq.kind === 'medium' ? 5 : 7)),
        h('p', { class: 'muted' }, `Plates fitted: ${used} / ${budget}. Each plate adds weight: slower aircraft are caught more often. Refit costs ${COSTS.armorChange} supplies per plate moved.`),
        h('table', { class: 'armor-table' }, h('tbody', null, rows)),
      ),
      panel('Damage Survey — Returned Aircraft',
        h('p', { class: 'muted' }, `Every hole recorded by the ground crews on aircraft that came back${sq.kind === 'fighter' || sq.kind === 'recon' ? ' last week' : ' (last 10 weeks, all bombers)'}. ${comp.length} holes plotted.`),
        h('div', { class: 'blueprint-wrap' }, aircraftCanvas(sq.kind, { side: side.id, style: 'blueprint', hits: comp, dots: true }, sq.kind === 'heavy' ? 4 : sq.kind === 'medium' ? 5 : 7)),
        h('p', { class: 'handwritten' }, comp.length > 30 ? 'The pattern is clear enough. The question is what it means.' : 'Too few returns yet to see a pattern.'),
      ),
    ),
    panel(`Aircraft of ${sq.name}`, h('div', { class: 'fleet' }, fleet.length ? fleet : h('p', { class: 'muted' }, 'No aircraft on strength.'))),
  );
}

/* ---------------- Factory ---------------- */
function factory(app: App, side: SideState): HTMLElement {
  const f = side.factory;
  const kinds: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
  const rate = (2 + f.level * 2.5) * (0.4 + 0.6 * side.facilities.industry / 100) * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
  return h('div', { class: 'grid2' },
    h('div', { class: 'col' },
      panel('Aircraft Works',
        h('div', { class: 'stats' },
          h('div', null, h('span', null, 'Works level'), h('b', null, `${f.level} / 5`)),
          h('div', null, h('span', null, 'Works condition'), meter(side.facilities.industry, 100, 10, side.facilities.industry < 50 ? 'bad' : '')),
          h('div', null, h('span', null, 'Output'), h('b', null, `${rate.toFixed(1)} pts/week`)),
        ),
        h('button', { class: 'btn', onclick: () => app.act(() => upgradeFactory(side)), disabled: f.level >= 5 }, `Expand works (${COSTS.factoryUpgrade(f.level)} supplies)`),
      ),
      panel('Quality Control',
        h('p', { class: 'muted' }, 'Rushed production is faster, but some aircraft will have faults nobody finds until they fail in the air.'),
        h('div', { class: 'choice-row' }, (['rushed', 'standard', 'strict'] as const).map((q) =>
          h('button', { class: `btn choice ${f.qc === q ? 'on' : ''}`, onclick: () => app.act(() => setQc(side, q)) }, q[0].toUpperCase() + q.slice(1)),
        )),
      ),
      panel('Ground Defences',
        h('p', { class: 'muted' }, `Flak batteries around our works and airfields. Current strength: ${Math.round(side.flak * 100)}.`),
        h('button', { class: 'btn', onclick: () => app.act(() => upgradeFlak(side)), disabled: side.flak >= 1.5 }, `Add batteries (${COSTS.flakUpgrade(side.flak)} supplies, 20 munitions)`),
      ),
    ),
    h('div', { class: 'col' },
      panel('Production Orders',
        h('div', { class: 'build-list' }, kinds.map((k) => {
          const spec = AIRCRAFT[k];
          const ok = canBuild(side, k);
          return h('div', { class: `build ${ok ? '' : 'locked'}` },
            aircraftCanvas(k, { side: side.id, seed: 2 }, 1),
            h('div', null, h('div', { class: 'sq-name' }, spec.name[side.id]), h('div', { class: 'muted small' }, ok ? `${spec.role} · ${spec.build} pts · crew ${spec.crew}` : `Requires: ${RESEARCH.find((r) => r.id === spec.requires)?.name}`)),
            h('button', { class: 'btn', disabled: !ok, onclick: () => app.act(() => queueAircraft(side, k)) }, `Order (${spec.cost})`),
          );
        })),
        h('h3', null, 'Queue'),
        f.queue.length ? h('ol', { class: 'queue' }, f.queue.map((k, i) => h('li', null, AIRCRAFT[k].name[side.id], h('button', { class: 'btn tiny', onclick: () => app.act(() => cancelQueued(side, i)) }, '✕')))) : h('p', { class: 'muted' }, 'Nothing on order.'),
        h('p', { class: 'muted small' }, `Progress carried: ${f.progress.toFixed(1)} pts. New aircraft join the squadron of their type with the fewest machines.`),
      ),
    ),
  );
}

/* ---------------- Training ---------------- */
function training(app: App, side: SideState): HTMLElement {
  const t = side.training;
  const focus: [TrainingFocus, string, string][] = [
    ['balanced', 'Balanced', 'The standard syllabus.'],
    ['gunnery', 'Gunnery', 'Better shots. Graduates start more skilled.'],
    ['evasion', 'Evasion', 'Better at staying alive. Graduates start more skilled.'],
    ['reporting', 'Reporting', 'Observation and debrief discipline. Reports are more accurate; combat skill suffers.'],
  ];
  return h('div', { class: 'grid2' },
    panel('Operational Training Unit',
      h('div', { class: 'stats' },
        h('div', null, h('span', null, 'School level'), h('b', null, `${t.level} / 5`)),
        h('div', null, h('span', null, 'Intake per week'), h('b', null, `${1 + t.level * 2} crews`)),
        h('div', null, h('span', null, 'In training'), h('b', null, `${t.inTraining}`)),
        h('div', null, h('span', null, 'Awaiting intake'), h('b', null, `${side.resources.replacements}`)),
      ),
      h('button', { class: 'btn', disabled: t.level >= 5, onclick: () => app.act(() => upgradeTraining(side)) }, `Expand school (${COSTS.trainingUpgrade(t.level)} supplies)`),
      h('p', { class: 'muted' }, 'Graduates fill squadrons that have more aircraft than crews. A squadron without crews cannot fly, however many aircraft it has.'),
    ),
    panel('Syllabus',
      h('div', { class: 'focus-list' }, focus.map(([id, label, desc]) =>
        h('button', { class: `focus ${t.focus === id ? 'on' : ''}`, onclick: () => app.act(() => setTrainingFocus(side, id)) }, h('b', null, label), h('span', null, desc)),
      )),
    ),
  );
}

/* ---------------- Research ---------------- */
function research(app: App, side: SideState): HTMLElement {
  return panel('Ministry of Aircraft Production — Development Projects',
    side.researching ? h('p', null, `In development: ${RESEARCH.find((r) => r.id === side.researching)?.name} (${side.researchProgress}/${researchTurns(RESEARCH.find((r) => r.id === side.researching)!.cost)} weeks)`) : h('p', { class: 'muted' }, 'Engineers are idle.'),
    h('div', { class: 'research-list' }, RESEARCH.map((r) => {
      const done = side.research.includes(r.id);
      const locked = r.requires && !side.research.includes(r.requires);
      const active = side.researching === r.id;
      return h('div', { class: `research ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''}` },
        h('div', { class: 'r-head' }, h('b', null, r.name), done ? h('span', { class: 'stamp notice' }, 'IN SERVICE') : active ? h('span', { class: 'stamp order' }, 'IN HAND') : null),
        h('div', { class: 'small' }, r.desc),
        locked ? h('div', { class: 'muted small' }, `Requires ${RESEARCH.find((x) => x.id === r.requires)?.name}`) : null,
        !done && !active ? h('button', { class: 'btn small', disabled: !!locked || !!side.researching, onclick: () => app.act(() => startResearch(side, r.id)) }, `Fund (${r.cost} supplies, ${researchTurns(r.cost)}w)`) : null,
      );
    })),
  );
}

/* ---------------- Intelligence ---------------- */
function intel(app: App, side: SideState): HTMLElement {
  const p = side.perceived;
  const st = app.state!;
  const officer = side.research.includes('intelOfficer');
  const app2 = p.enemyApproach;
  const claims = st.archive.map((e) => e.claimed[side.id]);
  const maxC = Math.max(1, ...claims);
  return h('div', { class: 'grid2' },
    h('div', { class: 'col' },
      panel('Enemy Order of Battle (our estimate)',
        h('div', { class: 'stats' },
          h('div', null, h('span', null, 'Enemy fighters'), h('b', null, officer ? `${Math.max(0, p.enemyFighters - p.enemyFightersSd)}–${p.enemyFighters + p.enemyFightersSd}` : `~${p.enemyFighters}`)),
          h('div', null, h('span', null, 'Enemy aircraft claimed destroyed'), h('b', null, `${p.claimedKillsTotal}`)),
        ),
        officer ? h('p', { class: 'muted small' }, 'Intelligence Section: ranges reflect disagreement between squadron reports.') : h('p', { class: 'muted small' }, 'Fund an Intelligence Section to see how uncertain these figures are.'),
      ),
      panel('How enemy fighters attack (as reported by returning crews)',
        (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) => h('div', { class: 'bar-row' }, h('span', null, APPROACH_LABEL[k]), h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(app2[k] * 100)}%` })), h('span', null, pct(app2[k])))),
        h('p', { class: 'muted small' }, 'Only crews who survive an attack can describe it.'),
      ),
    ),
    h('div', { class: 'col' },
      panel('Enemy facilities (our estimate)',
        (['industry', 'airfield', 'fuel'] as const).map((k) => h('div', { class: 'bar-row' }, h('span', null, TARGETS[k].name), h('span', { class: 'bar' }, h('i', { style: `width:${p.enemyFacilities[k]}%` })), h('span', null, `${p.enemyFacilities[k]}%`))),
        h('p', { class: 'muted small' }, 'Estimates are built from crews\' bombing reports and photo-reconnaissance, where available.'),
      ),
      panel('Claims per week',
        claims.length ? h('div', { class: 'chart' }, claims.map((c, i) => h('div', { class: 'col-bar', title: `Week ${i + 1}: ${c}` }, h('i', { style: `height:${Math.round((c / maxC) * 100)}%` }), h('span', null, String(i + 1))))) : h('p', { class: 'muted' }, 'No operations flown yet.'),
      ),
    ),
  );
}

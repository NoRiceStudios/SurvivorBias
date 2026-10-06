import {
  armorUsed,
  canBuild,
  COSTS,
  planCost,
  researchTurns,
} from '../core/actions';
import {
  AIRCRAFT,
  APPROACH_LABEL,
  ARCHETYPE_INFO,
  MAX_ARMOR_PER_ZONE,
  BRANCHES,
  RESEARCH,
  TRAIT_INFO,
  TARGETS,
  ZONE_LABEL,
} from '../core/data';
import { facilityEffects } from '../core/effects';
import { flyable } from '../core/sim';
import { bomberRange, currentStage, DECISIVE_GAIN, depthFor, escortRange, frontSector, SECTOR_PRESSURE, SECTORS, sectorAtDepth, THEATERS, WEATHER_LABEL } from '../core/theaters';
import { crewShortfall, STORES_CAP } from '../core/turn';
import type { AircraftKind, FighterApproach, Hit, SideId, SideState, Squadron, TargetId, TrainingFocus } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h, meter, pct, plural, slider } from './dom';
import { icon } from './icons';
import { aircraftCanvas } from './sprites';
import { believed, depthLabel, mapLegend, theaterMap } from './theaterui';

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


export function topBar(app: App, side: SideState, debriefWeek?: number, what = 'debrief'): HTMLElement {
  const st = app.state!;
  const r = side.resources;
  const front = side.perceived.front;
  const res = (name: string, v: string | number, label: string, title: string, cls = '') =>
    h('div', { class: `res ${cls}`, title }, icon(name, 18), h('div', { class: 'res-v' }, h('b', null, String(v)), h('small', null, label)));
  const lan = app.lan;
  const lanChip = lan
    ? h('div', { class: `lan-chip ${lan.connected ? 'on' : 'off'}`, title: lan.status },
      lan.role === 'host'
        ? `LAN host ${lan.addresses[0] ?? ''}:${lan.port} · ${lan.connected ? (lan.opponentSealed ? 'opponent sealed' : 'opponent planning') : 'waiting for opponent'}`
        : `LAN · ${lan.connected ? (lan.opponentSealed ? 'host sealed' : 'host planning') : 'disconnected'}`)
    : null;
  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: `crest side${side.id}` }, h('div', { class: 'crest-name' }, side.id === 0 ? 'No. 7 Composite Wing' : 'Kampfgeschwader Nord'), h('div', { class: 'crest-sub' }, side.name)),
    h('div', { class: 'week' }, icon('week', 18),
      h('span', null, debriefWeek !== undefined ? `Week ${debriefWeek} ${what}` : `Week ${st.turn}`),
      debriefWeek !== undefined ? null : h('span', { class: 'act' }, `${THEATERS[st.theater.index].name} · week ${st.theater.week + 1}/${THEATERS[st.theater.index].weeks}`),
      debriefWeek !== undefined ? null : h('span', { class: 'forecast', title: 'Meteorological Office forecast for the coming operation. Usually right.' }, `Forecast: ${WEATHER_LABEL[st.forecast[side.id]]}`)),
    lanChip,
    h('div', { class: 'resources' },
      res('supplies', r.supplies, 'supplies', 'Supplies: upgrades, repairs, production, research, armor'),
      res('fuel', r.stores, 'stores', `Stores: fuel, bombs and ammunition. Every aircraft that flies uses them. Depots hold at most ${STORES_CAP}; wrecked fuel depots cut deliveries.`),
      res('crew', r.replacements, 'recruits', 'Replacement aircrew waiting for a place at the training school'),
      res('trust', `${side.trust}`, 'confidence', 'High Command\'s confidence in you (0-100). Supply deliveries grow with it; at 0 you are relieved of command.', side.trust < 25 ? 'bad' : ''),
      res('front', `${side.id === 0 ? st.theater.held0 : SECTORS - st.theater.held0}/${SECTORS} ${front >= 0 ? '▲' : '▼'}${Math.abs(front)}`, 'sectors · pressure',
        `Sectors we hold, and the pressure on the front as Army liaison reports it. A sector usually falls at about ${SECTOR_PRESSURE}; the liaison officer's figures run a little optimistic.`, front >= 0 ? 'good' : 'bad'),
    ),
  );
}

export function renderHq(app: App, sideId: SideId, tab: string): HTMLElement {
  const side = app.state!.sides[sideId];
  const nav = h(
    'nav',
    { class: 'tabs' },
    TABS.map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, 'data-tab': id, onclick: () => { sfxClick(); app.go({ kind: 'hq', side: sideId, tab: id }); } }, label,
        id === 'briefing' && side.requests.length ? h('span', { class: 'badge' }, String(side.requests.length)) : null),
    ),
    h('div', { class: 'tabs-spacer' }),
    app.state!.mode !== 'single' ? h('button', { class: 'tab small', title: 'Hide the screen (Esc)', onclick: () => app.toggleCover() }, 'Close folder') : null,
    app.lan?.role === 'client' ? null : h('button', { class: 'tab small', onclick: () => { void app.save(`week${app.state!.turn}`).then(() => app.toast('Campaign saved')); } }, 'Save'),
    h('button', { class: 'tab small', onclick: () => { void app.save().then(() => { app.endLan(); app.go({ kind: 'title' }); }); } }, 'Main Menu'),
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
      plan.raid && plan.raid.squadronIds.length ? `Our operation: ${missionLabel(app, plan.raid)} with ${countPlanes(side, plan.raid.squadronIds)} of our aircraft` : 'No operation planned',
      ' · ',
      `Our defence: ${countPlanes(side, plan.defense)} fighters`,
      plan.feint ? ` · Feint: ${countPlanes(side, plan.feint.squadronIds)}` : '',
      ' · ',
      h('span', { class: c.stores > side.resources.stores ? 'bad' : '' }, `Stores ${c.stores}/${side.resources.stores}`),
      c.stores > side.resources.stores
        ? h('button', { class: 'btn small choice fit-btn', title: 'Drop the feint, then escorts and squadrons from the raid, until the plan fits the stores we hold', onclick: () => app.act(() => app.fitToStores(sideId)) }, 'Fit to stores')
        : null,
    ),
    h('button', { class: 'btn primary launch', onclick: () => void app.launch(sideId) }, app.state!.mode === 'lan' || (app.state!.mode === 'hotseat' && sideId === 0) ? 'Seal Orders ▸' : 'Launch Operation ▸'),
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
    h('li', { class: 'order-item' }, h('span', { class: 'order-text' }, o.text), h('span', { class: 'order-due' }, o.deadline <= st.turn ? 'DUE THIS WEEK' : `due week ${o.deadline}`)),
  );
  const memos = side.memos.slice(0, 12).map((m) =>
    h('article', { class: `memo memo-${m.kind}` },
      h('div', { class: 'memo-head' }, stampFor(m.kind), h('span', { class: 'memo-from' }, `From: ${m.from}`), h('span', { class: 'memo-week' }, `Week ${m.turn}`)),
      h('div', { class: 'memo-subject' }, m.subject),
      h('div', { class: 'memo-body' }, m.body),
    ),
  );
  const notes = adjutantNotes(app, side);
  return h('div', { class: 'col' },
    notes.length ? h('section', { class: 'paper panel adjutant' }, h('h2', null, 'Adjutant\'s notes'), h('ul', null, notes.map((n) => h('li', null, n)))) : null,
    side.requests.length ? h('section', { class: 'paper panel requests' },
      h('h2', null, 'Requests from the squadrons'),
      side.requests.map((r) => h('div', { class: 'request' },
        h('div', { class: 'request-text' }, r.text),
        h('div', { class: 'request-effect muted small' }, `If approved: ${r.effect}`),
        h('div', { class: 'request-actions' },
          h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'approve', id: r.id }) }, r.cost ? `Approve (${r.cost} supplies)` : 'Approve'),
          h('button', { class: 'btn choice small', onclick: () => app.cmd(side.id, { k: 'decline', id: r.id }) }, 'Decline'),
        ),
      )),
      h('p', { class: 'muted small' }, 'Leaders ask in character. Their advice is only as good as they are.'),
    ) : null,
    theaterPanel(app, side),
    h('div', { class: 'grid2' },
      h('div', { class: 'col' },
        panel('Standing Orders from High Command', orders.length ? h('ul', { class: 'orders' }, orders) : h('p', { class: 'muted' }, 'No outstanding directives.')),
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
    ),
  );
}

/** Plain-language warnings from the wing adjutant: the things a new commander misses. */
export function adjutantNotes(app: App, side: SideState): string[] {
  const st = app.state!;
  const plan = app.plans[side.id];
  const notes: string[] = [];
  const tired = side.squadrons.filter((q) => q.fatigue >= 0.7);
  if (tired.length) notes.push(`${tired.map((q) => `${q.name} (${Math.round(q.fatigue * 10)}/10)`).join(', ')} ${tired.length > 1 ? 'are' : 'is'} exhausted. Tired crews shoot and fly worse, and their morale slides. A week standing down restores them.`);
  for (const sq of side.squadrons) {
    if (sq.morale <= 0.25) notes.push(`Morale in ${sq.name} is very low. If the whole wing's morale stays this low for three weeks, the crews will refuse to fly.`);
    const idleAircraft = sq.airframes.filter((a) => a.status === 'ready').length - Math.max(0, sq.crews);
    if (idleAircraft >= 2) notes.push(`${sq.name} has ${idleAircraft} serviceable aircraft with no crews to fly them. The training school fills gaps as crews graduate.`);
  }
  // Bombers sent without fighter cover.
  const raidIds = plan.raid?.squadronIds ?? [];
  const kindIn = (k: AircraftKind[]) => raidIds.some((id) => k.includes(side.squadrons.find((q) => q.id === id)?.kind ?? 'recon'));
  if (plan.raid && plan.raid.target !== 'sweep' && kindIn(['medium', 'heavy']) && !kindIn(['fighter'])) notes.push('The bombers fly unescorted this week. Enemy fighters will have them to themselves.');
  // Squadrons with aircraft ready but no job this week.
  const busy = new Set([...(plan.raid?.squadronIds ?? []), ...plan.defense, ...(plan.feint?.squadronIds ?? []), plan.recon?.squadronId, ...(plan.rested ?? []).map((r) => r.id)]);
  const idle = side.squadrons.filter((q) => !busy.has(q.id) && flyable(q).length > 0);
  if (idle.length) notes.push(`${idle.map((q) => q.name).join(', ')} ${idle.length > 1 ? 'have' : 'has'} no task this week. Unassigned squadrons rest (fatigue falls) but do not fight (Operations).`);
  const spareCrews = side.squadrons.reduce((a, q) => a + Math.max(0, q.crews - q.airframes.length), 0) + side.resources.replacements;
  if (spareCrews >= 8) notes.push(`${spareCrews} trained or waiting aircrew have no aircraft. The aircraft works can build more (Factory).`);
  const c = planCost(side, plan);
  if (c.stores > side.resources.stores) notes.push(`This week's plan needs ${c.stores} stores and we have ${side.resources.stores}. Stand a squadron down or fly a smaller operation.`);
  else if (side.resources.stores >= STORES_CAP - 20) notes.push(`The depots are full (${side.resources.stores} stores). Deliveries beyond ${STORES_CAP} are lost: we can afford a bigger effort.`);
  if (!side.researching && side.resources.supplies >= 70) notes.push('The engineers are idle. Fund a development project (Research).');
  if (side.factory.queue.length === 0 && side.resources.supplies >= 60) notes.push('Nothing is on order at the aircraft works (Factory).');
  if (side.trust < 30) notes.push(`High Command's confidence is ${side.trust}/100. Deliveries shrink as it falls; at 0 you will be relieved.`);
  if (st.forecast[side.id] === 'storm') notes.push('Storms are forecast: bombing will be inaccurate, interceptions fewer, and results hard to observe.');
  return notes.slice(0, 6);
}

/** The theater: map, stage, objectives and the record of theaters so far. */
function theaterPanel(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const t = st.theater;
  const def = THEATERS[t.index];
  const stage = currentStage(st);
  const obj = t.objectives.find((o) => o.side === side.id)!;
  const gain = (side.id === 0 ? t.held0 - t.start0 : t.start0 - t.held0);
  const objStatus = { open: 'OPEN', claimed: 'CLAIMED', confirmed: 'CONFIRMED', discredited: 'DISCREDITED', overrun: 'TAKEN INTACT' }[obj.status];
  const record = THEATERS.map((th, i) => {
    const r = st.theaterResults.find((x) => x.index === i);
    const label = r ? (r.winner === side.id ? 'WON' : r.winner === null ? 'DRAWN' : 'LOST') : i === t.index ? 'IN PROGRESS' : 'TO COME';
    return h('div', { class: `theater-step ${r ? (r.winner === side.id ? 'won' : r.winner === null ? 'drawn' : 'lost') : i === t.index ? 'current' : ''}` },
      h('b', null, th.name), h('span', null, `${i + 1}. ${th.season}`), h('span', { class: 'step-label' }, label));
  });
  return h('section', { class: 'paper panel theater-panel' },
    h('div', { class: 'theater-head' },
      h('div', null,
        h('h2', null, `Theater of Operations: ${def.name}`),
        h('div', { class: 'muted' }, `${def.season} · week ${t.week + 1} of ${def.weeks} · Stage: ${stage.title}`),
      ),
      h('div', { class: 'theater-record' }, record),
    ),
    theaterMap(st, { viewer: side.id, patrols: Object.values(app.plans[side.id].cover), scale: 2 }),
    mapLegend(),
    h('div', { class: 'theater-goals' },
      h('div', null, h('h3', null, 'Primary objective'),
        h('p', null, `Gain ${DECISIVE_GAIN} sectors from the enemy. Gained so far: `, h('b', { class: gain > 0 ? 'good' : gain < 0 ? 'bad' : '' }, `${gain >= 0 ? '+' : ''}${gain}`), '.'),
        h('p', { class: 'small' }, `Army liaison puts the pressure on the front at ${side.perceived.front >= 0 ? '+' : ''}${side.perceived.front}. A sector usually falls at about ±${SECTOR_PRESSURE}, and at most one a week. Losses inflicted, close support and damage to enemy works all add pressure.`),
        h('p', { class: 'muted small' }, `If neither side breaks through by week ${def.weeks}, the theater goes to whoever holds the advantage, but only if they have taken at least one sector. Otherwise it is a stalemate.`)),
      h('div', null, h('h3', null, 'Secondary objective'), h('p', null, obj.text, ' ', h('span', { class: `stamp ${obj.status === 'discredited' || obj.status === 'overrun' ? 'reprimand' : obj.status === 'open' ? 'order' : 'notice'}` }, objStatus))),
      h('div', null, h('h3', null, `Stage: ${stage.title}`), h('p', { class: 'small' }, stage.text)),
    ),
  );
}

/* ---------------- Operations ---------------- */
export function missionLabel(app: App, raid: { target: TargetId; siteId?: string }): string {
  if (raid.target === 'support' || raid.target === 'sweep') return TARGETS[raid.target].name;
  return app.state!.theater.sites.find((x) => x.id === raid.siteId)?.name ?? TARGETS[raid.target].name;
}

function operations(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const t = st.theater;
  const def = THEATERS[t.index];
  const plan = app.plans[side.id];
  const bomberKinds = side.squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy');
  const longest = Math.max(0, ...bomberKinds.map((q) => bomberRange(q.kind)));
  const reach = escortRange(side);
  const enemySites = t.sites.filter((x) => x.owner !== side.id).sort((a, b) => depthFor(t.held0, side.id, a.sector) - depthFor(t.held0, side.id, b.sector));
  const pick = (target: TargetId, siteId?: string) => app.act(() => {
    let ids = plan.raid?.squadronIds ?? [];
    // Coming from "no operation", put the ready squadrons back on the job.
    if (!plan.raid || ids.length === 0) {
      ids = side.squadrons.filter((q) => (target === 'sweep' ? q.kind === 'fighter' && !plan.defense.includes(q.id) : q.kind === 'medium' || q.kind === 'heavy') && flyable(q).length > 0 && !plan.feint?.squadronIds.includes(q.id)).map((q) => q.id);
    }
    plan.raid = { target, siteId, squadronIds: target === 'sweep' ? ids.filter((id) => side.squadrons.find((q) => q.id === id)?.kind === 'fighter') : ids };
  });
  const siteRows = enemySites.map((site) => {
    const depth = depthFor(t.held0, side.id, site.sector);
    const cond = believed(st, side.id, site);
    const inRange = depth <= longest;
    const on = plan.raid?.siteId === site.id;
    return h('tr', { class: `site-row ${on ? 'on' : ''} ${inRange ? '' : 'locked'}`, title: inRange ? 'Strike this site' : 'Out of range of our bombers', onclick: () => { if (inRange) pick(site.type, site.id); } },
      h('td', null, h('b', null, site.name)),
      h('td', null, `${def.sectors[site.sector]} · ${depthLabel(st, side.id, site)}`),
      h('td', { class: 'red' }, `${cond}%${side.perceived.photographed.includes(site.id) ? ' 📷' : ''}`),
      h('td', { class: 'small muted' }, !inRange ? 'out of range' : depth > reach ? 'beyond escort range' : 'escorted'),
    );
  });
  const mainSector = plan.raid ? (plan.raid.siteId ? t.sites.find((x) => x.id === plan.raid!.siteId)?.sector : frontSector(t, side.id)) : undefined;
  const feintSectors = [1, 2].map((d) => sectorAtDepth(t.held0, (1 - side.id) as SideId, d)).filter((sec) => sec >= 0 && sec < SECTORS);
  const assign = (sq: Squadron, role: 'raid' | 'defense' | 'rest' | 'recon' | 'feint') => {
    plan.defense = plan.defense.filter((i) => i !== sq.id);
    delete plan.cover[sq.id];
    if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.filter((i) => i !== sq.id);
    if (plan.recon?.squadronId === sq.id) plan.recon = null;
    if (plan.feint) {
      plan.feint.squadronIds = plan.feint.squadronIds.filter((i) => i !== sq.id);
      if (plan.feint.squadronIds.length === 0) plan.feint = null;
    }
    if (role === 'feint') {
      const sector = plan.feint?.sector ?? feintSectors.find((x) => x !== mainSector);
      if (sector === undefined) return { ok: false, reason: 'No sector left to feint at' };
      plan.feint = { squadronIds: [...(plan.feint?.squadronIds ?? []), sq.id], sector };
    }
    if (role === 'raid') {
      if (!plan.raid) plan.raid = sq.kind === 'fighter' ? { target: 'sweep', squadronIds: [] } : { target: 'support', squadronIds: [] };
      if (plan.raid.target === 'sweep' && sq.kind !== 'fighter') return { ok: false, reason: 'Only fighters fly sweeps. Choose a bombing mission first.' };
      plan.raid.squadronIds.push(sq.id);
    }
    if (role === 'defense') plan.defense.push(sq.id);
    if (role === 'recon') plan.recon = { squadronId: sq.id, siteId: plan.raid?.siteId ?? enemySites[0].id };
    return { ok: true };
  };
  const ownSectors = Array.from({ length: SECTORS }, (_, i) => i).filter((i) => (i < t.held0 ? 0 : 1) === side.id).sort((a, b) => depthFor(t.held0, (1 - side.id) as SideId, a) - depthFor(t.held0, (1 - side.id) as SideId, b));
  const rows = side.squadrons.map((sq) => {
    const role = plan.raid?.squadronIds.includes(sq.id) ? 'raid' : plan.defense.includes(sq.id) ? 'defense' : plan.recon?.squadronId === sq.id ? 'recon' : plan.feint?.squadronIds.includes(sq.id) ? 'feint' : 'rest';
    const ready = flyable(sq).length;
    const roles: ['raid' | 'defense' | 'rest' | 'recon' | 'feint', string][] =
      sq.kind === 'fighter' ? [['raid', plan.raid?.target === 'sweep' ? 'Sweep' : 'Escort'], ['defense', 'Defend'], ['feint', 'Feint'], ['rest', 'Stand down']]
      : sq.kind === 'recon' ? [['recon', 'Photograph'], ['rest', 'Stand down']]
      : [['raid', 'Bomb'], ['feint', 'Feint'], ['rest', 'Stand down']];
    const coverRow = role === 'defense' ? h('div', { class: 'cover-row' }, h('span', { class: 'small muted' }, 'Patrol: '),
      h('button', { class: `btn choice ${plan.cover[sq.id] === undefined ? 'on' : ''}`, onclick: () => app.act(() => { delete plan.cover[sq.id]; }) }, 'Reserve'),
      ownSectors.map((sec) => h('button', { class: `btn choice ${plan.cover[sq.id] === sec ? 'on' : ''}`, onclick: () => app.act(() => { plan.cover[sq.id] = sec; }) }, def.sectors[sec])),
    ) : null;
    return h('tr', { class: role !== 'rest' ? 'active' : '' },
      h('td', { class: 'sq-cell' }, aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 1), h('div', null, h('div', { class: 'sq-name' }, sq.name), h('div', { class: 'muted small' }, `${AIRCRAFT[sq.kind].name[side.id]} · range ${sq.kind === 'fighter' ? reach : bomberRange(sq.kind)} sectors`))),
      h('td', null, `${ready}`, h('span', { class: 'muted small' }, ` / ${sq.airframes.length}`)),
      h('td', null, meter(sq.morale, 1, 6, sq.morale < 0.3 ? 'bad' : '')),
      h('td', null, meter(1 - sq.fatigue, 1, 6, sq.fatigue > 0.6 ? 'bad' : '')),
      h('td', { class: 'roles' }, roles.map(([r, label]) => h('button', { class: `btn choice ${role === r ? 'on' : ''}`, onclick: () => app.act(() => assign(sq, r)) }, label)), coverRow),
    );
  });
  const appr = side.approach;
  const setAppr = (k: FighterApproach, v: number) => app.cmd(side.id, { k: 'approach', w: { ...appr, [k]: Math.max(0.01, v) } });
  return h('div', { class: 'col' },
    panel('Mission',
      theaterMap(st, { viewer: side.id, selected: plan.raid?.siteId, patrols: Object.values(plan.cover), feint: plan.feint?.sector, scale: 2 }),
      h('div', { class: 'mission-grid' },
      h('div', { class: 'targets mission-cards' },
        (['support', 'sweep'] as const).map((m) => h('button', { class: `target-card ${plan.raid?.target === m ? 'on' : ''}`, onclick: () => pick(m) },
          h('div', { class: 'target-name' }, TARGETS[m].name), h('div', { class: 'target-desc' }, TARGETS[m].desc),
          h('div', { class: 'small muted' }, `Over ${def.sectors[frontSector(t, side.id)]}`))),
        h('button', { class: `target-card ${!plan.raid ? 'on' : ''}`, onclick: () => app.act(() => { plan.raid = null; }) },
          h('div', { class: 'target-name' }, 'No operation'), h('div', { class: 'target-desc' }, 'A defensive week. Bombers rest; fighters may still patrol.')),
      ),
      h('div', null,
        h('h3', null, 'Or strike a site (believed condition)'),
        h('table', { class: 'site-table' }, h('tbody', null, siteRows))),
    )),
    panel('Squadron Assignments',
      h('p', { class: 'muted small' }, 'A feint sends a squadron over another enemy sector first, to draw their reserve away from the real raid. Fighters on defence either patrol one sector (they will almost certainly meet a raid there, and rarely anywhere else) or wait in central reserve (they meet most raids, given warning).'),
      h('table', { class: 'sq-table' },
        h('thead', null, h('tr', null, h('th', null, 'Squadron'), h('th', null, 'Ready'), h('th', null, 'Morale'), h('th', null, 'Rested'), h('th', null, 'Assignment'))),
        h('tbody', null, rows),
      ),
      plan.feint ? h('div', { class: 'recon-row' }, 'Feint over: ',
        feintSectors.map((sec) => h('button', { class: `btn choice ${plan.feint!.sector === sec ? 'on' : ''}`, disabled: sec === mainSector, onclick: () => app.act(() => { plan.feint!.sector = sec; }) }, def.sectors[sec])),
        h('span', { class: 'small muted' }, ' The feint flies first. Reserve fighters may chase it; patrols over that sector will.')) : null,
      plan.recon ? h('div', { class: 'recon-row' }, 'Photograph: ',
        enemySites.map((x) => h('button', { class: `btn choice ${plan.recon!.siteId === x.id ? 'on' : ''}`, onclick: () => app.act(() => { plan.recon!.siteId = x.id; }) }, x.name))) : null,
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
    const set = (k: keyof typeof d) => (v: number) => app.cmd(side.id, { k: 'doctrine', sq: sq.id, d: { [k]: v } });
    const repairs = sq.airframes.filter((a) => a.status === 'repair').length;
    return h('section', { class: 'paper panel sq-card' },
      h('div', { class: 'sq-head' },
        aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 2),
        h('div', null,
          h('h2', null, sq.name),
          h('div', { class: 'muted' }, `${AIRCRAFT[sq.kind].name[side.id]} — ${AIRCRAFT[sq.kind].role}`),
          h('div', { class: 'leader' }, `${sq.leader.rank} ${sq.leader.name}`, h('span', { class: 'trait', title: info.blurb }, info.label),
            sq.leader.trait ? h('span', { class: `trait rep ${sq.leader.trait}`, title: TRAIT_INFO[sq.leader.trait].blurb }, TRAIT_INFO[sq.leader.trait].label) : null),
          h('div', { class: 'muted small' }, `${info.blurb} ${sq.leader.trait ? TRAIT_INFO[sq.leader.trait].blurb : `${sq.leader.ops ?? 0} operation${sq.leader.ops === 1 ? '' : 's'} in command; the wing makes up its mind about a leader after five.`}`),
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
      sq.leader.log?.length ? h('details', { class: 'leader-record' },
        h('summary', null, `${sq.leader.name.split(' ')[1]}'s record (${sq.leader.ops ?? 0} operations)`),
        h('ul', null, [...sq.leader.log].reverse().slice(0, 6).map((e) => h('li', null, `Week ${e.week}: ${e.text}.`)))) : null,
    );
  });
  return h('div', { class: 'col' },
    h('p', { class: 'help-line' }, 'Fatigue rises every week a squadron flies and falls when it stands down; tired crews shoot and fly worse, and above 6/10 their morale slides. Morale falls with losses; if the wing\'s average stays very low for three weeks, the crews refuse to fly. Each leader\'s character colours his reports.'),
    h('div', { class: 'cards' }, cards));
}

/* ---------------- Hangar ---------------- */
function survivorComposite(app: App, side: SideState, kind: AircraftKind): Hit[] {
  const st = app.state!;
  // Every hole the ground crews logged on this type over the last ten weeks.
  return st.archive.slice(-10).flatMap((e) => e.survivorHits[side.id]).filter((h) => (h.kind ?? 'medium') === kind);
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
        h('button', { class: 'btn tiny', onclick: () => app.cmd(side.id, { k: 'armor', sq: sq.id, zone: z, value: sq.armor[z] - 1 }) }, '−'),
        h('button', { class: 'btn tiny', onclick: () => app.cmd(side.id, { k: 'armor', sq: sq.id, zone: z, value: sq.armor[z] + 1 }) }, '+'),
      ),
      h('td', { class: 'muted' }, comp.length ? `${plural(compCount[z] ?? 0, 'hole')} (${Math.round(((compCount[z] ?? 0) / total) * 100)}%)` : '—'),
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
        h('div', { class: 'blueprint-wrap' }, aircraftCanvas(sq.kind, { side: side.id, style: 'blueprint', zoneTint: tint }, sq.kind === 'heavy' ? 3 : sq.kind === 'medium' ? 4 : 6)),
        h('p', { class: 'muted' }, `Plates fitted: ${used} / ${budget}. Each plate adds weight: slower aircraft are caught more often. Fitting a plate costs ${COSTS.armorChange} supplies; taking one off is free.`),
        h('table', { class: 'armor-table' }, h('tbody', null, rows)),
      ),
      panel('Damage Survey — Returned Aircraft',
        h('p', { class: 'muted' }, `Every hole recorded by the ground crews on ${AIRCRAFT[sq.kind].name[side.id]}s that came back (last 10 weeks). ${comp.length} holes plotted. Each type is built differently.`),
        h('div', { class: 'blueprint-wrap' }, aircraftCanvas(sq.kind, { side: side.id, style: 'blueprint', hits: comp, dots: true }, sq.kind === 'heavy' ? 3 : sq.kind === 'medium' ? 4 : 6)),
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
        h('button', { class: 'btn', onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'factory' }), disabled: f.level >= 5 }, `Expand works (${COSTS.factoryUpgrade(f.level)} supplies)`),
      ),
      panel('Quality Control',
        h('p', { class: 'muted' }, 'Rushed production is faster, but some aircraft will have faults nobody finds until they fail in the air.'),
        h('div', { class: 'choice-row' }, (['rushed', 'standard', 'strict'] as const).map((q) =>
          h('button', { class: `btn choice ${f.qc === q ? 'on' : ''}`, onclick: () => app.cmd(side.id, { k: 'qc', v: q }) }, q[0].toUpperCase() + q.slice(1)),
        )),
      ),
      panel('Ground Defences',
        h('p', { class: 'muted' }, `Flak batteries around our works and airfields. Current strength: ${Math.round(side.flak * 100)}.`),
        h('button', { class: 'btn', onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'flak' }), disabled: side.flak >= 1.5 }, `Add batteries (${COSTS.flakUpgrade(side.flak)} supplies, 20 stores)`),
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
            h('button', { class: 'btn', disabled: !ok, onclick: () => app.cmd(side.id, { k: 'build', kind: k }) }, `Order (${spec.cost})`),
          );
        })),
        h('h3', null, 'Queue'),
        f.queue.length ? h('ol', { class: 'queue' }, f.queue.map((k, i) => h('li', null, AIRCRAFT[k].name[side.id], h('button', { class: 'btn tiny', onclick: () => app.cmd(side.id, { k: 'cancel', i }) }, '✕')))) : h('p', { class: 'muted' }, 'Nothing on order.'),
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
        h('div', null, h('span', null, 'Aircraft without a crew'), h('b', null, `${crewShortfall(side)}`)),
      ),
      h('button', { class: 'btn', disabled: t.level >= 5, onclick: () => app.cmd(side.id, { k: 'upgrade', what: 'training' }) }, `Expand school (${COSTS.trainingUpgrade(t.level)} supplies)`),
      h('p', { class: 'muted' }, 'Graduates fill squadrons that have more aircraft than crews. A squadron without crews cannot fly, however many aircraft it has.'),
      h('p', { class: 'muted' }, 'The Air Ministry posts aircrew, and the school takes pupils, only for aircraft the wing has or has on order. To grow the wing, order aircraft at the Factory: crews follow.'),
    ),
    panel('Syllabus',
      h('div', { class: 'focus-list' }, focus.map(([id, label, desc]) =>
        h('button', { class: `focus ${t.focus === id ? 'on' : ''}`, onclick: () => app.cmd(side.id, { k: 'focus', v: id }) }, h('b', null, label), h('span', null, desc)),
      )),
    ),
  );
}

/* ---------------- Research ---------------- */
function research(app: App, side: SideState): HTMLElement {
  const current = RESEARCH.find((r) => r.id === side.researching);
  const doneCount = RESEARCH.filter((r) => side.research.includes(r.id)).length;
  // Within a branch, each project is followed by the ones that build on it.
  const ordered = (branch: string) => {
    const items = RESEARCH.filter((r) => r.branch === branch);
    const out: { r: (typeof RESEARCH)[number]; depth: number }[] = [];
    const visit = (r: (typeof RESEARCH)[number], depth: number) => {
      out.push({ r, depth });
      for (const c of items.filter((x) => x.requires === r.id)) visit(c, depth + 1);
    };
    for (const r of items.filter((x) => !x.requires || !items.some((y) => y.id === x.requires))) visit(r, 0);
    return out;
  };
  const card = (r: (typeof RESEARCH)[number], depth: number) => {
    const done = side.research.includes(r.id);
    const locked = !!r.requires && !side.research.includes(r.requires);
    const active = side.researching === r.id;
    return h('div', { class: `research tier${Math.min(depth, 3)} ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''}` },
      h('div', { class: 'r-head' }, h('b', null, `${depth ? '↳ ' : ''}${r.name}`), done ? h('span', { class: 'stamp notice' }, 'IN SERVICE') : active ? h('span', { class: 'stamp order' }, 'IN HAND') : null),
      h('div', { class: 'small' }, r.desc),
      locked ? h('div', { class: 'muted small' }, `Requires ${RESEARCH.find((x) => x.id === r.requires)?.name}`) : null,
      !done && !active ? h('button', { class: 'btn small', disabled: locked || !!side.researching || side.resources.supplies < r.cost, onclick: () => app.cmd(side.id, { k: 'research', id: r.id }) }, `Fund (${r.cost} supplies, ${researchTurns(r.cost)}w)`) : null,
    );
  };
  return h('div', { class: 'col' },
    panel('Ministry of Aircraft Production — Development Projects',
      current ? h('p', null, `In development: ${current.name} (${side.researchProgress}/${researchTurns(current.cost)} weeks)`) : h('p', { class: 'muted' }, 'Engineers are idle. One project at a time; each takes a few weeks.'),
      h('p', { class: 'muted small' }, `${doneCount} of ${RESEARCH.length} developments in service. Later projects in a branch build on earlier ones.`),
    ),
    h('div', { class: 'tech-tree' }, BRANCHES.map((b) => h('section', { class: 'paper panel tech-branch' },
      h('h2', null, b.name),
      h('div', { class: 'research-list' }, ordered(b.id).map(({ r, depth }) => card(r, depth))),
    ))),
  );
}

/* ---------------- Intelligence ---------------- */
/** What bombing does to works: ours as the ground staff know it, the enemy's as far as we can estimate. */
function strategicPanel(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const t = st.theater;
  const enemy = (1 - side.id) as SideId;
  const est = (type: 'industry' | 'airfield' | 'fuel') => {
    const sites = t.sites.filter((x) => x.owner === enemy && x.type === type);
    return Math.round(sites.reduce((a, x) => a + believed(st, side.id, x), 0) / Math.max(1, t.baseline[enemy][type]));
  };
  const theirs = { industry: est('industry'), airfield: est('airfield'), fuel: est('fuel') };
  const ours = side.facilities;
  const eo = facilityEffects(ours);
  const et = facilityEffects(theirs);
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  const row = (label: string, a: number, b: number, effA: string, effB: string) =>
    h('tr', null, h('td', null, label), h('td', null, `${a}%`, h('div', { class: 'small muted' }, effA)), h('td', null, `~${b}%`, h('div', { class: 'small muted' }, effB)));
  return panel('Effect of the bombing',
    h('table', { class: 'ledger effects' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Ours (known)'), h('th', null, 'Theirs (our estimate)'))),
      h('tbody', null,
        row('Airfields', ours.airfield, theirs.airfield,
          eo.grounded > 0 ? `${pc(eo.grounded)} of each operation stays on the ground` : 'all aircraft can take off',
          et.grounded > 0 ? `~${pc(et.grounded)} of their operations grounded` : 'no effect yet'),
        row('Fuel depots', ours.fuel, theirs.fuel, `stores deliveries at ${pc(eo.stores)}`, `their stores deliveries ~${pc(et.stores)}`),
        row('Aircraft works', ours.industry, theirs.industry, `production at ${pc(eo.production)}`, `their production ~${pc(et.production)}`),
      ),
    ),
    h('p', { class: 'muted small' }, 'Damage to works also tells at the front, week after week. The enemy figures are only as good as our crews\' bombing reports and photographs.'),
  );
}

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
      panel('Enemy sites (our estimate)',
        st.theater.sites.filter((x) => x.owner !== side.id).map((x) => {
          const b = believed(st, side.id, x);
          return h('div', { class: 'bar-row wide' }, h('span', null, x.name), h('span', { class: 'bar' }, h('i', { style: `width:${b}%` })), h('span', null, `${b}%${p.photographed.includes(x.id) ? ' 📷' : ''}`));
        }),
        h('p', { class: 'muted small' }, 'Estimates are built from crews\' bombing reports; a camera symbol marks figures from photographs.'),
      ),
      strategicPanel(app, side),
      panel('Claims per week',
        claims.length ? h('div', { class: 'chart' }, claims.map((c, i) => h('div', { class: 'col-bar', title: `Week ${i + 1}: ${c} claimed` }, h('em', null, String(c)), h('i', { style: `height:${Math.round((c / maxC) * 80)}%` }), h('span', null, `w${i + 1}`)))) : h('p', { class: 'muted' }, 'No operations flown yet.'),
        claims.length ? h('p', { class: 'muted small' }, 'Enemy aircraft claimed destroyed by our crews, by week (number above each bar).') : null,
      ),
    ),
  );
}

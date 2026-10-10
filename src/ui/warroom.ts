/**
 * The War Room: Briefing and Operations on one table. The map on the left is
 * where targets are chosen; the orders column on the right holds the mission,
 * the target, the stores ledger, every squadron's task and size and the returns
 * policy; the desk under the map lays out requests, standing orders, mail and the
 * press side by side, at full size, with nothing hidden behind a tab.
 */
import { aircraftName } from '../core/setup';
import { AIRCRAFT, APPROACH_LABEL, ARCHETYPE_INFO, MAX_EFFORT, TARGETS } from '../core/data';
import { tech } from '../core/tech';
import { flyable, sortie } from '../core/sim';
import { planLedger, type CostLine } from '../core/actions';
import { bomberRange, currentStage, DECISIVE_GAIN, depthFor, escortRange, frontSector, SECTOR_PRESSURE, SECTORS, sectorAtDepth, THEATERS } from '../core/theaters';
import type { FighterApproach, Memo, SideId, SideState, Site, Squadron, TargetId } from '../core/types';
import type { App } from './app';
import { h, pct, slider } from './dom';
import { leaderPortrait, letterMemos } from './general';
import { believed, depthLabel, pressureGauge, theaterMap } from './theaterui';
import { tip } from './tip';
import { countPlanes, pips, seg } from './widgets';
import { aircraftCanvas } from './sprites';
import { animatedMap, hoverFlight, type Flight } from './mapanim';
import { paperMini } from './paper';

type Role = 'raid' | 'defense' | 'rest' | 'recon' | 'feint';

const STAMP: Record<Memo['kind'], string> = { order: 'DIRECTIVE', intel: 'INTELLIGENCE', supply: 'SUPPLY', reprimand: 'REPRIMAND', commendation: 'COMMENDED', notice: 'NOTICE' };

/** Memos with repeats removed: only the latest of each sender and subject. */
export function dedupeMemos(memos: Memo[]): Memo[] {
  const seen = new Set<string>();
  return memos.filter((m) => {
    const k = `${m.from}|${m.subject}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function warRoom(app: App, side: SideState): HTMLElement {
  return h('div', { class: 'warroom' },
    h('div', { class: 'wr-left' }, mapCard(app, side), desk(app, side)),
    h('div', { class: 'wr-right' }, ordersColumn(app, side)),
  );
}

/** "No. 9" small, the nickname big: the same everywhere a squadron is named. */
export function sqLabel(name: string): HTMLElement {
  const m = name.match(/^(No\. \d+|Staffel)\s+(.*)$/);
  return h('span', { class: 'sqn' }, m ? [h('small', null, `${m[1]} `), m[2]] : name);
}

/** Site name without its sector ("Aerodrome", "Oil Terminal"). */
export function siteKind(app: App, site: Site): string {
  const sector = THEATERS[app.state!.theater.index].sectors[site.sector];
  return site.name.startsWith(sector) ? site.name.slice(sector.length).trim() : site.name;
}

/** Put a defending fighter squadron on patrol over a sector (from a Y-Service warning). */
export function patrolSector(app: App, side: SideState, sector: number) {
  const plan = app.plans[side.id];
  const fighters = side.squadrons.filter((q) => q.kind === 'fighter' && flyable(q).length > 0);
  const sq = fighters.find((q) => plan.defense.includes(q.id) && plan.cover[q.id] === undefined)
    ?? fighters.find((q) => plan.defense.includes(q.id))
    ?? fighters.find((q) => !plan.raid?.squadronIds.includes(q.id) && !plan.feint?.squadronIds.includes(q.id));
  if (!sq) return app.toast('No fighter squadron free to patrol', true);
  if (!plan.defense.includes(sq.id)) plan.defense.push(sq.id);
  plan.cover[sq.id] = sector;
  app.pulse = `[data-sq="${sq.id}"]`;
  app.act(() => undefined);
}

/* ---------------- Planning helpers ---------------- */

function planner(app: App, side: SideState) {
  const st = app.state!;
  const t = st.theater;
  const plan = app.plans[side.id];
  const bombers = side.squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy');
  const longest = Math.max(0, ...bombers.map((q) => bomberRange(q.kind)));
  const enemySites = t.sites.filter((x) => x.owner !== side.id).sort((a, b) => depthFor(t.held0, side.id, a.sector) - depthFor(t.held0, side.id, b.sector));
  const inRange = (x: Site) => depthFor(t.held0, side.id, x.sector) <= longest;
  const pick = (target: TargetId, siteId?: string) => app.act(() => {
    let ids = plan.raid?.squadronIds ?? [];
    // Coming from "no operation", put the ready squadrons back on the job.
    if (!plan.raid || ids.length === 0) {
      ids = side.squadrons.filter((q) => (target === 'sweep' ? q.kind === 'fighter' && !plan.defense.includes(q.id) : q.kind === 'medium' || q.kind === 'heavy') && flyable(q).length > 0 && !plan.feint?.squadronIds.includes(q.id)).map((q) => q.id);
    }
    // A sweep carries no bombs: maximum effort is for strikes and close support.
    const maxEffort = target !== 'sweep' && plan.raid?.maxEffort ? true : undefined;
    plan.raid = { target, siteId, squadronIds: target === 'sweep' ? ids.filter((id) => side.squadrons.find((q) => q.id === id)?.kind === 'fighter') : ids, maxEffort };
  });
  const mainSector = plan.raid ? (plan.raid.siteId ? t.sites.find((x) => x.id === plan.raid!.siteId)?.sector : frontSector(t, side.id)) : undefined;
  const feintSectors = [1, 2].map((d) => sectorAtDepth(t.held0, (1 - side.id) as SideId, d)).filter((sec) => sec >= 0 && sec < SECTORS);
  const assign = (sq: Squadron, role: Role) => {
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
      if (plan.raid.target === 'sweep' && sq.kind !== 'fighter') return { ok: false, reason: 'Only fighters fly sweeps. Choose a strike or close support first.' };
      plan.raid.squadronIds.push(sq.id);
    }
    if (role === 'defense') plan.defense.push(sq.id);
    if (role === 'recon') plan.recon = { squadronId: sq.id, siteId: plan.raid?.siteId ?? enemySites[0].id };
    return { ok: true };
  };
  const roleOf = (sq: Squadron): Role => plan.raid?.squadronIds.includes(sq.id) ? 'raid' : plan.defense.includes(sq.id) ? 'defense' : plan.recon?.squadronId === sq.id ? 'recon' : plan.feint?.squadronIds.includes(sq.id) ? 'feint' : 'rest';
  return { st, t, plan, longest, enemySites, inRange, pick, assign, roleOf, mainSector, feintSectors };
}

/** The best strike target: an ordered site in range first, then the healthiest site in range. */
export function bestTarget(app: App, side: SideState): Site | undefined {
  const { enemySites, inRange } = planner(app, side);
  const st = app.state!;
  const ordered = side.orders.filter((o) => o.siteId && !o.done).map((o) => enemySites.find((x) => x.id === o.siteId)).find((x) => x && inRange(x));
  return ordered ?? enemySites.filter(inRange).sort((a, b) => believed(st, side.id, b) - believed(st, side.id, a))[0];
}

export function strikeAt(app: App, side: SideState, site: Site) {
  planner(app, side).pick(site.type, site.id);
}

/* ---------------- Map card ---------------- */

function mapCard(app: App, side: SideState): HTMLElement {
  const { st, t, plan, longest, inRange, pick } = planner(app, side);
  const def = THEATERS[t.index];
  const stage = currentStage(st);
  const gain = side.id === 0 ? t.held0 - t.start0 : t.start0 - t.held0;
  const obj = t.objectives.find((o) => o.side === side.id)!;
  const objStatus = { open: 'OPEN', claimed: 'CLAIMED', confirmed: 'CONFIRMED', discredited: 'DISCREDITED', overrun: 'TAKEN INTACT' }[obj.status];
  const reach = escortRange(side);
  const flags = Array.from({ length: DECISIVE_GAIN }, (_, i) => h('i', { class: `flag ${i < gain ? 'on' : ''}` }));
  const warn = side.perceived.warning;
  const ordered = side.orders.filter((o) => o.siteId && !o.done).map((o) => o.siteId!);
  return h('section', { class: 'paper panel map-card' },
    h('div', { class: 'map-head' },
      h('div', { class: 'mh-title' },
        h('b', null, def.name), h('span', { class: 'muted' }, ` · wk ${Math.min(t.week + 1, def.weeks)}/${def.weeks} · `),
        h('span', { class: 'dotted', ...tip({ head: `Stage: ${stage.title}`, text: stage.text }) }, stage.title), ' · ',
        h('span', { class: 'dotted', ...tip({ head: 'Map key', text: '✈ airfield · ▙ aircraft works · ◘ fuel depot (pips: condition). Red hatching: enemy-held. Red line: the front, arrow shows which way the pressure runs. Dashed line: our operation. Blue ring: our patrol. The small aircraft fly this week\'s orders: hover a squadron\'s row to pick it out. Red pennant: named in a standing order. Struck-through plate: probably wrecked. Faded: out of range.' }) }, 'map key')),
      h('div', { class: 'objective', ...tip({ head: 'Primary objective', text: `Take ${DECISIVE_GAIN} sectors to win the theater outright. If nobody breaks through by week ${def.weeks}, it goes to whoever holds the advantage, but only if they have taken at least one sector.` }) },
        h('span', { class: 'small' }, 'Sectors taken'), h('span', { class: 'flags' }, flags), h('b', { class: gain > 0 ? 'good' : gain < 0 ? 'bad' : '' }, `${gain >= 0 ? '+' : ''}${gain}/${DECISIVE_GAIN}`)),
    ),
    warn ? h('div', { class: 'warning-line', ...tip({ head: 'Y-Service', text: `${warn.text} The warning may be wrong.`, source: 'signals intelligence' }) },
      h('span', { class: 'stamp intel' }, 'Y-SERVICE'), h('span', { class: 'wl-text' }, warn.text),
      warn.sector !== undefined && (warn.sector < t.held0 ? 0 : 1) === side.id
        ? h('button', { class: 'btn small', onclick: () => patrolSector(app, side, warn.sector!) }, `Patrol ${def.sectors[warn.sector]} ▸`)
        : null) : null,
    animatedMap(theaterMap(st, {
      viewer: side.id, selected: plan.raid?.siteId, patrols: Object.values(plan.cover), feint: plan.feint?.sector, raid: plan.raid ?? undefined, scale: 3, inRange, ordered,
      rangeLines: [{ depth: longest, label: 'BOMBER RANGE', color: '#8a5a1a' }, ...(reach < longest ? [{ depth: reach, label: 'ESCORT RANGE', color: '#2c4672' }] : [])],
      onSite: (site) => {
        if (!inRange(site)) return app.toast(`${site.name} is out of range of our bombers`, true);
        pick(site.type, site.id);
      },
    }), flights(app, side)),
    pressureGauge(side.perceived.front, { band: side.perceived.frontBand }),
    h('div', { class: 'map-foot small' },
      h('span', { class: 'mf-obj', ...tip({ head: 'Secondary objective', text: obj.text }) }, h('b', null, 'Secondary: '), obj.text, ' ', h('span', { class: `stamp ${obj.status === 'discredited' || obj.status === 'overrun' ? 'reprimand' : obj.status === 'open' ? 'order' : 'notice'}` }, objStatus)),
      h('span', { class: 'theater-mini' }, THEATERS.map((th, i) => {
        const r = st.theaterResults.find((x) => x.index === i);
        const cls = r ? (r.winner === side.id ? 'won' : r.winner === null ? 'drawn' : 'lost') : i === t.index ? 'current' : '';
        return h('span', { class: `tm ${cls}`, ...tip({ head: th.name, text: `${th.season}. ${r ? (r.winner === side.id ? 'Won.' : r.winner === null ? 'Drawn.' : 'Lost.') : i === t.index ? 'In progress.' : 'To come.'} ${th.blurb}` }) }, `${i + 1}`);
      })),
    ),
  );
}

/** Every squadron with aircraft ready, and what this week's orders have it doing over the map. */
function flights(app: App, side: SideState): Flight[] {
  const { plan, roleOf } = planner(app, side);
  return side.squadrons.filter((q) => flyable(q).length > 0).map((sq) => {
    const role = roleOf(sq);
    const f: Flight = { id: sq.id, name: sq.name, kind: sq.kind, ready: sortie(sq, plan).length, task: 'rest' };
    if (role === 'defense') {
      f.task = plan.cover[sq.id] === undefined ? 'reserve' : 'patrol';
      f.sector = plan.cover[sq.id];
    } else if (role === 'raid') f.task = sq.kind !== 'fighter' ? 'raid' : plan.raid?.target === 'sweep' ? 'sweep' : 'escort';
    else if (role === 'feint') { f.task = 'feint'; f.sector = plan.feint?.sector; }
    else if (role === 'recon') { f.task = 'recon'; f.siteId = plan.recon?.siteId; }
    return f;
  });
}

/* ---------------- Orders column ---------------- */

function ordersColumn(app: App, side: SideState): HTMLElement {
  const P = planner(app, side);
  const { st, t, plan, enemySites, inRange, pick, assign, roleOf, mainSector, feintSectors } = P;
  const def = THEATERS[t.index];
  const mission = !plan.raid ? 'none' : plan.raid.target === 'support' || plan.raid.target === 'sweep' ? plan.raid.target : 'strike';
  const firstTarget = enemySites.find((x) => x.id === plan.raid?.siteId && inRange(x)) ?? enemySites.find(inRange);
  const missionSeg = seg<string>([
    { value: 'strike', label: 'Strike', tip: { head: 'Strike a site', text: 'Bomb an enemy airfield, works or depot. Wrecked works cut the enemy\'s output and add pressure on the front, week after week.' }, disabled: !firstTarget },
    { value: 'support', label: 'Close support', tip: { head: TARGETS.support.name, text: TARGETS.support.desc } },
    { value: 'sweep', label: 'Sweep', tip: { head: TARGETS.sweep.name, text: TARGETS.sweep.desc } },
    { value: 'none', label: 'Stand down', tip: { head: 'No operation', text: 'A defensive week. Bombers rest; fighters may still patrol.' } },
  ], mission, (m) => {
    if (m === 'none') app.act(() => { plan.raid = null; });
    else if (m === 'strike') pick(firstTarget!.type, firstTarget!.id);
    else pick(m as TargetId);
  }, 'mission-seg');

  // Target card.
  let target: HTMLElement;
  if (mission === 'strike' && plan.raid?.siteId) {
    const site = t.sites.find((x) => x.id === plan.raid!.siteId)!;
    const cond = believed(st, side.id, site);
    const depth = depthFor(t.held0, side.id, site.sector);
    const order = side.orders.find((o) => o.text.includes(site.name));
    const alt = enemySites.filter((x) => inRange(x) && x.id !== site.id).length;
    target = h('div', { class: 'target-box' },
      h('div', { class: 'tb-line' }, h('span', { class: 'tb-label' }, 'Target:'), h('b', { class: 'tb-name' }, site.name), order ? h('span', { class: 'stamp order' }, 'ORDERED') : null),
      h('div', { class: 'cond-row', ...tip({ head: 'Believed condition', text: 'How much of the site still works, as far as we know.', source: side.perceived.photographed.includes(site.id) ? 'photographs' : 'crews\' bombing reports (often optimistic)' }) },
        h('span', { class: 'cond-bar' }, h('i', { style: `width:${cond}%` })), h('b', null, `≈${cond}%`), side.perceived.photographed.includes(site.id) ? ' 📷' : ''),
      h('div', { class: 'small muted' }, `${def.sectors[site.sector]} · ${depthLabel(st, side.id, site)} · ${depth > escortRange(side) ? 'beyond escort range' : 'escorts can stay with the bombers'}${alt ? ` · ${alt} other target${alt > 1 ? 's' : ''} in range: click the map` : ''}`),
    );
  } else if (mission === 'support' || mission === 'sweep') {
    target = h('div', { class: 'target-box' }, h('div', { class: 'tb-name' }, `${TARGETS[mission].name} over ${def.sectors[frontSector(t, side.id)]}`), h('div', { class: 'small muted' }, TARGETS[mission].desc));
  } else {
    target = h('div', { class: 'target-box' }, h('div', { class: 'small muted' }, 'No operation this week. Bombers rest; fighters may still defend. Click a site on the map to strike it.'));
  }

  // Bomb load: the standard load, or maximum effort at half as many stores again for the raid.
  let load: HTMLElement | null = null;
  if (plan.raid && (mission === 'strike' || mission === 'support')) {
    const raidStores = Math.round(plan.raid.squadronIds.reduce((a, id) => {
      const q = side.squadrons.find((x) => x.id === id);
      return a + (q ? sortie(q, plan).length * AIRCRAFT[q.kind].storesCost : 0);
    }, 0) * (1 - tech(side, 'economy')));
    const extra = Math.round(raidStores * (MAX_EFFORT.stores - 1));
    load = h('div', { class: 'policy-row load-row' },
      h('span', { class: 'small', ...tip({ head: 'Bomb load', text: 'Maximum effort: every bay full to the last rack and extra ammunition for the escort. The bombs do more damage, but the whole raid uses half as many stores again.' }) }, 'Bomb load'),
      seg<number>([
        { value: 0, label: 'Standard', tip: 'The normal load.' },
        { value: 1, label: 'Maximum effort', tip: { text: `Bombers carry ${Math.round(MAX_EFFORT.payload * 100)}% more.`, effect: `− ${extra} more stores` } },
      ], plan.raid.maxEffort ? 1 : 0, (v) => app.act(() => { if (plan.raid) plan.raid.maxEffort = v === 1 || undefined; }), 'mini'));
  }

  const ownSectors = Array.from({ length: SECTORS }, (_, i) => i).filter((i) => (i < t.held0 ? 0 : 1) === side.id)
    .sort((a, b) => depthFor(t.held0, (1 - side.id) as SideId, a) - depthFor(t.held0, (1 - side.id) as SideId, b)).slice(0, 3);
  const rows = side.squadrons.filter((q) => q.airframes.length > 0).map((sq) => {
    const role = roleOf(sq);
    const ready = flyable(sq).length;
    const flying = sortie(sq, plan).length;
    const cost = Math.round(flying * AIRCRAFT[sq.kind].storesCost * (1 - tech(side, 'economy')));
    const setSize = (n: number) => app.act(() => {
      if (n >= ready) { if (plan.sorties) delete plan.sorties[sq.id]; } else (plan.sorties ??= {})[sq.id] = Math.max(1, n);
    });
    const sizer = role !== 'rest' && role !== 'recon' && ready > 1
      ? h('span', { class: `sizer ${flying < ready ? 'cut' : ''}`, ...tip({ head: 'Formation size', text: `Send fewer aircraft than are ready and the rest stay home. Each aircraft kept at home saves ${Math.round(AIRCRAFT[sq.kind].storesCost * (1 - tech(side, 'economy')))} stores, but a small formation hits less and is easier prey.` }) },
        h('button', { class: 'step', disabled: flying <= 1, 'aria-label': 'Fewer aircraft', onclick: () => setSize(flying - 1) }, '−'),
        h('b', null, String(flying)), h('small', null, `/${ready}`),
        h('button', { class: 'step', disabled: flying >= ready, 'aria-label': 'More aircraft', onclick: () => setSize(flying + 1) }, '+'))
      : null;
    const roles: { value: Role; label: string; tip: string }[] =
      sq.kind === 'fighter' ? [
        { value: 'raid', label: plan.raid?.target === 'sweep' ? 'Sweep' : 'Escort', tip: plan.raid?.target === 'sweep' ? 'Hunt enemy fighters over the front.' : 'Fly with the bombers and tie up the interceptors.' },
        { value: 'defense', label: 'Defend', tip: 'Stay home and intercept enemy raids.' },
        { value: 'feint', label: 'Feint', tip: 'Fly over another sector first to draw the enemy reserve away.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down. Fatigue falls by about a third.' }]
      : sq.kind === 'recon' ? [
        { value: 'recon', label: 'Photograph', tip: 'Photograph an enemy site: its true condition, give or take.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down.' }]
      : [
        { value: 'raid', label: 'Bomb', tip: 'Fly the operation.' },
        { value: 'feint', label: 'Feint', tip: 'Fly over another sector first to draw the enemy reserve away.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down. Fatigue falls by about a third.' }];
    const extra = role === 'defense'
      ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Patrol '),
        seg<number>([{ value: -1, label: 'Reserve', tip: 'Central reserve: meets most raids, given warning.' }, ...ownSectors.map((sec) => ({ value: sec, label: def.sectors[sec], tip: 'Patrol this sector: almost sure to meet a raid there, rarely anywhere else.' }))],
          plan.cover[sq.id] ?? -1, (v) => app.act(() => { if (v < 0) delete plan.cover[sq.id]; else plan.cover[sq.id] = v; }), 'mini'))
      : role === 'feint' && plan.feint
        ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Feint over '),
          seg<number>(feintSectors.map((sec) => ({ value: sec, label: def.sectors[sec], disabled: sec === mainSector })), plan.feint.sector, (v) => app.act(() => { plan.feint!.sector = v; }), 'mini'))
        : role === 'recon' && plan.recon
          ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Photograph '),
            (() => {
              const sel = h('select', { class: 'sel', onchange: (e: Event) => app.act(() => { plan.recon!.siteId = (e.target as HTMLSelectElement).value; }) },
                enemySites.map((x) => h('option', { value: x.id, selected: plan.recon!.siteId === x.id }, `${x.name} (≈${believed(st, side.id, x)}%)`)));
              return sel;
            })())
          : null;
    const info = ARCHETYPE_INFO[sq.leader.archetype];
    return h('div', { class: `sq-row ${role !== 'rest' ? 'active' : ''}`, 'data-sq': sq.id, onmouseenter: () => hoverFlight(sq.id), onmouseleave: () => hoverFlight(null) },
      h('div', { class: 'sq-line1', ...tip({ head: `${sq.name} — ${aircraftName(sq.kind, side)}`, text: `${sq.leader.rank} ${sq.leader.name} (${info.label}): ${info.blurb}`, effect: `${ready} ready of ${sq.airframes.length}. Flying costs ${cost} stores.` }) },
        h('span', { class: 'sq-face' }, leaderPortrait(sq.leader, side.id, 1)),
        h('span', { class: 'sq-name' }, sqLabel(sq.name)),
        h('span', { class: 'sq-pips' },
          h('span', tip({ head: `Fatigue ${Math.round(sq.fatigue * 10)}/10`, text: 'Rises each week a squadron flies, falls when it rests. Tired crews shoot and fly worse; above 6/10 their morale slides.' }), h('small', null, 'fat '), pips(sq.fatigue, 6, 0.6)),
          h('span', tip({ head: `Morale ${Math.round(sq.morale * 10)}/10`, text: 'Falls with losses. If the whole wing stays very low for three weeks, the crews refuse to fly.' }), h('small', null, 'mor '), pips(sq.morale, 6, 0.3, true))),
        h('span', { class: 'sq-type' }, aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 1)),
        h('span', { class: `sq-ready ${ready === 0 ? 'bad' : ''}`, ...tip({ head: 'Ready aircraft', text: `${ready} ready of ${sq.airframes.length} on strength.` }) }, `${ready}/${sq.airframes.length}`)),
      h('div', { class: 'sq-line2' },
        seg<Role>(roles.map((r) => ({ ...r, disabled: ready === 0 && r.value !== 'rest', tip: { text: r.tip, effect: r.value === 'rest' ? undefined : `− ${cost} stores` } })), role, (r) => app.act(() => assign(sq, r)), 'mini roles-seg'),
        sizer,
        role !== 'rest' ? h('span', { class: 'sq-cost' }, `${cost}`, h('small', null, ' st')) : null),
      extra,
    );
  });

  const appr = side.approach;
  const setAppr = (k: FighterApproach, v: number) => app.cmd(side.id, { k: 'approach', w: { ...appr, [k]: Math.max(0.01, v) } });
  return h('section', { class: 'paper panel orders-col' },
    h('h2', null, 'Orders for the week'),
    missionSeg,
    target,
    load,
    ledger(app, side),
    h('div', { class: 'sq-rows' }, rows),
    h('div', { class: 'policy-row' },
      h('span', { class: 'small', ...tip({ head: 'Returns policy', text: 'How your adjutant presents results to High Command. Optimistic returns raise confidence, until someone checks: photographs and the observers can catch you out.' }) }, 'Returns to HQ'),
      seg<number>([{ value: 0, label: 'Accurate' }, { value: 0.4, label: 'Optimistic' }, { value: 0.9, label: 'Creative' }],
        [0, 0.4, 0.9].find((v) => Math.abs(plan.embellish - v) < 0.05), (v) => app.act(() => { plan.embellish = v; }), 'mini')),
    h('details', { class: 'tactics' },
      h('summary', null, 'Interceptor tactics (all fighters)'),
      h('p', { class: 'small muted' }, 'How our fighters are briefed to attack bombers. Gunners cover the tail best; a head-on pass is brief but meets fewer guns.'),
      (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) => h('div', { class: 'appr-row' }, h('span', { class: 'appr-label' }, APPROACH_LABEL[k]), slider(appr[k], (v) => setAppr(k, v), '', pct(appr[k]))))),
  );
}

/* ---------------- Stores ledger ---------------- */

const LEDGER_TIP: Record<CostLine['key'], string> = {
  bomb: 'Every bomber that flies burns fuel and drops its load.',
  escort: 'Fighters flying with the bombers, or sweeping the front.',
  extra: 'The extra bombs and ammunition of a maximum effort.',
  feint: 'The diversion over another sector.',
  patrol: 'Fighters held back to meet enemy raids.',
  recon: 'One photo flight.',
};

/** What this week's plan costs, line by line, against the stores we hold. */
function ledger(app: App, side: SideState): HTMLElement {
  const plan = app.plans[side.id];
  const { lines, total, saved } = planLedger(side, plan);
  const held = side.resources.stores;
  const over = total > held;
  const scale = Math.max(held, total, 1);
  return h('div', { class: `ledger ${over ? 'over' : ''}`, ...tip({ head: 'Stores for the week', text: 'Fuel, bombs and ammunition: every aircraft that flies uses them, paid when the week is flown. What is left over carries into next week.' }) },
    h('div', { class: 'lg-head' },
      h('span', { class: 'lg-title' }, 'Stores this week'),
      h('b', { class: 'lg-total' }, `${total}`), h('span', { class: 'lg-held' }, ` of ${held}`),
      h('span', { class: `lg-left ${over ? 'bad' : ''}` }, over ? `${total - held} short` : `${held - total} left`)),
    h('div', { class: 'lg-bar' },
      lines.map((l) => h('i', { class: `lg-seg lg-${l.key}`, style: `width:${(l.stores / scale) * 100}%`, title: `${l.label}: ${l.stores}` })),
      over ? null : h('i', { class: 'lg-free', style: `width:${((held - total) / scale) * 100}%` })),
    lines.length ? h('div', { class: 'lg-lines' }, lines.map((l) => h('span', { class: 'lg-line', ...tip({ head: l.label, text: LEDGER_TIP[l.key] }) }, h('i', { class: `lg-sw lg-${l.key}` }), l.label, h('b', null, String(l.stores))))) : h('div', { class: 'small muted' }, 'Nothing flies, nothing is spent.'),
    saved > 0 ? h('div', { class: 'lg-saved small' }, `Smaller formations save ${saved} stores`) : null);
}

/* ---------------- Desk ---------------- */

let pressOpen = false;

/** Requests, standing orders, mail and the press, all in view at full size under the map. */
function desk(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const { enemySites, inRange, pick } = planner(app, side);
  // What High Command already read out in its letter is not repeated here.
  const read = new Set(letterMemos(side, st.turn, 6));
  const fresh = dedupeMemos(side.memos.filter((m) => m.turn >= st.turn && m.kind !== 'supply' && !read.has(m)));
  const supply = side.memos.find((m) => m.kind === 'supply' && m.turn >= st.turn);
  const hasPress = !!side.press?.papers.length;
  if (!side.requests.length && !side.orders.length && !fresh.length && !hasPress) return h('section', { class: 'intray empty' }, 'Desk clear: no requests, directives or mail.');
  const head = (title: string, n: number, hot = false) => h('h3', { class: 'desk-head' }, title, n ? h('span', { class: `badge ${hot ? '' : 'quiet'}` }, String(n)) : null);
  const requests = h('div', { class: 'desk-col desk-requests' }, head('Requests', side.requests.length, true),
    side.requests.length ? side.requests.map((r) => requestCard(app, side, r)) : h('p', { class: 'small muted' }, 'No requests this week.'));
  const due = side.orders.filter((o) => o.deadline <= st.turn).length;
  const orders = h('div', { class: 'desk-col desk-orders' }, head('Directives', side.orders.length, due > 0),
    side.orders.length ? side.orders.map((o) => {
      const site = o.siteId ? enemySites.find((x) => x.id === o.siteId) : undefined;
      const current = site && app.plans[side.id].raid?.siteId === site.id;
      return h('div', { class: 'order-item' },
        h('span', { class: 'order-text' }, o.text),
        h('span', { class: `order-due ${o.deadline <= st.turn ? 'now' : ''}` }, o.graced ? `wk ${o.deadline}: awaiting photographs` : o.deadline <= st.turn ? 'DUE THIS WEEK' : `due wk ${o.deadline}`),
        site && !current ? h('button', { class: 'btn small', disabled: !inRange(site), onclick: () => pick(site.type, site.id) }, inRange(site) ? 'Make target ▸' : 'Out of range') : current ? h('span', { class: 'small good' }, '✓ this week\'s target') : null);
    }) : h('p', { class: 'small muted' }, 'No outstanding directives.'));
  const mail = h('div', { class: 'desk-col desk-mail' }, head('Mail', fresh.length),
    supply ? h('p', { class: 'small muted' }, supply.body) : null,
    fresh.length ? fresh.map((m) => h('details', { class: `slip memo-${m.kind}` },
      h('summary', null, h('span', { class: `stamp ${m.kind}` }, STAMP[m.kind]), ' ', h('b', null, m.subject), h('span', { class: 'small muted' }, ` · ${m.from}`)),
      h('div', { class: 'memo-body' }, m.body))) : h('p', { class: 'small muted' }, 'Nothing new. Older correspondence is filed under Intelligence.'));
  const press = hasPress ? h('details', { class: 'desk-press', open: pressOpen, ontoggle: (e: Event) => { pressOpen = (e.target as HTMLDetailsElement).open; } },
    h('summary', null, 'Home front press'), paperMini(app, side)) : null;
  return h('section', { class: 'intray' },
    h('div', { class: 'desk-grid' }, requests, orders),
    mail, press);
}

/** A squadron leader's request, with the trade-off and the answer buttons. */
export function requestCard(app: App, side: SideState, r: SideState['requests'][number]): HTMLElement {
  const sq = side.squadrons.find((q) => q.id === r.squadronId);
  return h('div', { class: 'request' },
    h('div', { class: 'request-who' }, sq ? h('span', { class: 'req-face' }, leaderPortrait(sq.leader, side.id, 1)) : null, sq ? sqLabel(sq.name) : null),
    h('div', { class: 'request-text' }, r.text),
    h('div', { class: 'request-effect small' }, h('b', null, 'If approved: '), r.effect),
    h('div', { class: 'request-actions' },
      h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'approve', id: r.id }) }, r.cost ? `Approve (${r.cost})` : 'Approve'),
      h('button', { class: 'btn choice small', onclick: () => app.cmd(side.id, { k: 'decline', id: r.id }) }, 'Decline')));
}

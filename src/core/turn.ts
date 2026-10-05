import { planCost, researchTurns } from './actions';
import { AIRCRAFT, ARCHETYPE_INFO, RESEARCH, SQUADRON_NAMES, TARGETS } from './data';
import { buildDebrief, updatePerceived } from './reports';
import { facilityEffects } from './effects';
import { generateRequests } from './requests';
import { Rng } from './rng';
import { makeAirframe, makeLeader, makeSquadron } from './setup';
import { finishDay, flyable, gatherFliers, newDay, resolveRaid, resolveRecon, type Flier } from './sim';
import {
  applyPressure,
  enterTheater,
  frontSector,
  reachableSites,
  rollWeather,
  sectorOwner,
  syncFacilities,
  theaterDecision,
  theaterDef,
  theaterMods,
  THEATERS,
} from './theaters';
import type {
  AircraftKind,
  ArchiveEntry,
  Facilities,
  GameState,
  Hit,
  Memo,
  Order,
  Outcome,
  PlaneRecord,
  RaidResult,
  SideId,
  SideState,
  TargetId,
  TurnPlan,
} from './types';

/** Which theater (1..3) the war has reached; drives AI escalation and HQ demands. */
export function act(state: GameState): 1 | 2 | 3 {
  return Math.min(3, state.theater.index + 1) as 1 | 2 | 3;
}

function memo(side: SideState, turn: number, kind: Memo['kind'], subject: string, body: string, from = 'Air Ministry') {
  side.memos.unshift({ turn, from, subject, body, kind });
  if (side.memos.length > 40) side.memos.length = 40;
}

/** Depots hold at most this much fuel and munitions. */
export const STORES_CAP = 240;

/** Production points per week. */
export function factoryRate(side: SideState): number {
  const f = side.factory;
  return (3 + f.level * 2.5) * facilityEffects(side.facilities).production * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
}

/** The AI's resource multiplier: difficulty plus escalation through the theaters. */
export function aiBonus(state: GameState, side: SideState): number {
  const difficulty = 0.55 + 0.6 * side.insight; // green ~0.64, seasoned ~0.82, wald ~1.09
  return difficulty * (1 + 0.15 * (act(state) - 1));
}

/** Between theaters the Ministry partly makes good a depleted wing. */
function reinforce(rng: Rng, state: GameState, side: SideState, news: string[]) {
  const planes = side.squadrons.reduce((x, q) => x + q.airframes.length, 0);
  const shortfall = Math.max(0, 28 - planes);
  const n = Math.round(shortfall * (0.3 + 0.4 * side.trust / 100));
  if (n <= 0) return;
  let delivered = 0;
  for (let i = 0; i < n; i++) {
    const fighters = side.squadrons.filter((q) => q.kind === 'fighter').reduce((x, q) => x + q.airframes.length, 0);
    const kind: AircraftKind = fighters < planes / 2 || i % 2 === 0 ? 'fighter' : 'medium';
    const sq = side.squadrons.filter((q) => q.kind === kind).sort((x, y) => x.airframes.length - y.airframes.length)[0];
    if (!sq || sq.airframes.length >= 10) continue;
    sq.airframes.push(makeAirframe(state, rng, kind, side.id));
    sq.crews++;
    delivered++;
  }
  if (delivered) news.push(`The Air Ministry has sent ${delivered} replacement aircraft with crews for the new theater.`);
}

/** Remove lost airframes and crews, update morale, queue repairs. */
function applyLosses(rng: Rng, state: GameState, side: SideState, recs: PlaneRecord[], news: string[]) {
  const bySq = new Map<string, PlaneRecord[]>();
  for (const r of recs) {
    if (r.side !== side.id) continue;
    if (!bySq.has(r.squadronId)) bySq.set(r.squadronId, []);
    bySq.get(r.squadronId)!.push(r);
  }
  for (const sq of side.squadrons) {
    const mine = bySq.get(sq.id);
    if (!mine) {
      // Rested.
      sq.fatigue = Math.max(0, sq.fatigue - 0.35);
      sq.morale = Math.min(1, sq.morale + 0.08);
      sq.trauma = Math.max(0, sq.trauma - 0.15);
      continue;
    }
    let lost = 0;
    let kills = 0;
    let leaderLost = false;
    for (const r of mine) {
      const af = sq.airframes.find((a) => a.id === r.airframeId);
      kills += r.trueKills;
      if (r.fate === 'lost') {
        lost++;
        sq.crews--;
        // The leader flies callsign 1: if that aircraft is lost, so is he.
        if (r.lead) {
          leaderLost = true;
          r.captain = `${sq.leader.rank} ${sq.leader.name}`;
        }
        sq.airframes = sq.airframes.filter((a) => a.id !== r.airframeId);
      } else if (r.fate === 'crashed') {
        if (rng.chance(0.25)) sq.crews--;
        sq.airframes = sq.airframes.filter((a) => a.id !== r.airframeId);
      } else if (af) {
        af.sorties++;
        af.hits = r.hits;
        af.patches += r.hits.length;
        if (af.condition < 75) {
          af.status = 'repair';
          af.repairTurns = Math.ceil((100 - af.condition) / 35);
        }
      }
    }
    const frac = lost / mine.length;
    sq.morale = Math.max(0, Math.min(1, sq.morale - frac * 0.45 + Math.min(0.08, kills * 0.02) + (lost === 0 ? 0.04 : 0) - (sq.fatigue > 0.6 ? 0.04 : 0)));
    sq.trauma = Math.min(1, sq.trauma * 0.7 + frac * 1.3);
    sq.fatigue = Math.min(1, sq.fatigue + 0.22);
    sq.skill = Math.min(0.95, sq.skill + 0.015 * (1 - frac));
    sq.crews = Math.max(0, sq.crews);
    if (frac >= 0.5 && mine.some((r) => r.fate !== 'lost')) {
      sq.notables.unshift(`Week ${state.turn}: the survivors are badly shaken after losing ${lost} of ${mine.length}.`);
    }
    if (leaderLost || (lost === mine.length && sq.airframes.length === 0)) {
      const old = sq.leader;
      sq.leader = makeLeader(rng, side.id, undefined, side.squadrons.map((q) => q.leader.name));
      const lostLead = mine.find((r) => r.lead && r.fate === 'lost');
      const line = `${old.rank} ${old.name}, commanding ${sq.name}, is missing${lostLead ? ` with ${lostLead.serial}` : ''}. ${sq.leader.rank} ${sq.leader.name} takes command.`;
      news.push(line);
      sq.notables.unshift(`Week ${state.turn}: ${old.rank} ${old.name} missing; ${sq.leader.rank} ${sq.leader.name} in command.`);
      memo(side, state.turn + 1, 'notice', `${sq.name}: change of command`, `${line} The new commanding officer is described by the squadron as ${ARCHETYPE_INFO[sq.leader.archetype].label.toLowerCase()}: "${ARCHETYPE_INFO[sq.leader.archetype].blurb}"`, 'Group HQ');
    }
    sq.notables = [...new Set(sq.notables)].slice(0, 5);
  }
}

function applyDamage(state: GameState, siteId: string | undefined, dmg: number): number {
  const site = state.theater.sites.find((x) => x.id === siteId);
  if (!site || dmg <= 0) return 0;
  const before = site.condition;
  site.condition = Math.max(0, Math.round(site.condition - dmg));
  return before - site.condition;
}

/** Aircraft (built or on order) still without a crew, after counting crews in training. */
export function crewShortfall(side: SideState): number {
  const aircraft = side.squadrons.reduce((a, q) => a + q.airframes.length, 0) + side.factory.queue.length;
  const crews = side.squadrons.reduce((a, q) => a + Math.max(0, q.crews), 0) + side.training.inTraining;
  return Math.max(0, aircraft - crews);
}

function economy(rng: Rng, state: GameState, side: SideState) {
  const r = side.resources;
  const trustF = 0.4 + side.trust / 100;
  const bonus = side.isAI ? aiBonus(state, side) : 1;
  const sup = Math.round((45 + 45 * trustF) * (0.55 + 0.45 * Math.min(1.2, side.facilities.industry / 100)) * bonus);
  // Stores are rationed: a full effort every week burns more than arrives, and wrecked fuel depots cut deliveries.
  const stores = Math.round((26 + 28 * trustF) * facilityEffects(side.facilities).stores * bonus);
  // Aircrew are posted only for aircraft the wing has or has on order.
  const rep = Math.min(Math.max(0, crewShortfall(side) - r.replacements), Math.round((2 + 3 * trustF) * bonus));
  r.supplies += sup;
  r.stores = Math.min(STORES_CAP, r.stores + stores);
  r.replacements += rep;
  side.memos.unshift({
    turn: state.turn + 1,
    from: 'Supply Command',
    kind: 'supply',
    subject: 'Deliveries',
    body: `Delivered this week: ${sup} supplies, ${stores} stores (fuel and munitions), ${rep} replacement aircrew.`,
  });

  // Factory production.
  const f = side.factory;
  const rate = factoryRate(side);
  f.progress += rate;
  while (f.queue.length > 0 && f.progress >= AIRCRAFT[f.queue[0]].build) {
    const kind = f.queue.shift() as AircraftKind;
    f.progress -= AIRCRAFT[kind].build;
    const defectScale = f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.15 : 0.5;
    const af = makeAirframe(state, rng, kind, side.id, defectScale);
    // Deliver to the squadron of that type with the fewest aircraft, or form one.
    const candidates = side.squadrons.filter((s) => s.kind === kind && s.airframes.length < 10);
    candidates.sort((a, b) => a.airframes.length - b.airframes.length);
    if (candidates.length > 0) candidates[0].airframes.push(af);
    else {
      const used = new Set(side.squadrons.map((q) => q.name));
      const free = SQUADRON_NAMES[side.id].findIndex((n) => !used.has(n));
      const sq = makeSquadron(state, rng, side.id, kind, 0, free >= 0 ? free : side.squadrons.length, undefined, side.squadrons.map((q) => q.leader.name));
      if (free < 0) sq.name = `${sq.name} (${side.squadrons.length + 1})`;
      sq.crews = 0;
      sq.airframes.push(af);
      side.squadrons.push(sq);
      memo(side, state.turn + 1, 'notice', `New squadron formed`, `${sq.name} has been formed to operate the ${AIRCRAFT[kind].name[side.id]}. ${sq.leader.rank} ${sq.leader.name} commanding.`, 'Group HQ');
    }
  }
  if (f.queue.length === 0) f.progress = Math.min(f.progress, 3);

  // Training: graduates join understrength squadrons.
  const t = side.training;
  const graduates = t.inTraining;
  t.inTraining = 0;
  let pool = graduates;
  const gradSkill = 0.25 + t.level * 0.07 + (t.focus === 'gunnery' || t.focus === 'evasion' ? 0.06 : 0) - (t.focus === 'reporting' ? 0.04 : 0);
  const needy = [...side.squadrons].sort((a, b) => a.crews - a.airframes.length - (b.crews - b.airframes.length));
  for (const sq of needy) {
    while (pool > 0 && sq.crews < sq.airframes.length) {
      sq.skill = (sq.skill * sq.crews + gradSkill) / (sq.crews + 1);
      sq.crews++;
      pool--;
    }
  }
  // Excess graduates wait in the pool as replacements.
  r.replacements += pool;
  const capacity = 1 + t.level * 2;
  // The school takes pupils only for aircraft that exist or are on order.
  const intake = Math.min(capacity, r.replacements, crewShortfall(side));
  r.replacements -= intake;
  t.inTraining = intake;

  // Repairs at the airfield.
  const repairCap = Math.round(4 + 8 * side.facilities.airfield / 100);
  let repaired = 0;
  for (const sq of side.squadrons) {
    for (const af of sq.airframes) {
      if (af.status !== 'repair') continue;
      if (repaired >= repairCap || r.supplies < 3) continue;
      r.supplies -= 3;
      repaired++;
      af.repairTurns--;
      if (af.repairTurns <= 0) {
        af.status = 'ready';
        af.condition = 100;
      }
    }
  }
  // Ready aircraft keep their latest holes visible until next sortie; patching is cosmetic.

  // Research.
  if (side.researching) {
    const item = RESEARCH.find((x) => x.id === side.researching)!;
    side.researchProgress++;
    if (side.researchProgress >= researchTurns(item.cost)) {
      side.research.push(item.id);
      memo(side, state.turn + 1, 'notice', `Development complete: ${item.name}`, item.desc, 'Ministry of Aircraft Production');
      side.researching = null;
      side.researchProgress = 0;
    }
  }

  // Facility repair: each site the side holds is patched up a little.
  for (const site of state.theater.sites) if (site.owner === side.id) site.condition = Math.min(100, site.condition + 4);
}

/** What moved the front, from one side's point of view, in the Army liaison's words. */
function pressureLedger(parts: Record<'air' | 'support' | 'strikes' | 'works' | 'escalation', number>, sign: number) {
  const labels: Record<keyof typeof parts, string> = {
    air: 'Fighting in the air (losses on both sides)',
    support: 'Close support over the front',
    strikes: 'Bombing of works and depots',
    works: 'State of works, depots and airfields (both sides)',
    escalation: 'Enemy reinforcements arriving',
  };
  const word = (v: number) =>
    v >= 8 ? 'strongly in our favour' : v >= 3 ? 'in our favour' : v > -3 ? 'little either way' : v > -8 ? 'against us' : 'strongly against us';
  return (Object.keys(parts) as (keyof typeof parts)[])
    .map((k) => ({ k, v: parts[k] * sign }))
    .filter(({ k, v }) => Math.abs(v) >= 1.5 || k === 'air')
    .map(({ k, v }) => ({ label: labels[k], effect: word(v), sign: v >= 3 ? 1 : v <= -3 ? -1 : 0 }));
}

function newOrder(rng: Rng, state: GameState, side: SideState, exclude: Order['kind'][] = []): Order | null {
  const a = act(state);
  const t = state.theater;
  const def = theaterDef(state);
  const id = `o${state.nextId++}`;
  // Orders are issued at the end of a week, for the weeks that follow, and never outlive the theater.
  const next = state.turn + 1;
  const lastWeek = state.turn + Math.max(1, def.weeks - t.week);
  const due = (weeks: number) => Math.min(lastWeek, next + weeks - 1);
  const open = new Set(side.orders.filter((o) => !o.done && !o.failed).map((o) => o.kind));
  const targets = reachableSites(state, side.id, 'medium');
  const w: Partial<Record<Order['kind'], number>> = {
    strike: targets.length && lastWeek > next ? 0.45 : 0,
    kills: 0.3,
    sorties: 0.1,
    advance: t.week >= 2 && lastWeek - next >= 2 ? 0.2 : 0,
  };
  for (const k of [...open, ...exclude]) w[k] = 0;
  if (Object.values(w).every((x) => !x)) return null;
  const kind = rng.weighted(w);
  if (kind === 'strike') {
    const site = rng.pick(targets);
    // Strike orders always leave at least two weeks to plan and fly them.
    const deadline = due(rng.int(2, 3));
    const amount = 10 + 5 * a + rng.int(0, 6);
    return { id, kind, target: site.type, siteId: site.id, amount, deadline, text: `Inflict at least ${amount}% damage on the ${site.name} by week ${deadline}.` };
  }
  if (kind === 'advance') {
    const sector = frontSector(t, side.id);
    const deadline = due(3);
    return { id, kind, amount: sector, deadline, text: `Support the Army until ${def.sectors[sector]} is in our hands, by week ${deadline}.` };
  }
  if (kind === 'kills') {
    // High Command asks for roughly what the wing usually reports: the median of recent weeks,
    // so one lucky (or inflated) week doesn't set an impossible quota.
    const recent = state.archive.slice(-5).map((e) => e.reportedToHq[side.id]).sort((x, y) => x - y);
    const rate = recent.length ? recent[Math.floor(recent.length / 2)] : 4;
    const weeks = Math.min(2, lastWeek - next + 1);
    const amount = Math.max(3, Math.round(rate * weeks * rng.range(0.8, 1.0)));
    const deadline = due(weeks);
    return { id, kind, amount, deadline, text: `Destroy no fewer than ${amount} enemy aircraft ${weeks === 1 ? 'this coming week' : `in the next ${weeks} weeks`} (by week ${deadline}).` };
  }
  const strength = side.squadrons.reduce((x, q) => x + flyable(q).length, 0);
  const amount = Math.max(6, Math.round(strength * rng.range(0.6, 0.8)));
  return { id, kind, amount, deadline: next, text: `Mount at least ${amount} sorties this coming week (week ${next}) to maintain pressure on the enemy.` };
}

interface Reported {
  kills: number;
  /** Reported damage, by site id. */
  damage: Record<string, number>;
  sorties: number;
}

function highCommand(rng: Rng, state: GameState, side: SideState, enemy: SideState, reported: Reported, plan: TurnPlan, hqLines: string[]) {
  // HQ only knows what it is told.
  const e = Math.max(0, Math.min(1, plan.embellish));
  const toHq: Reported = {
    kills: Math.round(reported.kills * (1 + e * 0.8)),
    damage: Object.fromEntries(Object.entries(reported.damage).map(([k, v]) => [k, Math.round((v ?? 0) * (1 + e * 0.8))])),
    sorties: reported.sorties,
  };
  let trustDelta = 0;
  const failedKinds: Order['kind'][] = [];
  hqLines.push(`Returns submitted: ${toHq.kills} enemy aircraft destroyed${toHq.kills !== reported.kills ? ` (crews claimed ${reported.kills})` : ''}${Object.values(toHq.damage).length ? `, target damage ${Object.values(toHq.damage)[0]}%` : ''}.`);
  for (const o of side.orders) {
    if (o.done || o.failed) continue;
    // A strike order on a site we now hold is moot.
    if (o.kind === 'strike' && o.siteId && state.theater.sites.find((x) => x.id === o.siteId)?.owner === side.id) {
      o.done = true;
      hqLines.push(`Order rescinded: "${o.text}" The site is now in our hands.`);
      continue;
    }
    if (o.kind === 'kills') o.amount -= toHq.kills;
    if (o.kind === 'strike' && o.siteId) o.amount -= toHq.damage[o.siteId] ?? 0;
    if (o.kind === 'sorties') o.amount -= toHq.sorties;
    // The Army knows where its own front line is: this one cannot be talked up.
    const advanced = o.kind === 'advance' && sectorOwner(state.theater, o.amount) === side.id;
    if (o.kind !== 'advance' ? o.amount <= 0 : advanced) {
      o.done = true;
      trustDelta += 8;
      hqLines.push(`Order fulfilled: "${o.text}" — noted with satisfaction.`);
    } else if (state.turn >= o.deadline) {
      o.failed = true;
      failedKinds.push(o.kind);
      trustDelta -= 7;
      hqLines.push(`Order NOT fulfilled: "${o.text}"`);
    }
  }
  trustDelta += Math.min(6, toHq.kills * 0.4) + 1;
  // Inspection: HQ's own photo-recon may contradict an embellished report.
  if (e > 0.05) {
    const p = 0.08 + e * 0.35 + side.caught * 0.05;
    if (rng.chance(p)) {
      side.caught++;
      trustDelta -= 18 + 8 * side.caught;
      hqLines.push('Air Ministry photographic interpretation does not support your claims. A formal inquiry has been opened.');
      memo(side, state.turn + 1, 'reprimand', 'Discrepancy in returns', 'Your recent returns are inconsistent with independent reconnaissance. You will ensure that future returns reflect what was achieved, not what was hoped for. Form 1180 (Explanation of Discrepancy) is to be submitted in triplicate.');
    }
  }
  side.trust = Math.max(side.isAI ? 20 : 0, Math.min(100, Math.round(side.trust + trustDelta)));
  side.orders = side.orders.filter((o) => !o.done && !o.failed);
  if (side.orders.length === 0 || (side.orders.length < 2 && rng.chance(0.35))) {
    const o = newOrder(rng, state, side, failedKinds);
    if (o) {
      side.orders.push(o);
      memo(side, state.turn + 1, 'order', 'Operational directive', o.text);
    }
  }
  // Intelligence from above: optimistic, sometimes plain wrong.
  const enemyFighters = enemy.squadrons.filter((s) => s.kind === 'fighter').reduce((a, s) => a + s.airframes.length, 0);
  const propaganda = rng.range(0.55, 0.95);
  const hqEstimate = Math.round(enemyFighters * propaganda + rng.gauss(4));
  if (rng.chance(0.5)) {
    // HQ believes its own arithmetic: big claims make it think the enemy is finished.
    const claimed = state.archive.slice(-2).reduce((x, e) => x + e.reportedToHq[side.id], 0);
    const stale = claimed >= 12 && rng.chance(Math.min(0.5, claimed / 60));
    memo(side, state.turn + 1, 'intel', 'Intelligence summary', stale
      ? 'Enemy fighter strength is assessed as broken. Remaining units are poorly trained and short of fuel. Bomber crews may expect light opposition.'
      : `Air Intelligence estimates enemy fighter strength in this sector at approximately ${Math.max(4, hqEstimate)} aircraft. Morale among enemy aircrew is believed to be poor.`);
  }
  if (trustDelta >= 10) memo(side, state.turn + 1, 'commendation', 'Commendation', 'The Air Officer Commanding wishes to convey his appreciation for the wing\'s recent efforts.');
  if (side.trust < 25) memo(side, state.turn + 1, 'reprimand', 'Confidence in your command', 'The Air Council is reviewing the conduct of operations in your sector. Results are expected.');
  return toHq;
}

function crewLoss(s: SideState): number {
  return 1 - s.squadrons.reduce((x, q) => x + q.crews, 0) / 28;
}

/** Early-ending conditions that are about a commander, not a theater. */
function commandFailure(state: GameState): [Outcome, Outcome] | null {
  const [a, b] = state.sides;
  for (const s of state.sides) {
    const avgMorale = s.squadrons.length ? s.squadrons.reduce((x, q) => x + q.morale, 0) / s.squadrons.length : 0;
    s.lowMoraleTurns = avgMorale < 0.15 ? s.lowMoraleTurns + 1 : 0;
  }
  const lose = (s: SideState): Outcome | null => {
    const planes = s.squadrons.reduce((x, q) => x + q.airframes.length, 0);
    if (s.trust <= 0 && !s.isAI) return 'relieved';
    if (planes === 0 && s.resources.supplies < AIRCRAFT.fighter.cost && s.factory.queue.length === 0) return 'grounded';
    if (s.lowMoraleTurns >= 3) return 'mutiny';
    return null;
  };
  const la = lose(a);
  const lb = lose(b);
  if (la && lb) return [la, lb];
  if (la) return [la, 'victory'];
  if (lb) return ['victory', lb];
  return null;
}

/** The war's verdict once the last theater is decided. */
function warOutcome(state: GameState): [Outcome, Outcome] {
  const last = state.theaterResults[state.theaterResults.length - 1];
  if (last.decisive && last.winner !== null) {
    const w = last.winner;
    const res: [Outcome, Outcome] = ['collapse', 'collapse'];
    res[w] = crewLoss(state.sides[w]) > 0.6 ? 'pyrrhic' : 'victory';
    return res;
  }
  const score = state.theaterResults.reduce((a, r) => a + (r.winner === 0 ? 1 : r.winner === 1 ? -1 : 0), 0);
  if (score > 0) return [crewLoss(state.sides[0]) > 0.6 ? 'pyrrhic' : 'victory', 'defeat'];
  if (score < 0) return ['defeat', crewLoss(state.sides[1]) > 0.6 ? 'pyrrhic' : 'victory'];
  return ['stalemate', 'stalemate'];
}

/** Secondary objectives are judged on what the commander believes, and HQ may check later. */
function secondaryObjectives(rng: Rng, state: GameState, news: [string[], string[]]) {
  for (const o of state.theater.objectives) {
    const side = state.sides[o.side];
    const site = state.theater.sites.find((x) => x.id === o.siteId)!;
    const believed = side.perceived.sites[o.siteId] ?? 100;
    if (o.status === 'open') {
      const captured = site.owner === o.side;
      // Taken by the Army: its engineers report what state the works were in. Intact means no credit to the wing.
      if (captured && !site.takenWrecked) {
        o.status = 'overrun';
        news[o.side].push(`The Army has taken the ${site.name} intact. The secondary objective was to wreck it from the air: no credit to the wing.`);
        continue;
      }
      if (captured || believed <= 25) {
        const confirmed = captured || side.perceived.photographed.includes(o.siteId);
        o.status = confirmed ? 'confirmed' : 'claimed';
        const r = o.reward;
        if (r.supplies) side.resources.supplies += r.supplies;
        if (r.trust) side.trust = Math.min(100, side.trust + r.trust);
        if (r.research && !side.research.includes(r.research)) side.research.push(r.research);
        const rewards = [r.supplies ? `${r.supplies} supplies` : '', r.trust ? 'the confidence of the Air Council' : '', r.research ? `priority delivery of ${RESEARCH.find((x) => x.id === r.research)?.name}` : ''].filter(Boolean).join(', ');
        news[o.side].push(`Secondary objective achieved${captured ? ': Army engineers confirm the works were wrecked before they arrived' : confirmed ? ' and confirmed' : ' (on crews\' reports)'}: ${site.name}. Awarded: ${rewards}.`);
      }
    } else if (o.status === 'claimed' && site.owner === o.side) {
      // The Army walks into the works and sees for itself.
      if (site.takenWrecked) o.status = 'confirmed';
      else {
        o.status = 'discredited';
        side.trust = Math.max(side.isAI ? 20 : 0, side.trust - 15);
        news[o.side].push(`The Army has taken the ${site.name} and found it in working order. Your claim to have destroyed it has been withdrawn.`);
        memo(side, state.turn + 1, 'reprimand', 'Objective not achieved', `Army engineers found the ${site.name} intact. The award made on the strength of your returns is noted against your record.`);
      }
    } else if (o.status === 'claimed' && site.owner !== o.side) {
      // Unconfirmed claims can come back to haunt a commander.
      if (side.perceived.photographed.includes(o.siteId) && (side.perceived.sites[o.siteId] ?? 0) <= 25) o.status = 'confirmed';
      else if (site.condition > 45 && rng.chance(0.3)) {
        o.status = 'discredited';
        side.trust = Math.max(side.isAI ? 20 : 0, side.trust - 15);
        // The Ministry's photographs replace the crews' estimate.
        side.perceived.sites[o.siteId] = site.condition;
        if (!side.perceived.photographed.includes(o.siteId)) side.perceived.photographed.push(o.siteId);
        news[o.side].push(`Air Ministry reconnaissance shows the ${site.name} working normally. Your claim to have destroyed it has been withdrawn.`);
        memo(side, state.turn + 1, 'reprimand', 'Objective not achieved', `Photographs taken this week show the ${site.name} in full operation. The award made on the strength of your returns is noted against your record.`);
      }
    }
  }
}

export interface TurnResult {
  raids: [RaidResult | null, RaidResult | null];
  feints: [RaidResult | null, RaidResult | null];
}

/**
 * Resolve a full turn given both commanders' plans. Mutates state.
 */
export function resolveTurn(state: GameState, plans: [TurnPlan, TurnPlan]): TurnResult {
  const rng = new Rng(state.rng);
  const battle = rng.fork(`battle-${state.turn}`);
  const [s0, s1] = state.sides;
  const t = state.theater;
  const mods = theaterMods(state);

  // Pay for stores.
  for (const id of [0, 1] as SideId[]) {
    const c = planCost(state.sides[id], plans[id]);
    state.sides[id].resources.stores = Math.max(0, state.sides[id].resources.stores - c.stores);
  }

  const day = newDay(state.lethality);
  const other = (id: SideId) => (1 - id) as SideId;

  // 1. Feints go in first. The enemy controller may scramble reserve squadrons at them;
  //    patrols over the feint sector engage it as a matter of course.
  const feints: [RaidResult | null, RaidResult | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const f = plans[id].feint;
    if (!f || f.squadronIds.length === 0) continue;
    const defender = state.sides[other(id)];
    const dp = plans[other(id)];
    const radar = defender.research.includes('radar');
    // Controllers who have seen diversions recently are slower to take the bait.
    const bait = (radar ? 0.25 : 0.5) / (1 + defender.observed.feints);
    const drawnSquadrons = new Set(dp.defense.filter((sqId) => dp.cover[sqId] === f.sector || (dp.cover[sqId] === undefined && battle.chance(bait))));
    const drawn = gatherFliers(defender, dp.defense, () => 'defense', day).filter((x) => drawnSquadrons.has(x.sq.id) && x.af.kind === 'fighter' && x.alive && !x.committed);
    for (const x of drawn) x.committed = true;
    feints[id] = resolveRaid(battle, state, state.sides[id], defender, { target: 'feint', squadronIds: f.squadronIds }, dp, { day, feintSector: f.sector, onlyDefenders: drawn });
  }

  // 2. Main raids. Fighters sweeping the front also screen it: enemy close-support
  //    raids and sweeps over the front run into them.
  const sweepers = (id: SideId): Flier[] => {
    const r = plans[id].raid;
    return r?.target === 'sweep' ? gatherFliers(state.sides[id], r.squadronIds, () => 'raid', day).filter((f) => f.af.kind === 'fighter') : [];
  };
  const raids: [RaidResult | null, RaidResult | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const r = plans[id].raid;
    let screen: Flier[] = [];
    if (r && (r.target === 'support' || (r.target === 'sweep' && !day.metFront))) {
      screen = sweepers(other(id));
      if (r.target === 'sweep' && screen.length) day.metFront = true;
    }
    raids[id] = resolveRaid(battle, state, state.sides[id], state.sides[other(id)], r, plans[other(id)], { day, screen });
  }

  // 3. Recon: fighters patrolling the photographed sector may catch it.
  const recons: [ReturnType<typeof resolveRecon> | null, ReturnType<typeof resolveRecon> | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const p = plans[id];
    if (!p.recon) continue;
    const site = t.sites.find((x) => x.id === p.recon!.siteId);
    const ep = plans[other(id)];
    const patrols = site
      ? gatherFliers(state.sides[other(id)], ep.defense.filter((sqId) => ep.cover[sqId] === site.sector), () => 'defense', day).filter((f) => f.alive && f.available !== false && f.af.kind === 'fighter')
      : [];
    recons[id] = resolveRecon(battle, state.sides[id], state.sides[other(id)], p.recon.squadronId, day, patrols);
  }

  // 4. Landing.
  finishDay(battle, day);
  const allRecs = [...day.fliers.values()].map((f) => f.rec);

  // Damage (true). Strikes hit sites; close support pushes the front directly.
  const damageTaken: [Partial<Facilities>, Partial<Facilities>] = [{}, {}];
  const supportPush: [number, number] = [0, 0];
  for (const id of [0, 1] as SideId[]) {
    const r = raids[id];
    if (!r) continue;
    if (r.target === 'support') supportPush[id] = r.damage * mods.support / (1 + 0.25 * state.sides[other(id)].observed.support);
    else if (r.target !== 'sweep' && r.target !== 'feint') {
      const dealt = applyDamage(state, r.siteId, r.damage);
      damageTaken[(1 - id) as SideId][r.target] = dealt;
      r.damage = dealt;
    }
  }

  // Losses & morale.
  const lossNews: [string[], string[]] = [[], []];
  for (const id of [0, 1] as SideId[]) {
    const n = state.sides[id].squadrons.reduce((a, q) => a + (day.grounded.get(q.id) ?? 0), 0);
    if (n > 0) lossNews[id].push(`Cratered runways kept ${n === 1 ? 'one of our aircraft' : `${n} of our aircraft`} on the ground (airfields at ${state.sides[id].facilities.airfield}%).`);
  }
  for (const id of [0, 1] as SideId[]) applyLosses(rng, state, state.sides[id], allRecs, lossNews[id]);

  // Pressure on the front moves on true results.
  const lost0 = allRecs.filter((r) => r.side === 0 && r.fate === 'lost').length;
  const lost1 = allRecs.filter((r) => r.side === 1 && r.fate === 'lost').length;
  const strat0 = raids[0] && raids[0].target !== 'support' ? raids[0].damage : 0;
  const strat1 = raids[1] && raids[1].target !== 'support' ? raids[1].damage : 0;
  syncFacilities(state);
  const parts = {
    air: (lost1 - lost0) * 2 + rng.gauss(3),
    support: (supportPush[0] - supportPush[1]) * 1.15,
    strikes: (strat0 - strat1) * 0.3,
    // Wrecked works keep telling at the front, week after week.
    works:
      (Math.min(120, s0.facilities.industry) - Math.min(120, s1.facilities.industry)) * 0.06 +
      (Math.min(120, s0.facilities.fuel) - Math.min(120, s1.facilities.fuel)) * 0.05 +
      (Math.min(120, s0.facilities.airfield) - Math.min(120, s1.facilities.airfield)) * 0.04,
    escalation: s1.isAI ? -0.8 * (act(state) - 1) : 0,
  };
  const delta = parts.air + parts.support + parts.strikes + parts.works + parts.escalation;
  state.front = Math.round(state.front + delta);
  t.week++;
  const flew = (id: SideId) => !!(raids[id] || feints[id]) || plans[id].defense.length > 0;
  const news = applyPressure(state, [flew(0), flew(1)]);
  for (const id of [0, 1] as SideId[]) news[id].unshift(...lossNews[id]);
  syncFacilities(state);

  // Debriefs.
  const debriefs: [ReturnType<typeof buildDebrief>, ReturnType<typeof buildDebrief>] = [null!, null!];
  const toHq: [Reported, Reported] = [null!, null!];
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    const enemy = state.sides[(1 - id) as SideId];
    const rc = recons[id];
    const reconSite = plans[id].recon ? t.sites.find((x) => x.id === plans[id].recon!.siteId) : undefined;
    let reconResult: { siteId: string; condition: number } | null = null;
    if (rc?.ok && reconSite) {
      if (state.weather === 'storm' && rng.chance(0.6)) news[id].push('Photo-reconnaissance returned, but the target was hidden by cloud.');
      else reconResult = { siteId: reconSite.id, condition: Math.max(0, Math.min(100, Math.round(reconSite.condition + rng.gauss(2)))) };
    }
    if (rc?.intercepted && rc.ok) news[id].push('The photo-reconnaissance aircraft was jumped by fighters over the target and only just got home.');
    const d = buildDebrief(rng, state.turn, side, enemy,
      [raids[id], feints[id]].filter((x): x is RaidResult => !!x),
      [raids[other(id)], feints[other(id)]].filter((x): x is RaidResult => !!x),
      allRecs, reconResult, !!rc && !rc.ok, damageTaken[id], day.landing, theaterDef(state).sectors, state.seed);
    d.pressure = pressureLedger(parts, id === 0 ? 1 : -1);
    updatePerceived(rng, side, d, raids[id]);
    // Army liaison: honest about towns, optimistic about pressure.
    side.perceived.front = Math.round(state.front * (id === 0 ? 1 : -1) + 4 + rng.gauss(3)) || 0;
    const reported: Reported = {
      kills: d.reports.reduce((a, r) => a + r.claims, 0),
      damage: {},
      sorties: d.reports.reduce((a, r) => a + r.sent, 0),
    };
    const sid = raids[id]?.siteId;
    if (sid) reported.damage[sid] = d.reports.filter((r) => r.targetDamageReported !== null).reduce((a, r) => a + (r.targetDamageReported ?? 0), 0);
    toHq[id] = highCommand(rng, state, side, enemy, reported, plans[id], d.hqResponse);
    debriefs[id] = d;
  }
  secondaryObjectives(rng, state, news);
  // Squadron leaders bring their requests to the commander (the AI runs its own wing).
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    side.requests = side.isAI ? [] : generateRequests(rng, state, side, debriefs[id]);
  }
  // Each side remembers what it saw the enemy do (observers, the Army). Memory fades.
  for (const id of [0, 1] as SideId[]) {
    const o = state.sides[id].observed;
    o.feints = o.feints * 0.6 + (feints[other(id)] ? 1 : 0);
    o.support = o.support * 0.6 + (raids[other(id)]?.target === 'support' ? 1 : 0);
  }

  // Archive the truth.
  const hitsOf = (side: SideId, lost: boolean): Hit[] =>
    allRecs
      .filter((r) => r.side === side && (lost ? r.fate === 'lost' : r.fate !== 'lost'))
      .flatMap((r) => r.hits.map((h) => ({ ...h, kind: r.kind })));
  const crashed = (side: SideId) => allRecs.filter((r) => r.side === side && r.fate === 'crashed').length;
  const entry: ArchiveEntry = {
    turn: state.turn,
    // Aircraft written off on landing are losses too, though the enemy can't claim them.
    trueLosses: [lost0 + crashed(0), lost1 + crashed(1)],
    trueKills: [lost1, lost0],
    claimed: [debriefs[0].reports.reduce((a, r) => a + r.claims, 0), debriefs[1].reports.reduce((a, r) => a + r.claims, 0)],
    reportedToHq: [toHq[0].kills, toHq[1].kills],
    facilities: [{ ...s0.facilities }, { ...s1.facilities }],
    theater: t.index,
    sectors0: t.held0,
    front: state.front,
    lostHits: [hitsOf(0, true), hitsOf(1, true)],
    survivorHits: [hitsOf(0, false), hitsOf(1, false)],
  };
  state.archive.push(entry);

  for (const id of [0, 1] as SideId[]) economy(rng, state, state.sides[id]);
  syncFacilities(state);

  // Has the theater been decided?
  const decision = theaterDecision(state);
  if (decision) {
    const def = theaterDef(state);
    state.theaterResults.push({ index: t.index, name: def.name, winner: decision.winner, weeks: t.week, decisive: decision.decisive, gain: t.held0 - t.start0 });
    for (const id of [0, 1] as SideId[]) {
      const side = state.sides[id];
      const won = decision.winner === id;
      const lostT = decision.winner !== null && !won;
      news[id].push(
        won ? `${def.name}: VICTORY. ${decision.decisive ? 'The enemy front has broken.' : 'We hold the advantage as the campaign season ends.'}`
        : lostT ? `${def.name}: DEFEAT. ${decision.decisive ? 'Our front has broken.' : 'The enemy holds the advantage as the season ends.'}`
        : `${def.name}: the campaign ends in deadlock.`,
      );
      side.trust = Math.max(side.isAI ? 20 : 0, Math.min(100, side.trust + (won ? 15 : lostT ? -12 : 0)));
      if (won) side.resources.supplies += 100;
    }
    if (t.index + 1 < THEATERS.length) {
      const next = THEATERS[t.index + 1];
      for (const id of [0, 1] as SideId[]) news[id].push(`The wing is redeploying to ${next.name}.`);
      enterTheater(state, t.index + 1, rng, decision.winner);
      for (const id of [0, 1] as SideId[]) reinforce(rng, state, state.sides[id], news[id]);
      // Orders from the old theater lapse; High Command issues fresh ones.
      for (const side of state.sides) {
        side.memos = side.memos.filter((m) => !(m.turn === state.turn + 1 && m.kind === 'order' && m.subject === 'Operational directive'));
        side.orders = [];
        const o = newOrder(rng, state, side);
        if (o) {
          side.orders.push(o);
          memo(side, state.turn + 1, 'order', 'Operational directive', o.text);
        }
      }
    } else {
      state.outcome = warOutcome(state);
    }
  }
  for (const id of [0, 1] as SideId[]) debriefs[id].theaterNews.push(...news[id]);
  state.lastDebriefs = debriefs;
  if (!state.outcome) state.outcome = commandFailure(state);
  if (!decision) rollWeather(state, rng);
  state.rng = rng.state;
  state.sealed = [null, null];
  if (!state.outcome) state.turn++;
  return { raids, feints };
}

import { planCost, researchTurns } from './actions';
import { AIRCRAFT, RESEARCH, TARGETS } from './data';
import { buildDebrief, updatePerceived } from './reports';
import { Rng } from './rng';
import { makeAirframe, makeLeader, makeSquadron } from './setup';
import { finishDay, gatherFliers, newDay, resolveRaid, resolveRecon, type Flier } from './sim';
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

/** Remove lost airframes and crews, update morale, queue repairs. */
function applyLosses(rng: Rng, side: SideState, recs: PlaneRecord[]) {
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
    for (const r of mine) {
      const af = sq.airframes.find((a) => a.id === r.airframeId);
      kills += r.trueKills;
      if (r.fate === 'lost') {
        lost++;
        sq.crews--;
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
      sq.notables.unshift(`Turn survivors of the ${sq.name} are badly shaken.`);
    }
    if (mine.length > 0 && lost === mine.length && sq.airframes.length === 0) {
      // Leader died with them.
      sq.leader = makeLeader(rng, side.id);
    }
    sq.notables = sq.notables.slice(0, 5);
  }
}

function applyDamage(state: GameState, siteId: string | undefined, dmg: number): number {
  const site = state.theater.sites.find((x) => x.id === siteId);
  if (!site || dmg <= 0) return 0;
  const before = site.condition;
  site.condition = Math.max(0, Math.round(site.condition - dmg));
  return before - site.condition;
}

function economy(rng: Rng, state: GameState, side: SideState) {
  const r = side.resources;
  const trustF = 0.4 + side.trust / 100;
  const bonus = side.isAI ? 1 + 0.15 * (act(state) - 1) : 1;
  const sup = Math.round((45 + 45 * trustF) * (0.55 + 0.45 * side.facilities.industry / 100) * bonus);
  const fuel = Math.round((35 + 35 * trustF) * (0.3 + 0.7 * side.facilities.fuel / 100) * bonus);
  const mun = Math.round((25 + 20 * trustF) * bonus);
  const rep = Math.round((2 + 3 * trustF) * bonus);
  r.supplies += sup;
  r.fuel += fuel;
  r.munitions += mun;
  r.replacements += rep;
  side.memos.unshift({
    turn: state.turn + 1,
    from: 'Supply Command',
    kind: 'supply',
    subject: 'Deliveries',
    body: `Delivered this week: ${sup} supplies, ${fuel} fuel, ${mun} munitions, ${rep} replacement aircrew.`,
  });

  // Factory production.
  const f = side.factory;
  const rate = (2 + f.level * 2.5) * (0.4 + 0.6 * side.facilities.industry / 100) * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
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
      const sq = makeSquadron(state, rng, side.id, kind, 0, side.squadrons.length + 3);
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
  const intake = Math.min(capacity, r.replacements);
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

function newOrder(rng: Rng, state: GameState, side: SideState): Order {
  const a = act(state);
  const t = state.theater;
  const def = theaterDef(state);
  const id = `o${state.nextId++}`;
  const deadline = state.turn + rng.int(1, 2);
  const targets = reachableSites(state, side.id, 'medium');
  const kind = rng.weighted({ strike: targets.length ? 0.45 : 0, kills: 0.3, sorties: 0.1, advance: t.week >= 2 ? 0.2 : 0 });
  if (kind === 'strike') {
    const site = rng.pick(targets);
    const amount = 10 + 5 * a + rng.int(0, 6);
    return { id, kind, target: site.type, siteId: site.id, amount, deadline, text: `Inflict at least ${amount}% damage on the ${site.name} by week ${deadline}.` };
  }
  if (kind === 'advance') {
    const sector = frontSector(t, side.id);
    const dl = state.turn + 3;
    return { id, kind, amount: sector, deadline: dl, text: `Support the Army until ${def.sectors[sector]} is in our hands, by week ${dl}.` };
  }
  if (kind === 'kills') {
    const amount = 6 + 3 * a + rng.int(0, 4);
    return { id, kind, amount, deadline, text: `Destroy no fewer than ${amount} enemy aircraft by week ${deadline}.` };
  }
  const amount = 10 + 2 * a + rng.int(0, 4);
  return { id, kind, amount, deadline: state.turn + 1, text: `Mount at least ${amount} sorties next week to maintain pressure on the enemy.` };
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
  for (const o of side.orders) {
    if (o.done || o.failed) continue;
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
  if (side.orders.length === 0 || rng.chance(0.35)) {
    const o = newOrder(rng, state, side);
    side.orders.push(o);
    memo(side, state.turn + 1, 'order', 'Operational directive', o.text);
  }
  // Intelligence from above: optimistic, sometimes plain wrong.
  const enemyFighters = enemy.squadrons.filter((s) => s.kind === 'fighter').reduce((a, s) => a + s.airframes.length, 0);
  const propaganda = rng.range(0.55, 0.95);
  const hqEstimate = Math.round(enemyFighters * propaganda + rng.gauss(4));
  if (rng.chance(0.5)) {
    const stale = rng.chance(0.25);
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
      if (captured || believed <= 25) {
        const confirmed = captured || side.perceived.photographed.includes(o.siteId);
        o.status = confirmed ? 'confirmed' : 'claimed';
        const r = o.reward;
        if (r.supplies) side.resources.supplies += r.supplies;
        if (r.trust) side.trust = Math.min(100, side.trust + r.trust);
        if (r.research && !side.research.includes(r.research)) side.research.push(r.research);
        const rewards = [r.supplies ? `${r.supplies} supplies` : '', r.trust ? 'the confidence of the Air Council' : '', r.research ? `priority delivery of ${RESEARCH.find((x) => x.id === r.research)?.name}` : ''].filter(Boolean).join(', ');
        news[o.side].push(`Secondary objective achieved${confirmed ? ' and confirmed' : ' (on crews\' reports)'}: ${site.name}. Awarded: ${rewards}.`);
      }
    } else if (o.status === 'claimed' && site.owner !== o.side) {
      // Unconfirmed claims can come back to haunt a commander.
      if (side.perceived.photographed.includes(o.siteId) && (side.perceived.sites[o.siteId] ?? 0) <= 25) o.status = 'confirmed';
      else if (site.condition > 45 && rng.chance(0.3)) {
        o.status = 'discredited';
        side.trust = Math.max(side.isAI ? 20 : 0, side.trust - 15);
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

  // Pay for fuel & munitions.
  for (const id of [0, 1] as SideId[]) {
    const c = planCost(state.sides[id], plans[id]);
    state.sides[id].resources.fuel = Math.max(0, state.sides[id].resources.fuel - c.fuel);
    state.sides[id].resources.munitions = Math.max(0, state.sides[id].resources.munitions - c.munitions);
  }

  const day = newDay();
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
    const drawnSquadrons = new Set(dp.defense.filter((sqId) => dp.cover[sqId] === f.sector || (dp.cover[sqId] === undefined && battle.chance(radar ? 0.25 : 0.5))));
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
    if (r.target === 'support') supportPush[id] = r.damage * mods.support;
    else if (r.target !== 'sweep' && r.target !== 'feint') {
      const dealt = applyDamage(state, r.siteId, r.damage);
      damageTaken[(1 - id) as SideId][r.target] = dealt;
      r.damage = dealt;
    }
  }

  // Losses & morale.
  for (const id of [0, 1] as SideId[]) applyLosses(rng, state.sides[id], allRecs);

  // Pressure on the front moves on true results.
  const lost0 = allRecs.filter((r) => r.side === 0 && r.fate === 'lost').length;
  const lost1 = allRecs.filter((r) => r.side === 1 && r.fate === 'lost').length;
  const strat0 = raids[0] && raids[0].target !== 'support' ? raids[0].damage : 0;
  const strat1 = raids[1] && raids[1].target !== 'support' ? raids[1].damage : 0;
  syncFacilities(state);
  const delta =
    (lost1 - lost0) * 2 +
    (supportPush[0] - supportPush[1]) * 1.4 +
    (strat0 - strat1) * 0.2 +
    (Math.min(120, s0.facilities.industry) - Math.min(120, s1.facilities.industry)) * 0.03 +
    (Math.min(120, s0.facilities.fuel) - Math.min(120, s1.facilities.fuel)) * 0.02 +
    rng.gauss(3) +
    (s1.isAI ? -0.8 * (act(state) - 1) : 0);
  state.front = Math.round(state.front + delta);
  t.week++;
  const news = applyPressure(state);
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
      allRecs, reconResult, !!rc && !rc.ok, damageTaken[id], day.landing, theaterDef(state).sectors);
    updatePerceived(rng, side, d, raids[id]);
    // Army liaison: honest about towns, optimistic about pressure.
    side.perceived.front = Math.round(state.front * (id === 0 ? 1 : -1) + 5 + rng.gauss(5));
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

  // Archive the truth.
  const hitsOf = (side: SideId, lost: boolean): Hit[] =>
    allRecs
      .filter((r) => r.side === side && (r.kind === 'medium' || r.kind === 'heavy') && (lost ? r.fate === 'lost' : r.fate !== 'lost'))
      .flatMap((r) => r.hits);
  const entry: ArchiveEntry = {
    turn: state.turn,
    trueLosses: [lost0, lost1],
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
    state.theaterResults.push({ index: t.index, name: def.name, winner: decision.winner, weeks: t.week, decisive: decision.decisive });
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
      // Orders from the old theater lapse; High Command issues fresh ones.
      for (const side of state.sides) {
        side.orders = [newOrder(rng, state, side)];
        memo(side, state.turn + 1, 'order', 'Operational directive', side.orders[0].text);
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

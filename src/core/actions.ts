import { tech } from './tech';
import { AIRCRAFT, MAX_ARMOR_PER_ZONE, MAX_EFFORT, RESEARCH, TURRET_FITS, TURRET_REFIT_COST } from './data';
import { researchCost, spec, storesCap } from './factions';
import { flyable } from './sim';
import { bomberRange, depthFor, frontSector, syncFacilities } from './theaters';
import type {
  AircraftKind,
  Doctrine,
  FacilityType,
  FighterApproach,
  GameState,
  QcPolicy,
  SideState,
  Squadron,
  TrainingFocus,
  TurnPlan,
  TurretFit,
  ZoneId,
} from './types';
import { ZONES } from './types';

export type ActionResult = { ok: true } | { ok: false; reason: string };
const ok: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

export const COSTS = {
  armorChange: 4,
  factoryUpgrade: (level: number) => 70 + 50 * level,
  trainingUpgrade: (level: number) => 50 + 40 * level,
  flakUpgrade: (flak: number) => Math.round(60 + 80 * flak),
  rest: 0,
};

export function armorUsed(sq: Squadron): number {
  return ZONES.reduce((a, z) => a + sq.armor[z], 0);
}

export function setArmor(side: SideState, sqId: string, zone: ZoneId, value: number): ActionResult {
  const sq = side.squadrons.find((s) => s.id === sqId);
  if (!sq) return fail('No such squadron');
  if (!ZONES.includes(zone)) return fail(`No such zone: ${zone}. Zones are ${ZONES.join(', ')}`);
  if (!Number.isFinite(value)) return fail('Give the number of plates');
  const v = Math.max(0, Math.min(MAX_ARMOR_PER_ZONE, Math.round(value)));
  const delta = v - sq.armor[zone];
  if (delta === 0) return ok;
  const budget = spec(side, sq.kind).armorBudget;
  if (armorUsed(sq) + delta > budget) return fail('Armor budget exceeded: remove plate elsewhere first');
  // Fitting plate costs supplies; taking it off is free.
  const cost = Math.max(0, delta) * COSTS.armorChange;
  if (side.resources.supplies < cost) return fail('Not enough supplies for the refit');
  side.resources.supplies -= cost;
  sq.armor[zone] = v;
  return ok;
}

/**
 * Copy one squadron's armor layout onto every other squadron of the same type.
 * All or nothing: the refit is refused if the supplies cannot pay for every plate fitted.
 */
export function copyArmor(side: SideState, sqId: string): ActionResult {
  const src = side.squadrons.find((s) => s.id === sqId);
  if (!src) return fail('No such squadron');
  const others = side.squadrons.filter((q) => q !== src && q.kind === src.kind);
  if (!others.length) return fail('No other squadron flies this type');
  const added = others.reduce((a, q) => a + ZONES.reduce((b, z) => b + Math.max(0, src.armor[z] - q.armor[z]), 0), 0);
  const cost = added * COSTS.armorChange;
  if (side.resources.supplies < cost) return fail(`Not enough supplies for the refit (${cost} needed)`);
  side.resources.supplies -= cost;
  for (const q of others) for (const z of ZONES) q.armor[z] = src.armor[z];
  return ok;
}

/** Plates that copying a squadron's layout would fit across its type, and what that costs. */
export function copyArmorCost(side: SideState, sqId: string): { squadrons: number; plates: number; cost: number } {
  const src = side.squadrons.find((s) => s.id === sqId);
  if (!src) return { squadrons: 0, plates: 0, cost: 0 };
  const others = side.squadrons.filter((q) => q !== src && q.kind === src.kind);
  const plates = others.reduce((a, q) => a + ZONES.reduce((b, z) => b + Math.max(0, src.armor[z] - q.armor[z]), 0), 0);
  const differ = others.filter((q) => ZONES.some((z) => q.armor[z] !== src.armor[z])).length;
  return { squadrons: differ, plates, cost: plates * COSTS.armorChange };
}

export function setDoctrine(side: SideState, sqId: string, d: Partial<Doctrine>): ActionResult {
  const sq = side.squadrons.find((s) => s.id === sqId);
  if (!sq) return fail('No such squadron');
  const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  if (d.aggression !== undefined) sq.doctrine.aggression = clamp(d.aggression);
  if (d.formation !== undefined) sq.doctrine.formation = clamp(d.formation);
  if (d.altitude !== undefined) sq.doctrine.altitude = clamp(d.altitude);
  if (d.breakOff !== undefined) sq.doctrine.breakOff = clamp(d.breakOff, 0.1, 1);
  return ok;
}

/** Move a bomber squadron's guns to another turret layout. */
export function setTurrets(side: SideState, sqId: string, fit: TurretFit): ActionResult {
  const sq = side.squadrons.find((s) => s.id === sqId);
  if (!sq) return fail('No such squadron');
  if (sq.kind !== 'medium' && sq.kind !== 'heavy') return fail('Only bombers carry turrets');
  if (!TURRET_FITS[fit]) return fail('No such layout');
  if ((sq.turrets ?? 'standard') === fit) return ok;
  if (side.resources.supplies < TURRET_REFIT_COST) return fail('Not enough supplies');
  side.resources.supplies -= TURRET_REFIT_COST;
  sq.turrets = fit;
  return ok;
}

export function setApproach(side: SideState, weights: Record<FighterApproach, number>): ActionResult {
  const tot = weights.tail + weights.headOn + weights.beam;
  if (tot <= 0) return fail('Weights must be positive');
  side.approach = { tail: weights.tail / tot, headOn: weights.headOn / tot, beam: weights.beam / tot };
  return ok;
}

export function upgradeFactory(side: SideState): ActionResult {
  const c = COSTS.factoryUpgrade(side.factory.level);
  if (side.factory.level >= 5) return fail('Factory fully expanded');
  if (side.resources.supplies < c) return fail('Not enough supplies');
  side.resources.supplies -= c;
  side.factory.level++;
  return ok;
}

export function upgradeTraining(side: SideState): ActionResult {
  const c = COSTS.trainingUpgrade(side.training.level);
  if (side.training.level >= 5) return fail('Training school fully expanded');
  if (side.resources.supplies < c) return fail('Not enough supplies');
  side.resources.supplies -= c;
  side.training.level++;
  return ok;
}

export function upgradeFlak(side: SideState): ActionResult {
  const c = COSTS.flakUpgrade(side.flak);
  if (side.flak >= 1.5) return fail('Flak defences at maximum');
  if (side.resources.supplies < c || side.resources.stores < 20) return fail('Not enough supplies or stores');
  side.resources.supplies -= c;
  side.resources.stores -= 20;
  side.flak = Math.round((side.flak + 0.25) * 100) / 100;
  return ok;
}

export function setQc(side: SideState, qc: QcPolicy): ActionResult {
  side.factory.qc = qc;
  return ok;
}

export function setTrainingFocus(side: SideState, focus: TrainingFocus): ActionResult {
  side.training.focus = focus;
  return ok;
}

/** Live-fire practice at the school: better graduates, paid in stores each week. */
export function setLiveFire(side: SideState, on: boolean): ActionResult {
  side.training.liveFire = on;
  return ok;
}

export function canBuild(side: SideState, kind: AircraftKind): boolean {
  const req = AIRCRAFT[kind].requires;
  return !req || side.research.includes(req);
}

export function queueAircraft(side: SideState, kind: AircraftKind): ActionResult {
  if (!canBuild(side, kind)) return fail('Not yet developed');
  const cost = spec(side, kind).cost;
  if (side.resources.supplies < cost) return fail('Not enough supplies');
  side.resources.supplies -= cost;
  side.factory.queue.push(kind);
  return ok;
}

export function cancelQueued(side: SideState, index: number): ActionResult {
  const kind = side.factory.queue[index];
  if (!kind) return fail('Nothing queued there');
  side.factory.queue.splice(index, 1);
  side.resources.supplies += Math.round(spec(side, kind).cost * 0.8);
  return ok;
}

export function startResearch(side: SideState, id: string): ActionResult {
  const item = RESEARCH.find((r) => r.id === id);
  if (!item) return fail('Unknown project');
  if (side.research.includes(id)) return fail('Already developed');
  if (side.researching) return fail('Engineers are busy with another project');
  if (item.requires && !side.research.includes(item.requires)) return fail('Prerequisite missing');
  const cost = researchCost(side, item);
  if (side.resources.supplies < cost) return fail('Not enough supplies');
  side.resources.supplies -= cost;
  side.researching = id;
  side.researchProgress = 0;
  return ok;
}

/** Emergency repairs: work gangs patch up every site of one type we hold, once per type per week. */
export const REPAIR_COST = 40;
export function emergencyRepair(state: GameState, side: SideState, type: FacilityType): ActionResult {
  if (side.repaired?.includes(type)) return fail('Those works have already had emergency repairs this week');
  const sites = state.theater.sites.filter((x) => x.owner === side.id && x.type === type && x.condition < 100);
  if (sites.length === 0) return fail('Nothing to repair');
  if (side.resources.supplies < REPAIR_COST) return fail('Not enough supplies');
  side.resources.supplies -= REPAIR_COST;
  for (const x of sites) x.condition = Math.min(100, x.condition + 20);
  side.repaired = [...(side.repaired ?? []), type];
  syncFacilities(state);
  return ok;
}

/** A stores convoy: supplies bought into fuel and munitions, once a week, at a poor rate. */
export const CONVOY = { supplies: 60, stores: 35 };
export function buyConvoy(state: GameState, side: SideState): ActionResult {
  if (side.convoyWeek === state.turn) return fail('One convoy a week is all the railways can manage');
  if (side.resources.supplies < CONVOY.supplies) return fail('Not enough supplies');
  const cap = storesCap(side);
  if (side.resources.stores >= cap) return fail('The depots are full');
  side.resources.supplies -= CONVOY.supplies;
  side.resources.stores = Math.min(cap, side.resources.stores + CONVOY.stores);
  side.convoyWeek = state.turn;
  return ok;
}

/** Supplies per aircrew asked of the Ministry: dearer the less it trusts the commander. */
export function crewPrice(side: SideState): number {
  return Math.round(15 + (100 - side.trust) * 0.35);
}

/** Aircraft (built or on order) without a trained crew or one at the school. Raw recruits don't count. */
function crewless(side: SideState): number {
  const aircraft = side.squadrons.reduce((a, q) => a + q.airframes.length, 0) + side.factory.queue.length;
  const crews = side.squadrons.reduce((a, q) => a + Math.max(0, q.crews), 0) + side.training.inTraining;
  return Math.max(0, aircraft - crews);
}

/**
 * How many crews the Ministry can usefully post: aircraft that have no crew now, or none coming from
 * the school. A squadron with an idle aircraft needs a crew this week, even if trainees will graduate later.
 */
export function crewNeed(side: SideState): number {
  const idleNow = side.squadrons.reduce((a, q) => a + Math.max(0, q.airframes.length - Math.max(0, q.crews)), 0);
  return Math.max(idleNow, crewless(side));
}

/** Ask the Ministry for trained aircrew, posted straight to squadrons short of crews. */
export function requestCrews(side: SideState, n: number): ActionResult {
  const need = crewNeed(side);
  if (!Number.isFinite(n) || n < 1) return fail('Ask for at least one crew');
  if (need <= 0) return fail(`Every aircraft has a crew, counting the ${side.training.inTraining} at the training school. Order aircraft first: crews follow them`);
  const k = Math.min(Math.round(n), need);
  const cost = k * crewPrice(side);
  if (side.resources.supplies < cost) return fail(`Not enough supplies: ${k} crew${k === 1 ? '' : 's'} at ${crewPrice(side)} each cost ${cost}, and we have ${side.resources.supplies}`);
  side.resources.supplies -= cost;
  let left = k;
  for (const sq of [...side.squadrons].sort((a, b) => a.crews - a.airframes.length - (b.crews - b.airframes.length))) {
    while (left > 0 && sq.crews < sq.airframes.length) {
      // Posted from other units: competent, not special.
      sq.skill = (sq.skill * sq.crews + 0.35) / (sq.crews + 1);
      sq.crews++;
      left--;
    }
  }
  side.resources.replacements += left;
  return ok;
}

/** Fold a gutted squadron into another of the same type: aircraft and crews move, the name goes on the roll. */
export function mergeSquadrons(state: GameState, side: SideState, fromId: string, intoId: string, plan?: TurnPlan): ActionResult {
  const from = side.squadrons.find((q) => q.id === fromId);
  const into = side.squadrons.find((q) => q.id === intoId);
  if (!from || !into || from === into) return fail('Choose two different squadrons');
  if (from.kind !== into.kind) return fail('Only squadrons flying the same type can be merged');
  if (from.airframes.length > 2) return fail(`${from.name} can still fly as a squadron`);
  into.skill = (into.skill * into.crews + from.skill * from.crews) / Math.max(1, into.crews + from.crews);
  into.airframes.push(...from.airframes);
  into.crews += from.crews;
  side.squadrons = side.squadrons.filter((q) => q !== from);
  if (plan) {
    if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.filter((x) => x !== from.id);
    plan.defense = plan.defense.filter((x) => x !== from.id);
    delete plan.cover[from.id];
    if (plan.feint) plan.feint.squadronIds = plan.feint.squadronIds.filter((x) => x !== from.id);
    if (plan.recon?.squadronId === from.id) plan.recon = null;
  }
  const n = from.airframes.length;
  into.notables = [`Week ${state.turn}: took in the last of ${from.name}; ${from.leader.rank} ${from.leader.name} now a flight commander.`, ...into.notables].slice(0, 5);
  side.memos.unshift({ turn: state.turn, from: 'Group HQ', kind: 'notice', subject: `${from.name} merged into ${into.name}`, body: `The last ${n === 0 ? 'men' : n === 1 ? 'crew and aircraft' : `${n} crews and aircraft`} of ${from.name} have carried their squadron badge across the field to ${into.name}. ${from.leader.rank} ${from.leader.name} becomes a flight commander there. You may make him commanding officer of ${into.name} instead of ${into.leader.rank} ${into.leader.name} this week (Squadrons). The name ${from.name} has been painted on the board in the mess, under the date.` });
  // Either man could command the merged squadron.
  into.candidate = from.leader;
  into.candidateWeek = state.turn;
  side.usedNames = [...new Set([...(side.usedNames ?? []), from.leader.name])];
  return ok;
}

/** Appoint the other flight commander after a change of command or a merge (the week it happens only). */
export function appointLeader(state: GameState, side: SideState, sqId: string): ActionResult {
  const sq = side.squadrons.find((q) => q.id === sqId);
  if (!sq?.candidate || sq.candidateWeek !== state.turn) return fail('There is no choice of commanding officer to make for that squadron this week');
  const was = sq.leader;
  sq.leader = sq.candidate;
  sq.leader.since = sq.leader.since ?? state.turn;
  delete sq.candidate;
  delete sq.candidateWeek;
  // The man passed over stays on as senior flight commander, first in line next time.
  sq.deputy = was;
  sq.notables = [`Week ${state.turn}: ${sq.leader.rank} ${sq.leader.name} appointed to command; ${was.rank} ${was.name} a flight commander.`, ...sq.notables.filter((n) => !n.includes(`${sq.leader.name} now a flight commander`))].slice(0, 5);
  side.memos.unshift({ turn: state.turn, from: 'Group HQ', kind: 'notice', subject: `${sq.name}: ${sq.leader.rank} ${sq.leader.name} appointed`, body: `On your recommendation ${sq.leader.rank} ${sq.leader.name} takes command of ${sq.name}. ${was.rank} ${was.name} remains with the squadron as a flight commander.` });
  return ok;
}

/** The medical officer grounds a shaken commanding officer for two weeks; his deputy leads meanwhile. */
export function restLeader(state: GameState, side: SideState, sqId: string): ActionResult {
  const sq = side.squadrons.find((q) => q.id === sqId);
  if (!sq) return fail('No such squadron');
  const l = sq.leader;
  if (l.trait !== 'shaken') return fail(`${l.rank} ${l.name} is not a sick man, says the medical officer`);
  if (l.resting) return fail(`${l.rank} ${l.name} is already on rest`);
  if (l.restedOnce) return fail(`The medical officer has rested ${l.rank} ${l.name} once already and won't sign it again`);
  l.resting = 2;
  l.restedOnce = true;
  // A CO taken off operations unsettles his squadron, and High Command notices.
  sq.morale = Math.max(0, sq.morale - 0.05);
  side.trust = Math.max(0, side.trust - 2);
  sq.notables = [`Week ${state.turn}: ${l.rank} ${l.name} sent on two weeks' rest by the medical officer.`, ...sq.notables].slice(0, 5);
  return ok;
}

export function researchTurns(cost: number): number {
  return Math.max(1, Math.round(cost / 45));
}

export function planCost(side: SideState, plan: TurnPlan): { stores: number } {
  let stores = 0;
  const ids = new Set([...(plan.raid?.squadronIds ?? []), ...plan.defense, ...(plan.feint?.squadronIds ?? [])]);
  for (const id of ids) {
    const sq = side.squadrons.find((s) => s.id === id);
    if (!sq) continue;
    const n = flyable(sq).length;
    const max = plan.raid?.maxEffort && plan.raid.squadronIds.includes(id) ? MAX_EFFORT.stores : 1;
    stores += n * AIRCRAFT[sq.kind].storesCost * max;
  }
  if (plan.recon) stores += AIRCRAFT.recon.storesCost;
  return { stores: Math.round(stores * (1 - tech(side, 'economy'))) };
}

/** Check a plan against the rules. Pass the game state to also check ranges and sites. */
export function validatePlan(side: SideState, plan: TurnPlan, state?: GameState): ActionResult {
  const raidIds = plan.raid?.squadronIds ?? [];
  if (plan.raid && raidIds.length === 0) return fail('No squadrons are assigned to the operation. Assign some, or choose No operation');
  if (state && plan.raid && raidIds.length) {
    const t = state.theater;
    const r = plan.raid;
    if (r.target !== 'sweep' && r.target !== 'support') {
      const site = t.sites.find((x) => x.id === r.siteId);
      if (!site || site.owner === side.id) return fail('Choose an enemy site to strike');
      const bombers = raidIds.filter((id) => ['medium', 'heavy'].includes(side.squadrons.find((s) => s.id === id)?.kind ?? ''));
      if (bombers.length === 0) return fail('No bombers are assigned to the strike. Fighters can escort it, but they carry no bombs');
      const depth = depthFor(t.held0, side.id, site.sector);
      for (const id of raidIds) {
        const sq = side.squadrons.find((s) => s.id === id);
        if (sq && sq.kind !== 'fighter' && bomberRange(sq.kind) < depth) return fail(`${sq.name} cannot reach ${site.name}: it is ${depth} sectors deep`);
      }
    }
  }
  if (plan.feint && plan.feint.squadronIds.length) {
    for (const id of plan.feint.squadronIds) {
      if (raidIds.includes(id) || plan.defense.includes(id)) return fail('A squadron cannot fly the feint and another mission');
      const sq = side.squadrons.find((s) => s.id === id);
      if (!sq || sq.kind === 'recon') return fail('Recon aircraft cannot fly feints');
    }
    if (state) {
      const t = state.theater;
      const sector = plan.feint.sector;
      if ((sector < t.held0 ? 0 : 1) === side.id) return fail('The feint must be flown over enemy territory');
      if (depthFor(t.held0, side.id, sector) > 2) return fail('The feint sector is too deep');
      const main = plan.raid?.siteId ? t.sites.find((x) => x.id === plan.raid!.siteId)?.sector : plan.raid ? frontSector(t, side.id) : undefined;
      if (main === sector) return fail('A feint over the same sector as the real raid fools nobody');
    }
  }
  const ready = (ids: string[]) => ids.reduce((a, id) => a + (side.squadrons.find((q) => q.id === id) ? flyable(side.squadrons.find((q) => q.id === id)!).length : 0), 0);
  if (plan.raid && raidIds.length && ready(raidIds) === 0) return fail('No aircraft in the raid are ready to fly');
  if (plan.feint && ready(plan.feint.squadronIds) === 0) return fail('No aircraft ready to fly the feint');
  if (plan.recon && ready([plan.recon.squadronId]) === 0) return fail('No recon aircraft ready to fly');
  if (state && plan.recon) {
    const site = state.theater.sites.find((x) => x.id === plan.recon!.siteId);
    if (!site || site.owner === side.id) return fail('Choose an enemy site to photograph');
  }
  for (const id of plan.defense) {
    if (raidIds.includes(id)) return fail('A squadron cannot both raid and defend');
    const sq = side.squadrons.find((s) => s.id === id);
    if (!sq || sq.kind !== 'fighter') return fail('Only fighters can be held for defence');
  }
  if (plan.raid?.target === 'sweep') {
    for (const id of raidIds) {
      const sq = side.squadrons.find((s) => s.id === id);
      if (sq && sq.kind !== 'fighter') return fail('Only fighters fly sweeps');
    }
  }
  if (plan.recon) {
    const sq = side.squadrons.find((s) => s.id === plan.recon!.squadronId);
    if (!sq || sq.kind !== 'recon') return fail('Recon needs a recon aircraft');
  }
  const c = planCost(side, plan);
  if (c.stores > side.resources.stores) return fail(`Not enough stores (${c.stores} needed, ${side.resources.stores} held)`);
  return ok;
}

export function emptyPlan(): TurnPlan {
  return { raid: null, defense: [], cover: {}, recon: null, feint: null, embellish: 0 };
}

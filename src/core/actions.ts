import { AIRCRAFT, MAX_ARMOR_PER_ZONE, RESEARCH } from './data';
import { flyable } from './sim';
import { bomberRange, depthFor, frontSector } from './theaters';
import type {
  AircraftKind,
  Doctrine,
  FighterApproach,
  GameState,
  QcPolicy,
  SideState,
  Squadron,
  TrainingFocus,
  TurnPlan,
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
  const v = Math.max(0, Math.min(MAX_ARMOR_PER_ZONE, Math.round(value)));
  const delta = v - sq.armor[zone];
  if (delta === 0) return ok;
  const budget = AIRCRAFT[sq.kind].armorBudget;
  if (armorUsed(sq) + delta > budget) return fail('Armor budget exceeded: remove plate elsewhere first');
  const cost = Math.abs(delta) * COSTS.armorChange;
  if (side.resources.supplies < cost) return fail('Not enough supplies for the refit');
  side.resources.supplies -= cost;
  sq.armor[zone] = v;
  return ok;
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
  if (side.resources.supplies < c || side.resources.munitions < 20) return fail('Not enough supplies or munitions');
  side.resources.supplies -= c;
  side.resources.munitions -= 20;
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

export function canBuild(side: SideState, kind: AircraftKind): boolean {
  const req = AIRCRAFT[kind].requires;
  return !req || side.research.includes(req);
}

export function queueAircraft(side: SideState, kind: AircraftKind): ActionResult {
  if (!canBuild(side, kind)) return fail('Not yet developed');
  const cost = AIRCRAFT[kind].cost;
  if (side.resources.supplies < cost) return fail('Not enough supplies');
  side.resources.supplies -= cost;
  side.factory.queue.push(kind);
  return ok;
}

export function cancelQueued(side: SideState, index: number): ActionResult {
  const kind = side.factory.queue[index];
  if (!kind) return fail('Nothing queued there');
  side.factory.queue.splice(index, 1);
  side.resources.supplies += Math.round(AIRCRAFT[kind].cost * 0.8);
  return ok;
}

export function startResearch(side: SideState, id: string): ActionResult {
  const item = RESEARCH.find((r) => r.id === id);
  if (!item) return fail('Unknown project');
  if (side.research.includes(id)) return fail('Already developed');
  if (side.researching) return fail('Engineers are busy with another project');
  if (item.requires && !side.research.includes(item.requires)) return fail('Prerequisite missing');
  if (side.resources.supplies < item.cost) return fail('Not enough supplies');
  side.resources.supplies -= item.cost;
  side.researching = id;
  side.researchProgress = 0;
  return ok;
}

export function researchTurns(cost: number): number {
  return Math.max(1, Math.round(cost / 45));
}

export function planCost(side: SideState, plan: TurnPlan): { fuel: number; munitions: number } {
  let fuel = 0;
  let munitions = 0;
  const ids = new Set([...(plan.raid?.squadronIds ?? []), ...plan.defense, ...(plan.feint?.squadronIds ?? [])]);
  for (const id of ids) {
    const sq = side.squadrons.find((s) => s.id === id);
    if (!sq) continue;
    const n = flyable(sq).length;
    fuel += n * AIRCRAFT[sq.kind].fuelCost;
    munitions += n * AIRCRAFT[sq.kind].munitionsCost;
  }
  if (plan.recon) {
    fuel += AIRCRAFT.recon.fuelCost;
  }
  return { fuel, munitions };
}

/** Check a plan against the rules. Pass the game state to also check ranges and sites. */
export function validatePlan(side: SideState, plan: TurnPlan, state?: GameState): ActionResult {
  const raidIds = plan.raid?.squadronIds ?? [];
  if (state && plan.raid && raidIds.length) {
    const t = state.theater;
    const r = plan.raid;
    if (r.target !== 'sweep' && r.target !== 'support') {
      const site = t.sites.find((x) => x.id === r.siteId);
      if (!site || site.owner === side.id) return fail('Choose an enemy site to strike');
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
  if (c.fuel > side.resources.fuel) return fail(`Not enough fuel (${c.fuel} needed)`);
  if (c.munitions > side.resources.munitions) return fail(`Not enough munitions (${c.munitions} needed)`);
  return ok;
}

export function emptyPlan(): TurnPlan {
  return { raid: null, defense: [], cover: {}, recon: null, feint: null, embellish: 0 };
}

import { emptyPlan, queueAircraft, setApproach, startResearch, upgradeFactory, upgradeFlak, upgradeTraining, validatePlan } from './actions';
import { AIRCRAFT, APPROACH_ZONES, MAX_ARMOR_PER_ZONE, RESEARCH, ZONE_AREA } from './data';
import { Rng } from './rng';
import { flyable } from './sim';
import { act } from './turn';
import type { GameState, SideId, SideState, Squadron, TargetId, TurnPlan, ZoneId } from './types';
import { ZONES } from './types';

/**
 * Lay out armor from what the commander has seen on returning aircraft.
 * A naive commander plates the holes; an insightful one plates the gaps.
 */
export function chooseArmor(side: SideState, sq: Squadron): Record<ZoneId, number> {
  const seen = side.perceived.survivorHits;
  const totalSeen = ZONES.reduce((a, z) => a + seen[z], 0);
  const budget = AIRCRAFT[sq.kind].armorBudget;
  const weights = {} as Record<ZoneId, number>;
  // Expected exposure if every hit were equally survivable.
  const exp = {} as Record<ZoneId, number>;
  let expTot = 0;
  for (const z of ZONES) {
    exp[z] = ZONE_AREA[z] * (APPROACH_ZONES.tail[z] + APPROACH_ZONES.headOn[z] + APPROACH_ZONES.beam[z] + APPROACH_ZONES.flak[z]);
    expTot += exp[z];
  }
  for (const z of ZONES) {
    const seenShare = totalSeen > 0 ? seen[z] / totalSeen : exp[z] / expTot;
    const expShare = exp[z] / expTot;
    const naive = seenShare;
    const wald = Math.max(0, expShare - seenShare) + 0.002;
    weights[z] = (1 - side.insight) * naive + side.insight * wald * 2.5;
  }
  const out = {} as Record<ZoneId, number>;
  for (const z of ZONES) out[z] = 0;
  for (let i = 0; i < budget; i++) {
    // Greedy: place next plate where weight / (plates + 1) is greatest.
    let best: ZoneId = 'fuselage';
    let bestV = -1;
    for (const z of ZONES) {
      if (out[z] >= MAX_ARMOR_PER_ZONE) continue;
      const v = weights[z] / (out[z] + 1);
      if (v > bestV) {
        bestV = v;
        best = z;
      }
    }
    out[best]++;
  }
  return out;
}

function ready(sq: Squadron): number {
  return flyable(sq).length;
}

export function aiPlan(state: GameState, id: SideId): TurnPlan {
  const side = state.sides[id];
  const rng = new Rng({ s: (state.rng.s ^ (0x9e3779b9 * (id + 1) + state.turn * 7919)) >>> 0 });
  const plan = emptyPlan();
  const a = act(state.turn, state.maxTurns);

  // --- Spending ---
  const bomberSqs = side.squadrons.filter((s) => s.kind === 'medium' || s.kind === 'heavy');
  for (const sq of side.squadrons) {
    if (sq.kind === 'recon') continue;
    // Re-plate only every few turns to save supplies, and only once there is evidence.
    if (state.turn % 3 === 0 && ZONES.reduce((x, z) => x + side.perceived.survivorHits[z], 0) > 10) {
      const target = chooseArmor(side, sq);
      const cost = ZONES.reduce((x, z) => x + Math.abs(target[z] - sq.armor[z]), 0) * 4;
      if (side.resources.supplies > cost + 60) {
        side.resources.supplies -= cost;
        sq.armor = target;
      }
    }
  }
  if (!side.researching) {
    const prefs = ['radar', 'selfSealing', 'gunCameras', a >= 2 ? 'heavyAirframe' : 'photoRecon', 'gyroSight', 'armorAlloy', 'radios', 'intelOfficer', 'photoRecon', 'heavyAirframe'];
    for (const p of prefs) {
      const item = RESEARCH.find((r) => r.id === p)!;
      if (!side.research.includes(p) && side.resources.supplies > item.cost + 80) {
        if (startResearch(side, p).ok) break;
      }
    }
  }
  const fighters = side.squadrons.filter((s) => s.kind === 'fighter').reduce((x, s) => x + s.airframes.length, 0);
  const bombers = bomberSqs.reduce((x, s) => x + s.airframes.length, 0);
  for (let i = 0; i < 4; i++) {
    if (side.resources.supplies < 90) break;
    const kind = fighters < 14 + a * 2 ? 'fighter' : side.research.includes('heavyAirframe') && rng.chance(0.5) ? 'heavy' : bombers < 12 ? 'medium' : 'fighter';
    if (!queueAircraft(side, kind).ok) break;
  }
  if (side.resources.supplies > 260 && side.factory.level < 4) upgradeFactory(side);
  if (side.resources.supplies > 220 && side.training.level < 3) upgradeTraining(side);
  if (side.resources.supplies > 240 && side.flak < 1 + a * 0.15) upgradeFlak(side);

  // --- Tactics: adapt interceptor approach to what pilots report. ---
  // As the war goes on the AI discovers head-on attacks; imperfectly.
  const headOn = Math.min(0.6, 0.1 + 0.15 * (a - 1) + rng.range(-0.05, 0.1));
  setApproach(side, { tail: Math.max(0.15, 0.7 - headOn), headOn, beam: 0.3 });

  // --- Operations ---
  const fighterSqs = side.squadrons.filter((s) => s.kind === 'fighter' && ready(s) >= 2);
  fighterSqs.sort((x, y) => ready(y) - ready(x));
  const readyBombers = bomberSqs.filter((s) => ready(s) >= 3 && s.morale > 0.2);
  const believedThreat = side.perceived.enemyFighters;
  const ownFighters = fighterSqs.reduce((x, s) => x + ready(s), 0);

  // Defence first: hold at least one fighter squadron.
  if (fighterSqs.length > 0) plan.defense.push(fighterSqs[0].id);
  const spareFighters = fighterSqs.slice(1);

  const pickTarget = (): TargetId => {
    const f = side.perceived.enemyFacilities;
    if (believedThreat > ownFighters * 1.6) return 'airfield';
    const options: TargetId[] = ['industry', 'airfield', 'fuel'];
    return options.sort((x, y) => f[x as 'industry'] - f[y as 'industry'])[rng.chance(0.6) ? 2 : rng.int(0, 2)];
  };

  if (readyBombers.length > 0 && rng.chance(0.85)) {
    plan.raid = { target: pickTarget(), squadronIds: [...readyBombers.map((s) => s.id), ...spareFighters.slice(0, 1).map((s) => s.id)] };
  } else if (spareFighters.length > 0) {
    plan.raid = { target: 'sweep', squadronIds: [spareFighters[0].id] };
  }
  const recon = side.squadrons.find((s) => s.kind === 'recon' && ready(s) > 0);
  if (recon && rng.chance(0.6)) plan.recon = { squadronId: recon.id, target: rng.pick(['industry', 'airfield', 'fuel'] as const) };

  // Doctrine: bolder when morale is high.
  for (const sq of side.squadrons) {
    sq.doctrine.aggression = Math.max(0.2, Math.min(0.9, 0.35 + sq.morale * 0.5));
    sq.doctrine.formation = sq.kind === 'fighter' ? 0.4 : 0.75;
    sq.doctrine.breakOff = 0.45;
  }

  // Trim the plan until it fits the fuel and munitions available.
  let guard = 0;
  while (!validatePlan(side, plan).ok && guard++ < 10) {
    if (plan.recon) plan.recon = null;
    else if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else if (plan.raid) plan.raid = null;
    else if (plan.defense.length) plan.defense.pop();
  }
  plan.embellish = side.isAI ? 0.1 : 0;
  return plan;
}

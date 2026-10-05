import { emptyPlan, queueAircraft, setApproach, startResearch, upgradeFactory, upgradeFlak, upgradeTraining, validatePlan } from './actions';
import { AIRCRAFT, APPROACH_ZONES, MAX_ARMOR_PER_ZONE, RESEARCH, ZONE_AREA } from './data';
import { Rng } from './rng';
import { flyable } from './sim';
import { bomberRange, depthFor, escortRange, frontSector, reachableSites, sectorAtDepth, theaterMods } from './theaters';
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
  const a = act(state);

  // --- Spending ---
  const bomberSqs = side.squadrons.filter((s) => s.kind === 'medium' || s.kind === 'heavy');
  for (const sq of side.squadrons) {
    if (sq.kind === 'recon') continue;
    // Re-plate only every few turns to save supplies, and only once there is evidence.
    if (state.turn % 3 === 0 && ZONES.reduce((x, z) => x + side.perceived.survivorHits[z], 0) > 10) {
      const target = chooseArmor(side, sq);
      const cost = ZONES.reduce((x, z) => x + Math.max(0, target[z] - sq.armor[z]), 0) * 4;
      if (side.resources.supplies > cost + 60) {
        side.resources.supplies -= cost;
        sq.armor = target;
      }
    }
  }
  if (!side.researching) {
    const prefs = ['radar', 'dropTanks', 'selfSealing', 'gunCameras', a >= 2 ? 'heavyAirframe' : 'photoRecon', 'gyroSight', 'armorAlloy', 'radios', 'intelOfficer', 'photoRecon', 'heavyAirframe'];
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

  const t = state.theater;
  // Guess where the enemy will strike: our sites within its reach, weighted by value.
  const exposed = t.sites.filter((x) => x.owner === id && depthFor(t.held0, (1 - id) as SideId, x.sector) <= 2);
  const coverSquadrons = [fighterSqs[0], ...(spareFighters.length > 1 ? [spareFighters[spareFighters.length - 1]] : [])].filter(Boolean);
  for (const sq of coverSquadrons) {
    if (!plan.defense.includes(sq.id)) plan.defense.push(sq.id);
    if (exposed.length && rng.chance(0.65)) {
      const w: Record<string, number> = {};
      exposed.forEach((x, k) => (w[k] = x.condition * (x.type === 'industry' ? 1.5 : 1)));
      plan.cover[sq.id] = exposed[Number(rng.weighted(w))].sector;
    }
  }
  // Being hit by close support? Patrol our own front and sweep it, if the staff notice in time.
  const ourFront = frontSector(t, (1 - id) as SideId);
  const alert = side.observed.support > 0.8 && rng.chance(0.3 + 0.7 * side.insight);
  if (alert && coverSquadrons.length) plan.cover[coverSquadrons[0].id] = ourFront;
  const escorts = spareFighters.filter((f) => !plan.defense.includes(f.id));

  const minRange = Math.min(...readyBombers.map((q) => bomberRange(q.kind)), 3);
  const targets = reachableSites(state, id, readyBombers.some((q) => q.kind === 'medium') ? 'medium' : 'heavy').filter((x) => depthFor(t.held0, id, x.sector) <= minRange);
  const pressured = side.perceived.front < -12 || theaterMods(state).support > 1;
  if (alert && escorts.length && rng.chance(0.35)) {
    plan.raid = { target: 'sweep', squadronIds: escorts.map((q) => q.id) };
  } else if (readyBombers.length > 0 && rng.chance(0.85)) {
    if (rng.chance(pressured ? 0.55 : 0.3) || targets.length === 0) {
      plan.raid = { target: 'support', squadronIds: [...readyBombers.map((q) => q.id), ...escorts.slice(0, 1).map((q) => q.id)] };
    } else {
      const reach = escortRange(side);
      const w: Record<string, number> = {};
      targets.forEach((x, k) => {
        const believed = side.perceived.sites[x.id] ?? 100;
        const depth = depthFor(t.held0, id, x.sector);
        w[k] = (believed + 10) * (x.type === 'industry' ? 1.4 : x.type === 'airfield' && believedThreat > ownFighters * 1.5 ? 1.6 : 1) * (depth <= reach ? 1.3 : 0.7);
      });
      const site = targets[Number(rng.weighted(w))];
      plan.raid = { target: site.type, siteId: site.id, squadronIds: [...readyBombers.map((q) => q.id), ...escorts.slice(0, 1).map((q) => q.id)] };
    }
  } else if (escorts.length > 0) {
    plan.raid = { target: 'sweep', squadronIds: [escorts[0].id] };
  }
  // Occasionally fly a feint with a spare fighter squadron to pull the enemy reserve away.
  const spare = escorts.filter((q) => !plan.raid?.squadronIds.includes(q.id) && !plan.defense.includes(q.id));
  if (plan.raid && plan.raid.target !== 'sweep' && spare.length && rng.chance(0.4)) {
    const mainSector = plan.raid.siteId ? t.sites.find((x) => x.id === plan.raid!.siteId)!.sector : frontSector(t, id);
    const options = [1, 2].map((d) => sectorAtDepth(t.held0, (1 - id) as SideId, d)).filter((sec) => sec !== mainSector && sec >= 0 && sec < 6);
    if (options.length) plan.feint = { squadronIds: [spare[0].id], sector: rng.pick(options) };
  }
  const recon = side.squadrons.find((q) => q.kind === 'recon' && ready(q) > 0);
  const enemySites = t.sites.filter((x) => x.owner !== id);
  if (recon && enemySites.length && rng.chance(0.6)) {
    const lastSite = plan.raid?.siteId;
    plan.recon = { squadronId: recon.id, siteId: lastSite ?? rng.pick(enemySites).id };
  }

  // Doctrine: bolder when morale is high.
  for (const sq of side.squadrons) {
    sq.doctrine.aggression = Math.max(0.2, Math.min(0.9, 0.35 + sq.morale * 0.5));
    sq.doctrine.formation = sq.kind === 'fighter' ? 0.4 : 0.75;
    sq.doctrine.breakOff = 0.45;
  }

  // Trim the plan until it fits the fuel and munitions available.
  let guard = 0;
  while (!validatePlan(side, plan, state).ok && guard++ < 10) {
    if (plan.recon) plan.recon = null;
    else if (plan.feint) plan.feint = null;
    else if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else if (plan.raid) plan.raid = null;
    else if (plan.defense.length) plan.defense.pop();
  }
  plan.embellish = side.isAI ? 0.1 : 0;
  return plan;
}

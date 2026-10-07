import { buyConvoy, CONVOY, planCost, requestCrews, emergencyRepair, emptyPlan, queueAircraft, REPAIR_COST, setApproach, setTurrets, startResearch, upgradeFactory, upgradeFlak, upgradeTraining, validatePlan } from './actions';
import { AIRCRAFT, APPROACH_ZONES, MAX_ARMOR_PER_ZONE, RESEARCH, TURRET_FITS, TURRET_REFIT_COST, ZONE_AREA } from './data';
import { researchCost, spec } from './factions';
import { Rng } from './rng';
import { fitPlanToStores } from './plans';
import { flyable } from './sim';
import { bomberRange, countedSites, depthFor, escortRange, facilityCondition, frontSector, reachableSites, sectorAtDepth, theaterMods } from './theaters';
import { CRIPPLED } from './effects';
import { act } from './turn';
import type { FighterApproach, GameState, SideId, SideState, Squadron, TargetId, TurnPlan, TurretFit, ZoneId } from './types';
import { ZONES } from './types';

/**
 * Lay out armor from what the commander has seen on returning aircraft.
 * A naive commander plates the holes; an insightful one plates the gaps.
 */
/**
 * Pick the turret layout that would have met the attacks the gunners report,
 * with a margin so the wing doesn't refit over every week's noise.
 */
export function chooseTurrets(side: SideState, sq: Squadron): TurretFit {
  const seen = side.perceived.enemyApproach;
  const score = (f: TurretFit) => (Object.keys(seen) as FighterApproach[]).reduce((a, k) => a + seen[k] * TURRET_FITS[f].coverage[k], 0);
  const now = sq.turrets ?? 'standard';
  let best = now;
  for (const f of Object.keys(TURRET_FITS) as TurretFit[]) if (score(f) > score(best) + 0.06) best = f;
  return best;
}

/** Update and return what this side's pilots believe about the enemy bombers' turrets. */
function enemyTurrets(state: GameState, id: SideId): Record<TurretFit, number> {
  const p = state.sides[id].perceived;
  const bombers = state.sides[(1 - id) as SideId].squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy');
  const n = bombers.reduce((a, q) => a + q.airframes.length, 0);
  const prev = p.enemyTurrets ?? { standard: 1, tail: 0, nose: 0 };
  if (!n) return prev;
  const next = { standard: 0, tail: 0, nose: 0 };
  for (const q of bombers) next[q.turrets ?? 'standard'] += q.airframes.length / n;
  // Word spreads slowly: about a third of the way each week.
  p.enemyTurrets = { standard: prev.standard * 0.65 + next.standard * 0.35, tail: prev.tail * 0.65 + next.tail * 0.35, nose: prev.nose * 0.65 + next.nose * 0.35 };
  return p.enemyTurrets;
}

export function chooseArmor(side: SideState, sq: Squadron): Record<ZoneId, number> {
  // Use this type's own survey once there is enough of it.
  const own = side.perceived.survivorHitsByKind?.[sq.kind];
  const seen = own && ZONES.reduce((a, z) => a + own[z], 0) > 10 ? own : side.perceived.survivorHits;
  const totalSeen = ZONES.reduce((a, z) => a + seen[z], 0);
  const budget = spec(side, sq.kind).armorBudget;
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

/** Next week's target for an AI wing: close support or a strike on a site, weighted by value. */
export function aiIntent(state: GameState, id: SideId): NonNullable<SideState['intent']> {
  const side = state.sides[id];
  const t = state.theater;
  const rng = new Rng({ s: (state.rng.s ^ (0x5bd1e995 * (id + 1)) ^ (state.turn * 7907)) >>> 0 });
  const bombers = side.squadrons.filter((s) => (s.kind === 'medium' || s.kind === 'heavy') && ready(s) >= 3);
  const minRange = Math.min(...bombers.map((q) => bomberRange(q.kind)), 3);
  const targets = reachableSites(state, id, bombers.some((q) => q.kind === 'medium') ? 'medium' : 'heavy').filter((x) => depthFor(t.held0, id, x.sector) <= minRange);
  // No bomber squadron fit to fly: nothing to plan but fighter operations.
  if (bombers.length === 0) return { target: 'sweep' };
  const pressured = side.perceived.front < -12 || theaterMods(state).support > 1;
  // A strategist (more so the higher the difficulty) answers an enemy pushing with worn-out squadrons
  // with a counter-offensive of its own over the front.
  const enemy = state.sides[(1 - id) as SideId];
  const flying = enemy.squadrons.filter((q) => q.kind !== 'recon' && q.airframes.length > 0);
  const worn = flying.length ? flying.reduce((a, q) => a + q.fatigue, 0) / flying.length : 0;
  const strategist = side.isAI ? side.insight : 0;
  if (bombers.length && (worn >= 0.5 || (side.observed.support > 1.2 && worn >= 0.35)) && rng.chance(strategist * 0.9)) return { target: 'support', push: true };
  // ...and works methodically at crippling one type of the enemy's works near the front, the one closest to breaking.
  if (targets.length && rng.chance(strategist * 0.75)) {
    const types = (['airfield', 'fuel', 'industry'] as const).map((type) => {
      const counted = countedSites(t, (1 - id) as SideId, type).filter((x) => targets.includes(x));
      const believed = (x: { id: string }) => side.perceived.sites[x.id] ?? 100;
      const avg = facilityCondition(t, (1 - id) as SideId, type, believed);
      return { type, counted, avg, believed };
    }).filter((x) => x.counted.length && x.avg > 20)
      // Closest above the crippling line first; already crippled works are kept down only if nothing else is in reach.
      .sort((a, b) => (a.avg >= CRIPPLED ? a.avg - CRIPPLED : 100 + a.avg) - (b.avg >= CRIPPLED ? b.avg - CRIPPLED : 100 + b.avg));
    const pick = types[0];
    if (pick) {
      const site = [...pick.counted].sort((a, b) => pick.believed(b) - pick.believed(a))[0];
      return { target: site.type, siteId: site.id, focus: true };
    }
  }
  if (rng.chance(pressured ? 0.55 : 0.3) || targets.length === 0) return { target: 'support' };
  const fighters = side.squadrons.filter((s) => s.kind === 'fighter').reduce((x, s) => x + ready(s), 0);
  const reach = escortRange(side);
  const w: Record<string, number> = {};
  targets.forEach((x, k) => {
    const believed = side.perceived.sites[x.id] ?? 100;
    const depth = depthFor(t.held0, id, x.sector);
    w[k] = (believed + 10) * (x.type === 'industry' ? 1.4 : x.type === 'airfield' && side.perceived.enemyFighters > fighters * 1.5 ? 1.6 : 1) * (depth <= reach ? 1.3 : 0.7);
  });
  const site = targets[Number(rng.weighted(w))];
  return { target: site.type, siteId: site.id };
}

function validIntent(state: GameState, id: SideId, intent: SideState['intent'], range: number) {
  if (!intent) return undefined;
  if (intent.target === 'support') return intent;
  const site = state.theater.sites.find((x) => x.id === intent.siteId);
  return site && site.owner !== id && depthFor(state.theater.held0, id, site.sector) <= range ? intent : undefined;
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
  // Move the guns to where the gunners say the fighters come from.
  // A sharper enemy reads its gunners' reports sooner; on Green it rarely bothers.
  for (const sq of bomberSqs) {
    if (!rng.chance(side.insight * 0.5)) continue;
    const fit = chooseTurrets(side, sq);
    if (fit !== (sq.turrets ?? 'standard') && side.resources.supplies > TURRET_REFIT_COST + 60) setTurrets(side, sq.id, fit);
  }
  // Aircraft waiting for crews and supplies to spare: ask the Ministry.
  if (side.resources.supplies > 220) requestCrews(side, 3);
  // Live-fire practice at the school only while the depots can spare it.
  side.training.liveFire = side.resources.stores > 90;
  // Short of stores with supplies to spare: buy a convoy.
  if (side.resources.stores < 60 && side.resources.supplies > CONVOY.supplies + 120) buyConvoy(state, side);
  // Emergency repairs to badly damaged works, when supplies allow.
  for (const type of ['airfield', 'fuel', 'industry'] as const) {
    if (side.facilities[type] < 70 && side.resources.supplies > REPAIR_COST + 100) emergencyRepair(state, side, type);
  }
  if (!side.researching) {
    const prefs = ['radar', 'gunneryManual', 'dropTanks', 'selfSealing', 'powerTurrets', 'gunCameras', a >= 2 ? 'heavyAirframe' : 'photoRecon', 'gyroSight', 'engineTuning', 'armorAlloy', 'assembly1', 'radios', 'extinguishers', 'bombsight2', 'intelOfficer', 'radarChain', 'photoRecon', 'heavyAirframe'];
    // Then anything else that is open, cheapest first.
    const rest = RESEARCH.filter((r) => !prefs.includes(r.id)).sort((x, y) => x.cost - y.cost).map((r) => r.id);
    for (const p of [...prefs, ...rest]) {
      const item = RESEARCH.find((r) => r.id === p)!;
      if (!side.research.includes(p) && side.resources.supplies > researchCost(side, item) + 80) {
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
  // Pilots also see the enemy's turrets, and over a few weeks go round the guns:
  // head-on against a wall of fire astern, back astern once a chin turret appears.
  const seen = enemyTurrets(state, id);
  const turn = 0.35 * seen.tail - 0.3 * seen.nose;
  const headOn = Math.max(0.05, Math.min(0.75, 0.1 + 0.15 * (a - 1) + turn + rng.range(-0.05, 0.1)));
  setApproach(side, { tail: Math.max(0.15, 0.7 - headOn), headOn, beam: 0.3 });

  // --- Operations ---
  const fighterSqs = side.squadrons.filter((s) => s.kind === 'fighter' && ready(s) >= 2);
  fighterSqs.sort((x, y) => ready(y) - ready(x));
  const readyBombers = bomberSqs.filter((s) => ready(s) >= 3 && s.morale > 0.2);

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
  // A target fixed a week ago is kept to (so the other side's intelligence may have got wind of it).
  const fixed = readyBombers.length > 0 ? validIntent(state, id, side.intent, minRange) : undefined;
  if (!fixed && alert && escorts.length && rng.chance(0.35)) {
    plan.raid = { target: 'sweep', squadronIds: escorts.map((q) => q.id) };
  } else if (readyBombers.length > 0 && (fixed || rng.chance(0.85))) {
    const intent = fixed ?? aiIntent(state, id);
    // A counter-offensive goes in with every escort it can spare.
    plan.raid = { target: intent.target, ...(intent.siteId ? { siteId: intent.siteId } : {}), squadronIds: [...readyBombers.map((q) => q.id), ...escorts.slice(0, intent.push ? 3 : 1).map((q) => q.id)] };
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

  // On Green the enemy spends the first three weeks finding its feet: smaller raids, one patrol.
  if (side.isAI && side.insight < 0.3 && state.turn <= 3) {
    plan.feint = null;
    for (const id of plan.defense.slice(1)) delete plan.cover[id];
    plan.defense = plan.defense.slice(0, 1);
    if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.slice(0, 2);
  }
  // Trim the plan until it fits the stores available. The announced raid matters most:
  // extra patrols go first, then bomber squadrons together with their escort...
  const over = () => planCost(side, plan).stores > side.resources.stores;
  while (over() && plan.defense.length > 1) delete plan.cover[plan.defense.pop()!];
  if (over() && plan.raid) {
    const raid = plan.raid;
    const patrols = plan.defense;
    plan.defense = [];
    fitPlanToStores(state, side.id, plan);
    plan.defense = patrols;
    // ...then, as a last resort, one bomber squadron goes without its escort.
    if (!plan.raid || over()) {
      const bomber = raid.squadronIds.find((id) => side.squadrons.find((q) => q.id === id)?.kind !== 'fighter');
      if (bomber) plan.raid = { ...raid, squadronIds: [bomber] };
    }
  }
  let guard = 0;
  while (!validatePlan(side, plan, state).ok && guard++ < 10) {
    if (plan.recon) plan.recon = null;
    else if (plan.feint) plan.feint = null;
    else if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else if (plan.raid && plan.defense.length) delete plan.cover[plan.defense.pop()!];
    else if (plan.raid) plan.raid = null;
    else if (plan.defense.length) plan.defense.pop();
  }
  // Stores to spare after the plan: send the bombers out at maximum effort.
  if (plan.raid && plan.raid.target !== 'sweep' && plan.raid.target !== 'feint') {
    plan.raid.maxEffort = true;
    if (!validatePlan(side, plan, state).ok || side.resources.stores - planCost(side, plan).stores < 20) plan.raid.maxEffort = false;
  }
  plan.embellish = side.isAI ? 0.1 : 0;
  return plan;
}

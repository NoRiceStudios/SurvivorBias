import { planCost, researchTurns } from './actions';
import { AIRCRAFT, RESEARCH, TARGETS } from './data';
import { buildDebrief, updatePerceived } from './reports';
import { Rng } from './rng';
import { makeAirframe, makeLeader, makeSquadron } from './setup';
import { resolveRaid, resolveRecon } from './sim';
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

export function act(turn: number, maxTurns: number): 1 | 2 | 3 {
  const f = turn / maxTurns;
  return f <= 0.34 ? 1 : f <= 0.67 ? 2 : 3;
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

function applyDamage(f: Facilities, target: TargetId, dmg: number): number {
  if (target === 'sweep' || dmg <= 0) return 0;
  const before = f[target];
  f[target] = Math.max(0, Math.round(f[target] - dmg));
  return before - f[target];
}

function economy(rng: Rng, state: GameState, side: SideState) {
  const r = side.resources;
  const trustF = 0.4 + side.trust / 100;
  const bonus = side.isAI ? 1 + 0.15 * (act(state.turn, state.maxTurns) - 1) : 1;
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

  // Facility repair.
  for (const k of ['industry', 'airfield', 'fuel'] as const) side.facilities[k] = Math.min(100, side.facilities[k] + 4);
}

function newOrder(rng: Rng, state: GameState, side: SideState): Order {
  const a = act(state.turn, state.maxTurns);
  const kind = rng.weighted({ strike: 0.5, kills: 0.35, sorties: 0.15 });
  const id = `o${state.nextId++}`;
  const deadline = state.turn + rng.int(1, 2);
  if (kind === 'strike') {
    const target = rng.pick(['industry', 'airfield', 'fuel'] as const);
    const amount = 10 + 5 * a + rng.int(0, 6);
    return { id, kind, target, amount, deadline, text: `Inflict at least ${amount}% damage on the enemy ${TARGETS[target].name.toLowerCase()} by week ${deadline}.` };
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
  damage: Partial<Record<TargetId, number>>;
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
    if (o.kind === 'strike' && o.target) o.amount -= toHq.damage[o.target] ?? 0;
    if (o.kind === 'sorties') o.amount -= toHq.sorties;
    if (o.amount <= 0) {
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

function checkOutcome(state: GameState): [Outcome, Outcome] | null {
  const [a, b] = state.sides;
  const lose = (s: SideState): Outcome | null => {
    const planes = s.squadrons.reduce((x, q) => x + q.airframes.length, 0);
    const avgMorale = s.squadrons.length ? s.squadrons.reduce((x, q) => x + q.morale, 0) / s.squadrons.length : 0;
    if (s.trust <= 0 && !s.isAI) return 'relieved';
    if (planes === 0 && s.resources.supplies < AIRCRAFT.fighter.cost && s.factory.queue.length === 0) return 'grounded';
    if (s.lowMoraleTurns >= 3) return 'mutiny';
    void avgMorale;
    return null;
  };
  for (const s of state.sides) {
    const avgMorale = s.squadrons.length ? s.squadrons.reduce((x, q) => x + q.morale, 0) / s.squadrons.length : 0;
    s.lowMoraleTurns = avgMorale < 0.15 ? s.lowMoraleTurns + 1 : 0;
  }
  if (state.front <= -100) return ['collapse', 'victory'];
  if (state.front >= 100) return ['victory', 'collapse'];
  const la = lose(a);
  const lb = lose(b);
  if (la && lb) return [la, lb];
  if (la) return [la, 'victory'];
  if (lb) return ['victory', lb];
  if (a.facilities.industry <= 0 && b.facilities.industry > 0) return ['defeat', 'victory'];
  if (b.facilities.industry <= 0 && a.facilities.industry > 0) return ['victory', 'defeat'];
  if (state.turn >= state.maxTurns) {
    const crewLossA = 1 - a.squadrons.reduce((x, q) => x + q.crews, 0) / 28;
    const crewLossB = 1 - b.squadrons.reduce((x, q) => x + q.crews, 0) / 28;
    if (state.front > 20) return [crewLossA > 0.6 ? 'pyrrhic' : 'victory', 'defeat'];
    if (state.front < -20) return ['defeat', crewLossB > 0.6 ? 'pyrrhic' : 'victory'];
    return ['stalemate', 'stalemate'];
  }
  return null;
}

export interface TurnResult {
  raids: [RaidResult | null, RaidResult | null];
}

/**
 * Resolve a full turn given both commanders' plans. Mutates state.
 */
export function resolveTurn(state: GameState, plans: [TurnPlan, TurnPlan]): TurnResult {
  const rng = new Rng(state.rng);
  const battle = rng.fork(`battle-${state.turn}`);
  const [s0, s1] = state.sides;

  // Pay for fuel & munitions.
  for (const id of [0, 1] as SideId[]) {
    const c = planCost(state.sides[id], plans[id]);
    state.sides[id].resources.fuel = Math.max(0, state.sides[id].resources.fuel - c.fuel);
    state.sides[id].resources.munitions = Math.max(0, state.sides[id].resources.munitions - c.munitions);
  }

  const raids: [RaidResult | null, RaidResult | null] = [
    resolveRaid(battle, state, s0, s1, plans[0], plans[1]),
    resolveRaid(battle, state, s1, s0, plans[1], plans[0]),
  ];

  const recons: [{ ok: boolean; rec: PlaneRecord | null } | null, { ok: boolean; rec: PlaneRecord | null } | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const p = plans[id];
    if (p.recon) recons[id] = resolveRecon(battle, state.sides[id], state.sides[(1 - id) as SideId], p.recon.squadronId);
  }

  // Facility damage (true).
  const damageTaken: [Partial<Facilities>, Partial<Facilities>] = [{}, {}];
  for (const id of [0, 1] as SideId[]) {
    const r = raids[id];
    if (!r) continue;
    const victim = state.sides[(1 - id) as SideId];
    const dealt = applyDamage(victim.facilities, r.target, r.damage);
    if (r.target !== 'sweep') damageTaken[(1 - id) as SideId][r.target] = dealt;
  }

  // Losses & morale.
  const allRecs = [...(raids[0]?.planes ?? []), ...(raids[1]?.planes ?? [])];
  for (const id of [0, 1] as SideId[]) {
    const rr = recons[id]?.rec;
    applyLosses(rng, state.sides[id], rr ? [...allRecs, rr] : allRecs);
  }

  // Front line moves on true results.
  const lost0 = (raids[0]?.lost[0] ?? 0) + (raids[1]?.lost[0] ?? 0);
  const lost1 = (raids[0]?.lost[1] ?? 0) + (raids[1]?.lost[1] ?? 0);
  const dmg0 = raids[0]?.damage ?? 0;
  const dmg1 = raids[1]?.damage ?? 0;
  const delta =
    (lost1 - lost0) * 1.4 +
    (dmg0 - dmg1) * 0.35 +
    (s0.facilities.industry - s1.facilities.industry) * 0.04 +
    rng.gauss(2.5) +
    (s1.isAI ? -0.6 * (act(state.turn, state.maxTurns) - 1) : 0);
  state.front = Math.max(-100, Math.min(100, Math.round(state.front + delta)));

  // Debriefs.
  const debriefs: [ReturnType<typeof buildDebrief>, ReturnType<typeof buildDebrief>] = [null!, null!];
  const toHq: [Reported, Reported] = [null!, null!];
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    const enemy = state.sides[(1 - id) as SideId];
    const rc = recons[id];
    const reconResult = rc?.ok && plans[id].recon ? { target: plans[id].recon!.target as TargetId, condition: Math.max(0, Math.min(100, Math.round(enemy.facilities[plans[id].recon!.target] + rng.gauss(2)))) } : null;
    const d = buildDebrief(rng, state.turn, side, enemy, raids[id], raids[(1 - id) as SideId], reconResult, rc?.rec ?? null, damageTaken[id]);
    updatePerceived(rng, side, d, plans[id].raid?.target ?? null);
    side.perceived.front = Math.max(-100, Math.min(100, Math.round(state.front * (id === 0 ? 1 : -1) + 6 + rng.gauss(6))));
    const reported: Reported = {
      kills: d.reports.reduce((a, r) => a + r.claims, 0),
      damage: {},
      sorties: d.reports.reduce((a, r) => a + r.sent, 0),
    };
    if (raids[id] && raids[id]!.target !== 'sweep') {
      const dmgR = d.reports.filter((r) => r.targetDamageReported !== null);
      reported.damage[raids[id]!.target] = dmgR.reduce((a, r) => a + (r.targetDamageReported ?? 0), 0);
    }
    toHq[id] = highCommand(rng, state, side, enemy, reported, plans[id], d.hqResponse);
    debriefs[id] = d;
  }
  state.lastDebriefs = debriefs;

  // Archive the truth.
  const hitsOf = (side: SideId, lost: boolean): Hit[] =>
    allRecs
      .filter((r) => r.side === side && r.kind !== 'fighter' && (lost ? r.fate === 'lost' : r.fate !== 'lost'))
      .flatMap((r) => r.hits);
  const entry: ArchiveEntry = {
    turn: state.turn,
    trueLosses: [lost0, lost1],
    trueKills: [lost1, lost0],
    claimed: [debriefs[0].reports.reduce((a, r) => a + r.claims, 0), debriefs[1].reports.reduce((a, r) => a + r.claims, 0)],
    reportedToHq: [toHq[0].kills, toHq[1].kills],
    facilities: [{ ...s0.facilities }, { ...s1.facilities }],
    front: state.front,
    lostHits: [hitsOf(0, true), hitsOf(1, true)],
    survivorHits: [hitsOf(0, false), hitsOf(1, false)],
  };
  state.archive.push(entry);

  for (const id of [0, 1] as SideId[]) economy(rng, state, state.sides[id]);

  state.outcome = checkOutcome(state);
  state.rng = rng.state;
  if (!state.outcome) state.turn++;
  return { raids };
}

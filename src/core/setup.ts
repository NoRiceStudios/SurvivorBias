import { nationOf, NATIONS, rulesOf, spec, type SideRef } from './factions';
import { Rng } from './rng';
import { rollLethality } from './lethality';
import { enterTheater } from './theaters';
import type {
  AircraftKind,
  Airframe,
  Archetype,
  Doctrine,
  GameState,
  Leader,
  NationId,
  Perceived,
  SideId,
  SideState,
  Squadron,
  ZoneMap,
} from './types';
import { ZONES } from './types';

export const SAVE_VERSION = 6;

export function zoneMap<T>(fn: (z: (typeof ZONES)[number]) => T): ZoneMap<T> {
  return Object.fromEntries(ZONES.map((z) => [z, fn(z)])) as ZoneMap<T>;
}

export function defaultArmor(kind: AircraftKind, budget = Infinity): ZoneMap<number> {
  // "Factory standard" layout: plates where the pre-war manual said to put them.
  const a = zoneMap(() => 0);
  if (kind === 'fighter') {
    a.fuselage = 1;
    a.tail = 1;
    a.outerWing = 1;
  } else if (kind === 'medium') {
    a.fuselage = 2;
    a.outerWing = 2;
    a.tail = 1;
    a.cockpit = 1;
  } else if (kind === 'heavy') {
    a.fuselage = 3;
    a.outerWing = 3;
    a.tail = 2;
    a.cockpit = 1;
  } else {
    a.fuselage = 1;
  }
  // A lighter airframe takes off the plates it has no room for, least useful first.
  let over = ZONES.reduce((n, z) => n + a[z], 0) - budget;
  for (const z of ['outerWing', 'fuselage', 'tail', 'cockpit'] as const) {
    while (over > 0 && a[z] > 0) {
      a[z]--;
      over--;
    }
  }
  return a;
}

export function defaultDoctrine(kind: AircraftKind): Doctrine {
  return {
    aggression: kind === 'fighter' ? 0.6 : 0.5,
    formation: kind === 'fighter' ? 0.4 : 0.6,
    breakOff: 0.5,
    altitude: kind === 'fighter' ? 0.5 : 0.6,
  };
}

export function newId(state: { nextId: number }, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function makeAirframe(
  state: { nextId: number },
  rng: Rng,
  kind: AircraftKind,
  side: SideRef,
  defectScale = 0.5,
): Airframe {
  const n = state.nextId++;
  const serial = nationOf(side).serial(n);
  defectScale *= rulesOf(side).defects;
  return {
    id: `af${n}`,
    serial,
    kind,
    condition: 100,
    hits: [],
    patches: 0,
    sorties: 0,
    defect: rng.chance(0.25 * defectScale * 2) ? rng.range(0.05, 0.4) * defectScale * 2 : 0,
    status: 'ready',
    repairTurns: 0,
  };
}

/** A squadron leader. Avoids reusing a first name or surname already in `taken`. */
export function makeLeader(rng: Rng, side: SideRef, archetype?: Archetype, taken: string[] = []): Leader {
  const nat = nationOf(side);
  const usedFirst = new Set(taken.map((n) => n.split(' ')[0]));
  const usedLast = new Set(taken.map((n) => n.split(' ').slice(1).join(' ')));
  const free = (pool: string[], used: Set<string>) => pool.filter((x) => !used.has(x));
  // Officers' names come first; the wider crew pools keep a long war from running out of names.
  const firstPool = [...new Set([...nat.firstNames, ...nat.crewFirst])];
  const lastPool = [...new Set([...nat.lastNames, ...nat.crewLast])];
  const firsts = free(nat.firstNames, usedFirst).length ? free(nat.firstNames, usedFirst) : free(firstPool, usedFirst);
  const lasts = free(nat.lastNames, usedLast).length ? free(nat.lastNames, usedLast) : free(lastPool, usedLast);
  return {
    name: `${rng.pick(firsts.length ? firsts : firstPool)} ${rng.pick(lasts.length ? lasts : lastPool)}`,
    rank: rng.pick(nat.ranks),
    archetype: archetype ?? pickArchetype(rng, side),
  };
}

const ARCHETYPES: Archetype[] = ['braggart', 'pessimist', 'gloryHunter', 'byTheBook', 'timid'];

/** A leader's character, weighted by what kind of officer the nation promotes. */
export function pickArchetype(rng: Rng, side: SideRef, avoid: Archetype[] = []): Archetype {
  const w = rulesOf(side).leaders;
  const pool = ARCHETYPES.filter((a) => !avoid.includes(a));
  const from = pool.length ? pool : ARCHETYPES;
  let r = rng.next() * from.reduce((t, a) => t + w[a], 0);
  for (const a of from) {
    r -= w[a];
    if (r < 0) return a;
  }
  return from[from.length - 1];
}

export function makeSquadron(
  state: { nextId: number },
  rng: Rng,
  side: SideRef,
  kind: AircraftKind,
  size: number,
  nameIndex: number,
  archetype?: Archetype,
  takenNames: string[] = [],
): Squadron {
  const names = nationOf(side).squadronNames;
  const sq: Squadron = {
    id: newId(state, 'sq'),
    name: names[nameIndex % names.length],
    side: side.id,
    kind,
    airframes: [],
    crews: size,
    skill: rng.range(0.4, 0.55),
    morale: rng.range(0.65, 0.8),
    fatigue: 0,
    trauma: 0,
    leader: makeLeader(rng, side, archetype, takenNames),
    doctrine: defaultDoctrine(kind),
    armor: defaultArmor(kind, spec(side, kind).armorBudget),
    notables: [],
    insignia: nameIndex % 10,
  };
  for (let i = 0; i < size; i++) sq.airframes.push(makeAirframe(state, rng, kind, side));
  return sq;
}

export function emptyPerceived(): Perceived {
  return {
    enemyFighters: 30,
    enemyFightersSd: 15,
    enemyBombers: 12,
    enemyFlak: 0.5,
    enemyApproach: { tail: 0.34, headOn: 0.33, beam: 0.33 },
    enemyFacilities: { industry: 100, airfield: 100, fuel: 100 },
    sites: {},
    photographed: [],
    front: 0,
    enemyArmorSeen: zoneMap(() => 0),
    survivorHits: zoneMap(() => 0),
    survivorHitsByKind: {},
    claimedKillsTotal: 0,
  };
}

function makeSide(state: GameState, rng: Rng, id: SideId, isAI: boolean, faction?: NationId): SideState {
  const ref: SideRef = { id, faction };
  const nat = nationOf(ref);
  const rules = rulesOf(ref);
  // A classic wing gets one leader of each character; a nation's wing leans the way its officers do.
  const archetypes: Archetype[] = faction ? [] : rng.shuffle([...ARCHETYPES]);
  const order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const squadrons: Squadron[] = [];
  rules.squadrons.forEach(([kind, size], i) => {
    // A nation's wing leans the way its officers do, duplicates and all; a classic wing gets one of each.
    const archetype = faction ? pickArchetype(rng, ref) : archetypes[i];
    squadrons.push(makeSquadron(state, rng, ref, kind, size, order[i], archetype, squadrons.map((q) => q.leader.name)));
  });
  return {
    id,
    ...(faction ? { faction } : {}),
    name: nat.name,
    commander: isAI ? nat.aiCommander : nat.title,
    short: nat.short,
    isAI,
    insight: 0.35,
    resources: { supplies: 160, stores: Math.min(120, rules.storesCap), replacements: 6 },
    squadrons,
    factory: { level: 1, qc: 'standard', queue: [], progress: 0 },
    training: { level: 1, focus: 'balanced', inTraining: 0 },
    facilities: { industry: 100, airfield: 100, fuel: 100 },
    research: [...rules.research],
    researching: null,
    researchProgress: 0,
    trust: 60,
    approach: { tail: 0.6, headOn: 0.1, beam: 0.3 },
    flak: rules.flak,
    perceived: emptyPerceived(),
    orders: [],
    memos: [],
    lowMoraleTurns: 0,
    caught: 0,
    observed: { feints: 0, support: 0 },
    requests: [],
  };
}

export interface NewGameOptions {
  seed?: string;
  mode?: 'single' | 'hotseat' | 'lan';
  maxTurns?: number;
  /** AI difficulty: 0 (naive) .. 1 (understands survivorship bias). */
  aiInsight?: number;
  /** The nation each side fights for. Absent: a classic war of Aldmere against the Directorate with symmetric rules. */
  factions?: [NationId, NationId];
}

export function newGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? String(Date.now());
  const rng = Rng.fromSeed(seed);
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: rng.state,
    turn: 1,
    maxTurns: opts.maxTurns ?? 30,
    mode: opts.mode ?? 'single',
    sides: undefined as unknown as [SideState, SideState],
    front: 0,
    theater: undefined as unknown as GameState['theater'],
    theaterResults: [],
    lethality: undefined as unknown as GameState['lethality'],
    weather: 'clear',
    forecast: ['clear', 'clear'],
    lastDebriefs: [null, null],
    sealed: [null, null],
    archive: [],
    outcome: null,
    nextId: 1,
  };
  const single = state.mode === 'single';
  const f = opts.factions;
  if (f && (f[0] === f[1] || !NATIONS[f[0]] || !NATIONS[f[1]])) throw new Error('Each side needs a different nation');
  state.sides = [makeSide(state, rng, 0, false, f?.[0]), makeSide(state, rng, 1, single, f?.[1])];
  if (single) state.sides[1].insight = opts.aiInsight ?? 0.4;
  state.lethality = rollLethality(rng.fork('lethality'));
  enterTheater(state, 0, rng, null);
  state.rng = rng.state;
  return state;
}

export function aircraftName(kind: AircraftKind, side: SideRef): string {
  return nationOf(side).aircraft[kind];
}

/** The captain of an aircraft: drawn per campaign (seed) and airframe, from the aircrew name pool. */
export function captainName(side: SideRef, serial: string, seed = ''): string {
  const nat = nationOf(side);
  let h = 2166136261;
  for (const ch of `${seed}|${serial}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  const u = h >>> 0;
  return `${nat.crewRanks[u % nat.crewRanks.length]} ${nat.crewFirst[(u >>> 3) % nat.crewFirst.length]} ${nat.crewLast[(u >>> 11) % nat.crewLast.length]}`;
}

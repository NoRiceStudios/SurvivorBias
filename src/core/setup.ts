import { AIRCRAFT, FIRST_NAMES, LAST_NAMES, RANKS, SIDE_NAMES, SQUADRON_NAMES } from './data';
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
  Perceived,
  SideId,
  SideState,
  Squadron,
  ZoneMap,
} from './types';
import { ZONES } from './types';

export const SAVE_VERSION = 4;

export function zoneMap<T>(fn: (z: (typeof ZONES)[number]) => T): ZoneMap<T> {
  return Object.fromEntries(ZONES.map((z) => [z, fn(z)])) as ZoneMap<T>;
}

export function defaultArmor(kind: AircraftKind): ZoneMap<number> {
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
  side: SideId,
  defectScale = 0.5,
): Airframe {
  const n = state.nextId++;
  const letters = side === 0 ? 'ABCDEFGHJKLMNPRSTVWX' : 'ABCDEFGHKLMNPRSTUVWZ';
  const serial =
    side === 0
      ? `${letters[n % letters.length]}${letters[(n * 7) % letters.length]}-${100 + ((n * 37) % 900)}`
      : `${10 + (n % 89)}+${letters[(n * 3) % letters.length]}${letters[(n * 11) % letters.length]}`;
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
export function makeLeader(rng: Rng, side: SideId, archetype?: Archetype, taken: string[] = []): Leader {
  const archetypes: Archetype[] = ['braggart', 'pessimist', 'gloryHunter', 'byTheBook', 'timid'];
  const usedFirst = new Set(taken.map((n) => n.split(' ')[0]));
  const usedLast = new Set(taken.map((n) => n.split(' ').slice(1).join(' ')));
  const free = (pool: string[], used: Set<string>) => pool.filter((x) => !used.has(x));
  const firsts = free(FIRST_NAMES[side], usedFirst);
  const lasts = free(LAST_NAMES[side], usedLast);
  return {
    name: `${rng.pick(firsts.length ? firsts : FIRST_NAMES[side])} ${rng.pick(lasts.length ? lasts : LAST_NAMES[side])}`,
    rank: rng.pick(RANKS[side]),
    archetype: archetype ?? rng.pick(archetypes),
  };
}

export function makeSquadron(
  state: { nextId: number },
  rng: Rng,
  side: SideId,
  kind: AircraftKind,
  size: number,
  nameIndex: number,
  archetype?: Archetype,
  takenNames: string[] = [],
): Squadron {
  const names = SQUADRON_NAMES[side];
  const sq: Squadron = {
    id: newId(state, 'sq'),
    name: names[nameIndex % names.length],
    side,
    kind,
    airframes: [],
    crews: size,
    skill: rng.range(0.4, 0.55),
    morale: rng.range(0.65, 0.8),
    fatigue: 0,
    trauma: 0,
    leader: makeLeader(rng, side, archetype, takenNames),
    doctrine: defaultDoctrine(kind),
    armor: defaultArmor(kind),
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

function makeSide(state: GameState, rng: Rng, id: SideId, isAI: boolean): SideState {
  const archetypes: Archetype[] = rng.shuffle(['braggart', 'pessimist', 'gloryHunter', 'byTheBook', 'timid']);
  const order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const squadrons: Squadron[] = [];
  const kinds: [AircraftKind, number][] = [['fighter', 8], ['fighter', 8], ['medium', 6], ['medium', 6]];
  kinds.forEach(([kind, size], i) =>
    squadrons.push(makeSquadron(state, rng, id, kind, size, order[i], archetypes[i], squadrons.map((q) => q.leader.name))),
  );
  // Keep fighter names for fighters on the Directorate side where names imply role.
  return {
    id,
    name: SIDE_NAMES[id].name,
    commander: isAI ? 'Oberst Reinhold Kranz' : id === 0 ? 'Air Commodore' : 'Oberst',
    short: SIDE_NAMES[id].short,
    isAI,
    insight: 0.35,
    resources: { supplies: 160, fuel: 140, munitions: 90, replacements: 6 },
    squadrons,
    factory: { level: 1, qc: 'standard', queue: [], progress: 0 },
    training: { level: 1, focus: 'balanced', inTraining: 0 },
    facilities: { industry: 100, airfield: 100, fuel: 100 },
    research: [],
    researching: null,
    researchProgress: 0,
    trust: 60,
    approach: { tail: 0.6, headOn: 0.1, beam: 0.3 },
    flak: 0.5,
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
  state.sides = [makeSide(state, rng, 0, false), makeSide(state, rng, 1, single)];
  if (single) state.sides[1].insight = opts.aiInsight ?? 0.4;
  state.lethality = rollLethality(rng.fork('lethality'));
  enterTheater(state, 0, rng, null);
  state.rng = rng.state;
  return state;
}

export function aircraftName(kind: AircraftKind, side: SideId): string {
  return AIRCRAFT[kind].name[side];
}

const CREW_RANKS: [string[], string[]] = [
  ['Plt Off', 'Fg Off', 'Flt Lt', 'Sgt', 'Flt Sgt', 'WO'],
  ['Leutnant', 'Oberleutnant', 'Feldwebel', 'Unteroffizier', 'Oberfeldwebel'],
];

/** A deterministic name for the captain of an aircraft, from its serial. */
export function captainName(side: SideId, serial: string): string {
  let h = 2166136261;
  for (const ch of serial) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const u = h >>> 0;
  return `${CREW_RANKS[side][u % CREW_RANKS[side].length]} ${FIRST_NAMES[side][(u >>> 4) % FIRST_NAMES[side].length]} ${LAST_NAMES[side][(u >>> 9) % LAST_NAMES[side].length]}`;
}

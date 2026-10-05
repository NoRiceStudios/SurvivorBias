import type {
  AircraftKind,
  Approach,
  Archetype,
  FighterApproach,
  TargetId,
  ZoneId,
  ZoneMap,
} from './types';

/**
 * HIDDEN: probability that a single hit in a zone brings the aircraft down.
 * The player is never shown these numbers. The survivors' damage is
 * concentrated where these are LOW, which is the entire point of the game.
 */
export const ZONE_LETHALITY: ZoneMap<number> = {
  nose: 0.1,
  cockpit: 0.32,
  engines: 0.24,
  fuel: 0.26,
  wingRoot: 0.12,
  outerWing: 0.004,
  fuselage: 0.005,
  tail: 0.05,
};

/** Structural damage per hit by zone (condition points). */
export const ZONE_DAMAGE: ZoneMap<number> = {
  nose: 6,
  cockpit: 5,
  engines: 8,
  fuel: 7,
  wingRoot: 8,
  outerWing: 2.5,
  fuselage: 3,
  tail: 5,
};

/** Relative exposure of each zone from each approach (before area). */
export const APPROACH_ZONES: Record<Approach, ZoneMap<number>> = {
  tail: { nose: 0.1, cockpit: 0.5, engines: 0.8, fuel: 0.9, wingRoot: 0.8, outerWing: 1.1, fuselage: 1.5, tail: 2.6 },
  headOn: { nose: 2.6, cockpit: 2.6, engines: 1.8, fuel: 0.7, wingRoot: 1.1, outerWing: 0.9, fuselage: 0.6, tail: 0.2 },
  beam: { nose: 0.6, cockpit: 0.8, engines: 1.2, fuel: 1.1, wingRoot: 1.0, outerWing: 1.0, fuselage: 2.0, tail: 0.9 },
  flak: { nose: 0.5, cockpit: 0.4, engines: 1.1, fuel: 1.5, wingRoot: 1.2, outerWing: 1.6, fuselage: 1.3, tail: 0.8 },
};

/** Visible area of each zone on a typical airframe. */
export const ZONE_AREA: ZoneMap<number> = {
  nose: 0.05,
  cockpit: 0.04,
  engines: 0.09,
  fuel: 0.07,
  wingRoot: 0.1,
  outerWing: 0.3,
  fuselage: 0.25,
  tail: 0.1,
};

export const ZONE_LABEL: ZoneMap<string> = {
  nose: 'Nose',
  cockpit: 'Cockpit',
  engines: 'Engines',
  fuel: 'Fuel tanks',
  wingRoot: 'Wing roots',
  outerWing: 'Outer wings',
  fuselage: 'Fuselage',
  tail: 'Tail',
};

export interface AircraftSpec {
  kind: AircraftKind;
  name: [string, string];
  role: string;
  /** Armor points that can be distributed over zones. */
  armorBudget: number;
  /** Defensive guns (turret positions). */
  guns: number;
  /** Bomb load in arbitrary units. */
  payload: number;
  speed: number;
  fuelCost: number;
  munitionsCost: number;
  /** Supplies cost to build. */
  cost: number;
  /** Production points needed. */
  build: number;
  crew: number;
  requires?: string;
}

export const AIRCRAFT: Record<AircraftKind, AircraftSpec> = {
  fighter: {
    kind: 'fighter',
    name: ['Kestrel Mk.II', 'Falke-7'],
    role: 'Escort & interception',
    armorBudget: 3,
    guns: 4,
    payload: 0,
    speed: 1.0,
    fuelCost: 2,
    munitionsCost: 1,
    cost: 30,
    build: 3,
    crew: 1,
  },
  medium: {
    kind: 'medium',
    name: ['Harrow B.III', 'Kormoran K-2'],
    role: 'Medium bomber',
    armorBudget: 6,
    guns: 4,
    payload: 3,
    speed: 0.75,
    fuelCost: 3,
    munitionsCost: 2,
    cost: 55,
    build: 5,
    crew: 5,
  },
  heavy: {
    kind: 'heavy',
    name: ['Colossus B.I', 'Gigant G-4'],
    role: 'Heavy bomber',
    armorBudget: 9,
    guns: 8,
    payload: 6,
    speed: 0.62,
    fuelCost: 5,
    munitionsCost: 3,
    cost: 95,
    build: 8,
    crew: 9,
    requires: 'heavyAirframe',
  },
  recon: {
    kind: 'recon',
    name: ['Swift PR.I', 'Elster A-1'],
    role: 'Photo reconnaissance',
    armorBudget: 1,
    guns: 0,
    payload: 0,
    speed: 1.15,
    fuelCost: 2,
    munitionsCost: 0,
    cost: 35,
    build: 3,
    crew: 1,
    requires: 'photoRecon',
  },
};

export const MAX_ARMOR_PER_ZONE = 3;
/** Each armor point on a zone multiplies lethality by this. */
export const ARMOR_FACTOR = 0.55;
export const ARMOR_FACTOR_ALLOY = 0.42;

export interface ResearchItem {
  id: string;
  name: string;
  cost: number;
  desc: string;
  requires?: string;
}

export const RESEARCH: ResearchItem[] = [
  { id: 'gunCameras', name: 'Gun Cameras', cost: 60, desc: 'Film from the guns confirms or refutes kill claims. Halves claim inflation.' },
  { id: 'radios', name: 'VHF Radio Sets', cost: 70, desc: 'Clearer radio traffic. You hear more of the battle, including the final calls of crews who do not return.' },
  { id: 'photoRecon', name: 'Photo Reconnaissance', cost: 80, desc: 'Unlocks the recon aircraft. Photographs show what really happened to a target.' },
  { id: 'intelOfficer', name: 'Intelligence Section', cost: 60, desc: 'Analysts cross-check debriefs. Shows uncertainty ranges and flags contradictions.' },
  { id: 'selfSealing', name: 'Self-Sealing Tanks', cost: 90, desc: 'Rubber-lined fuel tanks seal small punctures.' },
  { id: 'armorAlloy', name: 'Face-Hardened Plate', cost: 110, desc: 'Each armor plate stops considerably more.' , requires: 'selfSealing' },
  { id: 'heavyAirframe', name: 'Four-Engine Airframe', cost: 140, desc: 'Unlocks the heavy bomber: twice the bombs, twice the guns, twice the crew to lose.' },
  { id: 'radar', name: 'Ground Radar', cost: 100, desc: 'Early warning: more of your fighters reach incoming raids.' },
  { id: 'dropTanks', name: 'Drop Tanks', cost: 70, desc: 'Jettisonable fuel tanks let fighters escort bombers one sector deeper.' },
  { id: 'gyroSight', name: 'Gyro Gunsight', cost: 90, desc: 'Fighters and gunners hit more often.', requires: 'gunCameras' },
];

export const TARGETS: Record<TargetId, { name: string; desc: string }> = {
  industry: { name: 'Aircraft Works', desc: 'Slows enemy aircraft production.' },
  airfield: { name: 'Forward Airfields', desc: 'Grounds enemy fighters and slows repairs.' },
  fuel: { name: 'Fuel Depots', desc: 'Starves the enemy of fuel.' },
  support: { name: 'Close Support', desc: 'Bomb the enemy front line at low level. Pushes the front directly; the flak is close and heavy.' },
  sweep: { name: 'Fighter Sweep', desc: 'Fighters only. Hunt enemy fighters over the front; also screens it against enemy close-support raids and sweeps.' },
  feint: { name: 'Feint', desc: 'A diversion over another sector to draw the enemy reserve away from the real raid.' },
};

export const APPROACH_LABEL: Record<FighterApproach, string> = {
  tail: 'From astern',
  headOn: 'Head-on',
  beam: 'From the beam',
};

export const ARCHETYPE_INFO: Record<Archetype, { label: string; blurb: string }> = {
  braggart: { label: 'Showman', blurb: 'Never short of a story.' },
  pessimist: { label: 'Gloomy', blurb: 'Expects the worst and usually sees it.' },
  gloryHunter: { label: 'Glory-seeker', blurb: 'Wants the dangerous jobs. Wants the medals more.' },
  byTheBook: { label: 'By the book', blurb: 'Only reports what he is certain of.' },
  timid: { label: 'Cautious', blurb: 'Brings his boys home. Flak always looks heavier from his seat.' },
};

/** Report multipliers per archetype. Systematic and therefore learnable. */
export const ARCHETYPE_BIAS: Record<
  Archetype,
  { claims: number; enemies: number; damage: number; flak: number; unknownRate: number }
> = {
  braggart: { claims: 2.3, enemies: 0.8, damage: 1.6, flak: 0.9, unknownRate: 0 },
  pessimist: { claims: 0.8, enemies: 1.7, damage: 0.6, flak: 1.3, unknownRate: 0.1 },
  gloryHunter: { claims: 1.8, enemies: 1.4, damage: 1.4, flak: 1.1, unknownRate: 0 },
  byTheBook: { claims: 1.05, enemies: 1.0, damage: 1.0, flak: 1.0, unknownRate: 0.4 },
  timid: { claims: 0.9, enemies: 1.3, damage: 0.8, flak: 1.7, unknownRate: 0.15 },
};

export const SIDE_NAMES: [{ name: string; short: string }, { name: string; short: string }] = [
  { name: 'Commonwealth of Aldmere', short: 'Aldmere' },
  { name: 'Northern Directorate', short: 'Directorate' },
];

export const FIRST_NAMES: [string[], string[]] = [
  ['Arthur', 'Edmund', 'Hugh', 'Walter', 'Percy', 'Roland', 'Cecil', 'Douglas', 'Leonard', 'Harold', 'Ivor', 'Rupert', 'Giles', 'Neville', 'Clive', 'Desmond'],
  ['Anton', 'Ewald', 'Gerrit', 'Lothar', 'Matthis', 'Konrad', 'Henrik', 'Jaro', 'Ulrich', 'Waldemar', 'Bastian', 'Falk', 'Emil', 'Reinhold', 'Torben', 'Viktor'],
];
export const LAST_NAMES: [string[], string[]] = [
  ['Ashworth', 'Penrose', 'Hale', 'Brackley', 'Carrow', 'Thorne', 'Mabey', 'Fenwick', 'Lisle', 'Wexford', 'Dunmore', 'Ridley', 'Sallow', 'Pryce', 'Cobham', 'Garside'],
  ['Kessler', 'Brandt', 'Voigt', 'Ahlers', 'Reinke', 'Strahl', 'Lindqvist', 'Haber', 'Ostrow', 'Falkner', 'Merz', 'Rauch', 'Tiede', 'Brückner', 'Sommer', 'Kranz'],
];
export const RANKS: [string[], string[]] = [
  ['Sqn Ldr', 'Wg Cdr', 'Flt Lt'],
  ['Major', 'Hauptmann', 'Oberst'],
];

export const SQUADRON_NAMES: [string[], string[]] = [
  ['No. 41 "Lanterns"', 'No. 112 "Old Crows"', 'No. 9 "Ploughmen"', 'No. 207 "Nightjars"', 'No. 73 "Saints"', 'No. 18 "Ferrymen"', 'No. 304 "Harriers"', 'No. 61 "Long Odds"', 'No. 15 "Vespers"', 'No. 88 "Tinkers"'],
  ['Staffel Grau', 'Staffel Anker', 'Staffel Eis', 'Staffel Hammer', 'Staffel Ruß', 'Staffel Pflug', 'Staffel Nord', 'Staffel Auge', 'Staffel Hagel', 'Staffel Kreuz'],
];

export const CALLSIGNS: [string[], string[]] = [
  ['Lantern', 'Crow', 'Plough', 'Nightjar', 'Saint', 'Ferry', 'Harrier', 'Odds', 'Vesper', 'Tinker'],
  ['Grau', 'Anker', 'Eis', 'Hammer', 'Ruß', 'Pflug', 'Nord', 'Auge', 'Hagel', 'Kreuz'],
];

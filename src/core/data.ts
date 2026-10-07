import type {
  AircraftKind,
  Approach,
  Archetype,
  FighterApproach,
  RequestKind,
  TargetId,
  Trait,
  TurretFit,
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
  /** Stores (fuel and munitions) used per sortie. */
  storesCost: number;
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
    storesCost: 3,
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
    storesCost: 5,
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
    storesCost: 8,
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
    storesCost: 2,
    cost: 35,
    build: 3,
    crew: 1,
    requires: 'photoRecon',
  },
};

/**
 * Bombers' turret layouts: the same guns, moved to where the fighters are
 * believed to come from. Each value scales defensive fire against an attack
 * from that direction. Which layout pays depends on how the enemy actually
 * attacks, and the only evidence is what the gunners say they saw.
 */
export const TURRET_FITS: Record<TurretFit, { name: string; desc: string; coverage: Record<FighterApproach, number> }> = {
  standard: {
    name: 'Standard',
    desc: 'Guns spread as the works deliver them: strong astern, fair on the beam, little ahead.',
    coverage: { tail: 1.25, beam: 0.95, headOn: 0.4 },
  },
  tail: {
    name: 'Tail-heavy',
    desc: 'Extra guns in the rear turret, taken from the nose and waist. A wall of fire astern; almost nothing ahead.',
    coverage: { tail: 1.6, beam: 0.85, headOn: 0.25 },
  },
  nose: {
    name: 'Chin turret',
    desc: 'A powered turret under the nose, guns taken from the tail and waist. Answers head-on attacks; weaker astern.',
    coverage: { tail: 0.95, beam: 0.85, headOn: 0.9 },
  },
};
/** Supplies to move a squadron's guns to another layout. */
export const TURRET_REFIT_COST = 15;

/** Share of its build cost a wreck on our side of the line returns as salvage. */
export const SALVAGE = 0.35;

export const MAX_ARMOR_PER_ZONE = 3;
/** Each armor point on a zone multiplies lethality by this. */
export const ARMOR_FACTOR = 0.45;
export const ARMOR_FACTOR_ALLOY = 0.34;

/** Numeric effects a development can have. Values of the same key add up. */
export type TechKey =
  | 'hits' // fighters' and gunners' hit rate, +x
  | 'turrets' // bombers' defensive fire, +x
  | 'accuracy' // bomb damage, +x
  | 'blindBombing' // share of the weather penalty on bombing removed
  | 'reliability' // share of mechanical aborts prevented
  | 'plateWeight' // share of the weight penalty of armor removed
  | 'fireproof' // engine and fuel hits are less often fatal, -x
  | 'escape' // chance a lost aircraft's crew gets out and back
  | 'detection' // interception chance of our defenders, +x
  | 'production' // aircraft works output, +x
  | 'repair' // aircraft repaired per week and site repair, +x
  | 'economy' // stores used per sortie, -x
  | 'supply' // supplies delivered per week, +x flat (not scaled by trust or works)
  | 'training' // graduates' starting skill, +x
  | 'stealth' // chance the enemy catches our recon aircraft, -x
  | 'payload'; // bomb load, +x

export type Branch = 'gunnery' | 'engines' | 'protection' | 'bombing' | 'signals' | 'industry';

export const BRANCHES: { id: Branch; name: string }[] = [
  { id: 'gunnery', name: 'Gunnery' },
  { id: 'engines', name: 'Engines & Airframes' },
  { id: 'protection', name: 'Protection' },
  { id: 'bombing', name: 'Bombing' },
  { id: 'signals', name: 'Signals & Intelligence' },
  { id: 'industry', name: 'Industry & Logistics' },
];

export interface ResearchItem {
  id: string;
  name: string;
  cost: number;
  desc: string;
  branch: Branch;
  requires?: string;
  effects?: Partial<Record<TechKey, number>>;
}

export const RESEARCH: ResearchItem[] = [
  // Gunnery
  { id: 'gunneryManual', branch: 'gunnery', name: 'Gunnery Manuals', cost: 40, desc: 'Deflection-shooting tables for every crew room. Fighters and gunners hit 5% more often.', effects: { hits: 0.05 } },
  { id: 'gyroSight', branch: 'gunnery', name: 'Gyro Gunsight', cost: 90, desc: 'Fighters and gunners hit 15% more often.', requires: 'gunneryManual', effects: { hits: 0.15 } },
  { id: 'cannon', branch: 'gunnery', name: '20 mm Cannon', cost: 120, desc: 'Fighters swap rifle-calibre guns for cannon. Another 10% more hits.', requires: 'gyroSight', effects: { hits: 0.1 } },
  { id: 'powerTurrets', branch: 'gunnery', name: 'Power Turrets', cost: 70, desc: 'Hydraulic turrets traverse faster. Bombers\' defensive fire +12%.', effects: { turrets: 0.12 } },
  { id: 'twinTail', branch: 'gunnery', name: 'Twin-Gun Tail Turret', cost: 100, desc: 'More guns where the fighters come from. Defensive fire another +15%.', requires: 'powerTurrets', effects: { turrets: 0.15 } },
  { id: 'gunCameras', branch: 'gunnery', name: 'Gun Cameras', cost: 60, desc: 'Film from the guns confirms or refutes kill claims. Halves claim inflation.' },

  // Engines & airframes
  { id: 'engineTuning', branch: 'engines', name: 'Engine Tuning', cost: 45, desc: 'Better plugs and carburettor settings. A quarter fewer mechanical aborts.', effects: { reliability: 0.25 } },
  { id: 'uprated', branch: 'engines', name: 'Uprated Engines', cost: 90, desc: 'More power at height. Another quarter fewer aborts, and bombers carry 10% more.', requires: 'engineTuning', effects: { reliability: 0.25, payload: 0.1 } },
  { id: 'dropTanks', branch: 'engines', name: 'Drop Tanks', cost: 70, desc: 'Jettisonable fuel tanks let fighters escort bombers one sector deeper.' },
  { id: 'heavyAirframe', branch: 'engines', name: 'Four-Engine Airframe', cost: 140, desc: 'Unlocks the heavy bomber: twice the bombs, twice the guns, twice the crew to lose.' },
  { id: 'heavyMk2', branch: 'engines', name: 'Heavy Bomber Mk II', cost: 120, desc: 'Strengthened wing and bomb bay. Bombers carry another 15%.', requires: 'heavyAirframe', effects: { payload: 0.15 } },

  // Protection
  { id: 'selfSealing', branch: 'protection', name: 'Self-Sealing Tanks', cost: 90, desc: 'Rubber-lined fuel tanks seal small punctures.' },
  { id: 'extinguishers', branch: 'protection', name: 'Engine Fire Extinguishers', cost: 60, desc: 'Engine and fuel-tank hits are 10% less often fatal.', effects: { fireproof: 0.1 } },
  { id: 'armorAlloy', branch: 'protection', name: 'Face-Hardened Plate', cost: 110, desc: 'Each armor plate stops considerably more.', requires: 'selfSealing' },
  { id: 'lightPlate', branch: 'protection', name: 'Light Alloy Plate', cost: 90, desc: 'Plate weighs a third less, so armored aircraft are less sluggish.', requires: 'armorAlloy', effects: { plateWeight: 0.35 } },
  { id: 'escapeHatches', branch: 'protection', name: 'Escape Hatches', cost: 50, desc: 'Wider hatches and better parachutes. When an aircraft is lost, its crew gets out and home 15% of the time.', effects: { escape: 0.15 } },
  { id: 'airSeaRescue', branch: 'protection', name: 'Air-Sea Rescue', cost: 80, desc: 'Launches and spotter aircraft. Another 15% of lost crews are brought home.', requires: 'escapeHatches', effects: { escape: 0.15 } },

  // Bombing
  { id: 'bombsight2', branch: 'bombing', name: 'Bombsight Mk II', cost: 50, desc: 'A better-calibrated sight. Bombs do 8% more damage.', effects: { accuracy: 0.08 } },
  { id: 'bombsight3', branch: 'bombing', name: 'Stabilised Bombsight', cost: 100, desc: 'Gyro-stabilised sight. Another 12% more damage.', requires: 'bombsight2', effects: { accuracy: 0.12 } },
  { id: 'targetMarkers', branch: 'bombing', name: 'Target Markers', cost: 90, desc: 'Coloured flares mark the aiming point. Cloud and storms cost a third less accuracy.', requires: 'bombsight2', effects: { blindBombing: 0.35 } },
  { id: 'heavyBombs', branch: 'bombing', name: 'Heavy-Case Bombs', cost: 80, desc: 'Bigger bombs for hard targets. Bombs do 10% more damage.', effects: { accuracy: 0.1 } },

  // Signals & intelligence
  { id: 'radios', branch: 'signals', name: 'VHF Radio Sets', cost: 70, desc: 'Clearer radio traffic. You hear far more of the battle, including the final calls of crews who do not return.' },
  { id: 'radar', branch: 'signals', name: 'Ground Radar', cost: 100, desc: 'Early warning: more of your fighters reach incoming raids.' },
  { id: 'radarChain', branch: 'signals', name: 'Radar Chain', cost: 110, desc: 'Overlapping stations and a filter room. Defenders intercept another 8% more often.', requires: 'radar', effects: { detection: 0.08 } },
  { id: 'photoRecon', branch: 'signals', name: 'Photo Reconnaissance', cost: 80, desc: 'Unlocks the recon aircraft. Photographs show what really happened to a target.' },
  { id: 'longLens', branch: 'signals', name: 'Long-Focus Cameras', cost: 60, desc: 'Photographs from higher up. Recon aircraft are caught a third less often.', requires: 'photoRecon', effects: { stealth: 0.33 } },
  { id: 'intelOfficer', branch: 'signals', name: 'Intelligence Section', cost: 60, desc: 'Analysts cross-check debriefs. Shows uncertainty ranges and flags contradictions.' },

  // Industry & logistics
  { id: 'assembly1', branch: 'industry', name: 'Assembly Jigs', cost: 50, desc: 'Standard jigs on the factory floor. Aircraft production +10%.', effects: { production: 0.1 } },
  { id: 'assembly2', branch: 'industry', name: 'Moving Assembly Line', cost: 100, desc: 'Production +15%.', requires: 'assembly1', effects: { production: 0.15 } },
  { id: 'dispersal', branch: 'industry', name: 'Shadow Factories', cost: 140, desc: 'Production spread over many small works. Production another +15%.', requires: 'assembly2', effects: { production: 0.15 } },
  { id: 'groundCrews', branch: 'industry', name: 'Repair Gangs', cost: 50, desc: 'More fitters and riggers. Repairs and site repair +25%.', effects: { repair: 0.25 } },
  { id: 'fieldWorkshops', branch: 'industry', name: 'Field Workshops', cost: 90, desc: 'Mobile workshops at every airfield. Repairs and site repair another +25%.', requires: 'groundCrews', effects: { repair: 0.25 } },
  { id: 'fuelEconomy', branch: 'industry', name: 'Fuel Economy', cost: 60, desc: 'Leaner mixture settings and cruise discipline. Each sortie uses 10% fewer stores.', effects: { economy: 0.1 } },
  { id: 'pooledStores', branch: 'industry', name: 'Pooled Stores', cost: 90, desc: 'One supply system for the whole wing. Another 10% fewer stores per sortie.', requires: 'fuelEconomy', effects: { economy: 0.1 } },
  { id: 'requisition', branch: 'industry', name: 'Requisition Office', cost: 80, desc: 'Our own officers chase deliveries at the depots. +15 supplies every week, whatever the Air Council thinks of us.', effects: { supply: 15 } },
  { id: 'warEconomy', branch: 'industry', name: 'War Economy Board', cost: 120, desc: 'A seat on the regional production board. Another +15 supplies every week.', requires: 'requisition', effects: { supply: 15 } },
  { id: 'synthTrainer', branch: 'industry', name: 'Synthetic Trainers', cost: 60, desc: 'Link trainers and gunnery simulators at the school. Graduates start more skilled.', effects: { training: 0.04 } },
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

/** Reputations a squadron leader earns after about five operations in command. */
export const TRAIT_INFO: Record<Trait, { label: string; blurb: string }> = {
  ace: { label: 'Ace', blurb: 'A natural shot. His squadron shoots 10% better when he leads it.' },
  lucky: { label: 'Lucky', blurb: 'Comes home when others don\'t. Far less likely to be lost, and gets out when he is.' },
  steady: { label: 'Steady', blurb: 'Losses shake his squadron\'s morale much less.' },
  sharpEyed: { label: 'Sharp-eyed', blurb: 'His reports exaggerate claims and damage only half as much.' },
  shaken: { label: 'Shaken', blurb: 'Seen too much. His squadron tires faster and his reports wander.' },
};

/** Each request as it follows "he asked", for a leader's record and obituary. */
export const REQUEST_SHORT: Record<RequestKind, string> = {
  tighterBox: 'for a tighter box',
  headOn: 'for head-on attacks',
  higher: 'to bomb from higher up',
  breakOffSooner: 'for leave to turn back sooner',
  pressHome: 'to press his attacks home',
  rest: 'for a stand-down for his crews',
  strictQc: 'for stricter inspections at the works',
  gunnery: 'for more gunnery at the school',
  reporting: 'for better reporting drill at the school',
  plateTheHoles: 'for more plate where the holes were',
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
  ['Ashworth', 'Penrose', 'Hale', 'Brackley', 'Carrow', 'Thorne', 'Mabey', 'Fenwick', 'Lisle', 'Wexford', 'Dunmore', 'Ridley', 'Sallow', 'Pryce', 'Cobham', 'Garside', 'Aldridge', 'Bancroft', 'Blakeney', 'Brereton', 'Calloway', 'Carver', 'Chalcott', 'Coverley', 'Dacre', 'Danvers', 'Ellerby', 'Fairbairn', 'Farrant', 'Gilchrist', 'Granville', 'Hadley', 'Harcourt', 'Hensley', 'Keswick', 'Lancing', 'Latimer', 'Linley', 'Maitland', 'Marlowe', 'Melbury', 'Northcote', 'Ormsby', 'Pagett', 'Pelham', 'Quarrie', 'Radcliffe', 'Rawdon', 'Selwyn', 'Shelford', 'Stanmore', 'Tavener', 'Thursby', 'Trevelyan', 'Upton', 'Vane', 'Verity', 'Waverley', 'Westlake', 'Whitcombe', 'Wraxall', 'Yardley'],
  ['Kessler', 'Brandt', 'Voigt', 'Ahlers', 'Reinke', 'Strahl', 'Lindqvist', 'Haber', 'Ostrow', 'Falkner', 'Merz', 'Rauch', 'Tiede', 'Brückner', 'Sommer', 'Kranz', 'Adler', 'Bergmann', 'Bohlen', 'Dorn', 'Eckhart', 'Falk', 'Gerlach', 'Hagen', 'Heller', 'Hollmann', 'Jäger', 'Kemper', 'Kohl', 'Landau', 'Lenz', 'Marquardt', 'Nagel', 'Oberle', 'Pfeiffer', 'Quandt', 'Reuter', 'Ritter', 'Sander', 'Seeger', 'Stein', 'Thalmann', 'Ulrich', 'Vogt', 'Wendt', 'Winkler', 'Zander', 'Arndt', 'Baumann', 'Dressler', 'Eichler', 'Fendt', 'Grote', 'Henning', 'Ihlenfeld', 'Kessel', 'Lüders', 'Mahler', 'Nolte', 'Pahl', 'Rehberg', 'Schott'],
];
/** Aircrew names: a larger pool than the squadron leaders', drawn afresh each campaign. */
export const CREW_FIRST: [string[], string[]] = [
  ['Albert', 'Alfred', 'Bernard', 'Charles', 'Colin', 'Dennis', 'Derek', 'Donald', 'Eric', 'Ernest', 'Frank', 'Frederick', 'Geoffrey', 'George', 'Gordon', 'Henry', 'Herbert', 'Jack', 'James', 'John', 'Kenneth', 'Lionel', 'Maurice', 'Norman', 'Patrick', 'Peter', 'Ralph', 'Raymond', 'Reginald', 'Robert', 'Ronald', 'Sidney', 'Stanley', 'Thomas', 'Victor', 'William'],
  ['Alfons', 'Bruno', 'Dieter', 'Egon', 'Erich', 'Ernst', 'Franz', 'Friedrich', 'Fritz', 'Georg', 'Gerhard', 'Günther', 'Hans', 'Heinz', 'Helmut', 'Herbert', 'Horst', 'Johann', 'Josef', 'Karl', 'Klaus', 'Kurt', 'Ludwig', 'Manfred', 'Max', 'Otto', 'Paul', 'Peter', 'Richard', 'Rudolf', 'Siegfried', 'Walter', 'Werner', 'Wilhelm', 'Willi', 'Wolfgang'],
];
export const CREW_LAST: [string[], string[]] = [
  ['Abbott', 'Archer', 'Bailey', 'Barker', 'Bennett', 'Bishop', 'Booth', 'Bradshaw', 'Burton', 'Chapman', 'Clarke', 'Collins', 'Cooper', 'Dawson', 'Dixon', 'Ellis', 'Fletcher', 'Foster', 'Gibson', 'Graham', 'Harding', 'Harper', 'Hayes', 'Holmes', 'Hughes', 'Jennings', 'Kemp', 'Lawrence', 'Lloyd', 'Marsh', 'Mason', 'Morgan', 'Newman', 'Osborne', 'Parker', 'Payne', 'Porter', 'Reed', 'Rowe', 'Shaw', 'Spencer', 'Stevens', 'Turner', 'Walsh', 'Ward', 'Webb', 'Wells', 'Wood', 'Atkins', 'Baxter', 'Bell', 'Brooks', 'Carter', 'Cole', 'Cross', 'Dale', 'Day', 'Doyle', 'Edwards', 'Evans', 'Farmer', 'Ford', 'Fox', 'Gardner', 'Gray', 'Green', 'Hall', 'Hart', 'Hill', 'Hunt', 'Jarvis', 'Kelly', 'King', 'Knight', 'Lane', 'Long', 'Lucas', 'Mills', 'Moore', 'Nash', 'Nicholls', 'Owen', 'Page', 'Palmer', 'Pearce', 'Price', 'Rees', 'Rose', 'Ross', 'Russell', 'Simmons', 'Stone', 'Swift', 'Tucker', 'Wade', 'Watts', 'West', 'Wilkins', 'Wright', 'Young'],
  ['Albrecht', 'Bauer', 'Beck', 'Berger', 'Busch', 'Dietrich', 'Ebert', 'Engel', 'Fischer', 'Frank', 'Fuchs', 'Graf', 'Hahn', 'Hartmann', 'Hoffmann', 'Huber', 'Jung', 'Kaiser', 'Keller', 'Klein', 'Koch', 'König', 'Krause', 'Kuhn', 'Lang', 'Lehmann', 'Lorenz', 'Maier', 'Meyer', 'Möller', 'Neumann', 'Peters', 'Pohl', 'Richter', 'Roth', 'Schäfer', 'Schmitt', 'Schneider', 'Schulz', 'Schwarz', 'Seidel', 'Thiel', 'Vogel', 'Wagner', 'Weber', 'Werner', 'Winter', 'Wolf', 'Albers', 'Arnold', 'Bach', 'Beyer', 'Brandt', 'Dahl', 'Ernst', 'Franke', 'Friedrich', 'Geiger', 'Hesse', 'Horn', 'Jansen', 'Kraft', 'Krüger', 'Kühn', 'Lange', 'Lindner', 'Ludwig', 'Martin', 'Mayer', 'Otto', 'Paul', 'Pieper', 'Ramm', 'Rieger', 'Sauer', 'Scholz', 'Seidl', 'Simon', 'Sommerfeld', 'Stahl', 'Thomas', 'Unger', 'Vetter', 'Voss', 'Walter', 'Weiss', 'Wolff', 'Ziegler', 'Brauer', 'Fink', 'Haas', 'Kurz', 'Lindemann', 'Möbius', 'Nowak', 'Pohle', 'Reich', 'Schuster'],
];

/** Squadron commanders' ranks, most junior first. */
export const RANKS: [string[], string[]] = [
  ['Flt Lt', 'Sqn Ldr', 'Wg Cdr'],
  ['Hauptmann', 'Major', 'Oberst'],
];

export const SQUADRON_NAMES: [string[], string[]] = [
  ['No. 41 "Lanterns"', 'No. 112 "Old Crows"', 'No. 9 "Ploughmen"', 'No. 207 "Nightjars"', 'No. 73 "Saints"', 'No. 18 "Ferrymen"', 'No. 304 "Harriers"', 'No. 61 "Long Odds"', 'No. 15 "Vespers"', 'No. 88 "Tinkers"'],
  ['Staffel Grau', 'Staffel Anker', 'Staffel Eis', 'Staffel Hammer', 'Staffel Ruß', 'Staffel Pflug', 'Staffel Nord', 'Staffel Auge', 'Staffel Hagel', 'Staffel Kreuz'],
];

export const CALLSIGNS: [string[], string[]] = [
  ['Lantern', 'Crow', 'Plough', 'Nightjar', 'Saint', 'Ferry', 'Harrier', 'Odds', 'Vesper', 'Tinker'],
  ['Grau', 'Anker', 'Eis', 'Hammer', 'Ruß', 'Pflug', 'Nord', 'Auge', 'Hagel', 'Kreuz'],
];

import type { RngState } from './rng';

export type SideId = 0 | 1;

export const ZONES = [
  'nose',
  'cockpit',
  'engines',
  'fuel',
  'wingRoot',
  'outerWing',
  'fuselage',
  'tail',
] as const;
export type ZoneId = (typeof ZONES)[number];
export type ZoneMap<T> = Record<ZoneId, T>;

export type AircraftKind = 'fighter' | 'medium' | 'heavy' | 'recon';
/** Direction an attack comes from. Flak bursts below and around. */
export type Approach = 'tail' | 'headOn' | 'beam' | 'flak';
export type FighterApproach = Exclude<Approach, 'flak'>;
export type Archetype = 'braggart' | 'pessimist' | 'gloryHunter' | 'byTheBook' | 'timid';
export type FacilityType = 'industry' | 'airfield' | 'fuel';
/** Raid target: a facility type (with a specific site), close support at the front, or a fighter sweep. */
export type TargetId = FacilityType | 'support' | 'sweep' | 'feint';
export type Weather = 'clear' | 'cloud' | 'storm';
export type TrainingFocus = 'balanced' | 'gunnery' | 'evasion' | 'reporting';
export type QcPolicy = 'rushed' | 'standard' | 'strict';

export interface Doctrine {
  /** 0 = preserve aircraft, 1 = press every attack. */
  aggression: number;
  /** 0 = loose, 1 = tight combat box. */
  formation: number;
  /** Fraction of the squadron lost before it aborts (0.1 .. 1). */
  breakOff: number;
  /** 0 = low level, 1 = high altitude. */
  altitude: number;
}

export interface Hit {
  zone: ZoneId;
  /** Deterministic 0..1 coordinates used to place the hole inside the zone's pixel mask. */
  u: number;
  v: number;
  approach: Approach;
  /** Hit that brought the aircraft down. */
  lethal?: boolean;
  /** Armor plate stopped a hit that would otherwise have brought the aircraft down. */
  saved?: boolean;
  /** Aircraft type, recorded for the archive. */
  kind?: AircraftKind;
}

export interface Airframe {
  id: string;
  serial: string;
  kind: AircraftKind;
  /** Structural condition 0..100. Repairs restore it. */
  condition: number;
  /** Unrepaired hits from the most recent sortie (what the debrief shows). */
  hits: Hit[];
  /** Count of patched holes, for visual wear. */
  patches: number;
  sorties: number;
  /** Hidden manufacturing defect 0..1 (factory QC). */
  defect: number;
  status: 'ready' | 'repair';
  repairTurns: number;
  nickname?: string;
}

export type Trait = 'ace' | 'lucky' | 'steady' | 'sharpEyed' | 'shaken';

export interface Leader {
  name: string;
  rank: string;
  archetype: Archetype;
  /** Week he took command, operations led since, and the reputation earned after a few. */
  since?: number;
  ops?: number;
  /** Enemy aircraft his squadron actually destroyed under his command. */
  kills?: number;
  trait?: Trait;
  /** What the squadron remembers: his requests and how they were answered, close calls, losses. */
  log?: { week: number; text: string; kind?: RequestKind; approved?: boolean }[];
  /** Something he said in a recent debrief, for the squadron to remember him by. */
  said?: string;
  /** His last few debrief remarks, so he does not repeat himself every other week. */
  recent?: string[];
  /** Weeks left on the medical officer's rest: his deputy leads the squadron meanwhile. */
  resting?: number;
  /** He has had his rest already: the medical officer won't sign it twice. */
  restedOnce?: boolean;
}

export interface Squadron {
  id: string;
  name: string;
  side: SideId;
  kind: AircraftKind;
  airframes: Airframe[];
  /** Trained crews available to fly. */
  crews: number;
  /** 0..1 */
  skill: number;
  morale: number;
  fatigue: number;
  /** Accumulated shock from recent heavy losses, distorts reports. 0..1 */
  trauma: number;
  leader: Leader;
  doctrine: Doctrine;
  armor: ZoneMap<number>;
  notables: string[];
  insignia: number;
  /** The leader's last remark in a Form 541, so he doesn't repeat himself. */
  lastRemark?: string;
  /** Week each kind of request was last put to the commander (leaders don't nag every week). */
  asked?: Partial<Record<RequestKind, number>>;
  /** After a change of command or a merge: the other flight commander the commander may appoint instead, this week only. */
  candidate?: Leader;
  candidateWeek?: number;
  /** The senior flight commander: the man passed over, stood down or handed back command. First in line next time. */
  deputy?: Leader;
  /** Commanding officers this squadron has lost in the war. */
  cosLost?: number;
  /** Field modifications fitted to the squadron's aircraft (at most MOD_SLOTS). */
  mods?: ModId[];
}

/** Field modifications a squadron's aircraft can be fitted with. */
export type ModId =
  | 'extraGuns'
  | 'stripped'
  | 'boost'
  | 'bombBay'
  | 'plateMounts'
  | 'leanMix'
  | 'aiRadar'
  | 'armouredGlass'
  | 'inertTanks';

/** The air force a commander leads: each has its own strengths and weaknesses. */
export type FactionId = 'arsenal' | 'cadre' | 'patronage';

export type OfferTier = 0 | 1 | 2;
export type OfferKind =
  | 'grant'
  | 'fuelTrain'
  | 'crews'
  | 'labour'
  | 'leave'
  | 'tools'
  | 'ferry'
  | 'priority'
  | 'stockpile'
  | 'instructors'
  | 'photos'
  | 'kits'
  | 'prototype'
  | 'secret'
  | 'cabinet'
  | 'dominion'
  | 'ace'
  | 'newDepot';

/** One of the proposals High Command sends each week. */
export interface OfferCard {
  kind: OfferKind;
  tier: OfferTier;
  /** What the offer is about, fixed when it is made (an aircraft type, a project, a modification, a squadron). */
  param?: string;
}

/** This week's proposals from High Command: the commander may accept one. */
export interface Offers {
  week: number;
  cards: OfferCard[];
  /** Index of the card accepted, once one is. */
  taken?: number;
}

export interface Resources {
  supplies: number;
  /** Fuel and munitions: every aircraft that flies uses them. */
  stores: number;
  replacements: number;
}

export interface Factory {
  level: number;
  qc: QcPolicy;
  /** Aircraft queued for production. */
  queue: AircraftKind[];
  /** Production points carried over. */
  progress: number;
}

export interface Training {
  level: number;
  focus: TrainingFocus;
  /** Crews in the pipeline, graduate next turn. */
  inTraining: number;
}

export interface Facilities {
  industry: number;
  airfield: number;
  fuel: number;
}

export interface Order {
  id: string;
  kind: 'strike' | 'kills' | 'sorties' | 'advance';
  target?: TargetId;
  siteId?: string;
  amount: number;
  text: string;
  deadline: number;
  done?: boolean;
  failed?: boolean;
  /** Strike orders: the damage asked for, and the target's believed condition when it was set, so photographs can be measured against it. */
  goal?: number;
  from?: number;
  /** A strike whose results nobody saw gets one extra week to be photographed. */
  graced?: boolean;
}

export interface Memo {
  turn: number;
  from: string;
  subject: string;
  body: string;
  kind: 'order' | 'intel' | 'supply' | 'reprimand' | 'commendation' | 'notice';
}

/** What a commander believes about the enemy. Built only from reports. */
export interface Perceived {
  enemyFighters: number;
  enemyFightersSd: number;
  enemyBombers: number;
  enemyFlak: number;
  /** Believed share of each approach used by enemy interceptors. */
  enemyApproach: Record<FighterApproach, number>;
  /** Reported enemy facility condition (0..100), by type. */
  enemyFacilities: Facilities;
  /** Believed condition of each enemy site, by site id. */
  sites: Record<string, number>;
  /** Sites whose condition was confirmed by photographs this theater. */
  photographed: string[];
  /** Army liaison's account of the pressure on the front, + favours this side. */
  front: number;
  /** Believed enemy armor emphasis per zone, from observation. */
  enemyArmorSeen: ZoneMap<number>;
  /** Cumulative survivor hits by zone (what the debriefs showed). */
  survivorHits: ZoneMap<number>;
  /** The same, per aircraft type. */
  survivorHitsByKind: Partial<Record<AircraftKind, ZoneMap<number>>>;
  /** What the last calls of crews who didn't come back described, per type: the only word from the aircraft we never see. */
  lastCalls?: Partial<Record<AircraftKind, ZoneMap<number>>>;
  claimedKillsTotal: number;
  /** With an Intelligence Section: the band the true front lies in, from our side (low, high). */
  frontBand?: [number, number];
  /** Y-Service guess at the enemy's next operation (may be wrong). */
  warning?: { text: string; sector?: number; guess?: { target: TargetId; siteId?: string } | null };
  /** Whether the Y-Service's recent warnings came true (most recent last). */
  warningRecord?: boolean[];
}

export interface SideState {
  id: SideId;
  name: string;
  /** The human (or AI) in command, shown in hotseat handovers. */
  commander: string;
  short: string;
  isAI: boolean;
  /** For AI sides: how well it understands survivorship bias (0 naive .. 1 Wald). */
  insight: number;
  resources: Resources;
  squadrons: Squadron[];
  factory: Factory;
  training: Training;
  facilities: Facilities;
  research: string[];
  researching: string | null;
  researchProgress: number;
  trust: number;
  /** Interceptor tactics: preferred approach weights. */
  approach: Record<FighterApproach, number>;
  flak: number;
  perceived: Perceived;
  orders: Order[];
  memos: Memo[];
  lowMoraleTurns: number;
  /** Times caught inflating reports. */
  caught: number;
  /** What this side has seen the enemy do recently (decaying counts): controllers and the Army learn. */
  observed: { feints: number; support: number };
  /** Squadron leaders' requests waiting on the commander's desk this week. */
  requests: LeaderRequest[];
  /** Week a stores convoy was last bought. */
  convoyWeek?: number;
  /** The air force this commander leads (absent: no special strengths or weaknesses). */
  faction?: FactionId;
  /** Supply Office level: each level brings more supplies every week. */
  office?: number;
  /** Extra depot capacity for stores, beyond the standard. */
  depotBonus?: number;
  /** High Command's proposals for this week. */
  offers?: Offers;
  /** Rare field modifications released to this wing. */
  modsUnlocked?: ModId[];
  /** Modification kits delivered free: the next fittings cost nothing. */
  freeMods?: number;
  /** Facility types given emergency repairs this week (one each per week). */
  repaired?: FacilityType[];
  /** The AI's chosen next operation, fixed a week ahead so enemy intelligence can get wind of it. */
  /** An AI wing's next operation, fixed a week ahead. `push`: a counter-offensive with everything it has; `focus`: part of a campaign to cripple one type of works. */
  intent?: { target: TargetId; siteId?: string; push?: boolean; focus?: boolean };
  /** Letters still in the post: Red Cross cards about prisoners, delivered on their week. */
  post?: { due: number; from: string; subject: string; body: string; returns?: { squadronId: string; leader: Leader }; /** An obituary is written when the letter goes out, so it names whoever leads the squadron then. */ obit?: { leader: Leader; squadronId: string; squadron: string; week: number; lastWords?: string }; serial?: string; fate?: 'prisoner' | 'returned' | 'killed' }[];
  /** Everyone posted missing in this war, and what became of them as far as we know. */
  roll?: { week: number; theater: number; name: string; serial: string; squadron: string; crew: number; fate: 'missing' | 'prisoner' | 'returned' | 'killed' }[];
  /** Graduates who joined squadrons last week, for station-life scenes. */
  arrived?: { squadronId: string; n: number }[];
  /** Lines already spoken in this war that shouldn't be heard again (a dead man's saying, a successor's words, a scene). */
  usedLines?: string[];
  /** Leaders' names already used in this war (lost leaders included). */
  usedNames?: string[];
}

export interface RaidPlan {
  target: TargetId;
  /** For strikes: the specific site attacked. */
  siteId?: string;
  squadronIds: string[];
}

export interface TurnPlan {
  raid: RaidPlan | null;
  /** Fighter squadrons held back to intercept enemy raids. */
  defense: string[];
  /** Sector each defending squadron patrols; absent = central reserve. */
  cover: Record<string, number>;
  /** Recon squadron sent to photograph a site. */
  recon: { squadronId: string; siteId: string } | null;
  /** Diversion: squadrons sent over another enemy sector to draw the reserve away. */
  feint: { squadronIds: string[]; sector: number } | null;
  /** 0 = honest, 1 = heavily embellished report to High Command. */
  embellish: number;
  /** Squadrons stood down this week at their leader's request, and the duties they return to next week. */
  rested?: { id: string; raid: boolean; feint: boolean; defense: boolean; cover?: number }[];
}

/** --- Battle records --- */

export interface PlaneRecord {
  airframeId: string;
  serial: string;
  squadronId: string;
  kind: AircraftKind;
  side: SideId;
  role: 'raid' | 'escort' | 'defense' | 'recon' | 'feint';
  hits: Hit[];
  fate: 'returned' | 'lost' | 'aborted' | 'crashed';
  trueKills: number;
  claims: number;
  /** Times this plane's crew saw attacks from each approach. */
  sawApproach: Record<FighterApproach, number>;
  enemiesSeen: number;
  lastWords?: string;
  /** The zone the last call described (the hit that brought her down). */
  lastZone?: ZoneId;
  /** Parachutes seen (or not) when the aircraft went down. */
  chutes?: number;
  /** What a squadron mate saw of the loss, e.g. "falling out of formation, 3 chutes". */
  witnessed?: string;
  /** Turned back with a mechanical fault before contact. */
  mechanical?: boolean;
  /** The squadron leader's own aircraft (callsign 1). */
  lead?: boolean;
  /** Captain, when known for certain (the leader). */
  captain?: string;
}

export interface RadioLine {
  t: number;
  side: SideId;
  callsign: string;
  text: string;
  /** Only heard by the listed side. */
  heardBy: SideId;
  /** A crew's last call (already subject to radio range when generated). */
  final?: boolean;
}

export interface RaidResult {
  attacker: SideId;
  target: TargetId;
  siteId?: string;
  /** Sector over which the main action took place. */
  sector: number;
  weather: Weather;
  planes: PlaneRecord[];
  /** True damage to the target facility. */
  damage: number;
  aborted: string[];
  interceptors: number;
  flakLevel: number;
  /** True losses per side in this raid. */
  lost: [number, number];
  radio: RadioLine[];
}

export interface SquadronReport {
  squadronId: string;
  squadronName: string;
  leader: Leader;
  sent: number;
  returned: number;
  claims: number;
  enemyFightersReported: number;
  approachReported: Record<FighterApproach, number>;
  flakReported: 'light' | 'moderate' | 'heavy' | 'murderous';
  targetDamageReported: number | null;
  /** What the raid this report is about was doing. */
  mission?: TargetId;
  /** Whether the squadron flew the raid or defended. */
  role?: PlaneRecord['role'];
  remarks: string[];
  noReport?: boolean;
}

export interface Debrief {
  turn: number;
  side: SideId;
  /** Survivors only. Full hit lists for display. */
  returned: PlaneRecord[];
  /** Lost planes: only serials and squadron, never the hits. */
  missing: { serial: string; squadronId: string; kind: AircraftKind; lastWords?: string; lastZone?: ZoneId; witnessed?: string; captain?: string }[];
  reports: SquadronReport[];
  radio: RadioLine[];
  recon: { siteId: string; condition: number } | null;
  /** Theater news: sectors won or lost, objectives, stage changes. */
  theaterNews: string[];
  /** Enemy raid on us: what our defenders and ground observers say. */
  defenseSummary: string[];
  /** Enemy aircraft the observers counted over our side this week: the most our defenders can be credited with. */
  enemySeen?: number;
  facilityDamageTaken: Partial<Facilities>;
  hqResponse: string[];
  /** Station life: a scene or two from our own airfield. */
  station?: string[];
  /** High Command's confidence and the reported front pressure before this week (for showing the change). */
  trustBefore?: number;
  frontBefore?: number;
  /** Army liaison's rough account of what moved the front this week (words, not numbers). */
  pressure?: { label: string; effect: string; sign: number }[];
}

/** Archived truth per turn, for the end-of-war declassification. */
export interface ArchiveEntry {
  turn: number;
  trueLosses: [number, number];
  trueKills: [number, number];
  claimed: [number, number];
  reportedToHq: [number, number];
  facilities: [Facilities, Facilities];
  /** Theater index and the number of sectors held by side 0 at week's end. */
  theater: number;
  sectors0: number;
  front: number;
  lostHits: [Hit[], Hit[]];
  survivorHits: [Hit[], Hit[]];
}

export type Outcome =
  | 'victory'
  | 'pyrrhic'
  | 'stalemate'
  | 'relieved'
  | 'collapse'
  | 'mutiny'
  | 'grounded'
  | 'defeat';

export interface GameState {
  version: number;
  seed: string;
  rng: RngState;
  turn: number;
  maxTurns: number;
  mode: 'single' | 'hotseat' | 'lan';
  sides: [SideState, SideState];
  /** True pressure on the contested sector boundary, + favours side 0. */
  front: number;
  theater: TheaterState;
  theaterResults: TheaterResult[];
  /** HIDDEN: per-type chance that one hit in a zone is fatal, rolled per campaign. */
  lethality: Record<AircraftKind, ZoneMap<number>>;
  /** Weather for the coming week (true) and each side's forecast. */
  weather: Weather;
  forecast: [Weather, Weather];
  lastDebriefs: [Debrief | null, Debrief | null];
  /** Hotseat: orders sealed this week but not yet resolved (survives saving). */
  sealed: [TurnPlan | null, TurnPlan | null];
  archive: ArchiveEntry[];
  outcome: [Outcome, Outcome] | null;
  nextId: number;
  /** Tutorial step, while the guided first campaign is running. */
  tutorial?: number;
}

/** --- Theaters --- */

export interface Site {
  id: string;
  name: string;
  type: FacilityType;
  sector: number;
  owner: SideId;
  condition: number;
  /** Set when the site changes hands: was it already wrecked (25% or less) when the Army arrived? */
  takenWrecked?: boolean;
}

export interface SecondaryObjective {
  side: SideId;
  siteId: string;
  text: string;
  reward: { supplies?: number; trust?: number; research?: string };
  /** overrun: the Army took the site intact before the wing wrecked it, so the wing gets no credit. */
  status: 'open' | 'claimed' | 'confirmed' | 'discredited' | 'overrun';
  /** The site's true condition when the claim was made: a claim is judged by that, not by what repairs made of it since. */
  claimedAt?: number;
}

export interface TheaterState {
  index: number;
  id: string;
  /** Weeks spent in this theater so far. */
  week: number;
  /** Sectors held by side 0 (sectors 0..held0-1); side 1 holds the rest. */
  held0: number;
  /** held0 at the start of the theater. */
  start0: number;
  sites: Site[];
  /** Number of sites of each type each side started the theater with. */
  baseline: [Facilities, Facilities];
  stage: number;
  objectives: SecondaryObjective[];
}

export interface TheaterResult {
  index: number;
  name: string;
  winner: SideId | null;
  weeks: number;
  decisive: boolean;
  /** Sectors side 0 gained in the theater (negative: lost). */
  gain?: number;
}

/** --- Squadron leaders' requests --- */

export type RequestKind =
  | 'tighterBox'
  | 'headOn'
  | 'rest'
  | 'higher'
  | 'breakOffSooner'
  | 'pressHome'
  | 'strictQc'
  | 'gunnery'
  | 'reporting'
  | 'plateTheHoles';

export interface LeaderRequest {
  id: string;
  /** Number shown on the desk this week (R1, R2…); stays put when another request is answered. */
  n?: number;
  /** Week the request was made. */
  week?: number;
  squadronId: string;
  kind: RequestKind;
  /** What the leader says. */
  text: string;
  /** What approving does, including the trade-off. */
  effect: string;
  cost: number;
  /** For plate requests: the zone to add plate to, and the zone it comes off. */
  zone?: ZoneId;
  from?: ZoneId;
}

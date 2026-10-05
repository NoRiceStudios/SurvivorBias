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

export interface Leader {
  name: string;
  rank: string;
  archetype: Archetype;
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
}

export interface Resources {
  supplies: number;
  fuel: number;
  munitions: number;
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
  claimedKillsTotal: number;
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
}

export interface RadioLine {
  t: number;
  side: SideId;
  callsign: string;
  text: string;
  /** Only heard by the listed side. */
  heardBy: SideId;
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
  remarks: string[];
  noReport?: boolean;
}

export interface Debrief {
  turn: number;
  side: SideId;
  /** Survivors only. Full hit lists for display. */
  returned: PlaneRecord[];
  /** Lost planes: only serials and squadron, never the hits. */
  missing: { serial: string; squadronId: string; kind: AircraftKind; lastWords?: string; captain?: string }[];
  reports: SquadronReport[];
  radio: RadioLine[];
  recon: { siteId: string; condition: number } | null;
  /** Theater news: sectors won or lost, objectives, stage changes. */
  theaterNews: string[];
  /** Enemy raid on us: what our defenders and ground observers say. */
  defenseSummary: string[];
  facilityDamageTaken: Partial<Facilities>;
  hqResponse: string[];
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
  /** Weather for the coming week (true) and each side's forecast. */
  weather: Weather;
  forecast: [Weather, Weather];
  lastDebriefs: [Debrief | null, Debrief | null];
  /** Hotseat: orders sealed this week but not yet resolved (survives saving). */
  sealed: [TurnPlan | null, TurnPlan | null];
  archive: ArchiveEntry[];
  outcome: [Outcome, Outcome] | null;
  nextId: number;
}

/** --- Theaters --- */

export interface Site {
  id: string;
  name: string;
  type: FacilityType;
  sector: number;
  owner: SideId;
  condition: number;
}

export interface SecondaryObjective {
  side: SideId;
  siteId: string;
  text: string;
  reward: { supplies?: number; trust?: number; research?: string };
  status: 'open' | 'claimed' | 'confirmed' | 'discredited';
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
}

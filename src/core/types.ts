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
export type TargetId = 'industry' | 'airfield' | 'fuel' | 'sweep';
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
  kind: 'strike' | 'kills' | 'sorties';
  target?: TargetId;
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
  /** Reported enemy facility condition (0..100). */
  enemyFacilities: Facilities;
  /** Reported front line, + favours this side. */
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
}

export interface RaidPlan {
  target: TargetId;
  squadronIds: string[];
}

export interface TurnPlan {
  raid: RaidPlan | null;
  /** Fighter squadrons held back to intercept enemy raids. */
  defense: string[];
  /** Recon squadron sent to photograph a target. */
  recon: { squadronId: string; target: Exclude<TargetId, 'sweep'> } | null;
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
  role: 'raid' | 'escort' | 'defense' | 'recon';
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
  remarks: string[];
  noReport?: boolean;
}

export interface Debrief {
  turn: number;
  side: SideId;
  /** Survivors only. Full hit lists for display. */
  returned: PlaneRecord[];
  /** Lost planes: only serials and squadron, never the hits. */
  missing: { serial: string; squadronId: string; kind: AircraftKind; lastWords?: string }[];
  reports: SquadronReport[];
  radio: RadioLine[];
  recon: { target: TargetId; condition: number } | null;
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
  /** True front line, + favours side 0. -100..100. */
  front: number;
  lastDebriefs: [Debrief | null, Debrief | null];
  archive: ArchiveEntry[];
  outcome: [Outcome, Outcome] | null;
  nextId: number;
}

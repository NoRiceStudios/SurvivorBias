/**
 * Field modifications: kits fitted to a squadron's aircraft at its own airfield.
 * Each one changes how the type fights, and almost all of them cost something
 * in return. A squadron has room for two. The rarest are released only by
 * High Command.
 */
import { AIRCRAFT } from './data';
import type { AircraftKind, ModId, SideState, Squadron } from './types';

export type ModKey =
  /** Hit rate of the squadron's own guns (fighters' attacks and bombers' gunners), +x. */
  | 'hits'
  /** Bombers' defensive fire, +x. */
  | 'turrets'
  /** Extra weight, on the same scale as a full load of plate (1). */
  | 'weight'
  /** Extra armor plates the type can carry. */
  | 'plates'
  /** Bomb load, +x. */
  | 'payload'
  /** Chance an aircraft turns back with engine trouble each sortie. */
  | 'strain'
  /** Stores used per sortie, −x. */
  | 'economy'
  /** Defenders' interception chance, +x. */
  | 'detection'
  /** Cockpit and nose hits are less often fatal, −x. */
  | 'cockpit'
  /** Fuel tank hits are less often fatal, −x. */
  | 'fuel';

export interface ModSpec {
  id: ModId;
  name: string;
  desc: string;
  kinds: AircraftKind[];
  cost: number;
  /** Released only by High Command. */
  rare?: boolean;
  fx: Partial<Record<ModKey, number>>;
}

const ALL: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
const ARMED: AircraftKind[] = ['fighter', 'medium', 'heavy'];
const BOMBERS: AircraftKind[] = ['medium', 'heavy'];

export const MODS: Record<ModId, ModSpec> = {
  extraGuns: { id: 'extraGuns', name: 'Extra guns', kinds: ARMED, cost: 25, desc: 'Another pair of guns in the wings, or a second gun in every turret. Fighters hit 12% more often and gunners 20%; the weight makes the aircraft a little slower.', fx: { hits: 0.12, turrets: 0.2, weight: 0.15 } },
  stripped: { id: 'stripped', name: 'Stripped airframe', kinds: ALL, cost: 15, desc: 'Paint, spare kit and half the ammunition taken out. Lighter, so plate slows the aircraft much less; gunners have 20% less to fire.', fx: { weight: -0.35, turrets: -0.2 } },
  boost: { id: 'boost', name: 'Boost injection', kinds: ['fighter'], cost: 30, desc: 'Water-methanol for short bursts of power. Defenders reach the raid 6% more often and fight 8% better; 4% of sorties turn back with a strained engine.', fx: { hits: 0.08, detection: 0.06, strain: 0.04 } },
  bombBay: { id: 'bombBay', name: 'Enlarged bomb bay', kinds: BOMBERS, cost: 30, desc: 'The ventral turret comes out to make room. Bombs do 25% more damage; the formation\'s defensive fire falls by a quarter.', fx: { payload: 0.25, turrets: -0.25 } },
  plateMounts: { id: 'plateMounts', name: 'Extra plate mounts', kinds: ALL, cost: 20, desc: 'Strengthened frames carry two more armor plates. The plates still weigh what they weigh.', fx: { plates: 2 } },
  leanMix: { id: 'leanMix', name: 'Lean-mixture carburettors', kinds: ALL, cost: 20, desc: 'Each sortie uses a quarter fewer stores. A little less power in a fight: 5% fewer hits.', fx: { economy: 0.25, hits: -0.05 } },
  aiRadar: { id: 'aiRadar', name: 'Airborne radar', kinds: ['fighter'], cost: 40, rare: true, desc: 'A prototype interception set. Defenders find the raid 15% more often and get in the first burst: 5% more hits.', fx: { detection: 0.15, hits: 0.05 } },
  armouredGlass: { id: 'armouredGlass', name: 'Armoured windscreen and seat', kinds: ALL, cost: 30, rare: true, desc: 'Laminated glass and a back plate for the pilot, weighing next to nothing. Cockpit and nose hits are 45% less often fatal.', fx: { cockpit: 0.45 } },
  inertTanks: { id: 'inertTanks', name: 'Inerted fuel tanks', kinds: ALL, cost: 35, rare: true, desc: 'Exhaust gas piped into the tanks so the vapour cannot burn. Fuel tank hits are half as often fatal.', fx: { fuel: 0.5 } },
};

export const MOD_IDS = Object.keys(MODS) as ModId[];
/** Modifications a squadron can carry at once. */
export const MOD_SLOTS = 2;

export function modFx(sq: Pick<Squadron, 'mods'>, key: ModKey): number {
  let v = 0;
  for (const m of sq.mods ?? []) v += MODS[m]?.fx[key] ?? 0;
  return v;
}

/** Armor plates a squadron's aircraft can carry. */
export function armorBudget(sq: Pick<Squadron, 'kind' | 'mods'>): number {
  return AIRCRAFT[sq.kind].armorBudget + modFx(sq, 'plates');
}

/** Modifications this squadron could be fitted with: its type's, and the rare ones only once released. */
export function availableMods(side: Pick<SideState, 'modsUnlocked'>, sq: Pick<Squadron, 'kind'>): ModSpec[] {
  return MOD_IDS.map((id) => MODS[id]).filter((m) => m.kinds.includes(sq.kind) && (!m.rare || side.modsUnlocked?.includes(m.id)));
}

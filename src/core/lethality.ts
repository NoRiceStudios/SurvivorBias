/**
 * HIDDEN: the chance that a single hit in a zone brings an aircraft down.
 * Rolled per campaign and per aircraft type, within plausible bounds, so the
 * armor puzzle has to be solved from the evidence every war, for every type.
 */
import { ZONE_LETHALITY } from './data';
import type { Rng } from './rng';
import type { AircraftKind, ZoneId, ZoneMap } from './types';
import { ZONES } from './types';

export type LethalityTable = Record<AircraftKind, ZoneMap<number>>;

export const KINDS: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];

/** The original fixed profile, used for saves made before profiles were rolled. */
export const DEFAULT_LETHALITY: LethalityTable = Object.fromEntries(KINDS.map((k) => [k, { ...ZONE_LETHALITY }])) as LethalityTable;

const BOUNDS: ZoneMap<[number, number]> = {
  cockpit: [0.16, 0.38],
  engines: [0.14, 0.32],
  fuel: [0.14, 0.34],
  wingRoot: [0.06, 0.18],
  nose: [0.04, 0.16],
  tail: [0.02, 0.12],
  fuselage: [0.003, 0.02],
  outerWing: [0.002, 0.015],
};

/** Design character of each airframe, applied on top of the rolled values. */
const FLAVOUR: Record<AircraftKind, Partial<ZoneMap<number>>> = {
  // Single engine in the nose: a hit there is an engine hit.
  fighter: { nose: 1.8, engines: 1.1 },
  medium: {},
  // Four engines: losing one is survivable. Big wing tanks.
  heavy: { engines: 0.65, fuel: 1.15 },
  recon: { nose: 1.6, fuel: 1.2 },
};

export function rollLethality(rng: Rng): LethalityTable {
  const table = {} as LethalityTable;
  for (const kind of KINDS) {
    const t = {} as ZoneMap<number>;
    for (const z of ZONES) {
      const [lo, hi] = BOUNDS[z];
      t[z] = (lo + (hi - lo) * rng.next()) * (FLAVOUR[kind][z] ?? 1);
    }
    // Occasionally a design quirk makes a usually-forgiving zone deadly...
    if (rng.chance(0.35)) {
      const z = rng.pick<ZoneId>(['tail', 'wingRoot', 'nose']);
      t[z] = rng.range(0.18, 0.3);
    }
    // Sometimes even the big, "safe" areas hide something vital in this mark:
    // fuel tanks out in the wings, or control runs along the fuselage.
    if (rng.chance(0.4)) {
      const z = rng.pick<ZoneId>(['outerWing', 'fuselage']);
      t[z] = rng.range(0.1, 0.2);
    }
    // ...or a usually-deadly one well protected as built.
    if (rng.chance(0.25)) {
      const z = rng.pick<ZoneId>(['cockpit', 'engines', 'fuel']);
      t[z] = rng.range(0.07, 0.13);
    }
    for (const z of ZONES) t[z] = Math.round(t[z] * 1000) / 1000;
    table[kind] = t;
  }
  return table;
}

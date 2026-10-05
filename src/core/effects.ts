/**
 * What damage to a side's works actually does. One set of rules, used by the
 * simulation and by both commanders' screens: the victim sees it applied to
 * their own (known) facilities, the attacker sees it applied to their
 * estimate of the enemy's.
 */
import type { Facilities } from './types';

export interface FacilityEffects {
  /** Share of aircraft that cannot take off from cratered airfields (0..0.5). */
  grounded: number;
  /** Multiplier on weekly deliveries of stores (fuel and munitions). */
  stores: number;
  /** Multiplier on aircraft production at the works. */
  production: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1.2, v / 100));

export function facilityEffects(f: Facilities): FacilityEffects {
  return {
    grounded: Math.round(Math.max(0, 1 - clamp(f.airfield)) * 0.5 * 100) / 100,
    stores: Math.round((0.3 + 0.7 * clamp(f.fuel)) * 100) / 100,
    production: Math.round((0.4 + 0.6 * clamp(f.industry)) * 100) / 100,
  };
}

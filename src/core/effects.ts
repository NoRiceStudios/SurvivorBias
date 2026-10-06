/**
 * What damage to a side's works actually does. One set of rules, used by the
 * simulation and by both commanders' screens: the victim sees it applied to
 * their own (known) facilities, the attacker sees it applied to their
 * estimate of the enemy's.
 */
import type { Facilities } from './types';

/** Below this condition a type of works is crippled, and the effect jumps. */
export const CRIPPLED = 50;

export interface FacilityEffects {
  /** Share of aircraft that cannot take off from cratered airfields. */
  grounded: number;
  /** Multiplier on how many defending fighters can scramble at all. */
  cover: number;
  /** Multiplier on weekly deliveries of stores (fuel and munitions). */
  stores: number;
  /** Multiplier on aircraft production at the works. */
  production: number;
  crippled: { airfield: boolean; fuel: boolean; industry: boolean };
}

const clamp = (v: number) => Math.max(0, Math.min(1.2, v / 100));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function facilityEffects(f: Facilities): FacilityEffects {
  const crippled = { airfield: f.airfield < CRIPPLED, fuel: f.fuel < CRIPPLED, industry: f.industry < CRIPPLED };
  return {
    grounded: r2(Math.min(0.65, Math.max(0, 1 - clamp(f.airfield)) * 0.5 + (crippled.airfield ? 0.15 : 0))),
    // Crippled airfields: fighter cover is roughly halved.
    cover: crippled.airfield ? 0.55 : 1,
    stores: r2((0.3 + 0.7 * clamp(f.fuel)) * (crippled.fuel ? 0.7 : 1)),
    production: r2((0.4 + 0.6 * clamp(f.industry)) * (crippled.industry ? 0.7 : 1)),
    crippled,
  };
}

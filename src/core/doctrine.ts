/**
 * What a squadron's doctrine does, in the commander's terms. Each figure is read
 * straight off the formulas the battle sim uses (sim.ts), so the explanation
 * cannot drift from the game: change a coefficient there and change it here.
 */
import type { AircraftKind, Doctrine } from './types';

export type DoctrineKey = keyof Doctrine;

export interface DoctrineEffect {
  /** Which settings drive it. */
  keys: DoctrineKey[];
  label: string;
  /** Displayed value for these settings. */
  value: string;
  /** Raw number, for comparing two settings: a % change against standard (unit '%') or an absolute % (unit 'pts'). */
  raw: number;
  unit: '%' | 'pts';
  /** +1 if a higher raw value is good for us, -1 if bad, 0 if neither. */
  good: 1 | -1 | 0;
  /** One line on why. */
  why: string;
}

const isBomber = (k: AircraftKind) => k === 'medium' || k === 'heavy';

/** Which settings matter for a type (formation only for bombers: fighters fly in pairs whatever the order). */
export function doctrineKeys(kind: AircraftKind): DoctrineKey[] {
  if (kind === 'recon') return [];
  return isBomber(kind) ? ['formation', 'altitude', 'aggression', 'breakOff'] : ['aggression', 'altitude', 'breakOff'];
}

/** Rough bombing height for the altitude setting, in feet. */
export function altitudeFeet(alt: number): number {
  return Math.round((2000 + alt * 22000) / 500) * 500;
}

const sign = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}%`;
/** Relative change against the middle setting (0.5), as "+12%". */
const vsMid = (f: (x: number) => number, x: number) => (f(x) / f(0.5) - 1) * 100;

/** The effects of a doctrine for a squadron of this type and skill. */
export function doctrineEffects(kind: AircraftKind, d: Doctrine, skill = 0.5): DoctrineEffect[] {
  const out: DoctrineEffect[] = [];
  if (kind === 'recon') return out;
  const bomber = isBomber(kind);
  if (bomber) {
    // bomberPass: defensive fire ∝ (0.6 + 0.9 f); target choice weight ∝ (1.4 − 0.6 f); gunner claims 0.18 + 0.25 f.
    const fire = vsMid((f) => 0.6 + 0.9 * f, d.formation);
    const picked = vsMid((f) => 1.4 - 0.6 * f, d.formation);
    out.push({ keys: ['formation'], label: 'Return fire from the gunners', value: sign(fire), raw: fire, unit: '%', good: 1, why: 'A tight box puts many guns on every attacker.' });
    out.push({ keys: ['formation'], label: 'Singled out by fighters', value: sign(picked), raw: picked, unit: '%', good: -1, why: 'Fighters pick on loose formations and stragglers.' });
    const claims = 18 + 25 * d.formation;
    out.push({ keys: ['formation'], label: 'Gunners claiming the same kill', value: `${Math.round(claims)}%`, raw: claims, unit: 'pts', good: -1, why: 'In a tight box every gunner who fired believes the kill was his: claims run high.' });
  }
  // Over the target: flak ∝ (1.55 − a); accuracy 0.3 + 0.35 skill + 0.25 (1 − a) + 0.1 g. Close support always goes in low.
  const flak = vsMid((a) => 1.55 - a, d.altitude);
  out.push({ keys: ['altitude'], label: 'Flak hits over the target', value: sign(flak), raw: flak, unit: '%', good: -1, why: bomber ? 'The higher, the less the guns can reach. Close support always goes in low.' : 'Only matters for fighters escorting a raid over the target.' });
  // Detection: (0.5 − average altitude of the raid) × 0.2 on the enemy's chance to find it.
  const detect = (0.5 - d.altitude) * 20;
  out.push({ keys: ['altitude'], label: 'Chance enemy fighters find the raid', value: `${detect >= 0 ? '+' : '−'}${Math.abs(Math.round(detect))} pts`, raw: detect, unit: 'pts', good: -1, why: 'High raids are harder to spot and reach. The whole raid\'s average height counts.' });
  if (bomber) {
    const acc = (a: number, g: number) => 0.3 + 0.35 * skill + 0.25 * (1 - a) + 0.1 * g;
    const accuracy = (acc(d.altitude, d.aggression) / acc(0.5, 0.5) - 1) * 100;
    out.push({ keys: ['altitude', 'aggression'], label: 'Bombing accuracy', value: sign(accuracy), raw: accuracy, unit: '%', good: 1, why: 'Bombs dropped from low level fall closer, and crews who press the run home hold it steady.' });
  } else {
    // dogfight ∝ (0.6 + 0.8 g); bomberPass ∝ (0.65 + 0.7 g); escort engages 0.55 + 0.35 g; second pass chance g.
    const guns = vsMid((g) => 0.65 + 0.7 * g, d.aggression);
    out.push({ keys: ['aggression'], label: 'Firepower in each attack', value: sign(guns), raw: guns, unit: '%', good: 1, why: 'Pilots who close right in hit harder, on bombers and fighters alike.' });
    out.push({ keys: ['aggression'], label: 'Second attack on a bomber', value: `${Math.round(d.aggression * 100)}%`, raw: d.aggression * 100, unit: 'pts', good: 1, why: 'Chance an interceptor comes round again. Every pass also exposes him to the gunners.' });
    out.push({ keys: ['aggression'], label: 'Escorts engaging interceptors', value: `${Math.round((0.55 + 0.35 * d.aggression) * 100)}%`, raw: (0.55 + 0.35 * d.aggression) * 100, unit: 'pts', good: 1, why: 'Escorts that turn into the enemy tie them up before they reach the bombers.' });
  }
  const off = Math.round(d.breakOff * 100);
  out.push({ keys: ['breakOff'], label: 'Squadron turns back after losing', value: d.breakOff >= 0.99 ? 'never' : `${off}%`, raw: -d.breakOff * 100, unit: 'pts', good: 0, why: 'Breaking off early saves crews but leaves the job undone; never breaking off finishes it at any price.' });
  return out;
}

/** A plain sentence describing a setting, for the squadron card. */
export function doctrineSummary(kind: AircraftKind, key: DoctrineKey, v: number): string {
  switch (key) {
    case 'formation':
      return v >= 0.75 ? 'Tight combat box: mutual fire support, but the gunners over-claim.' : v >= 0.4 ? 'Standard formation.' : 'Loose formation: easy to fly, easy to pick off.';
    case 'altitude':
      return `About ${altitudeFeet(v).toLocaleString('en-GB')} ft. ${v >= 0.7 ? 'Above most of the flak; bombs scatter.' : v >= 0.35 ? 'A compromise between flak and accuracy.' : 'Under the radar, into the flak; bombs land where aimed.'}`;
    case 'aggression':
      return isBomber(kind)
        ? v >= 0.7 ? 'Press home every run.' : v >= 0.35 ? 'Normal bombing discipline.' : 'Drop and get out.'
        : v >= 0.7 ? 'Close to point-blank, come round again.' : v >= 0.35 ? 'Attack, but do not chase.' : 'Fire from range, break away early.';
    case 'breakOff':
      return v >= 0.99 ? 'Never break off.' : `Break off once ${Math.round(v * 100)}% of the squadron is lost.`;
  }
}

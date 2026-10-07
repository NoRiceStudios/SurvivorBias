import { RESEARCH, type TechKey } from './data';
import { rulesOf } from './factions';
import type { SideState } from './types';

const BY_ID = new Map(RESEARCH.map((r) => [r.id, r]));

/** Sum of a research effect over everything a side has developed, plus its nation's innate effects. */
export function tech(side: Pick<SideState, 'research' | 'id' | 'faction'>, key: TechKey): number {
  let v = rulesOf(side).effects[key] ?? 0;
  for (const id of side.research) v += BY_ID.get(id)?.effects?.[key] ?? 0;
  return v;
}

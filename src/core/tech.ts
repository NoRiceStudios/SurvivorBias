/** Sum of a research effect over everything a side has developed, and what its air force brings. */
import { RESEARCH, type TechKey } from './data';
import { factionTech } from './factions';
import type { SideState } from './types';

const BY_ID = new Map(RESEARCH.map((r) => [r.id, r]));

export function tech(side: Pick<SideState, 'research'> & Partial<Pick<SideState, 'faction'>>, key: TechKey): number {
  let v = factionTech(side, key);
  for (const id of side.research) v += BY_ID.get(id)?.effects?.[key] ?? 0;
  return v;
}

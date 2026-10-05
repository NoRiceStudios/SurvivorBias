/** Sum of a research effect over everything a side has developed. */
import { RESEARCH, type TechKey } from './data';
import type { SideState } from './types';

const BY_ID = new Map(RESEARCH.map((r) => [r.id, r]));

export function tech(side: Pick<SideState, 'research'>, key: TechKey): number {
  let v = 0;
  for (const id of side.research) v += BY_ID.get(id)?.effects?.[key] ?? 0;
  return v;
}

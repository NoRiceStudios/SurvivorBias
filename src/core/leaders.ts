/** A squadron leader's record: what the squadron remembers of him. */
import type { Leader, RequestKind } from './types';

export function remember(leader: Leader, week: number, text: string, kind?: RequestKind, approved?: boolean) {
  leader.log = [...(leader.log ?? []), { week, text, ...(kind ? { kind, approved } : {}) }].slice(-12);
}
